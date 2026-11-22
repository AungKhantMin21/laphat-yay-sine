// The worker's world: shared WorldState plus change tracking for the 10 Hz frame diffs.
import { CATALOG, LAYER, footH, footW } from '../shared/catalog';
import type { FrameWriter } from '../shared/diff';
import { IndexQueue } from '../shared/ids';
import { TILE_LAYER } from '../shared/layout';
import { markOccupancy, WorldState, type AreaGrids } from '../shared/world-state';
import { PropertyGrids } from './grids/property-grids';

export interface ObjectFields {
  type: number;
  x: number;
  y: number;
  rot: number;
  layer: number;
  colour: number;
  /** Slot index of the surface below (0 = floor). */
  parent: number;
}

export class SimWorld {
  readonly state: WorldState;
  readonly grids: PropertyGrids;
  /** Property grids the main thread wants streamed (bitmask). */
  subscribed = 0;
  /** Newly subscribed grids that need a full send. */
  private fullSend = 0;
  private nextUid = 1;
  private readonly upserts: IndexQueue;
  private readonly removed: Uint32Array;
  private removedCount = 0;
  /** Tiles whose floor-standing furniture changed (walk grid rebuild), inclusive-exclusive. */
  walkX0 = 0;
  walkY0 = 0;
  walkX1 = 0;
  walkY1 = 0;

  constructor(area: AreaGrids) {
    this.state = new WorldState(area);
    this.grids = new PropertyGrids(area);
    this.upserts = new IndexQueue(this.state.objects.capacity);
    this.removed = new Uint32Array(this.state.objects.capacity);
  }

  /** Next uid to hand out (saved, so uids are never reused across sessions). */
  get uidCounter(): number {
    return this.nextUid;
  }
  set uidCounter(n: number) {
    this.nextUid = Math.max(this.nextUid, n);
  }

  /** A fresh uid for an object about to be created. */
  reserveUid(): number {
    return this.nextUid++;
  }

  get objects(): WorldState['objects'] {
    return this.state.objects;
  }

  /** Adds an object; `uid` is reused when undo/redo or a load recreates an object. Returns slot or 0 if full. */
  add(f: ObjectFields, uid = 0): number {
    const s = this.state.objects;
    const id = uid || this.nextUid++;
    if (id >= this.nextUid) this.nextUid = id + 1;
    const i = s.alloc(id);
    if (!i) return 0;
    this.write(i, f);
    markOccupancy(s, this.state.occ, i, i);
    this.grids.apply(f, 1);
    this.upserts.push(i);
    this.touchWalk(i);
    return i;
  }

  update(i: number, f: ObjectFields): void {
    this.detach(i);
    this.attach(i, f);
  }

  /** Clears an object's occupancy before a batch of moves (so moved items can't erase each other). */
  detach(i: number): void {
    this.touchWalk(i);
    markOccupancy(this.state.objects, this.state.occ, i, 0);
    this.grids.apply(this.read(i), -1);
  }

  /** Writes fields and marks occupancy for a detached object. */
  attach(i: number, f: ObjectFields): void {
    this.write(i, f);
    markOccupancy(this.state.objects, this.state.occ, i, i);
    this.grids.apply(f, 1);
    this.upserts.push(i);
    this.touchWalk(i);
  }

  remove(i: number): void {
    const s = this.state.objects;
    if (!s.live[i]) return;
    this.touchWalk(i);
    markOccupancy(s, this.state.occ, i, 0);
    this.grids.apply(this.read(i), -1);
    this.removed[this.removedCount++] = s.handle(i);
    s.release(i);
  }

  get walkDirty(): boolean {
    return this.walkX1 > this.walkX0 && this.walkY1 > this.walkY0;
  }

  clearWalkDirty(): void {
    this.walkX0 = this.walkY0 = this.walkX1 = this.walkY1 = 0;
  }

  /** Extends the walk dirty rect by the footprint of object i if it stands on the floor and blocks walking. */
  private touchWalk(i: number): void {
    const s = this.state.objects;
    if (s.layer[i] !== LAYER.furniture || s.parent[i] !== 0) return;
    const def = CATALOG.defs[s.type[i]!];
    if (!def) return;
    const x0 = s.x[i]!;
    const y0 = s.y[i]!;
    const x1 = x0 + footW(def, s.rot[i]!);
    const y1 = y0 + footH(def, s.rot[i]!);
    if (!this.walkDirty) {
      this.walkX0 = x0;
      this.walkY0 = y0;
      this.walkX1 = x1;
      this.walkY1 = y1;
      return;
    }
    if (x0 < this.walkX0) this.walkX0 = x0;
    if (y0 < this.walkY0) this.walkY0 = y0;
    if (x1 > this.walkX1) this.walkX1 = x1;
    if (y1 > this.walkY1) this.walkY1 = y1;
  }

  read(i: number): ObjectFields {
    const s = this.state.objects;
    return { type: s.type[i]!, x: s.x[i]!, y: s.y[i]!, rot: s.rot[i]!, layer: s.layer[i]!, colour: s.colour[i]!, parent: s.parent[i]! };
  }

  /** Changes since the last call: removals first (a slot may be reused in the same frame). */
  writeChanges(w: FrameWriter): void {
    for (let k = 0; k < this.removedCount; k++) w.objRemove(this.removed[k]!);
    this.removedCount = 0;
    const q = this.upserts;
    for (let k = 0; k < q.length; k++) {
      const i = q.list[k]!;
      if (this.state.objects.live[i]) this.writeUpsert(w, i);
    }
    q.clear();
    this.writeGrids(w);
  }

  /** Main thread's heat overlay: which property grids to stream. */
  subscribe(mask: number): void {
    this.fullSend |= mask & ~this.subscribed;
    this.subscribed = mask;
  }

  private writeGrids(w: FrameWriter): void {
    const g = this.grids;
    const a = this.state.area;
    for (let p = 0; p < g.value.length; p++) {
      const bit = 1 << p;
      if (!(this.subscribed & bit)) continue;
      if (this.fullSend & bit) w.gridPatch(p, 0, 0, a.w, a.h, g.value[p]!, a.w);
      else if (g.dirtyMask & bit) w.gridPatch(p, g.dx0, g.dy0, g.dx1 - g.dx0, g.dy1 - g.dy0, g.value[p]!, a.w);
    }
    this.fullSend = 0;
    g.clearDirty();
  }

  /** Full state for a new mirror: tiles, then every object (parents before children). */
  writeSnapshot(w: FrameWriter): void {
    const a = this.state.area;
    w.tilePatch(TILE_LAYER.floor, 0, 0, a.w, a.h, a.floor, a.w);
    w.tilePatch(TILE_LAYER.wall, 0, 0, a.w, a.h, a.wall, a.w);
    w.tilePatch(TILE_LAYER.zone, 0, 0, a.w, a.h, a.zone, a.w);
    w.tilePatch(TILE_LAYER.access, 0, 0, a.w, a.h, a.access, a.w);
    w.tilePatch(TILE_LAYER.facade, 0, 0, a.w, a.h, a.facade, a.w);
    const s = this.state.objects;
    for (let pass = 0; pass < 2; pass++) {
      for (let i = 1; i < s.capacity; i++) if (s.live[i] && (s.parent[i] === 0) === (pass === 0)) this.writeUpsert(w, i);
    }
    this.upserts.clear();
    this.removedCount = 0;
  }

  private writeUpsert(w: FrameWriter, i: number): void {
    const s = this.state.objects;
    const p = s.parent[i]!;
    w.objUpsert(s.handle(i), s.type[i]!, s.x[i]!, s.y[i]!, s.rot[i]!, s.layer[i]!, s.colour[i]!, s.flags[i]!, p ? s.handle(p) : 0);
  }

  private write(i: number, f: ObjectFields): void {
    const s = this.state.objects;
    s.type[i] = f.type;
    s.x[i] = f.x;
    s.y[i] = f.y;
    s.rot[i] = f.rot;
    s.layer[i] = f.layer;
    s.colour[i] = f.colour;
    s.parent[i] = f.parent;
  }
}
