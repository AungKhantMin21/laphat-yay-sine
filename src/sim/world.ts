// The worker's world: shared WorldState plus change tracking for the 10 Hz frame diffs.
import type { FrameWriter } from '../shared/diff';
import { IndexQueue } from '../shared/ids';
import { TILE_LAYER } from '../shared/layout';
import { markOccupancy, WorldState, type AreaGrids } from '../shared/world-state';

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
  private nextUid = 1;
  private readonly upserts: IndexQueue;
  private readonly removed: Uint32Array;
  private removedCount = 0;

  constructor(area: AreaGrids) {
    this.state = new WorldState(area);
    this.upserts = new IndexQueue(this.state.objects.capacity);
    this.removed = new Uint32Array(this.state.objects.capacity);
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
    this.upserts.push(i);
    return i;
  }

  update(i: number, f: ObjectFields): void {
    const s = this.state.objects;
    markOccupancy(s, this.state.occ, i, 0);
    this.write(i, f);
    markOccupancy(s, this.state.occ, i, i);
    this.upserts.push(i);
  }

  remove(i: number): void {
    const s = this.state.objects;
    if (!s.live[i]) return;
    markOccupancy(s, this.state.occ, i, 0);
    this.removed[this.removedCount++] = s.handle(i);
    s.release(i);
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
  }

  /** Full state for a new mirror: tiles, then every object (parents before children). */
  writeSnapshot(w: FrameWriter): void {
    const a = this.state.area;
    w.tilePatch(TILE_LAYER.floor, 0, 0, a.w, a.h, a.floor, a.w);
    w.tilePatch(TILE_LAYER.wall, 0, 0, a.w, a.h, a.wall, a.w);
    w.tilePatch(TILE_LAYER.zone, 0, 0, a.w, a.h, a.zone, a.w);
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
