// The task board: every open job in the shop (take an order, brew, serve, clear, wash, cook).
// The player and staff take jobs from it (sim/npc/workers.ts). Struct of arrays, fixed capacity,
// index + generation handles; no allocation after construction.
import { IndexQueue, NONE, handleGen, handleIndex, makeHandle } from '../../shared/ids';
import { MAX_TASKS } from '../../shared/layout';

export const TASK = {
  /** Take the order at the table. target = customer handle. */
  order: 1,
  /** Brew a cup at the counter. target = customer handle. */
  brew: 2,
  /** Carry a ready cup from the counter to the table. target = cup id. */
  serve: 3,
  /** Take a used cup from the table to the sink. target = cup id. */
  clear: 4,
  /** Wash the dirty cups in the sink. target = 0 (one task while the sink holds dirty cups). */
  wash: 5,
  /** Snacks (M5). Nothing creates it yet. */
  cook: 6,
} as const;
export const TASK_KINDS = 7;

export const TASK_CAPACITY = MAX_TASKS;

export class TaskBoard {
  readonly capacity = TASK_CAPACITY;
  readonly live: Uint8Array;
  readonly gen: Uint16Array;
  readonly kind: Uint8Array;
  readonly target: Uint32Array;
  /** Worker index holding the job (0 = open). */
  readonly claimedBy: Uint8Array;
  /** Tick it was posted (older jobs score higher for staff). */
  readonly created: Uint32Array;
  /** Open + claimed jobs per kind. */
  readonly count: Uint16Array;
  /** Slots that changed since the last frame (TASK section, S5). */
  readonly dirty: IndexQueue;
  private readonly free: Uint16Array;
  private freeTop = 0;

  constructor() {
    const n = this.capacity;
    this.live = new Uint8Array(n);
    this.gen = new Uint16Array(n);
    this.kind = new Uint8Array(n);
    this.target = new Uint32Array(n);
    this.claimedBy = new Uint8Array(n);
    this.created = new Uint32Array(n);
    this.count = new Uint16Array(TASK_KINDS);
    this.dirty = new IndexQueue(n);
    this.free = new Uint16Array(n);
    for (let i = n - 1; i >= 1; i--) this.free[this.freeTop++] = i;
  }

  handle(i: number): number {
    return makeHandle(i, this.gen[i]!);
  }

  /** Index of a live task handle, or 0. */
  indexOf(h: number): number {
    const i = handleIndex(h);
    return i > 0 && i < this.capacity && this.live[i] === 1 && this.gen[i] === handleGen(h) ? i : 0;
  }

  /** Posts a job. Returns its handle, or NONE when the board is full (the caller retries later). */
  add(kind: number, target: number, tick: number): number {
    if (this.freeTop === 0) return NONE;
    const i = this.free[--this.freeTop]!;
    this.live[i] = 1;
    this.kind[i] = kind;
    this.target[i] = target;
    this.claimedBy[i] = 0;
    this.created[i] = tick;
    this.count[kind]!++;
    this.dirty.push(i);
    return this.handle(i);
  }

  /** Takes a job off the board (done or no longer needed). Stale handles are ignored. */
  remove(h: number): void {
    const i = this.indexOf(h);
    if (!i) return;
    this.count[this.kind[i]!]!--;
    this.live[i] = 0;
    this.gen[i] = (this.gen[i]! + 1) & 0xffff;
    this.free[this.freeTop++] = i;
    this.dirty.push(i);
  }

  /** The live job of `kind` for `target`, or NONE. */
  find(kind: number, target: number): number {
    for (let i = 1; i < this.capacity; i++) if (this.live[i] && this.kind[i] === kind && this.target[i] === target) return this.handle(i);
    return NONE;
  }

  claim(h: number, worker: number): boolean {
    const i = this.indexOf(h);
    if (!i) return false;
    this.claimedBy[i] = worker;
    this.dirty.push(i);
    return true;
  }

  /** Back on the board for anyone (the worker cancelled or gave up). */
  unclaim(h: number): void {
    const i = this.indexOf(h);
    if (!i || this.claimedBy[i] === 0) return;
    this.claimedBy[i] = 0;
    this.dirty.push(i);
  }

  /** Every job goes (the day ends). */
  clear(): void {
    for (let i = 1; i < this.capacity; i++) if (this.live[i]) this.remove(this.handle(i));
  }
}
