// Spatial hash for viewport culling. Items are integer ids with world-pixel bounding boxes.
// query() writes into a caller-owned Int32Array: no allocation per frame.

export class SpatialHash {
  private readonly cells = new Map<number, number[]>();
  private readonly boxes: Float32Array;
  private readonly stamp: Uint32Array;
  private queryId = 0;

  constructor(
    private readonly cellSize: number,
    readonly capacity: number,
  ) {
    this.boxes = new Float32Array(capacity * 4);
    this.stamp = new Uint32Array(capacity);
  }

  private key(cx: number, cy: number): number {
    // Cells within ±32767 in each direction.
    return ((cx + 0x8000) << 16) | (cy + 0x8000);
  }

  insert(id: number, x0: number, y0: number, x1: number, y1: number): void {
    const b = id * 4;
    this.boxes[b] = x0;
    this.boxes[b + 1] = y0;
    this.boxes[b + 2] = x1;
    this.boxes[b + 3] = y1;
    const s = this.cellSize;
    const cx1 = Math.floor(x1 / s);
    const cy1 = Math.floor(y1 / s);
    for (let cx = Math.floor(x0 / s); cx <= cx1; cx++) {
      for (let cy = Math.floor(y0 / s); cy <= cy1; cy++) {
        const k = this.key(cx, cy);
        let list = this.cells.get(k);
        if (!list) this.cells.set(k, (list = []));
        list.push(id);
      }
    }
  }

  remove(id: number): void {
    const b = id * 4;
    const s = this.cellSize;
    const cx1 = Math.floor(this.boxes[b + 2]! / s);
    const cy1 = Math.floor(this.boxes[b + 3]! / s);
    for (let cx = Math.floor(this.boxes[b]! / s); cx <= cx1; cx++) {
      for (let cy = Math.floor(this.boxes[b + 1]! / s); cy <= cy1; cy++) {
        const list = this.cells.get(this.key(cx, cy));
        if (!list) continue;
        const i = list.indexOf(id);
        if (i >= 0) {
          list[i] = list[list.length - 1]!;
          list.pop();
        }
      }
    }
  }

  /** Moving sprites: cheap when the box stays in the same cells. */
  update(id: number, x0: number, y0: number, x1: number, y1: number): void {
    const b = id * 4;
    const s = this.cellSize;
    const same =
      Math.floor(this.boxes[b]! / s) === Math.floor(x0 / s) &&
      Math.floor(this.boxes[b + 1]! / s) === Math.floor(y0 / s) &&
      Math.floor(this.boxes[b + 2]! / s) === Math.floor(x1 / s) &&
      Math.floor(this.boxes[b + 3]! / s) === Math.floor(y1 / s);
    if (same) {
      this.boxes[b] = x0;
      this.boxes[b + 1] = y0;
      this.boxes[b + 2] = x1;
      this.boxes[b + 3] = y1;
      return;
    }
    this.remove(id);
    this.insert(id, x0, y0, x1, y1);
  }

  /** Writes ids whose boxes overlap the rect into out; returns the count. */
  query(x0: number, y0: number, x1: number, y1: number, out: Int32Array): number {
    const q = ++this.queryId;
    const s = this.cellSize;
    let n = 0;
    const cx1 = Math.floor(x1 / s);
    const cy1 = Math.floor(y1 / s);
    for (let cx = Math.floor(x0 / s); cx <= cx1; cx++) {
      for (let cy = Math.floor(y0 / s); cy <= cy1; cy++) {
        const list = this.cells.get(this.key(cx, cy));
        if (!list) continue;
        for (let i = 0; i < list.length; i++) {
          const id = list[i]!;
          if (this.stamp[id] === q) continue;
          this.stamp[id] = q;
          const b = id * 4;
          if (this.boxes[b]! < x1 && this.boxes[b + 2]! > x0 && this.boxes[b + 1]! < y1 && this.boxes[b + 3]! > y0) {
            if (n < out.length) out[n++] = id;
          }
        }
      }
    }
    return n;
  }
}
