// The Near LOD rect (M4): the tiles the main thread is looking at, plus a margin. NPCs inside it are
// streamed (NPC_SPAWN/STATE/ORDER); the rest exist only in the worker. The simulation never reads
// it, so where the camera is never changes what happens.

/** Extra tiles around the view, so walkers appear just before they come into sight. */
export const NEAR_MARGIN = 4;

export class NearRect {
  x0 = -1e9;
  y0 = -1e9;
  x1 = 1e9;
  y1 = 1e9;

  /** Sets the view (tiles, inclusive-exclusive); the margin is added here. */
  set(x0: number, y0: number, x1: number, y1: number): void {
    this.x0 = x0 - NEAR_MARGIN;
    this.y0 = y0 - NEAR_MARGIN;
    this.x1 = x1 + NEAR_MARGIN;
    this.y1 = y1 + NEAR_MARGIN;
  }

  /** Everything is near (new games and tests until a viewport arrives). */
  all(): void {
    this.x0 = this.y0 = -1e9;
    this.x1 = this.y1 = 1e9;
  }

  /** Position in tiles. */
  has(x: number, y: number): boolean {
    return x >= this.x0 && x < this.x1 && y >= this.y0 && y < this.y1;
  }
}
