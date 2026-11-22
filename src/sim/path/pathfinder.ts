// A* on the walk grid: 8-way without corner cutting, back walls block the edge they stand on.
// Requests are queued and searched within a node budget per tick (deterministic, so catch-up and
// live play agree), one search at a time. Results live in a fixed pool of path slots addressed by
// handles (index + generation). No allocation after construction.
//
// A path holds the tiles after the start, ending at the goal. The goal may be a blocked tile
// (a seat): it can be the destination but is never walked through.
import { NONE, SlotAllocator, handleIndex } from '../../shared/ids';
import { BLOCKED, DX, DY, MIN_COST, WALK, type WalkConfig, type WalkGrid } from './walk-grid';

export const PATH = {
  /** Handle is stale or was released. */
  none: 0,
  queued: 1,
  done: 2,
  failed: 3,
} as const;
export type PathStatus = (typeof PATH)[keyof typeof PATH];

/** Diagonal steps cost this many tenths of an orthogonal step. */
const DIAG = 14;

export class PathFinder {
  private readonly slots: SlotAllocator;
  private readonly status: Uint8Array;
  private readonly from: Int32Array;
  private readonly to: Int32Array;
  private readonly len: Uint16Array;
  /** Access class per request: which walk grid it searches. */
  private readonly cls: Uint8Array;
  /** Path tiles: slot i owns [i * stride, i * stride + len[i]). */
  readonly tiles: Uint16Array;
  readonly stride: number;
  /** FIFO of queued slot indices. */
  private readonly queue: Uint16Array;
  private qLen = 0;

  // Search state for the one active request.
  private active = 0;
  private activeVersion = -1;
  private sid = 0;
  private readonly g: Int32Array;
  private readonly f: Int32Array;
  private readonly parent: Int32Array;
  private readonly seen: Uint32Array;
  private readonly closed: Uint32Array;
  private readonly heap: Int32Array;
  private readonly heapPos: Int32Array;
  private heapLen = 0;
  /** Tile offset per direction (dx + dy * w). */
  private readonly off = new Int32Array(8);
  /** Node expansions so far (stats/tests). */
  expansions = 0;

  /** One walk grid per access class (index = class). All share one budget and one path pool. */
  readonly grids: readonly WalkGrid[];
  /** The grid of the active search. */
  private cur: WalkGrid;

  constructor(
    grids: WalkGrid | readonly WalkGrid[],
    readonly config: WalkConfig = WALK,
  ) {
    this.grids = Array.isArray(grids) ? (grids as readonly WalkGrid[]) : [grids as WalkGrid];
    const walk = this.grids[0]!;
    for (const g of this.grids) if (g.w !== walk.w || g.h !== walk.h) throw new Error('walk grids differ in size');
    this.cur = walk;
    const n = walk.w * walk.h;
    if (n > 0x10000) throw new Error('area too large for 16-bit path tiles');
    const slots = config.pathSlots + 1; // slot 0 is never used
    this.slots = new SlotAllocator(slots);
    this.status = new Uint8Array(slots);
    this.from = new Int32Array(slots);
    this.to = new Int32Array(slots);
    this.len = new Uint16Array(slots);
    this.cls = new Uint8Array(slots);
    this.stride = config.maxPathLen;
    this.tiles = new Uint16Array(slots * this.stride);
    this.queue = new Uint16Array(slots);
    this.g = new Int32Array(n);
    this.f = new Int32Array(n);
    this.parent = new Int32Array(n);
    this.seen = new Uint32Array(n);
    this.closed = new Uint32Array(n);
    this.heap = new Int32Array(n);
    this.heapPos = new Int32Array(n);
    for (let d = 0; d < 8; d++) this.off[d] = DX[d]! + DY[d]! * walk.w;
  }

  /** Paths in use (queued, done or failed but not yet released). */
  get inUse(): number {
    return this.slots.count;
  }

  /** The people grid (class 0). */
  get walk(): WalkGrid {
    return this.grids[0]!;
  }

  /**
   * Queues a search from tile index `from` to `to` for access class `cls`.
   * Returns a handle, or NONE if the pool is full.
   */
  request(from: number, to: number, cls = 0): number {
    if (!this.grids[cls]) throw new Error(`no walk grid for access class ${cls}`);
    const h = this.slots.alloc();
    if (h === NONE) return NONE;
    const i = handleIndex(h);
    this.cls[i] = cls;
    this.from[i] = from;
    this.to[i] = to;
    this.len[i] = 0;
    this.status[i] = PATH.queued;
    this.queue[this.qLen++] = i;
    return h;
  }

  /** Frees a path (also cancels a queued or running search). Stale handles are ignored. */
  release(h: number): void {
    if (!this.slots.isLive(h)) return;
    const i = handleIndex(h);
    if (this.status[i] === PATH.queued) {
      if (this.active === i) {
        this.active = 0;
      } else {
        for (let k = 0; k < this.qLen; k++) {
          if (this.queue[k] === i) {
            this.queue.copyWithin(k, k + 1, this.qLen);
            this.qLen--;
            break;
          }
        }
      }
    }
    this.status[i] = PATH.none;
    this.slots.release(h);
  }

  statusOf(h: number): PathStatus {
    return this.slots.isLive(h) ? (this.status[handleIndex(h)] as PathStatus) : PATH.none;
  }

  /** Tiles in a finished path (0 if not done, or start = goal). */
  length(h: number): number {
    return this.statusOf(h) === PATH.done ? this.len[handleIndex(h)]! : 0;
  }

  /** Offset of a path's first tile in `tiles`. */
  offset(h: number): number {
    return handleIndex(h) * this.stride;
  }

  /** k-th tile index of a finished path. */
  tileAt(h: number, k: number): number {
    return this.tiles[handleIndex(h) * this.stride + k]!;
  }

  /**
   * Whether one step from tile a to neighbouring tile b is allowed right now (paths go stale after
   * building): b passable (or the goal), no wall on the edge, no corner cutting on diagonals.
   */
  canStep(a: number, b: number, goal = -1, cls = 0): boolean {
    const walk = this.grids[cls]!;
    const w = walk.w;
    const ax = a % w;
    const ay = (a - ax) / w;
    const bx = b % w;
    const by = (b - bx) / w;
    const dx = bx - ax;
    const dy = by - ay;
    if (dx < -1 || dx > 1 || dy < -1 || dy > 1 || (dx === 0 && dy === 0)) return false;
    return walk.stepAllowed(ax, ay, dx, dy, b === goal);
  }

  /** Runs queued searches for up to `budget` node expansions (default: the per-tick budget). */
  tick(budget = this.config.nodesPerTick): void {
    let left = budget;
    while (left > 0) {
      if (this.active === 0) {
        if (this.qLen === 0) return;
        this.active = this.queue[0]!;
        this.queue.copyWithin(0, 1, this.qLen);
        this.qLen--;
        this.start();
      } else if (this.activeVersion !== this.cur.version) {
        this.start(); // the walk grid changed mid-search: begin again
      }
      left = this.expand(left);
    }
  }

  private start(): void {
    const i = this.active;
    this.cur = this.grids[this.cls[i]!]!;
    this.activeVersion = this.cur.version;
    if (++this.sid === 0xffffffff) {
      this.seen.fill(0);
      this.closed.fill(0);
      this.sid = 1;
    }
    this.heapLen = 0;
    const s = this.from[i]!;
    const t = this.to[i]!;
    const n = this.cur.w * this.cur.h;
    if (s < 0 || t < 0 || s >= n || t >= n) {
      this.finish(PATH.failed);
      return;
    }
    this.g[s] = 0;
    this.parent[s] = -1;
    this.seen[s] = this.sid;
    this.f[s] = this.heuristic(s, t);
    this.push(s);
  }

  /** Expands nodes of the active search; returns the budget left. */
  private expand(budget: number): number {
    const i = this.active;
    if (i === 0) return budget;
    const walk = this.cur;
    const w = walk.w;
    const cost = walk.cost;
    const moves = walk.moves;
    const off = this.off;
    const t = this.to[i]!;
    const sid = this.sid;
    let left = budget;
    while (this.heapLen > 0) {
      if (left <= 0) return 0;
      const cur = this.pop();
      left--;
      this.expansions++;
      if (cur === t) {
        this.finish(this.writePath(i, t) ? PATH.done : PATH.failed);
        return left;
      }
      this.closed[cur] = sid;
      const m = moves[cur]!;
      const gc = this.g[cur]!;
      for (let d = 0; d < 8; d++) {
        const nt = cur + off[d]!;
        if ((m & (1 << d)) === 0) {
          // Not walkable — unless it is the goal (a seat) and the step itself is allowed.
          if (nt !== t) continue;
          const cx = cur % w;
          if (!walk.stepAllowed(cx, (cur - cx) / w, DX[d]!, DY[d]!, true)) continue;
        }
        if (this.closed[nt] === sid) continue;
        const c = cost[nt] === BLOCKED ? MIN_COST : cost[nt]!; // only the goal can be blocked here
        const ng = gc + (d >= 4 ? ((c * DIAG + 5) / 10) | 0 : c);
        if (this.seen[nt] !== sid) {
          this.seen[nt] = sid;
          this.g[nt] = ng;
          this.parent[nt] = cur;
          this.f[nt] = ng + this.heuristic(nt, t);
          this.push(nt);
        } else if (ng < this.g[nt]!) {
          this.g[nt] = ng;
          this.parent[nt] = cur;
          this.f[nt] = ng + this.heuristic(nt, t);
          this.siftUp(this.heapPos[nt]!);
        }
      }
    }
    this.finish(PATH.failed);
    return left;
  }

  /** Octile distance at the cheapest tile cost: never overestimates. */
  private heuristic(a: number, b: number): number {
    const w = this.walk.w;
    const ax = a % w;
    const bx = b % w;
    const dx = Math.abs(ax - bx);
    const dy = Math.abs((a - ax) / w - (b - bx) / w);
    const lo = dx < dy ? dx : dy;
    const hi = dx < dy ? dy : dx;
    return hi * MIN_COST + ((lo * (DIAG - 10) * MIN_COST) / 10) | 0;
  }

  /** Writes the found path into slot i, start excluded. False if it is longer than the stride. */
  private writePath(i: number, goal: number): boolean {
    let n = 0;
    for (let c = goal; this.parent[c]! !== -1; c = this.parent[c]!) n++;
    if (n > this.stride) return false;
    const base = i * this.stride;
    let k = n;
    for (let c = goal; this.parent[c]! !== -1; c = this.parent[c]!) this.tiles[base + --k] = c;
    this.len[i] = n;
    return true;
  }

  private finish(status: PathStatus): void {
    this.status[this.active] = status;
    this.active = 0;
    this.heapLen = 0;
  }

  // Binary min-heap of tile indices keyed by f (ties: larger g first, i.e. nearer the goal).
  private less(a: number, b: number): boolean {
    const fa = this.f[a]!;
    const fb = this.f[b]!;
    return fa < fb || (fa === fb && this.g[a]! > this.g[b]!);
  }

  private push(t: number): void {
    const k = this.heapLen++;
    this.heap[k] = t;
    this.heapPos[t] = k;
    this.siftUp(k);
  }

  private pop(): number {
    const top = this.heap[0]!;
    const last = this.heap[--this.heapLen]!;
    if (this.heapLen > 0) {
      this.heap[0] = last;
      this.heapPos[last] = 0;
      this.siftDown(0);
    }
    return top;
  }

  private siftUp(k: number): void {
    const heap = this.heap;
    const t = heap[k]!;
    while (k > 0) {
      const p = (k - 1) >> 1;
      const pt = heap[p]!;
      if (!this.less(t, pt)) break;
      heap[k] = pt;
      this.heapPos[pt] = k;
      k = p;
    }
    heap[k] = t;
    this.heapPos[t] = k;
  }

  private siftDown(k: number): void {
    const heap = this.heap;
    const n = this.heapLen;
    const t = heap[k]!;
    for (;;) {
      const l = 2 * k + 1;
      if (l >= n) break;
      const r = l + 1;
      const c = r < n && this.less(heap[r]!, heap[l]!) ? r : l;
      const ct = heap[c]!;
      if (!this.less(ct, t)) break;
      heap[k] = ct;
      this.heapPos[ct] = k;
      k = c;
    }
    heap[k] = t;
    this.heapPos[t] = k;
  }
}
