// One running game: clock, world, economy and build commands. Plain TS (tested headless);
// worker.ts only adds messaging and timing around it.
import { CATALOG } from '../shared/catalog';
import type { FrameWriter } from '../shared/diff';
import type { Action, PlayerState, SimEvent } from '../shared/protocol';
import start from '../data/start.json';
import { createM1Area, STREET } from './area';
import { DRINKS, REACTION, autoPrice, pourScore, pouredPrice, reactionFor, tipFor } from '../shared/drinks';
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
import { SAVE_SCHEMA, type SaveData, type SavedObject } from './save/format';

const res = (err: string): Result => (err ? { ok: false, reason: err } : { ok: true });

export class Game {
  /** Events for the main thread, drained by the worker after each step or action. */
  readonly events: SimEvent[] = [];
  readonly walk: WalkGrid;
  readonly paths: PathFinder;
  readonly npcs: Customers;
  /** Last game minute an arrival was rolled for (one roll per minute). */
  private arrivalMinute = -1;

  constructor(
    readonly sim: Sim,
    readonly world: SimWorld,
    readonly builder: Builder,
    readonly day: ShopDay = new ShopDay(),
  ) {
    day.update(sim.gameMinute, 0);
    world.clearWalkDirty(); // the walk grid below starts from the current occupancy
    this.walk = new WalkGrid(world.state.area, world.state.occ);
    this.paths = new PathFinder(this.walk);
    this.npcs = new Customers(world, this.walk, this.paths, sim.rng.npcDecide, sim.rng.cosmetic, STREET, (h, drink, poured, score) =>
      this.pay(h, drink, poured, score),
    );
  }

  /** A customer got a cup: money into the tin, today's stats, events for the main thread. */
  private pay(id: number, drinkId: number, poured: boolean, score: number): void {
    const drink = DRINKS.defs[drinkId]!;
    const price = poured ? pouredPrice(drink) : autoPrice(drink);
    const tip = poured ? tipFor(drink, score) : 0;
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
    const reaction = poured ? reactionFor(score) : REACTION.auto;
    this.events.push({ k: 'served', id, drink: drinkId, poured, price, tip, reaction });
    this.events.push({ k: 'money', delta: price + tip, total: b.money });
  }

  /** Rebuilds walk costs around build changes (searches in flight restart). */
  syncWalk(): void {
    const w = this.world;
    if (!w.walkDirty) return;
    this.walk.update(w.walkX0, w.walkY0, w.walkX1, w.walkY1);
    w.clearWalkDirty();
  }

  /** Customers still in or heading to the shop. */
  customers(): number {
    return this.npcs.inShop();
  }

  static create(seed: number): Game {
    const inv = new Uint16Array(CATALOG.defs.length);
    for (const [key, n] of Object.entries(start.inventory as Record<string, number>)) {
      const def = CATALOG.byKey.get(key);
      if (def) inv[def.id] = n;
    }
    const world = new SimWorld(createM1Area());
    return new Game(new Sim(seed), world, new Builder(world, start.money, inv));
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
   */
  static fromSave(d: SaveData): { game: Game; skipped: number } {
    const sim = new Sim(d.seed);
    sim.tick = d.tick;
    sim.clock = d.clock;
    [sim.rng.market.state, sim.rng.npcDecide.state, sim.rng.events.state, sim.rng.cosmetic.state] = d.rng;
    const world = new SimWorld(createM1Area());
    const inv = new Uint16Array(CATALOG.defs.length);
    for (const [key, n] of Object.entries(d.inventory)) {
      const def = CATALOG.byKey.get(key);
      if (def) inv[def.id] = Math.min(0xffff, n);
    }
    let skipped = 0;
    const ordered = [...d.objects].sort((a, b) => Number(a.parentUid !== 0) - Number(b.parentUid !== 0));
    for (const o of ordered) {
      const def = CATALOG.byKey.get(o.key);
      const parent = o.parentUid ? world.objects.indexOfUid(o.parentUid) : 0;
      if (!def || (o.parentUid && !parent)) {
        skipped++;
        continue;
      }
      world.add({ type: def.id, x: o.x, y: o.y, rot: o.rot & 3, layer: def.layer, colour: o.colour, parent }, o.uid);
    }
    world.uidCounter = d.nextUid;
    const day = new ShopDay();
    day.shuttersOpen = d.shuttersOpen;
    day.today = { ...d.today };
    day.teaser = { ...d.teaser };
    return { game: new Game(sim, world, new Builder(world, d.money, inv), day), skipped };
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
      case 'openShop':
        return this.day.open(this.sim, this.customers());
      case 'sleep': {
        const r = this.day.sleep(this.sim, this.customers());
        if (!r.ok) return r;
        if (r.ended) {
          this.events.push({ k: 'dayEnd', day: r.ended.day, stats: r.ended.stats });
          const t = this.day.teaser;
          if (t.key) this.events.push({ k: 'teaser', key: t.key, drink: DRINKS.byKey.get(t.arg)?.id ?? -1 });
        }
        this.npcs.clear(); // the last passers-by go home too
        return { ok: true };
      }
      case 'startPour':
        return res(this.npcs.startPour(a.id));
      case 'cancelPour':
        return res(this.npcs.cancelPour(a.id));
      case 'serve': {
        const i = this.npcs.indexOf(a.id);
        if (!i || !Number.isFinite(a.tea) || !Number.isFinite(a.milk)) return { ok: false, reason: 'pour.err.gone' };
        const score = pourScore(DRINKS.defs[this.npcs.drink[i]!]!, a.tea, a.milk, this.npcs.milkShift[i]!);
        return res(this.npcs.servePoured(a.id, score));
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
    };
  }

  /** True once after anything in the player state changed. */
  takeChanged(): boolean {
    const c = this.builder.changed || this.day.changed;
    this.builder.changed = this.day.changed = false;
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
    this.npcs.tick();
    day.update(this.sim.gameMinute, this.customers());
    this.world.writeChanges(w);
    this.npcs.writeChanges(w);
  }

  /** Full state for a new main-thread mirror. */
  writeSnapshot(w: FrameWriter): void {
    this.world.writeSnapshot(w);
    this.npcs.writeSnapshot(w);
  }
}
