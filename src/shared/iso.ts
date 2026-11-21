// Isometric tile math. Tiles are 32×16 px (2:1). Tile (tx, ty) has its top vertex at
// screen (sx, sy) = ((tx − ty) · 16, (tx + ty) · 8); its diamond spans sx ± 16 and sy … sy + 16.

export const TILE_W = 32;
export const TILE_H = 16;
export const HALF_W = TILE_W / 2;
export const HALF_H = TILE_H / 2;

/** Screen x of tile (tx, ty)'s top vertex, in world pixels. */
export function isoX(tx: number, ty: number): number {
  return (tx - ty) * HALF_W;
}

/** Screen y of tile (tx, ty)'s top vertex, in world pixels. */
export function isoY(tx: number, ty: number): number {
  return (tx + ty) * HALF_H;
}

/** Fractional tile coordinates under a world-pixel point. */
export function tileXf(sx: number, sy: number): number {
  return (sx / HALF_W + sy / HALF_H) / 2;
}

export function tileYf(sx: number, sy: number): number {
  return (sy / HALF_H - sx / HALF_W) / 2;
}

/** The tile whose diamond contains the world-pixel point. */
export function tileAtX(sx: number, sy: number): number {
  return Math.floor(tileXf(sx, sy));
}

export function tileAtY(sx: number, sy: number): number {
  return Math.floor(tileYf(sx, sy));
}

/** Depth sort key: later draws on top. Layer 0–3 = floor, furniture, wall item, ceiling. */
export function depthKey(tx: number, ty: number, layer: number): number {
  return (tx + ty) * 4 + layer;
}

/** World-pixel bounding box of a W×H area: [minX, minY, maxX, maxY]. */
export function areaBounds(w: number, h: number): [number, number, number, number] {
  return [-h * HALF_W, 0, w * HALF_W, (w + h) * HALF_H];
}
