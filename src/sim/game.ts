// One running game: clock, world, economy and build commands. Plain TS (tested headless);
// worker.ts only adds messaging and timing around it.
import { CATALOG } from '../shared/catalog';
import type { FrameWriter } from '../shared/diff';
import type { Action, PlayerState, SimEvent } from '../shared/protocol';
import start from '../data/start.json';
import { createM1Area } from './area';
import { Builder, type Result } from './build/builder';
import { Sim } from './sim';
import { SimWorld } from './world';
import { ShopDay } from './day/shop-day';
import { SAVE_SCHEMA, type SaveData, type SavedObject } from './save/format';

export class Game {
  /** Events for the main thread, drained by the worker after each step or action. */
  readonly events: SimEvent[] = [];

  constructor(
    readonly sim: Sim,
    readonly world: SimWorld,
    readonly builder: Builder,
    readonly day: ShopDay = new ShopDay(),
  ) {
    day.update(sim.gameMinute, 0);
  }

  /** Customers still in or heading to the shop (M2.4). */
  customers(): number {
    return 0;
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
        if (r.ended) this.events.push({ k: 'dayEnd', day: r.ended.day, stats: r.ended.stats });
        return { ok: true };
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
    day.update(this.sim.gameMinute, this.customers());
    this.sim.step(w, !day.holds);
    day.update(this.sim.gameMinute, this.customers());
    this.world.writeChanges(w);
  }
}
