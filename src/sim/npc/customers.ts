// Customers (M2): arrive on the street, choose a seat by utility, order, wait for a cup (poured by
// the player, or auto-served after a delay), drink, and walk off. Struct of arrays, fixed capacity,
// handles = index + generation. No allocation per tick: queues and grids are preallocated.
//
// Seats are the footprint tiles of floor-standing furniture with `seat > 0` (a bench gives 2).
// A customer reserves one seat tile; if the seat is moved, picked up or sold, they stand and choose
// again, or leave if they have already been served. Placement ignores customers; walkers re-path.
import { CATALOG, LAYER, footH, footW } from '../../shared/catalog';
import { CUSTOMERS, pickOrder, type CustomerRules } from '../../shared/customers';
import { POS_SCALE, type FrameWriter } from '../../shared/diff';
import { IndexQueue, NONE, handleGen, handleIndex, makeHandle } from '../../shared/ids';
import { LEVEL, MAX_NPCS, PROP } from '../../shared/layout';
import { ANIM, DIR, NPC_DEF_CUSTOMER, ORDER } from '../../shared/npc';
import { TICK_HZ } from '../../shared/protocol';
import type { Rng } from '../../shared/rng';
import { SHOP, arrivalRate, type ShopRules } from '../../shared/shop';
import { PATH, type PathFinder } from '../path/pathfinder';
import { DX, DY, type WalkGrid } from '../path/walk-grid';
import type { SimWorld } from '../world';

/** Customer state machine. */
export const CS = {
  free: 0,
  /** Walking to a reserved seat. */
  toSeat: 1,
  /** Seated, about to order. */
  ordering: 2,
  /** Order bubble up, waiting for a cup. */
  waiting: 3,
  drinking: 4,
  /** Walking off the street (served, displaced after paying, or no free seat). */
  leaving: 5,
} as const;

const WALKING = 0;
const ARRIVED = 1;
const FAILED = 2;

/** Called when a customer gets a cup; the game takes the payment. `score` is 0 for auto-served cups. */
export type OnServed = (handle: number, drink: number, poured: boolean, score: number) => void;

export interface Street {
  /** Pavement rows customers walk along; they enter and leave at x = 0 and x = w − 1. Row 0 is the shop side. */
  rows: readonly number[];
}

export class Customers {
  readonly capacity = MAX_NPCS;
  readonly alive: Uint8Array;
  readonly gen: Uint16Array;
  readonly state: Uint8Array;
  /** Ticks in the current state (pouring pauses it while waiting). */
  readonly stateT: Uint16Array;
  /** Ticks walking toward the current goal (stuck guard). */
  readonly walkT: Uint16Array;
  /** Position in tiles; a tile's centre is (x + 0.5, y + 0.5). */
  readonly x: Float32Array;
  readonly y: Float32Array;
  /** Last tile reached (index). */
  readonly tile: Int32Array;
  readonly goal: Int32Array;
  readonly path: Uint32Array;
  readonly pathStep: Uint16Array;
  /** Reserved seat tile (−1 = none) and the handle of the object it belongs to. */
  readonly seat: Int32Array;
  readonly seatObj: Uint32Array;
  readonly exit: Int32Array;
  readonly drink: Uint8Array;
  readonly order: Uint8Array;
  /** Ticks the current pour has held the auto-serve. */
  readonly pourT: Uint16Array;
  readonly milkShift: Float32Array;
  readonly noiseTaste: Float32Array;
  readonly look: Uint8Array;
  readonly dir: Uint8Array;
  readonly anim: Uint8Array;
  /** Customer index holding each tile as a seat (0 = free). */
  readonly seatRes: Uint16Array;

  private readonly free: Uint16Array;
  private freeTop = 0;
  private live = 0;
  private readonly stateDirty: IndexQueue;
  private readonly orderDirty: IndexQueue;
  private readonly spawned: Uint32Array;
  private spawnedN = 0;
  private readonly despawned: Uint32Array;
  private despawnedN = 0;

  /** Tiles reachable from the street (seat choice), rebuilt when the walk grid changes. */
  private readonly reach: Uint8Array;
  private readonly bfs: Int32Array;
  private reachVersion = -1;
  private seatVersion = -1;

  private readonly speed: number;
  private readonly t: { orderDelay: number; autoServe: number; drink: number; pourHold: number; stuck: number };

  constructor(
    private readonly world: SimWorld,
    private readonly walk: WalkGrid,
    private readonly paths: PathFinder,
    private readonly decide: Rng,
    private readonly cosmetic: Rng,
    private readonly street: Street,
    private readonly onServed: OnServed,
    private readonly rules: ShopRules = SHOP,
    private readonly cust: CustomerRules = CUSTOMERS,
  ) {
    const n = this.capacity;
    this.alive = new Uint8Array(n);
    this.gen = new Uint16Array(n);
    this.state = new Uint8Array(n);
    this.stateT = new Uint16Array(n);
    this.walkT = new Uint16Array(n);
    this.x = new Float32Array(n);
    this.y = new Float32Array(n);
    this.tile = new Int32Array(n);
    this.goal = new Int32Array(n);
    this.path = new Uint32Array(n);
    this.pathStep = new Uint16Array(n);
    this.seat = new Int32Array(n).fill(-1);
    this.seatObj = new Uint32Array(n);
    this.exit = new Int32Array(n);
    this.drink = new Uint8Array(n);
    this.order = new Uint8Array(n);
    this.pourT = new Uint16Array(n);
    this.milkShift = new Float32Array(n);
    this.noiseTaste = new Float32Array(n);
    this.look = new Uint8Array(n);
    this.dir = new Uint8Array(n);
    this.anim = new Uint8Array(n);
    this.free = new Uint16Array(n);
    for (let i = n - 1; i >= 1; i--) this.free[this.freeTop++] = i;
    this.stateDirty = new IndexQueue(n);
    this.orderDirty = new IndexQueue(n);
    this.spawned = new Uint32Array(n * 2);
    this.despawned = new Uint32Array(n * 2);
    const tiles = walk.w * walk.h;
    this.seatRes = new Uint16Array(tiles);
    this.reach = new Uint8Array(tiles);
    this.bfs = new Int32Array(tiles);
    this.speed = cust.walkSpeed / TICK_HZ;
    const s = rules.service;
    const ticks = (min: number): number => Math.max(1, Math.round(min * TICK_HZ));
    this.t = { orderDelay: ticks(s.orderDelay), autoServe: ticks(s.autoServe), drink: ticks(s.drink), pourHold: ticks(s.pourHold), stuck: ticks(s.stuck) };
  }

  get count(): number {
    return this.live;
  }

  handle(i: number): number {
    return makeHandle(i, this.gen[i]!);
  }

  /** Index for a live handle, or 0. */
  indexOf(h: number): number {
    const i = handleIndex(h);
    return i > 0 && i < this.capacity && this.alive[i] === 1 && this.gen[i] === handleGen(h) ? i : 0;
  }

  /** Customers still in or heading to the shop (drives closing → evening). */
  inShop(): number {
    let n = 0;
    for (let i = 1; i < this.capacity; i++) {
      if (this.alive[i] && this.state[i] !== CS.leaving) n++;
    }
    return n;
  }

  // ---- arrivals ----

  /** Shop appeal (arrival multiplier) from its seats: count and average comfort/beauty. */
  appeal(): number {
    const s = this.world.objects;
    const v = this.world.grids.value;
    const comfort = v[PROP.comfort]!;
    const beauty = v[PROP.beauty]!;
    const W = this.walk.w;
    let seats = 0;
    let c = 0;
    let b = 0;
    for (let o = 1; o < s.capacity; o++) {
      if (!s.live[o] || s.layer[o] !== LAYER.furniture || s.parent[o] !== 0) continue;
      const def = CATALOG.defs[s.type[o]!]!;
      if (def.seat <= 0) continue;
      const fw = footW(def, s.rot[o]!);
      const fh = footH(def, s.rot[o]!);
      let k = 0;
      for (let dy = 0; dy < fh; dy++) {
        for (let dx = 0; dx < fw && k < def.seat; dx++, k++) {
          const t = (s.y[o]! + dy) * W + s.x[o]! + dx;
          seats++;
          c += comfort[t]!;
          b += beauty[t]!;
        }
      }
    }
    const a = this.rules.arrivals.appeal;
    let f = a.base + a.perSeat * Math.min(seats, a.seatCap);
    if (seats > 0) f += (a.comfort * c + a.beauty * b) / (seats * LEVEL);
    return f < a.min ? a.min : f > a.max ? a.max : f;
  }

  /**
   * Called once per game minute during shop hours: maybe a customer arrives. `extraRate` (per hour)
   * and `extraAppeal` come from tomorrow's teaser. Returns their handle or NONE.
   */
  arrivalRoll(minuteOfDay: number, extraRate = 0, extraAppeal = 0): number {
    const p = ((arrivalRate(minuteOfDay, this.rules) + extraRate) * (this.appeal() + extraAppeal)) / 60;
    if (!this.decide.chance(p)) return NONE;
    return this.spawn();
  }

  /** A customer appears at a street edge and chooses a seat (or walks on by). `order` ≥ 0 fixes their drink. */
  spawn(order = -1): number {
    if (this.freeTop === 0) return NONE;
    const r = this.decide;
    const W = this.walk.w;
    const st = this.street;
    const side = r.int(2);
    const y0 = st.rows[r.int(st.rows.length)]!;
    const y1 = st.rows[r.int(st.rows.length)]!;
    const rolled = pickOrder(r.next(), this.cust);
    const drink = order >= 0 ? order : rolled;
    const ms = this.cust.milkShift;
    const nt = this.cust.noiseTaste;
    const milkShift = ms[0] + (ms[1] - ms[0]) * r.next();
    const noiseTaste = nt[0] + (nt[1] - nt[0]) * r.next();

    const i = this.free[--this.freeTop]!;
    this.live++;
    this.alive[i] = 1;
    const x0 = side ? W - 1 : 0;
    this.tile[i] = y0 * W + x0;
    this.exit[i] = y1 * W + (side ? 0 : W - 1);
    this.x[i] = x0 + 0.5;
    this.y[i] = y0 + 0.5;
    this.dir[i] = side ? DIR.west : DIR.east;
    this.anim[i] = ANIM.walk;
    this.drink[i] = drink;
    this.order[i] = ORDER.none;
    this.pourT[i] = 0;
    this.milkShift[i] = milkShift;
    this.noiseTaste[i] = noiseTaste;
    this.look[i] = this.cosmetic.int(this.cust.looks);
    this.seat[i] = -1;
    this.seatObj[i] = NONE;
    this.path[i] = NONE;
    this.state[i] = CS.free;
    this.choose(i);
    const h = this.handle(i);
    if (this.spawnedN < this.spawned.length) this.spawned[this.spawnedN++] = h;
    this.stateDirty.push(i);
    return h;
  }

  // ---- seat choice ----

  /** Picks the best free reachable seat and walks there, or leaves when there is none. */
  choose(i: number): void {
    this.releaseSeat(i);
    this.dropPath(i);
    const s = this.world.objects;
    const W = this.walk.w;
    this.refreshReach();
    let best = -1;
    let bestObj = NONE;
    let bestScore = -Infinity;
    for (let o = 1; o < s.capacity; o++) {
      if (!s.live[o] || s.layer[o] !== LAYER.furniture || s.parent[o] !== 0) continue;
      const def = CATALOG.defs[s.type[o]!]!;
      if (def.seat <= 0) continue;
      const fw = footW(def, s.rot[o]!);
      const fh = footH(def, s.rot[o]!);
      let k = 0;
      for (let dy = 0; dy < fh; dy++) {
        for (let dx = 0; dx < fw && k < def.seat; dx++, k++) {
          const t = (s.y[o]! + dy) * W + s.x[o]! + dx;
          if (this.seatRes[t] !== 0 || !this.seatReachable(t)) continue;
          const score = this.scoreSeat(i, t);
          if (score > bestScore) {
            bestScore = score;
            best = t;
            bestObj = s.handle(o);
          }
        }
      }
    }
    if (best < 0) {
      this.leave(i);
      return;
    }
    this.seat[i] = best;
    this.seatObj[i] = bestObj;
    this.seatRes[best] = i;
    this.state[i] = CS.toSeat;
    this.stateT[i] = 0;
    this.goal[i] = best;
    this.walkT[i] = 0;
    this.setAnim(i, ANIM.walk);
  }

  /** Utility of sitting at tile t for customer i (higher is better). Draws one jitter value. */
  scoreSeat(i: number, t: number): number {
    const w = this.rules.seat;
    const v = this.world.grids.value;
    const L = LEVEL;
    const W = this.walk.w;
    let s =
      (w.comfort * v[PROP.comfort]![t]! +
        w.light * v[PROP.light]![t]! +
        w.beauty * v[PROP.beauty]![t]! +
        w.shade * v[PROP.shade]![t]! +
        w.warmth * v[PROP.warmth]![t]! -
        w.noise * this.noiseTaste[i]! * v[PROP.noise]![t]!) /
      L;
    if (this.tableNextTo(t)) s += w.table;
    const tx = t % W;
    const dx = tx + 0.5 - this.x[i]!;
    const dy = (t - tx) / W + 0.5 - this.y[i]!;
    s -= w.distance * Math.sqrt(dx * dx + dy * dy);
    return s + w.jitter * this.decide.next();
  }

  /** A table (furniture with a surface) on one of the four sides of tile t. */
  private tableNextTo(t: number): boolean {
    const W = this.walk.w;
    const H = this.walk.h;
    const x = t % W;
    const y = (t - x) / W;
    const furn = this.world.state.occ.furniture;
    const s = this.world.objects;
    for (let d = 0; d < 4; d++) {
      const nx = x + DX[d]!;
      const ny = y + DY[d]!;
      if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
      const o = furn[ny * W + nx]!;
      if (o !== 0 && CATALOG.defs[s.type[o]!]!.surface > 0) return true;
    }
    return false;
  }

  /** Flood fill of walkable tiles from the street entry; only after build changes. */
  private refreshReach(): void {
    const walk = this.walk;
    if (this.reachVersion === walk.version) return;
    this.reachVersion = walk.version;
    const W = walk.w;
    const reach = this.reach;
    reach.fill(0);
    const start = this.street.rows[0]! * W;
    if (!walk.passable(start)) return;
    const q = this.bfs;
    let head = 0;
    let tail = 0;
    q[tail++] = start;
    reach[start] = 1;
    const moves = walk.moves;
    while (head < tail) {
      const c = q[head++]!;
      const m = moves[c]!;
      for (let d = 0; d < 8; d++) {
        if ((m & (1 << d)) === 0) continue;
        const n = c + DX[d]! + DY[d]! * W;
        if (reach[n]) continue;
        reach[n] = 1;
        q[tail++] = n;
      }
    }
  }

  /** A seat tile can be walked onto from some reachable neighbour. */
  private seatReachable(t: number): boolean {
    const walk = this.walk;
    const W = walk.w;
    const x = t % W;
    const y = (t - x) / W;
    for (let d = 0; d < 8; d++) {
      const nx = x - DX[d]!;
      const ny = y - DY[d]!;
      if (nx < 0 || ny < 0 || nx >= W || ny >= walk.h || !this.reach[ny * W + nx]) continue;
      if (walk.stepAllowed(nx, ny, DX[d]!, DY[d]!, true)) return true;
    }
    return false;
  }

  /** After build changes: customers whose seat moved or vanished stand up and choose again (or leave if served). */
  private checkSeats(): void {
    if (this.seatVersion === this.walk.version) return;
    this.seatVersion = this.walk.version;
    const objs = this.world.objects;
    const furn = this.world.state.occ.furniture;
    for (let i = 1; i < this.capacity; i++) {
      if (!this.alive[i] || this.seat[i]! < 0) continue;
      const o = objs.indexOf(this.seatObj[i]!);
      if (o !== 0 && furn[this.seat[i]!] === o) continue;
      if (this.order[i] === ORDER.served) this.leave(i);
      else this.choose(i);
    }
  }

  // ---- per tick ----

  tick(): void {
    this.checkSeats();
    for (let i = 1; i < this.capacity; i++) {
      if (!this.alive[i]) continue;
      switch (this.state[i]) {
        case CS.toSeat: {
          const r = this.walkStep(i);
          if (r === ARRIVED) this.sitDown(i);
          else if (r === FAILED) this.leave(i);
          break;
        }
        case CS.ordering:
          if (++this.stateT[i]! >= this.t.orderDelay) {
            this.state[i] = CS.waiting;
            this.stateT[i] = 0;
            this.setOrder(i, ORDER.waiting);
          }
          break;
        case CS.waiting:
          if (this.order[i] === ORDER.pouring) {
            if (++this.pourT[i]! >= this.t.pourHold) this.setOrder(i, ORDER.waiting);
          } else if (++this.stateT[i]! >= this.t.autoServe) {
            this.serveIndex(i, false, 0);
          }
          break;
        case CS.drinking:
          if (++this.stateT[i]! >= this.t.drink) this.leave(i);
          break;
        case CS.leaving: {
          const r = this.walkStep(i);
          if (r !== WALKING) this.despawn(i);
          break;
        }
        default:
          break;
      }
    }
  }

  private sitDown(i: number): void {
    this.dropPath(i);
    this.stateT[i] = 0;
    this.setAnim(i, ANIM.sit);
    const o = this.order[i];
    if (o === ORDER.served) this.state[i] = CS.drinking;
    else if (o === ORDER.none) this.state[i] = CS.ordering;
    else this.state[i] = CS.waiting;
  }

  /** Starts walking off the street. Keeps any order state (a served customer stays served). */
  leave(i: number): void {
    this.releaseSeat(i);
    this.dropPath(i);
    if (this.order[i] === ORDER.waiting || this.order[i] === ORDER.pouring) this.setOrder(i, ORDER.none);
    this.state[i] = CS.leaving;
    this.stateT[i] = 0;
    this.goal[i] = this.exit[i]!;
    this.walkT[i] = 0;
    this.setAnim(i, ANIM.walk);
  }

  /** One tick of walking toward goal[i]. */
  private walkStep(i: number): number {
    const paths = this.paths;
    if (++this.walkT[i]! >= this.t.stuck) return FAILED;
    let h = this.path[i]!;
    if (h === NONE) {
      h = paths.request(this.tile[i]!, this.goal[i]!);
      if (h === NONE) return WALKING; // pool full: try again next tick
      this.path[i] = h;
      this.pathStep[i] = 0;
    }
    const st = paths.statusOf(h);
    if (st === PATH.queued) return WALKING;
    if (st !== PATH.done) return FAILED;
    const len = paths.length(h);
    const k = this.pathStep[i]!;
    if (k >= len) return this.arriveAtGoal(i);
    const next = paths.tileAt(h, k);
    if (!paths.canStep(this.tile[i]!, next, this.goal[i]!)) {
      this.dropPath(i); // something was built in the way: search again next tick
      return WALKING;
    }
    const W = this.walk.w;
    const nx = next % W;
    const ny = (next - nx) / W;
    const dx = nx + 0.5 - this.x[i]!;
    const dy = ny + 0.5 - this.y[i]!;
    const d = Math.sqrt(dx * dx + dy * dy);
    const sp = this.speed;
    if (d <= sp) {
      this.x[i] = nx + 0.5;
      this.y[i] = ny + 0.5;
      this.tile[i] = next;
      this.pathStep[i] = k + 1;
    } else {
      this.x[i] = this.x[i]! + (dx / d) * sp;
      this.y[i] = this.y[i]! + (dy / d) * sp;
    }
    const ax = dx < 0 ? -dx : dx;
    const ay = dy < 0 ? -dy : dy;
    this.setDir(i, ax >= ay ? (dx > 0 ? DIR.east : DIR.west) : dy > 0 ? DIR.south : DIR.north);
    this.stateDirty.push(i);
    if (this.pathStep[i]! >= len) return this.arriveAtGoal(i);
    return WALKING;
  }

  private arriveAtGoal(i: number): number {
    this.dropPath(i);
    return ARRIVED;
  }

  // ---- pouring and serving (player actions) ----

  /** The pour minigame opened: the customer's auto-serve waits. Returns an error key or ''. */
  startPour(h: number): string {
    const i = this.indexOf(h);
    if (!i || (this.order[i] !== ORDER.waiting && this.order[i] !== ORDER.pouring)) return 'pour.err.gone';
    this.pourT[i] = 0;
    this.setOrder(i, ORDER.pouring);
    return '';
  }

  cancelPour(h: number): string {
    const i = this.indexOf(h);
    if (!i) return 'pour.err.gone';
    if (this.order[i] === ORDER.pouring) this.setOrder(i, ORDER.waiting);
    return '';
  }

  /** Serves a poured cup scored `score` (0…1). Returns an error key or ''. */
  servePoured(h: number, score: number): string {
    const i = this.indexOf(h);
    if (!i || (this.order[i] !== ORDER.waiting && this.order[i] !== ORDER.pouring)) return 'pour.err.gone';
    this.serveIndex(i, true, score);
    return '';
  }

  private serveIndex(i: number, poured: boolean, score: number): void {
    this.setOrder(i, ORDER.served);
    if (this.state[i] === CS.waiting) {
      this.state[i] = CS.drinking;
      this.stateT[i] = 0;
    }
    this.onServed(this.handle(i), this.drink[i]!, poured, score);
  }

  // ---- lifecycle ----

  despawn(i: number): void {
    if (!this.alive[i]) return;
    this.releaseSeat(i);
    this.dropPath(i);
    if (this.despawnedN < this.despawned.length) this.despawned[this.despawnedN++] = this.handle(i);
    this.alive[i] = 0;
    this.state[i] = CS.free;
    this.order[i] = ORDER.none;
    this.gen[i] = (this.gen[i]! + 1) & 0xffff;
    this.free[this.freeTop++] = i;
    this.live--;
  }

  /** Everyone goes home (sleep). */
  clear(): void {
    for (let i = 1; i < this.capacity; i++) if (this.alive[i]) this.despawn(i);
  }

  private releaseSeat(i: number): void {
    const t = this.seat[i]!;
    if (t >= 0 && this.seatRes[t] === i) this.seatRes[t] = 0;
    this.seat[i] = -1;
    this.seatObj[i] = NONE;
  }

  private dropPath(i: number): void {
    const h = this.path[i]!;
    if (h !== NONE) this.paths.release(h);
    this.path[i] = NONE;
    this.pathStep[i] = 0;
  }

  private setAnim(i: number, a: number): void {
    if (this.anim[i] === a) return;
    this.anim[i] = a;
    this.stateDirty.push(i);
  }

  private setDir(i: number, d: number): void {
    this.dir[i] = d;
  }

  private setOrder(i: number, o: number): void {
    if (this.order[i] === o) return;
    this.order[i] = o;
    this.orderDirty.push(i);
  }

  // ---- frames ----

  /** Changes since the last call: despawns, spawns, moved/animated customers, order bubbles. */
  writeChanges(w: FrameWriter): void {
    for (let k = 0; k < this.despawnedN; k++) w.npcDespawn(this.despawned[k]!);
    this.despawnedN = 0;
    for (let k = 0; k < this.spawnedN; k++) {
      const h = this.spawned[k]!;
      const i = this.indexOf(h);
      if (i) this.writeSpawn(w, i);
    }
    this.spawnedN = 0;
    const q = this.stateDirty;
    for (let k = 0; k < q.length; k++) {
      const i = q.list[k]!;
      if (this.alive[i]) this.writeState(w, i);
    }
    q.clear();
    const o = this.orderDirty;
    for (let k = 0; k < o.length; k++) {
      const i = o.list[k]!;
      if (this.alive[i]) w.npcOrder(this.handle(i), this.drink[i]!, this.order[i]!);
    }
    o.clear();
  }

  /** Every customer, for a new mirror. */
  writeSnapshot(w: FrameWriter): void {
    for (let i = 1; i < this.capacity; i++) {
      if (!this.alive[i]) continue;
      this.writeSpawn(w, i);
      this.writeState(w, i);
      if (this.order[i] !== ORDER.none) w.npcOrder(this.handle(i), this.drink[i]!, this.order[i]!);
    }
    this.spawnedN = this.despawnedN = 0;
    this.stateDirty.clear();
    this.orderDirty.clear();
  }

  private writeSpawn(w: FrameWriter, i: number): void {
    w.npcSpawn(this.handle(i), NPC_DEF_CUSTOMER, this.world.state.area.id, this.look[i]!, Math.round(this.x[i]! * POS_SCALE), Math.round(this.y[i]! * POS_SCALE));
  }

  private writeState(w: FrameWriter, i: number): void {
    w.npcState(i, Math.round(this.x[i]! * POS_SCALE), Math.round(this.y[i]! * POS_SCALE), this.dir[i]!, this.anim[i]!);
  }
}
