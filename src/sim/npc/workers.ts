// Workers (M2.5): the player character and staff. They walk (staff access class: kitchen too),
// take jobs from the task board (sim/service/) and do them in person. The player's jobs come from
// taps: a queue of up to 3 task handles, done in order. Staff choose jobs themselves (S7).
// Struct of arrays; worker w (1-based) is NPC slot WORKER_SLOT0 + w − 1 on the wire.
import { SERVICE } from '../../shared/catalog';
import type { FrameWriter } from '../../shared/diff';
import { POS_SCALE } from '../../shared/diff';
import { IndexQueue, NONE, handleGen, handleIndex, makeHandle } from '../../shared/ids';
import { MAX_WORKERS, WORKER_SLOT0 } from '../../shared/layout';
import { ANIM, DIR, NPC_DEF_PLAYER, NPC_DEF_WAITER } from '../../shared/npc';
import { TICK_HZ, type SimEvent } from '../../shared/protocol';
import { ACCESS } from '../../shared/rules/access';
import { SHOP, type ShopRules } from '../../shared/shop';
import type { Rng } from '../../shared/rng';
import { STAFF, type RoleDef, type StaffRules } from '../../shared/staff';
import type { PathFinder } from '../path/pathfinder';
import { DX, DY, type WalkGrid } from '../path/walk-grid';
import { CUP } from '../service/cups';
import type { Service } from '../service/service';
import { TASK } from '../service/task-board';
import type { Customers } from './customers';
import { ARRIVED, FAILED, drop, face, walkStep } from './walker';

/** Worker states. */
export const WS = {
  idle: 0,
  walking: 1,
  /** Doing the job where they stand (actT counts down). */
  acting: 2,
  /** The player at the counter with the pour minigame open (waits for the `serve` action). */
  brewing: 3,
} as const;

export const ROLE = { player: 0, waiter: 1 } as const;

/** Pour score of a cup brewed by staff (tea sayar, M5): steady, a little better than average. */
const STAFF_BREW_SCORE = 0.85;

/** The player is always worker 1. */
export const PLAYER = 1;
/** Jobs the player can queue at once. */
export const QUEUE_MAX = 3;

export class Workers {
  readonly capacity = MAX_WORKERS + 1;
  readonly alive: Uint8Array;
  readonly gen: Uint16Array;
  readonly role: Uint8Array;
  readonly x: Float32Array;
  readonly y: Float32Array;
  readonly tile: Int32Array;
  readonly goal: Int32Array;
  readonly path: Uint32Array;
  readonly pathStep: Uint16Array;
  readonly walkT: Uint16Array;
  readonly dir: Uint8Array;
  readonly anim: Uint8Array;
  readonly state: Uint8Array;
  readonly actT: Uint16Array;
  /** Current task handle (0 = none) and which step of it (0 = first leg, 1 = second leg). */
  readonly task: Uint32Array;
  readonly phase: Uint8Array;
  /** Player queue: QUEUE_MAX task handles per worker, the first is the current one. */
  readonly queue: Uint32Array;
  readonly qLen: Uint8Array;
  /** Customer handle being brewed for (state brewing). */
  readonly brewFor: Uint32Array;
  /** The player state (queue, brewing) changed: Game sends a new PlayerState. */
  changed = false;
  /** Staff role of each worker (null for the player). */
  private readonly staffRole: (RoleDef | null)[];
  /** Current sim tick (set by tick()): how long jobs have waited. */
  private now = 0;

  private readonly dirty: IndexQueue;
  private readonly spawned: Uint8Array;
  private spawnedN = 0;
  private readonly despawned: Uint32Array;
  private despawnedN = 0;
  private readonly speed: number;
  private readonly stuck: number;
  private readonly t: { takeOrder: number; pickUp: number; serve: number; clear: number; wash: number; brew: number };

  constructor(
    private readonly walk: WalkGrid,
    private readonly paths: PathFinder,
    private readonly service: Service,
    private readonly customers: Customers,
    private readonly emit: (e: SimEvent) => void,
    private readonly decide: Rng,
    rules: ShopRules = SHOP,
    private readonly staff: StaffRules = STAFF,
  ) {
    const n = this.capacity;
    this.staffRole = new Array<RoleDef | null>(n).fill(null);
    this.alive = new Uint8Array(n);
    this.gen = new Uint16Array(n);
    this.role = new Uint8Array(n);
    this.x = new Float32Array(n);
    this.y = new Float32Array(n);
    this.tile = new Int32Array(n);
    this.goal = new Int32Array(n);
    this.path = new Uint32Array(n);
    this.pathStep = new Uint16Array(n);
    this.walkT = new Uint16Array(n);
    this.dir = new Uint8Array(n);
    this.anim = new Uint8Array(n);
    this.state = new Uint8Array(n);
    this.actT = new Uint16Array(n);
    this.task = new Uint32Array(n);
    this.phase = new Uint8Array(n);
    this.queue = new Uint32Array(n * QUEUE_MAX);
    this.qLen = new Uint8Array(n);
    this.brewFor = new Uint32Array(n);
    this.dirty = new IndexQueue(n);
    this.spawned = new Uint8Array(n);
    this.despawned = new Uint32Array(n * 2);
    const s = rules.service;
    const ticks = (sec: number): number => Math.max(1, Math.round(sec * TICK_HZ));
    this.speed = s.walkSpeed / TICK_HZ;
    this.stuck = ticks(s.stuck);
    this.t = { takeOrder: ticks(s.takeOrder), pickUp: ticks(s.pickUp), serve: ticks(s.serve), clear: ticks(s.clear), wash: ticks(s.wash), brew: ticks(s.brew) };
  }

  /** NPC handle of worker w (its slot on the wire). */
  handle(w: number): number {
    return makeHandle(WORKER_SLOT0 + w - 1, this.gen[w]!);
  }

  /** Worker index for an NPC handle, or 0. */
  indexOfNpc(h: number): number {
    const w = handleIndex(h) - WORKER_SLOT0 + 1;
    return w >= 1 && w < this.capacity && this.alive[w] && this.gen[w] === handleGen(h) ? w : 0;
  }

  /** A worker appears at `tile`. Worker 1 is always the player; staff pass their role. */
  spawn(w: number, role: number, tile: number, staffRole: RoleDef | null = null): void {
    this.alive[w] = 1;
    this.role[w] = role;
    this.staffRole[w] = staffRole;
    this.place(w, tile);
    this.dir[w] = DIR.south;
    this.anim[w] = ANIM.stand;
    this.state[w] = WS.idle;
    this.task[w] = NONE;
    this.qLen[w] = 0;
    this.spawned[w] = 1;
    this.spawnedN++;
    this.dirty.push(w);
  }

  despawn(w: number): void {
    if (!this.alive[w]) return;
    this.clearQueue(w);
    if (this.despawnedN < this.despawned.length) this.despawned[this.despawnedN++] = this.handle(w);
    this.alive[w] = 0;
    this.gen[w] = (this.gen[w]! + 1) & 0xffff;
  }

  /** Standing place next to the counter (where the day starts), or −1 if there's no counter. */
  homeTile(): number {
    const c = this.service.fixtureTile(SERVICE.counter);
    return c < 0 ? -1 : this.besideTile(c);
  }

  /** Night: everyone back beside the counter, nothing queued. */
  reset(): void {
    const home = this.homeTile();
    for (let w = 1; w < this.capacity; w++) {
      if (!this.alive[w]) continue;
      this.clearQueue(w);
      if (home >= 0) this.place(w, home);
    }
  }

  // ---- the player's queue ----

  /** Queues task `h` for worker w (the player taps a job). Returns '' or an i18n error key. */
  queueTask(w: number, h: number): string {
    const b = this.service.board;
    const i = b.indexOf(h);
    if (!i || b.kind[i] === TASK.cook) return 'serve.err.gone';
    const base = w * QUEUE_MAX;
    for (let k = 0; k < this.qLen[w]!; k++) if (this.queue[base + k] === h) return 'serve.err.queued';
    if (this.qLen[w]! >= QUEUE_MAX) return 'serve.err.queueFull';
    // Taking a job over from staff: they let it go and choose another (not once it's in their hands).
    const other = b.claimedBy[i]!;
    if (other !== 0 && other !== w) {
      if (this.task[other] === h && this.carrying(other)) return 'serve.err.taken';
      this.release(other, h);
    }
    b.claim(h, w);
    this.queue[base + this.qLen[w]!] = h;
    this.qLen[w]!++;
    this.changed = true;
    return '';
  }

  /** Takes task `h` off worker w's queue. A job half done with a cup in hand can't be cancelled. */
  cancelTask(w: number, h: number): string {
    if (!this.inQueue(w, h)) return 'serve.err.gone';
    if (this.task[w] === h) {
      if (this.carrying(w)) return 'serve.err.carrying';
      if (this.state[w] === WS.brewing) this.service.pouring(this.brewFor[w]!, false);
      this.stop(w);
    }
    this.release(w, h);
    return '';
  }

  /** The pour minigame finished for customer `customer` with `score`. */
  brewDone(w: number, customer: number, score: number): string {
    if (this.state[w] !== WS.brewing || this.brewFor[w] !== customer) return 'serve.err.gone';
    const r = this.service.brew(customer, score, true);
    if (r) return r;
    this.finish(w);
    return '';
  }

  /** The pour minigame was closed without pouring: the brew goes back on the board. */
  cancelBrew(w: number, customer: number): string {
    if (this.state[w] !== WS.brewing || this.brewFor[w] !== customer) return 'serve.err.gone';
    this.service.pouring(customer, false);
    const h = this.task[w]!;
    this.stop(w);
    this.release(w, h);
    return '';
  }

  /** Queue position 1…3 of task h for the player (0 = not queued). */
  queuePos(h: number): number {
    const base = PLAYER * QUEUE_MAX;
    for (let k = 0; k < this.qLen[PLAYER]!; k++) if (this.queue[base + k] === h) return k + 1;
    return 0;
  }

  /** The player's queue as task handles (for PlayerState). */
  playerQueue(): number[] {
    const out: number[] = [];
    for (let k = 0; k < this.qLen[PLAYER]!; k++) out.push(this.queue[PLAYER * QUEUE_MAX + k]!);
    return out;
  }

  // ---- per tick ----

  tick(now: number): void {
    this.now = now;
    for (let w = 1; w < this.capacity; w++) {
      if (!this.alive[w]) continue;
      switch (this.state[w]) {
        case WS.idle:
          if (this.qLen[w]! === 0 && this.staffRole[w]) this.choose(w);
          if (this.qLen[w]! > 0) this.start(w, this.queue[w * QUEUE_MAX]!);
          break;
        case WS.walking: {
          const r = walkStep(this, w, this.paths, this.walk.w, this.speed, this.stuck, ACCESS.staff, true);
          this.dirty.push(w);
          if (r === ARRIVED) this.arrived(w);
          else if (r === FAILED) this.giveUp(w, 'serve.err.cantReach');
          break;
        }
        case WS.acting:
          if (this.actT[w]! > 0 && --this.actT[w]! === 0) this.done(w);
          break;
        default:
          break; // brewing: waits for the player's pour
      }
    }
  }

  /** Starts task h: work out where to go first. */
  private start(w: number, h: number): void {
    if (!this.service.board.indexOf(h)) {
      this.release(w, h); // done by someone else, or no longer needed
      return;
    }
    this.task[w] = h;
    this.phase[w] = 0;
    this.plan(w);
  }

  /** Sets the goal for the current step of the task and starts walking (or finishes the task). */
  private plan(w: number): void {
    const b = this.service.board;
    const i = b.indexOf(this.task[w]!);
    if (!i) return this.finish(w);
    const target = b.target[i]!;
    const cups = this.service.cups;
    let goal = -1;
    switch (b.kind[i]) {
      case TASK.order:
        goal = this.seatOf(target);
        break;
      case TASK.brew:
        goal = this.service.fixtureTile(SERVICE.counter);
        break;
      case TASK.serve:
        if (this.phase[w] === 0 && cups.place[target] === CUP.tray && cups.holder[target] === w) this.phase[w] = 1;
        if (this.phase[w] === 0) goal = cups.place[target] === CUP.counter ? this.service.fixtureTile(SERVICE.counter) : -1;
        else goal = this.seatOf(cups.forCustomer[target]!);
        break;
      case TASK.clear:
        if (this.phase[w] === 0 && cups.place[target] === CUP.tray && cups.holder[target] === w) this.phase[w] = 1;
        goal = this.phase[w] === 0 ? cups.tile[target]! : this.service.fixtureTile(SERVICE.sink);
        break;
      case TASK.wash:
        goal = this.service.fixtureTile(SERVICE.sink);
        break;
    }
    if (goal < 0) return this.giveUp(w, 'serve.err.gone');
    this.goal[w] = goal;
    this.walkT[w] = 0;
    drop(this, w, this.paths);
    this.state[w] = WS.walking;
    this.setAnim(w, ANIM.walk);
  }

  /** Next to the goal: start the job. */
  private arrived(w: number): void {
    face(this, w, this.goal[w]!, this.walk.w);
    this.setAnim(w, ANIM.stand);
    const b = this.service.board;
    const h = this.task[w]!;
    const i = b.indexOf(h);
    if (!i) return this.finish(w);
    const t = this.t;
    switch (b.kind[i]) {
      case TASK.order:
        return this.act(w, t.takeOrder);
      case TASK.brew: {
        if (!this.service.canBrew()) return this.giveUp(w, 'serve.err.noCups');
        if (this.staffRole[w]) return this.act(w, t.brew); // staff brew on their own (tea sayar, M5)
        const customer = b.target[i]!;
        this.state[w] = WS.brewing;
        this.brewFor[w] = customer;
        this.service.pouring(customer, true);
        this.changed = true;
        const ci = this.customers.indexOf(customer);
        this.emit({ k: 'brewReady', id: customer, drink: ci ? this.customers.drink[ci]! : 0 });
        return;
      }
      case TASK.serve:
        return this.act(w, this.phase[w] === 0 ? t.pickUp : t.serve);
      case TASK.clear:
        return this.act(w, this.phase[w] === 0 ? t.clear : t.pickUp);
      case TASK.wash:
        return this.act(w, t.wash);
    }
  }

  /** The job at hand is done: apply it and move on. */
  private done(w: number): void {
    const s = this.service;
    const b = s.board;
    const h = this.task[w]!;
    const i = b.indexOf(h);
    if (!i) return this.finish(w);
    const target = b.target[i]!;
    switch (b.kind[i]) {
      case TASK.order:
        s.takeOrder(target);
        return this.finish(w);
      case TASK.brew:
        s.brew(target, STAFF_BREW_SCORE, false);
        return this.finish(w);
      case TASK.serve:
        if (this.phase[w] === 0) {
          if (s.pickUp(target, w)) return this.giveUp(w, 'serve.err.gone');
          this.pickUpQueued(w);
          this.phase[w] = 1;
          return this.plan(w);
        }
        if (s.serve(target, w)) {
          // The customer is moving to another seat: follow them; if they left, the cup went back.
          if (s.cups.place[target] === CUP.tray && s.cups.holder[target] === w) return this.plan(w);
          return this.finish(w);
        }
        return this.finish(w);
      case TASK.clear:
        if (this.phase[w] === 0) {
          if (s.pickUpDirty(target, w)) return this.giveUp(w, 'serve.err.gone');
          this.phase[w] = 1;
          return this.plan(w);
        }
        s.dropAtSink(target, w);
        return this.finish(w);
      case TASK.wash:
        if (s.washOne() && s.cups.countIn(CUP.sink) > 0) return this.act(w, this.t.wash);
        return this.finish(w);
    }
    this.finish(w);
  }

  /**
   * An idle staff member picks the best open job they do: role weight − distance (tiles) + how long
   * it has waited (seconds) + a little seeded jitter. Re-scored only while idle, never per tick for busy staff.
   */
  private choose(w: number): void {
    const role = this.staffRole[w]!;
    const sc = this.staff.score;
    const b = this.service.board;
    const W = this.walk.w;
    const x = this.tile[w]! % W;
    const y = (this.tile[w]! - x) / W;
    let best = NONE;
    let bestScore = -Infinity;
    for (let i = 1; i < b.capacity; i++) {
      if (!b.live[i] || b.claimedBy[i] !== 0) continue;
      const kind = b.kind[i]!;
      const weight = role.weight[kind]!;
      if (weight <= 0) continue;
      const t = this.jobTile(kind, b.target[i]!);
      if (t < 0) continue;
      const tx = t % W;
      const ty = (t - tx) / W;
      const dx = tx > x ? tx - x : x - tx;
      const dy = ty > y ? ty - y : y - ty;
      const dist = dx > dy ? dx : dy;
      const age = (this.now - b.created[i]!) / TICK_HZ;
      const s = weight - sc.distance * dist + sc.age * age + sc.jitter * this.decide.next();
      if (s > bestScore) {
        bestScore = s;
        best = b.handle(i);
      }
    }
    if (best === NONE) return;
    b.claim(best, w);
    this.queue[w * QUEUE_MAX] = best;
    this.qLen[w] = 1;
  }

  /** Where a staff member would go first for a job, or −1 if they can't start it now. */
  private jobTile(kind: number, target: number): number {
    const s = this.service;
    switch (kind) {
      case TASK.order:
        return this.seatOf(target);
      case TASK.brew:
        return s.canBrew() ? s.fixtureTile(SERVICE.counter) : -1;
      case TASK.serve:
        return s.cups.place[target] === CUP.counter ? s.fixtureTile(SERVICE.counter) : -1;
      case TASK.clear:
        return s.cups.place[target] === CUP.table ? s.cups.tile[target]! : -1;
      case TASK.wash:
        return s.fixtureTile(SERVICE.sink);
      default:
        return -1;
    }
  }

  /** At the counter with room on the tray: take the cups of the next queued serve jobs too. */
  private pickUpQueued(w: number): void {
    const s = this.service;
    const b = s.board;
    for (let k = 1; k < this.qLen[w]!; k++) {
      const i = b.indexOf(this.queue[w * QUEUE_MAX + k]!);
      if (!i || b.kind[i] !== TASK.serve) continue;
      const c = b.target[i]!;
      if (s.cups.place[c] === CUP.counter && s.pickUp(c, w) === 'serve.err.trayFull') return;
    }
  }

  private act(w: number, ticks: number): void {
    this.state[w] = WS.acting;
    this.actT[w] = ticks;
  }

  /** The current task is over (done, or gone from the board). */
  private finish(w: number): void {
    const h = this.task[w]!;
    this.stop(w);
    this.release(w, h);
  }

  /** Can't do the current task: tell the player, put any cup down safely, and let the job go. */
  private giveUp(w: number, reason: string): void {
    const h = this.task[w]!;
    const cups = this.service.cups;
    // Cups in hand go back where they came from: full ones to the counter, used ones to their table.
    for (let c = 1; c <= cups.count; c++) {
      if (cups.place[c] !== CUP.tray || cups.holder[c] !== w) continue;
      cups.move(c, cups.dirty[c] ? CUP.table : CUP.counter, cups.dirty[c] ? cups.tile[c]! : -1, 0);
    }
    if (w === PLAYER && reason) this.emit({ k: 'text', key: reason });
    this.stop(w);
    this.release(w, h);
  }

  /** Back to idle (the task stays wherever release puts it). */
  private stop(w: number): void {
    drop(this, w, this.paths);
    this.task[w] = NONE;
    this.phase[w] = 0;
    this.brewFor[w] = 0;
    this.state[w] = WS.idle;
    this.setAnim(w, ANIM.stand);
    this.changed = true;
  }

  /** Takes h out of worker w's queue and back on the board for anyone. */
  private release(w: number, h: number): void {
    const base = w * QUEUE_MAX;
    const n = this.qLen[w]!;
    for (let k = 0; k < n; k++) {
      if (this.queue[base + k] !== h) continue;
      for (let j = k; j < n - 1; j++) this.queue[base + j] = this.queue[base + j + 1]!;
      this.queue[base + n - 1] = 0;
      this.qLen[w] = n - 1;
      break;
    }
    if (this.task[w] === h) this.stop(w);
    const b = this.service.board;
    const i = b.indexOf(h);
    if (i && b.claimedBy[i] === w) b.unclaim(h);
    if (i) b.dirty.push(i); // queue positions changed
    this.changed = true;
  }

  private clearQueue(w: number): void {
    while (this.qLen[w]! > 0) this.release(w, this.queue[w * QUEUE_MAX]!);
    this.stop(w);
  }

  private inQueue(w: number, h: number): boolean {
    for (let k = 0; k < this.qLen[w]!; k++) if (this.queue[w * QUEUE_MAX + k] === h) return true;
    return false;
  }

  /** Has a cup on the tray for the current task (it can't simply be dropped). */
  private carrying(w: number): boolean {
    return this.phase[w] === 1 && this.service.cups.carried(w) > 0;
  }

  /** Seat tile of customer handle h (where they sit or are going to), or −1. */
  private seatOf(h: number): number {
    const i = this.customers.indexOf(h);
    return i ? this.customers.seat[i]! : -1;
  }

  /** A staff-walkable tile beside tile t (first in a fixed order), or −1. */
  private besideTile(t: number): number {
    const W = this.walk.w;
    const x = t % W;
    const y = (t - x) / W;
    // Try the object's footprint row and its neighbours: north side first (behind the counter).
    for (let r = 1; r <= 2; r++) {
      for (let d = 0; d < 8; d++) {
        const nx = x + DX[d]! * r;
        const ny = y + DY[d]! * r;
        if (nx < 0 || ny < 0 || nx >= W || ny >= this.walk.h) continue;
        if (this.walk.passable(ny * W + nx)) return ny * W + nx;
      }
    }
    return -1;
  }

  private place(w: number, tile: number): void {
    const W = this.walk.w;
    drop(this, w, this.paths);
    this.tile[w] = tile;
    this.x[w] = (tile % W) + 0.5;
    this.y[w] = Math.floor(tile / W) + 0.5;
    this.dirty.push(w);
  }

  private setAnim(w: number, a: number): void {
    if (this.anim[w] === a) return;
    this.anim[w] = a;
    this.dirty.push(w);
  }

  // ---- frames ----

  writeChanges(out: FrameWriter): void {
    for (let k = 0; k < this.despawnedN; k++) out.npcDespawn(this.despawned[k]!);
    this.despawnedN = 0;
    if (this.spawnedN > 0) {
      for (let w = 1; w < this.capacity; w++) {
        if (!this.spawned[w]) continue;
        this.spawned[w] = 0;
        if (this.alive[w]) this.writeSpawn(out, w);
      }
      this.spawnedN = 0;
    }
    const q = this.dirty;
    for (let k = 0; k < q.length; k++) {
      const w = q.list[k]!;
      if (this.alive[w]) this.writeState(out, w);
    }
    q.clear();
  }

  writeSnapshot(out: FrameWriter): void {
    for (let w = 1; w < this.capacity; w++) {
      this.spawned[w] = 0;
      if (!this.alive[w]) continue;
      this.writeSpawn(out, w);
      this.writeState(out, w);
    }
    this.spawnedN = this.despawnedN = 0;
    this.dirty.clear();
  }

  private writeSpawn(out: FrameWriter, w: number): void {
    const def = this.role[w] === ROLE.player ? NPC_DEF_PLAYER : NPC_DEF_WAITER;
    out.npcSpawn(this.handle(w), def, 0, this.role[w]!, Math.round(this.x[w]! * POS_SCALE), Math.round(this.y[w]! * POS_SCALE));
  }

  private writeState(out: FrameWriter, w: number): void {
    out.npcState(WORKER_SLOT0 + w - 1, Math.round(this.x[w]! * POS_SCALE), Math.round(this.y[w]! * POS_SCALE), this.dir[w]!, this.anim[w]!);
  }
}
