// Procedural placeholder floor tiles (32×16, 2:1 pixel diamonds) until the atlas exists.
import { Texture } from 'pixi.js';
import { FLOOR, FLOOR_TYPES } from '../shared/layout';

/** Half-width of diamond row y: rows are 2, 6, …, 30, 30, …, 2 px wide so tiles tessellate exactly. */
export function diamondHalf(y: number): number {
  return y < 8 ? 2 * y + 1 : 2 * (15 - y) + 1;
}

const COLOURS: Record<number, [string, string, string]> = {
  // base, top-left light edge, bottom-right shade edge
  [FLOOR.road]: ['#4a4040', '#5a504e', '#3a3232'],
  [FLOOR.pavement]: ['#9a8670', '#ad9a82', '#857260'],
  [FLOOR.shopTile]: ['#c8a46e', '#dab886', '#a9875a'],
  [FLOOR.dirt]: ['#6e5a3c', '#7e6a4a', '#5c4a30'],
};

export function makePlaceholderFloorTextures(): Texture[] {
  const out: Texture[] = [Texture.EMPTY];
  for (let t = 1; t < FLOOR_TYPES; t++) {
    const c = document.createElement('canvas');
    c.width = 32;
    c.height = 16;
    const g = c.getContext('2d')!;
    const [base, light, shade] = COLOURS[t] ?? ['#f0f', '#f0f', '#f0f'];
    for (let y = 0; y < 16; y++) {
      const a = diamondHalf(y);
      const x0 = 16 - a;
      const x1 = 16 + a; // exclusive
      g.fillStyle = base;
      g.fillRect(x0, y, x1 - x0, 1);
      // Light from the top left: brighten the top-left edge, shade the bottom-right edge.
      g.fillStyle = y < 8 ? light : shade;
      g.fillRect(y < 8 ? x0 : x1 - 2, y, 2, 1);
    }
    const tex = Texture.from(c);
    tex.source.scaleMode = 'nearest';
    out.push(tex);
  }
  return out;
}
