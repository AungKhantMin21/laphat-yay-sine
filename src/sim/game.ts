// One running game: clock, world, economy and build commands. Plain TS (tested headless);
// worker.ts only adds messaging and timing around it.
import { CATALOG, LAYER, SERVICE, footH, footW } from '../shared/catalog';
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
import { ITEM, itemId, itemKey } from '../shared/market';
import { MATERIALS } from '../shared/materials';
import { NEIGHBOURHOOD } from '../shared/neighbourhood';
import { isShopZone } from '../shared/rules/access';
import { PAINT_LAYER, checkPaint } from '../shared/rules/placement';
import { PLAYER, ROLE, WS, Workers } from './npc/workers';
import { STAFF, hireBlock } from '../shared/staff';
import { FLOOR, MAX_WORKERS, WALL_COLOURS, ZONE } from '../shared/layout';
import { PHASE, minuteOfDay } from '../shared/day';
import { teaserAppeal, teaserGuest, teaserRate } from '../shared/teasers';
import { SHOP } from '../shared/shop';
import { Customers } from './npc/customers';
import { Residents } from './npc/residents';
import { PropertyMarket, type NewsItem } from './world/property-market';
import { LISTING, PROPERTIES, PS, type Expansion, type PropertyDef } from '../shared/properties';
import { RESIDENTS } from '../shared/residents';
import { Builder, type Result } from './build/builder';
import { Sim } from './sim';
import { SimWorld } from './world';
import { ShopDay } from './day/shop-day';
import { WalkGrid } from './path/walk-grid';
import { PathFinder } from './path/pathfinder';
import { checkPlacement, newPlaceResult } from '../shared/rules/placement';
import { SAVE_SCHEMA, type SaveData, type SavedObject, type SaveNeighbourhood, type SavedPaint, type SaveWorld, type StaffMember } from './save/format';

const res = (err: string): Result => (err ? { ok: false, reason: err } : { ok: true });

/** FLOOR key by value (saves store floor finishes by key). */
const FLOOR_KEYS: string[] = [];
for (const [k, v] of Object.entries(FLOOR)) FLOOR_KEYS[v] = k;

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
  /** Day phase seen last step (closing starts: walkers still on their way go home). */
  private lastPhase = -1;
  /** The neighbourhood shops: today's stock, goods in hand, deliveries (M3). */
  readonly market: Market;
  /** The named neighbours (M4). */
  readonly residents: Residents;
  /** The property market and the street's news (M4). */
  properties: PropertyMarket;
  /** Residents not living here now (moved away, or newcomers yet to come), by key. */
  spares: string[] = RESIDENTS.spare.map((d) => d.key);
  /** Keepers mask last sent in PlayerState. */
  private keepers = -1;

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
    this.market.refresh(sim.day);
    this.residents = new Residents(this.walk, this.paths, sim.seed);
    this.residents.hooks = { teaVisit: (_r, from, drink, look) => this.npcs.spawnResident(_r, from, drink, look) };
    this.npcs.onResidentGone = (r) => this.residents.backFromTea(r);
    this.residents.settle(sim.day, sim.gameMinute);
    this.residents.near = this.npcs.near;
    this.properties = new PropertyMarket(sim.seed, (p) => this.houseOwner(p));
  }

  /** The first resident living behind a house's door ('' if nobody). */
  private houseOwner(p: PropertyDef): string {
    if (p.door < 0) return '';
    const res = this.residents;
    for (let r = 0; r < res.capacity; r++) if (res.who[r] && res.doorOf(r) === p.door) return res.who[r]!.key;
    return '';
  }

  /** A house sold to a newcomer: its owner moves away, the first spare resident moves in. */
  private houseSold(p: PropertyDef): [string, string] | null {
    const res = this.residents;
    const owner = this.properties.props[p.id]!.owner;
    const r = owner ? res.slotOf(owner) : -1;
    if (r < 0 || this.spares.length === 0) return null;
    const came = this.spares.shift()!;
    const def = RESIDENTS.byKey.get(came);
    if (!def) return null;
    res.moveOut(r);
    res.moveIn(r, def, p.door);
    this.spares.push(owner);
    return [owner, came];
  }

  // ---- growing the shop (M4) ----

  /** The lots joined to the shop now (bought or rented). */
  spaces(): Expansion[] {
    return spacesOf(PROPERTIES.defs.map((def, i) => ({ key: def.key, state: this.properties.props[i]!.state })));
  }

  /** The player stands at the notice board (and isn't walking). */
  private atBoard(): boolean {
    const b = NEIGHBOURHOOD.board;
    const w = this.workers;
    return w.tile[PLAYER] === b.visitY * this.walkStaff.w + b.visitX && w.state[PLAYER] !== WS.walking;
  }

  /** Buys (or rents) a listed lot that joins the shop, at the notice board. Rent is paid at Sleep. */
  private takeProperty(key: string, rent: boolean): Result {
    const def = PROPERTIES.byKey.get(key);
    if (!def || !def.expand) return { ok: false, reason: 'board.err.notForYou' };
    const p = this.properties.props[def.id]!;
    if (p.state !== PS.listed || !(p.listing & (rent ? LISTING.rent : LISTING.sale))) return { ok: false, reason: 'board.err.gone' };
    if (!this.atBoard()) return { ok: false, reason: 'board.err.notHere' };
    const b = this.builder;
    const cost = rent ? def.rent : p.price;
    if (b.money < cost) return { ok: false, reason: 'board.err.money' };
    if (!rent) {
      b.money -= cost;
      b.changed = true;
      this.events.push({ k: 'money', delta: -cost, total: b.money });
    }
    this.properties.take(def, rent, this.sim.day);
    const returned = this.clearForArea(def.expand, false);
    this.applySpaces();
    this.events.push({ k: 'propertyTaken', key, rented: rent, returned });
    return { ok: true };
  }

  /** A rented lot goes back to its landlord: whatever stands there goes into the inventory. */
  private endLease(def: PropertyDef, unpaid: boolean): void {
    const returned = this.clearForArea(def.expand!, true);
    this.properties.endLease(def, this.sim.day);
    this.applySpaces();
    // Nobody stands where the shop no longer is.
    const home = this.workers.homeTile();
    const a = this.world.state.area;
    for (let w = 1; w < this.workers.capacity; w++) {
      const t = this.workers.tile[w]!;
      if (this.workers.alive[w] && home >= 0 && (a.zone[t]! & ZONE.owned) === 0 && !this.walkStaff.passable(t)) this.workers.place(w, home);
    }
    this.builder.clearHistory(); // history may name objects that just went into the inventory
    this.builder.changed = true;
    this.events.push({ k: 'leaseEnded', key: def.key, returned, unpaid });
  }

  /**
   * Objects that would no longer fit when lot `e` joins (party-wall items where the wall opens) or
   * leaves (`leaving`: everything inside it) go into the inventory. Returns how many.
   */
  private clearForArea(e: Expansion, leaving: boolean): number {
    const s = this.world.objects;
    const { x0, y0, x1, y1 } = e.rect;
    const party = e.join === 'w' ? x0 : x1;
    const out: number[] = [];
    for (let i = 1; i < s.capacity; i++) {
      if (!s.live[i]) continue;
      const def = CATALOG.defs[s.type[i]!]!;
      const ox = s.x[i]!;
      const oy = s.y[i]!;
      const ow = footW(def, s.rot[i]!);
      const oh = footH(def, s.rot[i]!);
      const inside = ox < x1 && ox + ow > x0 && oy < y1 && oy + oh > y0;
      const onParty = s.layer[i] === LAYER.wall && ox === party && oy >= e.opening[0] && oy < e.opening[1];
      if ((leaving && inside) || onParty) out.push(i);
    }
    // Items standing on a surface go with it.
    for (let i = 1; i < s.capacity; i++) if (s.live[i] && s.parent[i] && out.includes(s.parent[i]!) && !out.includes(i)) out.push(i);
    out.sort((a, b) => Number(s.parent[b] !== 0) - Number(s.parent[a] !== 0)); // children first
    for (const i of out) {
      this.builder.give(s.type[i]!, 1);
      this.world.remove(i);
    }
    if (out.length) this.builder.clearHistory();
    return out.length;
  }

  /** Rebuilds the tiles around every lot from the neighbourhood with today's spaces joined. */
  private applySpaces(): void {
    const next = createArea(this.spaces());
    const a = this.world.state.area;
    const W = a.w;
    for (const def of PROPERTIES.defs) {
      if (!def.expand) continue;
      const r = def.expand.rect;
      const x0 = Math.max(0, r.x0 - 1);
      const y0 = Math.max(0, r.y0 - 1);
      const x1 = Math.min(W, r.x1 + 1);
      const y1 = Math.min(a.h, r.y1 + 1);
      for (let y = y0; y < y1; y++) {
        for (let x = x0; x < x1; x++) {
          const t = y * W + x;
          const was = a.zone[t]!;
          // Floors change only where the tile joins or leaves the shop (painted shop floors stay).
          if ((was & ZONE.owned) !== (next.zone[t]! & ZONE.owned)) a.floor[t] = next.floor[t]!;
          a.wall[t] = next.wall[t]!;
          a.zone[t] = next.zone[t]!;
          a.access[t] = next.access[t]!;
          a.facade[t] = next.facade[t]!;
          if (a.wall[t] === 0 || (next.zone[t]! & ZONE.owned) === 0) a.paint[t] = 0;
          this.world.grids.rebase(t, (was & ZONE.roof) !== 0, (a.zone[t]! & ZONE.roof) !== 0);
        }
      }
      this.world.grids.refresh(x0, y0, x1, y1);
      this.world.retile(x0, y0, x1, y1);
    }
    this.syncWalk();
  }

  /** Sleep: rent for each rented lot comes out of the tin; if it can't, that lease ends calmly. */
  private payRent(): void {
    const b = this.builder;
    PROPERTIES.defs.forEach((def, i) => {
      if (this.properties.props[i]!.state !== PS.rented) return;
      if (b.money >= def.rent) {
        b.money -= def.rent;
        b.changed = true;
        this.events.push({ k: 'money', delta: -def.rent, total: b.money });
      } else this.endLease(def, true);
    });
  }

  /** The once-a-day world step (M4): the property market rolls for `day`. Sleep and catch-up both use it. */
  worldDay(day: number): void {
    this.properties.rollDay(day, { houseSold: (p) => this.houseSold(p) });
  }

  /**
   * The main thread's view in tiles (M4 LOD): only customers and residents in it (plus a margin) are
   * streamed. Workers (the player, staff) are always streamed. Nothing in the simulation reads it.
   */
  setViewport(x0: number, y0: number, x1: number, y1: number): void {
    if (![x0, y0, x1, y1].every(Number.isFinite)) return;
    this.npcs.near.set(x0, y0, x1, y1);
  }

  /** Purchases land here: ingredients on the kitchen shelf, objects in the inventory, materials in the store. */
  receive(g: Goods): void {
    if (g.kind === ITEM.ingredient) this.service.stock.add(g.id, g.qty * INGREDIENTS.defs[g.id]!.pack);
    else if (g.kind === ITEM.material) {
      const m = this.builder.materials;
      m[g.id] = m[g.id]! + g.qty * MATERIALS.defs[g.id]!.pack;
      this.builder.changed = true;
    } else this.builder.give(g.id, g.qty);
  }

  /** Building materials in tiles (Builder owns them: painting is undoable). */
  get materials(): Int32Array {
    return this.builder.materials;
  }

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
    const ci = this.npcs.indexOf(id);
    const res = ci ? this.npcs.resident[ci]! : -1;
    if (res >= 0) {
      this.residents.visits[res] = Math.min(0xffff, this.residents.visits[res]! + 1);
      // A neighbour passes on the street's news (M4): the newest thing you haven't heard.
      const n = this.properties.tell();
      const who = this.residents.who[res];
      if (n && who) this.events.push({ k: 'gossip', id, who: who.key, news: { kind: n.kind, prop: n.prop, a: n.a, b: n.b } });
    }
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
  }

  /** The street end staff member w comes from and goes home to (M4). */
  private staffEnd(w: number): number {
    const ends = NEIGHBOURHOOD.ends;
    const e = ends[(w - 2) % ends.length]!;
    return e.y * this.walkStaff.w + e.x;
  }

  /**
   * Workers 2… follow the roster: present unless on a day off, and not in the evening (they've gone
   * home). With `arrive`, newcomers walk in from their street end (the morning); otherwise they're
   * placed beside the counter (a load mid-day). Anyone no longer wanted goes at once.
   */
  spawnStaff(arrive = false): void {
    const home = this.workers.homeTile();
    const here = home >= 0 ? home : this.workers.tile[PLAYER]!;
    const evening = this.day.phase === PHASE.evening;
    for (let w = 2; w < this.workers.capacity; w++) {
      const m = this.staff[w - 2];
      const want = m !== undefined && !m.dayOff && !evening;
      if (want && !this.workers.alive[w]) {
        this.workers.spawn(w, ROLE.waiter, arrive ? this.staffEnd(w) : here, STAFF.byKey.get(m.role)!);
        if (arrive) this.workers.commute(w, here, false);
      } else if (!want && this.workers.alive[w]) {
        this.workers.despawn(w);
      }
    }
  }

  /** Evening: staff stop work and walk home (M4). */
  private staffHome(): void {
    for (let w = 2; w < this.workers.capacity; w++) if (this.workers.alive[w]) this.workers.commute(w, this.staffEnd(w), true);
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
      hood: this.saveHood(),
      world: this.saveWorld(),
    };
  }

  /** The living-world part of the save (M4). */
  private saveWorld(): SaveWorld {
    const pm = this.properties;
    const res = this.residents;
    const residents: SaveWorld['residents'] = [];
    for (let r = 0; r < res.capacity; r++) {
      const d = res.who[r];
      if (d) residents.push({ key: d.key, door: res.doorOf(r), visits: res.visits[r]! });
    }
    for (const key of this.spares) residents.push({ key, door: 255, visits: 0 });
    return {
      rolledDay: pm.rolledDay,
      nextNews: pm.nextNews,
      props: PROPERTIES.defs.map((def, i) => ({ key: def.key, ...pm.props[i]! })),
      news: pm.news.map((n) => ({ ...n })),
      residents,
    };
  }

  /** Restores the living world (empty lists = an upgraded older save: keep the new world). */
  private loadWorld(w: SaveWorld): void {
    const res = this.residents;
    if (w.residents.length > 0) {
      const seen = new Set<string>();
      res.clearAll();
      this.spares = [];
      let slot = 0;
      for (const s of w.residents) {
        const def = RESIDENTS.byKey.get(s.key);
        if (!def || seen.has(s.key)) continue;
        seen.add(s.key);
        if (s.door === 255 || !NEIGHBOURHOOD.doors[s.door] || slot >= res.capacity) {
          this.spares.push(s.key);
          continue;
        }
        res.moveIn(slot, def, s.door);
        res.visits[slot] = s.visits;
        slot++;
      }
      // People added to the data since the save was made.
      for (const def of RESIDENTS.residents) if (!seen.has(def.key) && slot < res.capacity) res.moveIn(slot++, def, def.home);
      for (const def of RESIDENTS.spare) if (!seen.has(def.key)) this.spares.push(def.key);
      res.settle(this.sim.day, this.sim.gameMinute);
    }
    const pm = this.properties;
    for (const s of w.props) {
      const def = PROPERTIES.byKey.get(s.key);
      if (!def) continue;
      const p = pm.props[def.id]!;
      p.state = s.state;
      p.listing = s.listing;
      p.price = s.price;
      p.days = s.days;
      p.cooldown = s.cooldown;
      p.owner = s.owner;
      p.closed = s.closed;
      p.listedOnce = s.listedOnce;
      p.urgent = s.urgent;
      p.fortune = s.fortune;
      p.slow = s.slow;
    }
    pm.rolledDay = w.rolledDay;
    pm.nextNews = Math.max(1, w.nextNews);
    pm.news = w.news.map((n) => ({ ...n }));
  }

  /** The neighbourhood part of the save (M3). Goods are stored by key. */
  private saveHood(): SaveNeighbourhood {
    const m = this.market;
    const st = this.service.stock;
    const stock: Record<string, number> = {};
    INGREDIENTS.defs.forEach((d) => st.count[d.id]! > 0 && (stock[d.key] = st.count[d.id]!));
    const materials: Record<string, number> = {};
    MATERIALS.defs.forEach((d) => this.materials[d.id]! > 0 && (materials[d.key] = this.materials[d.id]!));
    const sold: Record<string, number[]> = {};
    NEIGHBOURHOOD.shops.forEach((s) => (sold[s.key] = [...(m.sold[s.id] ?? [])]));
    return {
      marketDay: m.day,
      sold,
      stock,
      materials,
      carry: m.carry.map((g) => ({ kind: g.kind, key: itemKey(g.kind, g.id), qty: g.qty })),
      deliveries: m.deliveries.map((g) => ({ kind: g.kind, key: itemKey(g.kind, g.id), qty: g.qty, due: g.due })),
      painted: this.painted(),
    };
  }

  /** Tiles that differ from the neighbourhood as built (floors laid or walls coloured with the paint tool). */
  private painted(): SavedPaint[] {
    const a = this.world.state.area;
    const spaces = this.spaces();
    const sig = spaces.map((e) => `${e.rect.x0},${e.rect.y0}`).join('|');
    if (!Game.baseArea || Game.baseSig !== sig) {
      Game.baseArea = createArea(spaces);
      Game.baseSig = sig;
    }
    const base = Game.baseArea;
    const out: SavedPaint[] = [];
    for (let t = 0; t < a.w * a.h; t++) {
      const x = t % a.w;
      const y = (t - x) / a.w;
      if (a.floor[t] !== base.floor[t]) out.push({ x, y, layer: PAINT_LAYER.floor, finish: FLOOR_KEYS[a.floor[t]!] ?? '' });
      if (a.paint[t] !== 0) out.push({ x, y, layer: PAINT_LAYER.wall, finish: WALL_COLOURS[a.paint[t]!] ?? '' });
    }
    return out;
  }
  private static baseArea: ReturnType<typeof createArea> | undefined;
  private static baseSig = '';

  /** Restores the neighbourhood part of a save; items whose key no longer exists are skipped. */
  private loadHood(h: SaveNeighbourhood): void {
    const st = this.service.stock;
    for (const [key, n] of Object.entries(h.stock)) {
      const d = INGREDIENTS.byKey.get(key);
      if (d) st.add(d.id, n);
    }
    for (const [key, n] of Object.entries(h.materials)) {
      const d = MATERIALS.byKey.get(key);
      if (d) this.materials[d.id] = n;
    }
    const m = this.market;
    if (h.marketDay === this.sim.day) m.restore(h.marketDay, NEIGHBOURHOOD.shops.map((s) => h.sold[s.key] ?? []));
    m.carry = h.carry.flatMap((g) => {
      const id = itemId(g.kind, g.key);
      return id >= 0 ? [{ kind: g.kind, id, qty: g.qty }] : [];
    });
    m.deliveries = h.deliveries.flatMap((g) => {
      const id = itemId(g.kind, g.key);
      return id >= 0 ? [{ kind: g.kind, id, qty: g.qty, due: g.due }] : [];
    });
    m.changed = true;
    // Paint that still fits today's rules (unknown finishes or tiles no longer in the shop are dropped).
    const a = this.world.state;
    for (const p of h.painted) {
      if (checkPaint(a, p.x, p.y, p.layer)) continue;
      const t = p.y * a.area.w + p.x;
      if (p.layer === PAINT_LAYER.floor) {
        const v = (FLOOR as Record<string, number>)[p.finish];
        if (v && FLOOR_KEYS[v]) this.world.paint(t, true, v);
      } else {
        const v = (WALL_COLOURS as readonly string[]).indexOf(p.finish);
        if (v > 0) this.world.paint(t, false, v);
      }
    }
    this.syncWalk();
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
    // Lots joined to the shop (M4) are part of the area before anything is placed.
    const world = new SimWorld(createArea(spacesOf(d.world.props)));
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
    game.loadHood(d.hood);
    game.loadWorld(d.world);
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
        this.worldDay(this.sim.day); // the street moves on overnight
        this.residents.settle(this.sim.day, this.sim.gameMinute); // tomorrow: everyone where the plan has them
        this.service.endOfDay(); // cups washed overnight, no jobs left
        this.payWages();
        this.payRent();
        this.workers.reset(); // everyone back beside the counter
        this.spawnStaff(true); // staff walk in from home
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
      case 'paint':
        return b.paint(a.x, a.y, a.material);
      case 'buyProperty':
        return this.takeProperty(a.key, false);
      case 'rentProperty':
        return this.takeProperty(a.key, true);
      case 'endLease': {
        const def = PROPERTIES.byKey.get(a.key);
        if (!def || this.properties.props[def.id]?.state !== PS.rented) return { ok: false, reason: 'board.err.notRented' };
        if (this.day.phase !== PHASE.evening) return { ok: false, reason: 'day.err.notNow' };
        this.endLease(def, false);
        return { ok: true };
      }
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
      materials: Array.from(this.builder.materials),
      keepers: this.residents.keepersMask(),
      buildings: this.properties.buildingFlags(),
      listings: this.listings(),
      news: this.properties.news.map(newsLine),
    };
  }

  /** Listed properties and your own spaces, for the notice board (M4). */
  private listings(): PlayerState['listings'] {
    const out: PlayerState['listings'] = [];
    PROPERTIES.defs.forEach((def, i) => {
      const p = this.properties.props[i]!;
      if (p.state !== PS.listed && p.state !== PS.owned && p.state !== PS.rented) return;
      out.push({ key: def.key, state: p.state, listing: p.listing, price: p.price, rent: def.rent, days: p.days, urgent: p.urgent, joins: def.expand !== null });
    });
    return out;
  }

  /** True once after anything in the player state changed. */
  takeChanged(): boolean {
    const c = this.builder.changed || this.day.changed || this.workers.changed || this.service.stock.changed || this.market.changed || this.properties.changed;
    this.builder.changed = this.day.changed = this.workers.changed = this.service.stock.changed = this.market.changed = this.properties.changed = false;
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
    const res = this.residents;
    res.nowMinute = minute;
    res.tick(this.sim.day, minute, day.phase === PHASE.open && minuteOfDay(minute) < SHOP.close);
    this.npcs.tick(this.sim.tick);
    const km = res.keepersMask();
    if (km !== this.keepers) {
      this.keepers = km;
      this.day.changed = true;
    }
    this.workers.tick(this.sim.tick);
    this.market.refresh(this.sim.day);
    this.goods(false);
    if (day.phase === PHASE.closing && this.lastPhase !== PHASE.closing) this.npcs.closing();
    if (day.phase === PHASE.evening && this.lastPhase !== PHASE.evening && this.lastPhase !== -1) this.staffHome();
    this.lastPhase = day.phase;
    day.update(this.sim.gameMinute, this.customers());
    this.world.writeChanges(w);
    this.npcs.writeChanges(w);
    this.residents.writeChanges(w);
    this.workers.writeChanges(w);
    this.service.writeChanges(w, this.workers);
  }

  /** Full state for a new main-thread mirror. */
  writeSnapshot(w: FrameWriter): void {
    this.world.writeSnapshot(w);
    this.npcs.writeSnapshot(w);
    this.residents.writeSnapshot(w);
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

/** A news item as the main thread sees it (PlayerState.news). */
function newsLine(n: NewsItem): PlayerState['news'][number] {
  return { id: n.id, day: n.day, kind: n.kind, prop: n.prop, a: n.a, b: n.b, heard: n.heard };
}

/** The lots joined to the shop, from property states by key (bought or rented). */
function spacesOf(props: readonly { key: string; state: number }[]): Expansion[] {
  const out: Expansion[] = [];
  for (const p of props) {
    const def = PROPERTIES.byKey.get(p.key);
    if (def?.expand && (p.state === PS.owned || p.state === PS.rented)) out.push(def.expand);
  }
  return out;
}
