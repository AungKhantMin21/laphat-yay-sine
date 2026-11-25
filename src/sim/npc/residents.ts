// Residents (M4): the named neighbours. Each day every resident gets a plan (shared/residents.ts
// planDay: deterministic from the save seed, the day and the resident). Indoors they are hidden; on
// the street they walk with the `people` class (sim/npc/walker.ts); a tea visit hands them to the
// customer pipeline (Customers.spawnResident) until they walk home again.
//
// Where the camera looks never changes anything here. Struct of arrays over a fixed slot range
// (shared/layout.ts RESIDENT_SLOT0); no allocation per tick (plans are rebuilt once a day).
import { POS_SCALE, type FrameWriter } from '../../shared/diff';
import { NONE, makeHandle } from '../../shared/ids';
import { MAX_RESIDENTS, MINUTES_PER_DAY, RESIDENT_SLOT0 } from '../../shared/layout';
import { NEIGHBOURHOOD, spanTile, type Neighbourhood } from '../../shared/neighbourhood';
import { ANIM, DIR, NPC_DEF_RESIDENT } from '../../shared/npc';
import { TICK_HZ } from '../../shared/protocol';
import { RE, RESIDENTS, planDay, type PlannedEvent, type ResidentDef, type ResidentRules } from '../../shared/residents';
import { ACCESS } from '../../shared/rules/access';
import type { PathFinder } from '../path/pathfinder';
import type { WalkGrid } from '../path/walk-grid';
import { ARRIVED, FAILED, drop, walkStep, type WalkerSoA } from './walker';

/** Resident states. */
export const RS = {
  /** Indoors (home, or at work off the map): hidden. */
  inside: 0,
  walking: 1,
  /** Standing on the street: behind their stall's counter, or at a market stall. */
  standing: 2,
  /** In your tea shop as a customer (drawn by the customer layer). */
  visiting: 3,
} as const;

/** Where a walk ends. */
const DEST = { home: 0, stall: 1, work: 2, market: 3, stroll: 4 } as const;

/** What the tea visit needs from the game. */
export interface ResidentHooks {
  /** Resident r steps out of door tile `from` for tea: the customer handle, or NONE (no room). */
  teaVisit(r: number, from: number, drink: number, look: number): number;
}

export class Residents implements WalkerSoA {
  readonly capacity = MAX_RESIDENTS;
  /** The people living here now, by resident slot (null = empty slot). */
  readonly who: (ResidentDef | null)[];
  /** Home door tile per slot. */
  readonly home: Int32Array;
  readonly state: Uint8Array;
  readonly dest: Uint8Array;
  /** Absolute game minute a market stop ends. */
  readonly until: Float64Array;
  readonly x: Float32Array;
  readonly y: Float32Array;
  readonly tile: Int32Array;
  readonly goal: Int32Array;
  readonly path: Uint32Array;
  readonly pathStep: Uint16Array;
  readonly walkT: Uint16Array;
  readonly dir: Uint8Array;
  readonly anim: Uint8Array;
  readonly gen: Uint16Array;
  /** Visible on the street (has an NPC on the wire). */
  readonly shown: Uint8Array;
  /** Tea visits that ended in a cup (feeds friendship in M5; saved from M4 S5). */
  readonly visits: Uint16Array;
  /** Today's plan and the next event per slot. */
  private plan: PlannedEvent[][] = [];
  private readonly next: Int32Array;
  private planDay = -1;

  private readonly speed: number;
  private readonly stuck: number;
  private readonly W: number;
  private readonly dirty: Uint8Array;
  private readonly spawned: Uint16Array;
  private spawnedN = 0;
  private readonly despawned: Uint32Array;
  private despawnedN = 0;
  /** Market spots: pavement tiles along the wet market's front (not the counter tile itself). */
  private readonly marketSpots: Int32Array;
  hooks: ResidentHooks = { teaVisit: () => NONE };

  constructor(
    private readonly walk: WalkGrid,
    private readonly paths: PathFinder,
    private readonly seed: number,
    private readonly rules: ResidentRules = RESIDENTS,
    private readonly hood: Neighbourhood = NEIGHBOURHOOD,
  ) {
    const n = this.capacity;
    this.who = new Array<ResidentDef | null>(n).fill(null);
    this.home = new Int32Array(n).fill(-1);
    this.state = new Uint8Array(n);
    this.dest = new Uint8Array(n);
    this.until = new Float64Array(n);
    this.x = new Float32Array(n);
    this.y = new Float32Array(n);
    this.tile = new Int32Array(n);
    this.goal = new Int32Array(n);
    this.path = new Uint32Array(n);
    this.pathStep = new Uint16Array(n);
    this.walkT = new Uint16Array(n);
    this.dir = new Uint8Array(n);
    this.anim = new Uint8Array(n);
    this.gen = new Uint16Array(n);
    this.shown = new Uint8Array(n);
    this.visits = new Uint16Array(n);
    this.next = new Int32Array(n);
    this.dirty = new Uint8Array(n);
    this.spawned = new Uint16Array(n * 2);
    this.despawned = new Uint32Array(n * 2);
    this.W = walk.w;
    this.speed = rules.walkSpeed / TICK_HZ;
    this.stuck = 240 * TICK_HZ;
    const mk = hood.shops.find((s) => s.key === 'market');
    const spots: number[] = [];
    if (mk) {
      for (let p = mk.from; p < mk.to; p++) {
        const t = spanTile(mk, p);
        if (t.x === mk.visitX && t.y === mk.visitY) continue;
        spots.push(t.y * this.W + t.x);
      }
    }
    this.marketSpots = Int32Array.from(spots);
    rules.residents.forEach((d, r) => this.moveIn(r, d, d.home));
  }

  /** Puts resident `d` in slot r, living behind door `door`. */
  moveIn(r: number, d: ResidentDef, door: number): void {
    const t = this.hood.doors[door]!;
    this.who[r] = d;
    this.home[r] = t.y * this.W + t.x;
    this.visits[r] = 0;
    this.placeInside(r, this.home[r]!);
  }

  /** Resident slot by key, or −1. */
  slotOf(key: string): number {
    for (let r = 0; r < this.capacity; r++) if (this.who[r]?.key === key) return r;
    return -1;
  }

  handle(r: number): number {
    return makeHandle(RESIDENT_SLOT0 + r, this.gen[r]!);
  }

  // ---- the day ----

  /**
   * Puts everyone where today's plan has them at absolute game minute `now` (new game, load, after
   * Sleep): keepers behind their counter during their hours, workers away, everyone else at home.
   * Outings planned before `now` are skipped.
   */
  settle(day: number, now: number): void {
    this.makePlans(day);
    const md = ((now % MINUTES_PER_DAY) + MINUTES_PER_DAY) % MINUTES_PER_DAY;
    for (let r = 0; r < this.capacity; r++) {
      const d = this.who[r];
      if (!d) continue;
      const plan = this.plan[r]!;
      let place: number = DEST.home;
      let k = 0;
      for (; k < plan.length && plan[k]!.minute <= md; k++) {
        const e = plan[k]!;
        if (e.kind === RE.toStall) place = DEST.stall;
        else if (e.kind === RE.toWork) place = DEST.work;
        else if (e.kind === RE.home) place = DEST.home;
      }
      this.next[r] = k;
      drop(this, r, this.paths);
      if (place === DEST.stall) this.standAtStall(r, d);
      else if (place === DEST.work) this.placeInside(r, this.endTile(d));
      else this.placeInside(r, this.home[r]!);
    }
  }

  private makePlans(day: number): void {
    if (day === this.planDay) return;
    this.planDay = day;
    this.plan = this.who.map((d) => (d ? planDay(this.seed, day, d, this.rules, this.hood) : []));
    this.next.fill(0);
  }

  /**
   * One sim tick. `now` = absolute game minute, `teaOpen` = the shop takes customers now
   * (open phase, before closing time).
   */
  tick(day: number, now: number, teaOpen: boolean): void {
    if (day !== this.planDay) this.settle(day, now);
    const md = ((now % MINUTES_PER_DAY) + MINUTES_PER_DAY) % MINUTES_PER_DAY;
    for (let r = 0; r < this.capacity; r++) {
      const d = this.who[r];
      if (!d) continue;
      this.decide(r, d, md, teaOpen);
      const s = this.state[r];
      if (s === RS.walking) {
        const res = walkStep(this, r, this.paths, this.W, this.speed, this.stuck, ACCESS.people, false);
        this.dirty[r] = 1;
        if (res === ARRIVED) this.arrive(r, d);
        else if (res === FAILED) {
          // Calm: never stranded. Step to where they were going.
          drop(this, r, this.paths);
          this.setTile(r, this.goal[r]!);
          this.arrive(r, d);
        }
      } else if (s === RS.standing && this.dest[r] === DEST.market && now >= this.until[r]!) {
        this.walkTo(r, this.home[r]!, DEST.home);
      }
    }
  }

  /** Runs the next planned event if it's time and they're free for it. */
  private decide(r: number, d: ResidentDef, md: number, teaOpen: boolean): void {
    const plan = this.plan[r]!;
    const k = this.next[r]!;
    const e = plan[k];
    if (!e || e.minute > md) return;
    const s = this.state[r];
    const atHome = s === RS.inside && this.tile[r] === this.home[r];
    const late = md - e.minute > this.rules.staleAfter;
    switch (e.kind) {
      case RE.toStall:
        if (!atHome) return; // still out: they go once home
        this.walkTo(r, this.stallTile(d), DEST.stall);
        break;
      case RE.toWork:
        if (!atHome) return;
        this.walkTo(r, this.endTile(d), DEST.work);
        break;
      case RE.home:
        if (s === RS.visiting) return;
        if (s === RS.standing && this.dest[r] === DEST.stall) {
          const site = this.hood.shops[d.keeper]!;
          this.show(r, site.visitY * this.W + site.visitX);
        } else if (s === RS.inside && !atHome) this.show(r, this.tile[r]!);
        if (!(s === RS.inside && atHome)) this.walkTo(r, this.home[r]!, DEST.home);
        break;
      case RE.tea: {
        if (!atHome || !teaOpen) {
          if (late) break; // gave it a miss today
          return;
        }
        const h = this.hooks.teaVisit(r, this.home[r]!, d.tea!.drink, d.look);
        if (h !== NONE) this.state[r] = RS.visiting;
        break;
      }
      case RE.market:
      case RE.stroll:
        if (!atHome) {
          if (late) break;
          return;
        }
        if (e.kind === RE.market) {
          if (this.marketSpots.length === 0) break;
          this.walkTo(r, this.marketSpots[(r * 7 + this.planDay) % this.marketSpots.length]!, DEST.market);
          this.until[r] = 0;
        } else {
          const doors = this.hood.doors;
          let t = this.home[r]!;
          if (doors.length > 1) {
            const o = doors[(d.home + 1 + ((r + this.planDay) % (doors.length - 1))) % doors.length]!;
            t = o.y * this.W + o.x;
          }
          this.walkTo(r, t, DEST.stroll);
        }
        break;
      default:
        break;
    }
    this.next[r] = k + 1;
  }

  private arrive(r: number, d: ResidentDef): void {
    drop(this, r, this.paths);
    switch (this.dest[r]) {
      case DEST.home:
      case DEST.work:
        this.placeInside(r, this.tile[r]!);
        break;
      case DEST.stall:
        this.standAtStall(r, d);
        break;
      case DEST.market: {
        this.state[r] = RS.standing;
        this.setAnim(r, ANIM.stand);
        this.dir[r] = DIR.west;
        const [lo, hi] = this.rules.marketDwell;
        this.until[r] = this.nowMinute + lo + ((r * 3 + this.planDay) % (hi - lo + 1));
        break;
      }
      default:
        this.walkTo(r, this.home[r]!, DEST.home);
        break;
    }
  }

  /** Set by Game before tick (absolute game minute; market stops are timed in it). */
  nowMinute = 0;

  /** A tea visit ended (the customer walked back in at their door). */
  backFromTea(r: number): void {
    if (this.state[r] !== RS.visiting) return;
    this.state[r] = RS.inside;
    this.setTile(r, this.home[r]!);
  }

  // ---- moves ----

  private walkTo(r: number, to: number, dest: number): void {
    if (!this.shown[r]) this.show(r, this.tile[r]!);
    drop(this, r, this.paths);
    this.goal[r] = to;
    this.dest[r] = dest;
    this.walkT[r] = 0;
    this.state[r] = RS.walking;
    this.setAnim(r, ANIM.walk);
  }

  private standAtStall(r: number, d: ResidentDef): void {
    const site = this.hood.shops[d.keeper]!;
    if (!this.shown[r]) this.show(r, site.keeperY * this.W + site.keeperX);
    else this.setTile(r, site.keeperY * this.W + site.keeperX);
    this.state[r] = RS.standing;
    this.dest[r] = DEST.stall;
    this.dir[r] = site.edge === 'n' ? DIR.south : DIR.east;
    this.setAnim(r, ANIM.stand);
  }

  private placeInside(r: number, t: number): void {
    if (this.shown[r]) this.hide(r);
    this.state[r] = RS.inside;
    this.setTile(r, t);
  }

  private stallTile(d: ResidentDef): number {
    const s = this.hood.shops[d.keeper]!;
    return s.visitY * this.W + s.visitX;
  }

  private endTile(d: ResidentDef): number {
    const e = this.hood.ends[d.away?.end ?? 0]!;
    return e.y * this.W + e.x;
  }

  private setTile(r: number, t: number): void {
    const x = t % this.W;
    this.tile[r] = t;
    this.x[r] = x + 0.5;
    this.y[r] = (t - x) / this.W + 0.5;
    this.dirty[r] = 1;
  }

  private setAnim(r: number, a: number): void {
    if (this.anim[r] === a) return;
    this.anim[r] = a;
    this.dirty[r] = 1;
  }

  private show(r: number, t: number): void {
    this.setTile(r, t);
    if (this.shown[r]) return;
    this.shown[r] = 1;
    if (this.spawnedN < this.spawned.length) this.spawned[this.spawnedN++] = r;
  }

  private hide(r: number): void {
    if (!this.shown[r]) return;
    this.shown[r] = 0;
    if (this.despawnedN < this.despawned.length) this.despawned[this.despawnedN++] = this.handle(r);
    this.gen[r] = (this.gen[r]! + 1) & 0xffff;
  }

  /** Residents on the street now (tests, perf overlay). */
  outside(): number {
    let n = 0;
    for (let r = 0; r < this.capacity; r++) if (this.shown[r]) n++;
    return n;
  }

  // ---- frames ----

  writeChanges(w: FrameWriter): void {
    for (let k = 0; k < this.despawnedN; k++) w.npcDespawn(this.despawned[k]!);
    this.despawnedN = 0;
    for (let k = 0; k < this.spawnedN; k++) {
      const r = this.spawned[k]!;
      if (this.shown[r]) this.writeSpawn(w, r);
    }
    this.spawnedN = 0;
    for (let r = 0; r < this.capacity; r++) {
      if (!this.dirty[r]) continue;
      this.dirty[r] = 0;
      if (this.shown[r]) this.writeState(w, r);
    }
  }

  writeSnapshot(w: FrameWriter): void {
    for (let r = 0; r < this.capacity; r++) {
      this.dirty[r] = 0;
      if (!this.shown[r]) continue;
      this.writeSpawn(w, r);
      this.writeState(w, r);
    }
    this.spawnedN = this.despawnedN = 0;
  }

  private writeSpawn(w: FrameWriter, r: number): void {
    w.npcSpawn(this.handle(r), NPC_DEF_RESIDENT, 0, this.who[r]?.look ?? 0, Math.round(this.x[r]! * POS_SCALE), Math.round(this.y[r]! * POS_SCALE));
  }

  private writeState(w: FrameWriter, r: number): void {
    w.npcState(RESIDENT_SLOT0 + r, Math.round(this.x[r]! * POS_SCALE), Math.round(this.y[r]! * POS_SCALE), this.dir[r]!, this.anim[r]!);
  }
}
