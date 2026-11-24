// World state shared by the worker (authority) and the main-thread mirror (game/view.ts):
// area tile grids, the object store (struct of arrays) and per-layer occupancy grids.
// Pure TS: no DOM, no Worker globals.
import { CATALOG, LAYER, footH, footW } from './catalog';
import { NONE, handleGen, handleIndex, makeHandle } from './ids';
import { MAX_OBJECTS } from './layout';

export class AreaGrids {
  readonly floor: Uint8Array;
  /** WALL bits per tile. */
  readonly wall: Uint8Array;
  /** ZONE bits per tile. */
  readonly zone: Uint8Array;
  /** Walk zone per tile (shared/rules/access.ts WZ). */
  readonly access: Uint8Array;
  /** Building-front segment on the tile's −y edge, or its −x edge with FACADE_WEST (shared/street.ts FACADE_FRAMES index; 0 = none). Decor only. */
  readonly facade: Uint8Array;

  constructor(
    readonly id: number,
    readonly w: number,
    readonly h: number,
  ) {
    this.floor = new Uint8Array(w * h);
    this.wall = new Uint8Array(w * h);
    this.zone = new Uint8Array(w * h);
    this.access = new Uint8Array(w * h);
    this.facade = new Uint8Array(w * h);
  }

  inBounds(x: number, y: number): boolean {
    return x >= 0 && y >= 0 && x < this.w && y < this.h;
  }
}

/**
 * Objects as struct of arrays, indexed by slot (1…capacity−1; 0 = none).
 * `gen` makes wire handles safe; `uid` is a stable id that is never reused (undo/redo, saves).
 */
export class ObjectStore {
  readonly live: Uint8Array;
  readonly gen: Uint16Array;
  readonly uid: Uint32Array;
  readonly type: Uint16Array;
  readonly x: Uint8Array;
  readonly y: Uint8Array;
  readonly rot: Uint8Array;
  readonly layer: Uint8Array;
  readonly colour: Uint8Array;
  readonly flags: Uint8Array;
  /** Slot index of the surface this item stands on (0 = floor). */
  readonly parent: Uint16Array;
  private readonly free: Uint16Array;
  private freeTop = 0;
  private liveCount = 0;
  private readonly byUid = new Map<number, number>();

  constructor(readonly capacity = MAX_OBJECTS) {
    this.live = new Uint8Array(capacity);
    this.gen = new Uint16Array(capacity);
    this.uid = new Uint32Array(capacity);
    this.type = new Uint16Array(capacity);
    this.x = new Uint8Array(capacity);
    this.y = new Uint8Array(capacity);
    this.rot = new Uint8Array(capacity);
    this.layer = new Uint8Array(capacity);
    this.colour = new Uint8Array(capacity);
    this.flags = new Uint8Array(capacity);
    this.parent = new Uint16Array(capacity);
    this.free = new Uint16Array(capacity);
    for (let i = capacity - 1; i >= 1; i--) this.free[this.freeTop++] = i;
  }

  get count(): number {
    return this.liveCount;
  }

  handle(i: number): number {
    return makeHandle(i, this.gen[i]!);
  }

  /** Slot index for a live handle, or 0 if stale/invalid. */
  indexOf(h: number): number {
    const i = handleIndex(h);
    return i > 0 && i < this.capacity && this.live[i] === 1 && this.gen[i] === handleGen(h) ? i : 0;
  }

  indexOfUid(uid: number): number {
    return this.byUid.get(uid) ?? 0;
  }

  /** Allocates a free slot (worker). Returns 0 when full. */
  alloc(uid: number): number {
    if (this.freeTop === 0) return 0;
    const i = this.free[--this.freeTop]!;
    this.claim(i, this.gen[i]!, uid);
    return i;
  }

  /** Mirror side: occupy exactly the slot and generation the worker sent. */
  claimHandle(h: number, uid: number): number {
    const i = handleIndex(h);
    if (i === 0 || i >= this.capacity) return 0;
    if (this.live[i]) {
      this.byUid.delete(this.uid[i]!);
    } else {
      // Remove i from the free stack (rare: mirror and loads only).
      for (let k = 0; k < this.freeTop; k++) {
        if (this.free[k] === i) {
          this.free[k] = this.free[--this.freeTop]!;
          break;
        }
      }
      this.liveCount++;
      this.live[i] = 1;
    }
    this.gen[i] = handleGen(h);
    this.uid[i] = uid;
    this.byUid.set(uid, i);
    return i;
  }

  release(i: number): void {
    if (!this.live[i]) return;
    this.live[i] = 0;
    this.byUid.delete(this.uid[i]!);
    this.gen[i] = (this.gen[i]! + 1) & 0xffff;
    this.free[this.freeTop++] = i;
    this.liveCount--;
  }

  private claim(i: number, gen: number, uid: number): void {
    this.live[i] = 1;
    this.gen[i] = gen;
    this.uid[i] = uid;
    this.byUid.set(uid, i);
    this.liveCount++;
  }
}

/** Per-layer occupancy: slot index of the object covering each tile (0 = free). */
export class Occupancy {
  readonly floor: Uint16Array;
  readonly furniture: Uint16Array;
  readonly ceiling: Uint16Array;
  /** Small item standing on the surface at this tile. */
  readonly stack: Uint16Array;
  /** Wall items on the tile's north / west back wall. */
  readonly wallN: Uint16Array;
  readonly wallW: Uint16Array;

  constructor(
    readonly w: number,
    readonly h: number,
  ) {
    const n = w * h;
    this.floor = new Uint16Array(n);
    this.furniture = new Uint16Array(n);
    this.ceiling = new Uint16Array(n);
    this.stack = new Uint16Array(n);
    this.wallN = new Uint16Array(n);
    this.wallW = new Uint16Array(n);
  }

  clear(): void {
    this.floor.fill(0);
    this.furniture.fill(0);
    this.ceiling.fill(0);
    this.stack.fill(0);
    this.wallN.fill(0);
    this.wallW.fill(0);
  }
}

/** Wall items: rotation 0 hangs on the west (−x) wall, rotation 1 on the north (−y) wall. */
export function wallGridFor(occ: Occupancy, rot: number): Uint16Array {
  return rot & 1 ? occ.wallN : occ.wallW;
}

/** Writes `value` (slot index, or 0 to clear) into every tile the object covers on its layer. */
export function markOccupancy(s: ObjectStore, occ: Occupancy, i: number, value: number): void {
  const def = CATALOG.defs[s.type[i]!];
  if (!def) return;
  const x = s.x[i]!;
  const y = s.y[i]!;
  const W = occ.w;
  switch (s.layer[i]) {
    case LAYER.floor:
    case LAYER.furniture: {
      if (s.parent[i] !== 0) {
        occ.stack[y * W + x] = value;
        return;
      }
      const grid = s.layer[i] === LAYER.floor ? occ.floor : occ.furniture;
      const fw = footW(def, s.rot[i]!);
      const fh = footH(def, s.rot[i]!);
      for (let dy = 0; dy < fh; dy++) for (let dx = 0; dx < fw; dx++) grid[(y + dy) * W + x + dx] = value;
      return;
    }
    case LAYER.wall:
      wallGridFor(occ, s.rot[i]!)[y * W + x] = value;
      return;
    case LAYER.ceiling:
      occ.ceiling[y * W + x] = value;
      return;
  }
}

/** Area + objects + occupancy: everything placement rules and rendering need. */
export class WorldState {
  readonly objects = new ObjectStore();
  readonly occ: Occupancy;

  constructor(readonly area: AreaGrids) {
    this.occ = new Occupancy(area.w, area.h);
  }

  /** Items standing on surface object `i` (writes slot indices into out, returns count). */
  childrenOf(i: number, out: Uint16Array): number {
    const s = this.objects;
    let n = 0;
    for (let k = 1; k < s.capacity && n < out.length; k++) if (s.live[k] && s.parent[k] === i) out[n++] = k;
    return n;
  }
}

export { NONE };
