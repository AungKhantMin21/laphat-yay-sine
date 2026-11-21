// Area tile data. M1 has one placeholder street with the tea shop; real areas load from src/data in M3.
import { FLOOR, M0_AREA_H, M0_AREA_W, WALL, ZONE } from '../shared/layout';
import { AreaGrids } from '../shared/world-state';

/** The tea shop's interior rect (inclusive-exclusive), shared with tests. */
export const SHOP = { x0: 24, y0: 9, x1: 36, y1: 19 } as const;
/** Owned pavement in front of the shop. */
export const FRONTAGE = { x0: 24, y0: 19, x1: 36, y1: 22 } as const;

export function createM1Area(): AreaGrids {
  const a = new AreaGrids(0, M0_AREA_W, M0_AREA_H);
  const w = a.w;
  const fill = (grid: Uint8Array, x0: number, y0: number, x1: number, y1: number, v: number, or = false): void => {
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) grid[y * w + x] = or ? grid[y * w + x]! | v : v;
  };
  a.floor.fill(FLOOR.dirt);
  fill(a.floor, 0, 22, w, 28, FLOOR.road);
  fill(a.floor, 0, 19, w, 22, FLOOR.pavement);
  fill(a.floor, 0, 28, w, 31, FLOOR.pavement);
  fill(a.floor, SHOP.x0, SHOP.y0, SHOP.x1, SHOP.y1, FLOOR.shopTile);

  fill(a.zone, SHOP.x0, SHOP.y0, SHOP.x1, SHOP.y1, ZONE.owned | ZONE.roof);
  fill(a.zone, FRONTAGE.x0, FRONTAGE.y0, FRONTAGE.x1, FRONTAGE.y1, ZONE.owned);

  // Back walls (cutaway view): along the shop's −y edge and −x edge.
  fill(a.wall, SHOP.x0, SHOP.y0, SHOP.x1, SHOP.y0 + 1, WALL.n, true);
  fill(a.wall, SHOP.x0, SHOP.y0, SHOP.x0 + 1, SHOP.y1, WALL.w, true);
  return a;
}
