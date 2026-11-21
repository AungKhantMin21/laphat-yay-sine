// Property grids (DESIGN §3): comfort, light, noise, warmth, shade, beauty, smell, cover.
// accum (Int16) holds exact sums so removing an object subtracts precisely; value (Uint8) is the
// clamped view everything else reads. Only the rect around a change is touched.
import { CATALOG, footH, footW } from '../../shared/catalog';
import { LEVEL, PROP_COUNT, ZONE } from '../../shared/layout';
import type { AreaGrids } from '../../shared/world-state';

export interface StampSource {
  type: number;
  x: number;
  y: number;
  rot: number;
}

/** Contribution at distance d (tiles) from the footprint: full on it, fading to 0 just past `radius`. */
export function falloff(levelUnits: number, radius: number, d: number): number {
  if (d > radius) return 0;
  return Math.round((levelUnits * (radius + 1 - d)) / (radius + 1));
}

export class PropertyGrids {
  readonly accum: Int16Array[] = [];
  readonly value: Uint8Array[] = [];
  /** Changed rect since the last flush (inclusive-exclusive) and which properties changed. */
  dx0 = 0;
  dy0 = 0;
  dx1 = 0;
  dy1 = 0;
  dirtyMask = 0;

  constructor(readonly area: AreaGrids) {
    const n = area.w * area.h;
    for (let p = 0; p < PROP_COUNT; p++) {
      this.accum.push(new Int16Array(n));
      this.value.push(new Uint8Array(n));
    }
    // Area base: roofed tiles get cover and shade; open tiles get daylight.
    const { roof, open } = CATALOG.base;
    for (let t = 0; t < n; t++) {
      const base = area.zone[t]! & ZONE.roof ? roof : open;
      for (let p = 0; p < PROP_COUNT; p++) this.accum[p]![t] = base[p]! * LEVEL;
    }
    this.markDirty(0, 0, area.w, area.h, (1 << PROP_COUNT) - 1);
    this.clampRect(0, 0, area.w, area.h);
  }

  /** Adds (sign 1) or removes (sign −1) an object's stamps. */
  apply(o: StampSource, sign: 1 | -1): void {
    const def = CATALOG.defs[o.type];
    if (!def) return;
    const fw = footW(def, o.rot);
    const fh = footH(def, o.rot);
    const W = this.area.w;
    const H = this.area.h;
    let rMax = -1;
    let mask = 0;
    for (let p = 0; p < PROP_COUNT; p++) {
      if (def.propLevel[p] === 0) continue;
      mask |= 1 << p;
      rMax = Math.max(rMax, def.propRadius[p]!);
    }
    if (rMax < 0) return;
    const x0 = Math.max(0, o.x - rMax);
    const y0 = Math.max(0, o.y - rMax);
    const x1 = Math.min(W, o.x + fw + rMax);
    const y1 = Math.min(H, o.y + fh + rMax);
    for (let ty = y0; ty < y1; ty++) {
      const dy = Math.max(o.y - ty, 0, ty - (o.y + fh - 1));
      for (let tx = x0; tx < x1; tx++) {
        const dx = Math.max(o.x - tx, 0, tx - (o.x + fw - 1));
        const d = Math.sqrt(dx * dx + dy * dy);
        const t = ty * W + tx;
        for (let p = 0; p < PROP_COUNT; p++) {
          const level = def.propLevel[p]!;
          if (level === 0) continue;
          const v = falloff(level * LEVEL, def.propRadius[p]!, d);
          if (v !== 0) this.accum[p]![t] = this.accum[p]![t]! + sign * v;
        }
      }
    }
    this.clampRect(x0, y0, x1, y1, mask);
    this.markDirty(x0, y0, x1, y1, mask);
  }

  clearDirty(): void {
    this.dx0 = this.dy0 = this.dx1 = this.dy1 = 0;
    this.dirtyMask = 0;
  }

  private clampRect(x0: number, y0: number, x1: number, y1: number, mask = (1 << PROP_COUNT) - 1): void {
    const W = this.area.w;
    for (let p = 0; p < PROP_COUNT; p++) {
      if (!(mask & (1 << p))) continue;
      const a = this.accum[p]!;
      const v = this.value[p]!;
      for (let y = y0; y < y1; y++) {
        for (let x = x0; x < x1; x++) {
          const s = a[y * W + x]!;
          v[y * W + x] = s < 0 ? 0 : s > 255 ? 255 : s;
        }
      }
    }
  }

  private markDirty(x0: number, y0: number, x1: number, y1: number, mask: number): void {
    if (this.dirtyMask === 0) {
      this.dx0 = x0;
      this.dy0 = y0;
      this.dx1 = x1;
      this.dy1 = y1;
    } else {
      this.dx0 = Math.min(this.dx0, x0);
      this.dy0 = Math.min(this.dy0, y0);
      this.dx1 = Math.max(this.dx1, x1);
      this.dy1 = Math.max(this.dy1, y1);
    }
    this.dirtyMask |= mask;
  }
}
