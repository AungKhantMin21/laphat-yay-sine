// One running game: clock, world, economy and build commands. Plain TS (tested headless);
// worker.ts only adds messaging and timing around it.
import { CATALOG, SERVICE } from '../shared/catalog';
import type { FrameWriter } from '../shared/diff';
import type { Action, PlayerState, SimEvent } from '../shared/protocol';
import start from '../data/start.json';
import { INGREDIENTS } from '../shared/ingredients';
import { createArea, ENTRIES, SEATING } from './area';
import { ACCESS } from '../shared/rules/access';
import { DRINKS, pourScore, pouredPrice, reactionFor, tipFor } from '../shared/drinks';
import { Service } from './service/service';
import { TASK } from './service/task-board';
import { Market, type Goods } from './market/market';
import { ITEM } from '../shared/market';
import { MATERIALS } from '../shared/materials';
import { NEIGHBOURHOOD } from '../shared/neighbourhood';
import { isShopZone } from '../shared/rules/access';
import { PLAYER, ROLE, WS, Workers } from './npc/workers';
import { STAFF, hireBlock } from '../shared/staff';
import { MAX_WORKERS } from '../shared/layout';
import { PHASE, minuteOfDay } from '../shared/day';
import { teaserAppeal, teaserGuest, teaserRate } from '../shared/teasers';
import { SHOP } from '../shared/shop';
import { Customers } from './npc/customers';
import { Builder, type Result } from './build/builder';
import { Sim } from './sim';
import { SimWorld } from './world';
import { ShopDay } from './day/shop-day';
import { WalkGrid } from './path/walk-grid';
import { PathFinder } from './path/pathfinder';
import { checkPlacement, newPlaceResult } from '../shared/rules/placement';
import { SAVE_SCHEMA, type SaveData, type SavedObject, type StaffMember } from './save/format';

const res = (err: string): Result => (err ? { ok: false, reason: err } : { ok: true });

export class Game {
  /** Events for the main thread, drained by the worker after each step or action. */
  readonly events: SimEvent[] = [];
  /** Walk grid for customers (ACCESS.people). */
  readonly walk: WalkGrid;
  /** Walk grid for the player and staff (ACCESS.staff: also the kitchen). */
  readonly walkStaff: WalkGrid;
  readonly paths: PathFinder;
  readonly npcs: Customers;
  /** Task board, cups and the rules of each service job. */
  readonly service: Service;
  /** The player character and staff. */
  readonly workers: Workers;
  /** Hired staff (saved): role key, the day they were hired, and whether they're off (unpaid) today. */
  staff: StaffMember[] = [];
  /** Last game minute an arrival was rolled for (one roll per minute). */
  private arrivalMinute = -1;
  /** The neighbourhood shops: today's stock, goods in hand, deliveries (M3). */
  readonly market: Market;
  /** Building materials in tiles, per material id (M3; the paint tool uses them). */
  readonly materials: Int32Array;

  constructor(
    readonly sim: Sim,
    readonly world: SimWorld,
    readonly builder: Builder,
    readonly day: ShopDay = new ShopDay(),
  ) {
    day.update(sim.gameMinute, 0);
    world.clearWalkDirty(); // the walk grid below starts from the current occupancy
    this.walk = new WalkGrid(world.state.area, world.state.occ, ACCESS.people);
    this.walkStaff = new WalkGrid(world.state.area, world.state.occ, ACCESS.staff);
    this.paths = new PathFinder([this.walk, this.walkStaff]);
    this.npcs = new Customers(world, this.walk, this.paths, sim.rng.npcDecide, sim.rng.cosmetic, { entries: ENTRIES });
    this.service = new Service(world, this.npcs, (h, drink, score, wait, poured) => this.pay(h, drink, score, wait, poured));
    this.service.onFreeTea = (h) => this.events.push({ k: 'freeTea', id: h });
    this.workers = new Workers(this.walkStaff, this.paths, this.service, this.npcs, (e) => this.events.push(e), sim.rng.npcDecide);
    const home = this.workers.homeTile();
    this.workers.spawn(PLAYER, ROLE.player, home >= 0 ? home : SEATING.y0 * this.walk.w + SEATING.x0);
    this.market = new Market(sim.seed);
    this.materials = new Int32Array(MATERIALS.defs.length);
    this.market.refresh(sim.day);
  }

  /** Purchases land here: ingredients on the kitchen shelf, objects in the inventory, materials in the store. */
  receive(g: Goods): void {
    if (g.kind === ITEM.ingredient) this.service.stock.add(g.id, g.qty * INGREDIENTS.defs[g.id]!.pack);
    else if (g.kind === ITEM.material) this.materials[g.id] = this.materials[g.id]! + g.qty * MATERIALS.defs[g.id]!.pack;
    else this.builder.give(g.id, g.qty);
    this.materialsChanged = true;
  }
  private materialsChanged = false;

  /** Buys at a neighbourhood shop (the player must stand at its counter, during its hours). */
  private buy(shop: number, row: number, qty: number, deliver: boolean): Result {
    const w = this.workers;
    const site = NEIGHBOURHOOD.shops[shop];
    const atCounter = !!site && w.tile[PLAYER] === site.visitY * this.walkStaff.w + site.visitX && w.state[PLAYER] !== WS.walking;
    const b = this.builder;
    const r = this.market.buy(shop, row, qty, deliver, b.money, minuteOfDay(this.sim.gameMinute), atCounter, this.sim.gameMinute, this.day.holds);
    if (r.reason) return { ok: false, reason: r.reason };
    b.money -= r.paid;
    b.changed = true;
    this.events.push({ k: 'money', delta: -r.paid, total: b.money });
    return { ok: true };
  }

  /** Goods in hand are put away once the player is inside; deliveries arrive when due. */
  private goods(opening: boolean): void {
    const m = this.market;
    if (m.carry.length > 0) {
      const t = this.workers.tile[PLAYER]!;
      if (t >= 0 && isShopZone(this.world.state.area.access[t]!)) {
        const got = m.putAway(this);
        if (got) this.events.push({ k: 'putAway', goods: got });
      }
    }
    const got = m.deliverDue(this.sim.gameMinute, opening, this);
    if (got) this.events.push({ k: 'delivered', goods: got });
  }

  /**
   * A customer got their cup: the full price plus a tip from the pour score and the wait, into the
   * tin; today's stats; events for the main thread.
   */
  private pay(id: number, drinkId: number, score: number, wait: number, poured: boolean): void {
    const drink = DRINKS.defs[drinkId]!;
    const price = pouredPrice(drink);
    const tip = tipFor(drink, score, wait);
    const b = this.builder;
    b.money += price + tip;
    b.changed = true;
    const t = this.day.today;
    t.served++;
    if (poured) {
      t.poured++;
      t.best = Math.max(t.best, Math.round(score * 100));
    }
    t.earned += price + tip;
    t.tips += tip;
    this.day.changed = true;
    const reaction = reactionFor(score);
    this.events.push({ k: 'served', id, drink: drinkId, poured, price, tip, reaction, wait: Math.round(wait) });
    this.events.push({ k: 'money', delta: price + tip, total: b.money });
  }

  // ---- staff (M2.5) ----

  /** Hires one of `role` (evening only; one of each role; unlocked by savings and seats). */
  private hire(role: string): Result {
    if (this.day.phase !== PHASE.evening) return { ok: false, reason: 'day.err.notNow' };
    const def = STAFF.byKey.get(role);
    if (!def) return { ok: false, reason: 'staff.err.notYet' };
    if (this.staff.some((m) => m.role === role)) return { ok: false, reason: 'staff.err.hired' };
    if (this.staff.length >= MAX_WORKERS - 1) return { ok: false, reason: 'staff.err.full' };
    const block = hireBlock(def, this.builder.money, this.npcs.seatCount());
    if (block) return { ok: false, reason: block };
    // They start tomorrow; the first wage is paid tonight at Sleep.
    this.staff.push({ role, hiredDay: this.sim.day, dayOff: true });
    this.day.changed = true;
    return { ok: true };
  }

  private dismiss(role: string): Result {
    if (this.day.phase !== PHASE.evening) return { ok: false, reason: 'day.err.notNow' };
    const k = this.staff.findIndex((m) => m.role === role);
    if (k < 0) return { ok: false, reason: 'staff.err.notHired' };
    this.staff.splice(k, 1);
    this.spawnStaff();
    this.day.changed = true;
    return { ok: true };
  }

  /**
   * Sleep: each staff member's wage comes out of the tin for tomorrow. If the tin holds less, they take
   * an unpaid day off instead — nothing is taken and money never goes below zero.
   */
  private payWages(): void {
    if (this.staff.length === 0) return;
    const b = this.builder;
    let paid = 0;
    let off = 0;
    for (const m of this.staff) {
      const wage = STAFF.byKey.get(m.role)!.wage;
      if (b.money >= wage) {
        b.money -= wage;
        paid += wage;
        m.dayOff = false;
      } else {
        m.dayOff = true;
        off++;
      }
    }
    b.changed = true;
    this.day.changed = true;
    this.events.push({ k: 'wages', paid, dayOff: off, total: b.money });
    this.spawnStaff();
  }

  /** Workers 2… follow the roster: present unless on a day off. */
  spawnStaff(): void {
    const home = this.workers.homeTile();
    for (let w = 2; w < this.workers.capacity; w++) {
      const m = this.staff[w - 2];
      const want = m !== undefined && !m.dayOff;
      if (want && !this.workers.alive[w]) {
        this.workers.spawn(w, ROLE.waiter, home >= 0 ? home : this.workers.tile[PLAYER]!, STAFF.byKey.get(m.role)!);
      } else if (!want && this.workers.alive[w]) {
        this.workers.despawn(w);
      }
    }
  }

  /** Rebuilds walk costs around build changes (searches in flight restart). */
  syncWalk(): void {
    const w = this.world;
    if (!w.walkDirty) return;
    this.walk.update(w.walkX0, w.walkY0, w.walkX1, w.walkY1);
    this.walkStaff.update(w.walkX0, w.walkY0, w.walkX1, w.walkY1);
    w.clearWalkDirty();
  }

  /** Customers still in or heading to the shop. */
  customers(): number {
    return this.npcs.inShop();
  }

  /** A new game. `layout` = false leaves the shop empty (tests that build their own layout). */
  static create(seed: number, layout = true): Game {
    const inv = new Uint16Array(CATALOG.defs.length);
    for (const [key, n] of Object.entries(start.inventory as Record<string, number>)) {
      const def = CATALOG.byKey.get(key);
      if (def) inv[def.id] = n;
    }
    const world = new SimWorld(createArea());
    for (const e of layout ? start.layout : []) {
      if (!placeStart(world, e)) throw new Error(`start.json: ${e.key} at ${e.x},${e.y} breaks the placement rules`);
    }
    const game = new Game(new Sim(seed), world, new Builder(world, start.money, inv));
    game.giveStartStock();
    return game;
  }

  /** A new game's kitchen stock (start.json `stock`, ingredient keys → portions). */
  giveStartStock(): void {
    for (const [key, n] of Object.entries(start.stock as Record<string, number>)) {
      const def = INGREDIENTS.byKey.get(key);
      if (def) this.service.stock.add(def.id, n);
    }
  }

  /** Snapshot for saving. */
  toSave(nowMs: number): SaveData {
    const s = this.world.objects;
    const objects: SavedObject[] = [];
    for (let i = 1; i < s.capacity; i++) {
      if (!s.live[i]) continue;
      const p = s.parent[i]!;
      objects.push({
        uid: s.uid[i]!,
        key: CATALOG.defs[s.type[i]!]!.key,
        x: s.x[i]!,
        y: s.y[i]!,
        rot: s.rot[i]!,
        layer: s.layer[i]!,
        colour: s.colour[i]!,
        flags: s.flags[i]!,
        parentUid: p ? s.uid[p]! : 0,
      });
    }
    const inventory: Record<string, number> = {};
    this.builder.inventory.forEach((n, id) => {
      if (n > 0) inventory[CATALOG.defs[id]!.key] = n;
    });
    const r = this.sim.rng;
    const day = this.day;
    return {
      schema: SAVE_SCHEMA,
      seed: this.sim.seed,
      savedAt: nowMs,
      tick: this.sim.tick,
      clock: this.sim.clock,
      shuttersOpen: day.shuttersOpen,
      today: { ...day.today },
      teaser: { ...day.teaser },
      staff: this.staff.map((m) => ({ ...m })),
      rng: [r.market.state >>> 0, r.npcDecide.state >>> 0, r.events.state >>> 0, r.cosmetic.state >>> 0],
      money: this.builder.money,
      nextUid: this.world.uidCounter,
      inventory,
      objects,
    };
  }

  /**
   * Rebuilds a game from a save. Types are matched by key; objects whose key no longer exists
   * are skipped (reported in `skipped`). Parents are placed before the items standing on them.
   * Objects that break today's placement rules (the shop layout or rules changed since the save)
   * go back to the inventory, never lost (`returned`); so do items whose surface went back.
   */
  static fromSave(d: SaveData): { game: Game; skipped: number; returned: number; added: number } {
    const sim = new Sim(d.seed);
    sim.tick = d.tick;
    sim.clock = d.clock;
    [sim.rng.market.state, sim.rng.npcDecide.state, sim.rng.events.state, sim.rng.cosmetic.state] = d.rng;
    const world = new SimWorld(createArea());
    const inv = new Uint16Array(CATALOG.defs.length);
    for (const [key, n] of Object.entries(d.inventory)) {
      const def = CATALOG.byKey.get(key);
      if (def) inv[def.id] = Math.min(0xffff, n);
    }
    let skipped = 0;
    let returned = 0;
    const ordered = [...d.objects].sort((a, b) => Number(a.parentUid !== 0) - Number(b.parentUid !== 0));
    const check = newPlaceResult();
    for (const o of ordered) {
      const def = CATALOG.byKey.get(o.key);
      if (!def) {
        skipped++;
        continue;
      }
      const parent = o.parentUid ? world.objects.indexOfUid(o.parentUid) : 0;
      const ok = (!o.parentUid || parent !== 0) && checkPlacement(world.state, def.id, o.x, o.y, o.rot & 3, 0, check).ok && check.parent === parent;
      if (!ok) {
        inv[def.id] = Math.min(0xffff, inv[def.id]! + 1);
        returned++;
        continue;
      }
      world.add({ type: def.id, x: o.x, y: o.y, rot: o.rot & 3, layer: def.layer, colour: o.colour, parent }, o.uid);
    }
    world.uidCounter = d.nextUid;
    // Saves from before M2.5 have no kitchen fixtures: add any that are missing (never removes anything).
    const added = addMissingFixtures(world, inv);
    const day = new ShopDay();
    day.shuttersOpen = d.shuttersOpen;
    day.today = { ...d.today };
    day.teaser = { ...d.teaser };
    const game = new Game(sim, world, new Builder(world, d.money, inv), day);
    // Staff whose role no longer exists are dropped (they were never objects; nothing is lost).
    game.staff = d.staff.filter((m) => STAFF.byKey.has(m.role)).map((m) => ({ ...m }));
    game.spawnStaff();
    game.giveStartStock(); // S7: the saved stock (save v4)
    return { game, skipped, returned, added };
  }

  /** Runs a player action. Object ids on the wire are handles; stale handles are refused. */
  act(a: Action): Result {
    const b = this.builder;
    const idx = (h: number): number => this.world.objects.indexOf(h);
    switch (a.k) {
      case 'place':
        return b.place(a.type, a.x, a.y, a.rot, a.colour);
      case 'move':
        return b.move(idx(a.id), a.x, a.y, a.rot);
      case 'rotate':
        return b.rotate(idx(a.id), a.rot);
      case 'recolour':
        return b.recolour(idx(a.id), a.colour);
      case 'pickup':
        return b.pickup(idx(a.id));
      case 'sell':
        return b.sell(idx(a.id));
      case 'undo':
        return b.undo();
      case 'redo':
        return b.redo();
      case 'openShop': {
        const r = this.day.open(this.sim, this.customers());
        if (r.ok) this.goods(true); // deliveries ordered for the opening arrive
        return r;
      }
      case 'sleep': {
        const r = this.day.sleep(this.sim, this.customers());
        if (!r.ok) return r;
        if (r.ended) {
          // Running low on ingredients beats the usual teaser: tomorrow starts at the wet market.
          if (this.service.stock.cupsLeft() < INGREDIENTS.lowCups) this.day.teaser = { key: 'lowStock', arg: '' };
          this.events.push({ k: 'dayEnd', day: r.ended.day, stats: r.ended.stats });
          const t = this.day.teaser;
          if (t.key) this.events.push({ k: 'teaser', key: t.key, drink: DRINKS.byKey.get(t.arg)?.id ?? -1 });
        }
        this.npcs.clear(); // the last passers-by go home too
        this.service.endOfDay(); // cups washed overnight, no jobs left
        this.payWages();
        this.workers.reset(); // everyone back beside the counter
        // Overnight: goods in hand are put away and every delivery arrives.
        const carried = this.market.putAway(this);
        if (carried) this.events.push({ k: 'putAway', goods: carried });
        const arrived = this.market.deliverAll(this);
        if (arrived) this.events.push({ k: 'delivered', goods: arrived });
        this.market.refresh(this.sim.day);
        return { ok: true };
      }
      case 'hire':
        return this.hire(a.role);
      case 'dismiss':
        return this.dismiss(a.role);
      case 'queueTask':
        return res(this.workers.queueTask(PLAYER, a.task));
      case 'cancelTask':
        return res(this.workers.cancelTask(PLAYER, a.task));
      case 'walkTo': {
        const W = this.walkStaff.w;
        if (!Number.isInteger(a.x) || !Number.isInteger(a.y) || a.x < 0 || a.y < 0 || a.x >= W || a.y >= this.walkStaff.h) return { ok: false, reason: 'walk.err.cantGo' };
        return res(this.workers.queueErrand(PLAYER, TASK.go, a.y * W + a.x));
      }
      case 'visit':
        return res(this.workers.queueErrand(PLAYER, TASK.visit, a.shop));
      case 'buy':
        return this.buy(a.shop, a.item, a.qty, !!a.deliver);
      // The player's pour at the counter (the worker opened it with a brewReady event).
      case 'cancelPour':
        return res(this.workers.cancelBrew(PLAYER, a.id));
      case 'serve': {
        const i = this.npcs.indexOf(a.id);
        if (!i || !Number.isFinite(a.tea) || !Number.isFinite(a.milk)) return { ok: false, reason: 'serve.err.gone' };
        const score = pourScore(DRINKS.defs[this.npcs.drink[i]!]!, a.tea, a.milk, this.npcs.milkShift[i]!);
        return res(this.workers.brewDone(PLAYER, a.id, score));
      }
      default:
        return { ok: false, reason: 'error.notYet' };
    }
  }

  playerState(): PlayerState {
    const b = this.builder;
    const d = this.day;
    return {
      money: b.money,
      inventory: Array.from(b.inventory),
      canUndo: b.canUndo,
      canRedo: b.canRedo,
      phase: d.phase,
      day: this.sim.day,
      today: { ...d.today },
      queue: this.workers.playerQueue(),
      brewing: this.workers.brewFor[PLAYER]!,
      staff: this.staff.map((m) => ({ role: m.role, dayOff: m.dayOff })),
      seats: this.npcs.seatCount(),
      stock: Array.from(this.service.stock.count, (n, k) => n - this.service.stock.reserved[k]!),
      cupsLeft: this.service.stock.cupsLeft(),
      market: this.market.rows.map((rows) => rows.map((r) => ({ ...r }))),
      carry: this.market.carry.map((g) => ({ ...g })),
      carryLoad: this.market.load(),
      deliveries: this.market.deliveries.map((g) => ({ kind: g.kind, id: g.id, qty: g.qty })),
      materials: Array.from(this.materials),
    };
  }

  /** True once after anything in the player state changed. */
  takeChanged(): boolean {
    const c = this.builder.changed || this.day.changed || this.workers.changed || this.service.stock.changed || this.market.changed || this.materialsChanged;
    this.builder.changed = this.day.changed = this.workers.changed = this.service.stock.changed = this.market.changed = this.materialsChanged = false;
    return c;
  }

  /** Forces the next takeChanged() (after a snapshot). */
  markChanged(): void {
    this.day.changed = true;
  }

  step(w: FrameWriter): void {
    const day = this.day;
    this.syncWalk();
    this.paths.tick();
    day.update(this.sim.gameMinute, this.customers());
    this.sim.step(w, !day.holds);
    const minute = this.sim.gameMinute;
    if (minute !== this.arrivalMinute) {
      this.arrivalMinute = minute;
      const md = minuteOfDay(minute);
      if (day.phase === PHASE.open && md < SHOP.close) {
        const t = day.teaser;
        this.npcs.arrivalRoll(md, teaserRate(t, md), teaserAppeal(t));
        const guest = teaserGuest(t, md, SHOP.open);
        if (guest >= 0) this.npcs.spawn(guest);
      }
    }
    this.service.tick(this.sim.tick);
    this.npcs.tick(this.sim.tick);
    this.workers.tick(this.sim.tick);
    this.market.refresh(this.sim.day);
    this.goods(false);
    day.update(this.sim.gameMinute, this.customers());
    this.world.writeChanges(w);
    this.npcs.writeChanges(w);
    this.workers.writeChanges(w);
    this.service.writeChanges(w, this.workers);
  }

  /** Full state for a new main-thread mirror. */
  writeSnapshot(w: FrameWriter): void {
    this.world.writeSnapshot(w);
    this.npcs.writeSnapshot(w);
    this.workers.writeSnapshot(w);
    this.service.writeSnapshot(w, this.workers);
  }
}

interface StartEntry {
  key: string;
  x: number;
  y: number;
  rot: number;
}

const startCheck = newPlaceResult();

/** Places one start-layout object if the rules allow it there; returns the slot or 0. `onSurface`: small items only on a surface. */
function placeStart(world: SimWorld, e: StartEntry, onSurface = false): number {
  const def = CATALOG.byKey.get(e.key);
  if (!def) throw new Error(`start.json: unknown object "${e.key}"`);
  if (!checkPlacement(world.state, def.id, e.x, e.y, e.rot & 3, 0, startCheck).ok) return 0;
  if (onSurface && startCheck.parent === 0) return 0;
  return world.add({ type: def.id, x: e.x, y: e.y, rot: e.rot & 3, layer: def.layer, colour: 0, parent: startCheck.parent });
}

/**
 * Every shop needs one of each service fixture (counter, kettle, sink, stove). For any that is
 * missing, place the start-layout one: at its start spot, else the first legal spot in the shop,
 * else (the shop is full) into the inventory. Returns how many were added.
 */
function addMissingFixtures(world: SimWorld, inv: Uint16Array): number {
  const s = world.objects;
  const have = new Set<number>();
  for (let i = 1; i < s.capacity; i++) if (s.live[i]) have.add(CATALOG.defs[s.type[i]!]!.service);
  let added = 0;
  for (const e of start.layout) {
    const def = CATALOG.byKey.get(e.key)!;
    if (def.service === SERVICE.none || have.has(def.service)) continue;
    have.add(def.service);
    added++;
    if (placeStart(world, e)) continue;
    let placed = false;
    const a = world.state.area;
    // Small items (the kettle) try surfaces first, then the floor.
    for (let pass = def.small ? 0 : 1; pass < 2 && !placed; pass++) {
      for (let y = 0; y < a.h && !placed; y++) {
        for (let x = 0; x < a.w && !placed; x++) {
          for (let rot = 0; rot < 4 && !placed; rot++) placed = placeStart(world, { key: e.key, x, y, rot }, pass === 0) !== 0;
        }
      }
    }
    if (!placed) inv[def.id] = Math.min(0xffff, inv[def.id]! + 1);
  }
  return added;
}
