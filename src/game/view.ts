// Main-thread mirror of the simulation, filled from worker frames. render/ and ui/ read it.
// NPC/object/grid stores arrive with M1–M4 (docs/ARCHITECTURE.md §3).
import type { FrameHandler } from '../shared/diff';
import { TILE_LAYER } from '../shared/layout';

/** Inclusive-exclusive tile rect that changed since render last consumed it. */
export class DirtyRect {
  x0 = 0;
  y0 = 0;
  x1 = 0;
  y1 = 0;
  get empty(): boolean {
    return this.x1 <= this.x0 || this.y1 <= this.y0;
  }
  add(x: number, y: number, w: number, h: number): void {
    if (this.empty) {
      this.x0 = x;
      this.y0 = y;
      this.x1 = x + w;
      this.y1 = y + h;
      return;
    }
    this.x0 = Math.min(this.x0, x);
    this.y0 = Math.min(this.y0, y);
    this.x1 = Math.max(this.x1, x + w);
    this.y1 = Math.max(this.y1, y + h);
  }
  clear(): void {
    this.x0 = this.y0 = this.x1 = this.y1 = 0;
  }
}

export class WorldView implements FrameHandler {
  tick = 0;
  gameMinute = 0;
  day = 0;
  /** Worker time spent on the last frame's ticks (ms). */
  simWorkMs = 0;
  area = 0;
  areaW = 0;
  areaH = 0;
  floor: Uint8Array = new Uint8Array(0);
  wall: Uint8Array = new Uint8Array(0);
  readonly floorDirty = new DirtyRect();

  /** Called when an area loads, before its snapshot is read. */
  setArea(id: number, w: number, h: number): void {
    this.area = id;
    this.areaW = w;
    this.areaH = h;
    this.floor = new Uint8Array(w * h);
    this.wall = new Uint8Array(w * h);
    this.floorDirty.add(0, 0, w, h);
  }

  header(tick: number, gameMinute: number, workCentiMs: number): void {
    this.tick = tick;
    this.gameMinute = gameMinute;
    this.simWorkMs = workCentiMs / 100;
  }
  world(_weather: number, _season: number, day: number): void {
    this.day = day;
  }
  tilePatch(layer: number, x: number, y: number, w: number, h: number, bytes: Uint8Array, offset: number): void {
    const dst = layer === TILE_LAYER.floor ? this.floor : this.wall;
    const W = this.areaW;
    for (let row = 0; row < h; row++) {
      const s = offset + row * w;
      dst.set(bytes.subarray(s, s + w), (y + row) * W + x);
    }
    this.floorDirty.add(x, y, w, h);
  }
  npcSpawn(): void {}
  npcDespawn(): void {}
  npcState(): void {}
  objUpsert(): void {}
  objRemove(): void {}
  gridPatch(): void {}
}
