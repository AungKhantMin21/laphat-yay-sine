// Tiny iso rasterizer for placeholder sprites (dev-only). Draws shaded boxes and flat shapes
// in tile space onto an RGBA buffer, using only palette colours (hex strings).
//
// Sprite convention (shared with src/render/objects.ts): for a footprint fw×fh the image is
// (fw+fh)·16 px wide; the footprint diamond sits at the bottom, its top vertex at x = fh·16.

export class IsoImage {
  readonly px: Buffer;
  readonly ox: number;
  readonly oy: number;
  readonly fw: number;
  readonly fh: number;
  /** Pixels of headroom above the footprint diamond. */
  readonly height: number;

  constructor(fw: number, fh: number, height: number) {
    this.fw = fw;
    this.fh = fh;
    this.height = height;
    this.px = Buffer.alloc(this.w * this.h * 4);
    this.ox = fh * 16;
    this.oy = height;
  }

  get w(): number {
    return (this.fw + this.fh) * 16;
  }
  get h(): number {
    return (this.fw + this.fh) * 8 + this.height;
  }

  /** Tile-space (u along x, v along y, z up in px) → image pixel coordinates. */
  at(u: number, v: number, z: number): [number, number] {
    return [this.ox + (u - v) * 16, this.oy + (u + v) * 8 - z];
  }

  set(x: number, y: number, hex: string): void {
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return;
    const i = (y * this.w + x) * 4;
    this.px[i] = parseInt(hex.slice(0, 2), 16);
    this.px[i + 1] = parseInt(hex.slice(2, 4), 16);
    this.px[i + 2] = parseInt(hex.slice(4, 6), 16);
    this.px[i + 3] = 255;
  }

  /** Fills a convex polygon (pixel centres inside). */
  poly(pts: Array<[number, number]>, hex: string): void {
    const xs = pts.map((p) => p[0]);
    const ys = pts.map((p) => p[1]);
    const x0 = Math.floor(Math.min(...xs));
    const x1 = Math.ceil(Math.max(...xs));
    const y0 = Math.floor(Math.min(...ys));
    const y1 = Math.ceil(Math.max(...ys));
    let area = 0;
    for (let k = 0; k < pts.length; k++) {
      const [ax, ay] = pts[k]!;
      const [bx, by] = pts[(k + 1) % pts.length]!;
      area += ax * by - bx * ay;
    }
    const sign = area >= 0 ? 1 : -1;
    for (let y = y0; y < y1; y++) {
      for (let x = x0; x < x1; x++) {
        const cx = x + 0.5;
        const cy = y + 0.5;
        let inside = true;
        for (let k = 0; k < pts.length && inside; k++) {
          const [ax, ay] = pts[k]!;
          const [bx, by] = pts[(k + 1) % pts.length]!;
          if (sign * ((bx - ax) * (cy - ay) - (by - ay) * (cx - ax)) < -1e-9) inside = false;
        }
        if (inside) this.set(x, y, hex);
      }
    }
  }

  /** Box over tile-space rect [u0,u1]×[v0,v1] from z0 to z1. Ramp: [top, left (+v face), right (+u face)]. */
  box(u0: number, v0: number, u1: number, v1: number, z0: number, z1: number, ramp: [string, string, string]): void {
    const P = (u: number, v: number, z: number) => this.at(u, v, z);
    if (z1 > z0) {
      this.poly([P(u0, v1, z1), P(u1, v1, z1), P(u1, v1, z0), P(u0, v1, z0)], ramp[1]);
      this.poly([P(u1, v0, z1), P(u1, v1, z1), P(u1, v1, z0), P(u1, v0, z0)], ramp[2]);
    }
    this.poly([P(u0, v0, z1), P(u1, v0, z1), P(u1, v1, z1), P(u0, v1, z1)], ramp[0]);
  }

  /** Flat quad on a vertical wall plane. side 'w': plane u = 0 (along v); side 'n': plane v = 0 (along u). */
  wallQuad(side: 'n' | 'w', a0: number, a1: number, z0: number, z1: number, hex: string): void {
    const P = (a: number, z: number) => (side === 'n' ? this.at(a, 0, z) : this.at(0, a, z));
    this.poly([P(a0, z1), P(a1, z1), P(a1, z0), P(a0, z0)], hex);
  }
}
