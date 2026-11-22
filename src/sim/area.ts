// Area tile data. M2.5: one street with the tea shop, explicit walk zones (shared/rules/access.ts)
// and a walled shop with a front opening and a back kitchen. Real areas load from src/data in M3.
import { FLOOR, M0_AREA_H, M0_AREA_W, WALL, ZONE } from '../shared/layout';
import { WZ } from '../shared/rules/access';
import { AreaGrids } from '../shared/world-state';

import { BUILDINGS, CROSSING, FAR_PAVEMENT, KITCHEN, KITCHEN_DOOR, OPENING, PAVEMENT, ROAD, SEATING, SHOP, facadeId, facadeKind } from '../shared/street';

export { CROSSING, FAR_PAVEMENT, KITCHEN, KITCHEN_DOOR, OPENING, PAVEMENT, ROAD, SEATING, SHOP, SPAWN_ROWS } from '../shared/street';
export type { Rect } from '../shared/street';

export function createM1Area(): AreaGrids {
  const a = new AreaGrids(0, M0_AREA_W, M0_AREA_H);
  const w = a.w;
  const fill = (grid: Uint8Array, x0: number, y0: number, x1: number, y1: number, v: number, or = false): void => {
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) grid[y * w + x] = or ? grid[y * w + x]! | v : v;
  };
  // Floors.
  a.floor.fill(FLOOR.dirt);
  fill(a.floor, 0, ROAD.y0, w, ROAD.y1, FLOOR.road);
  fill(a.floor, CROSSING.x0, ROAD.y0, CROSSING.x1, ROAD.y1, FLOOR.crossing);
  fill(a.floor, 0, PAVEMENT.y0, w, PAVEMENT.y1, FLOOR.pavement);
  fill(a.floor, 0, FAR_PAVEMENT.y0, w, FAR_PAVEMENT.y1, FLOOR.pavement);
  fill(a.floor, SEATING.x0, SEATING.y0, SEATING.x1, SEATING.y1, FLOOR.shopTile);
  fill(a.floor, KITCHEN.x0, KITCHEN.y0, KITCHEN.x1, KITCHEN.y1, FLOOR.kitchen);

  // Walk zones (everything else stays blocked).
  fill(a.access, 0, ROAD.y0, w, ROAD.y1, WZ.road);
  fill(a.access, CROSSING.x0, ROAD.y0, CROSSING.x1, ROAD.y1, WZ.crossing);
  fill(a.access, 0, PAVEMENT.y0, w, PAVEMENT.y1, WZ.pavement);
  fill(a.access, 0, FAR_PAVEMENT.y0, w, FAR_PAVEMENT.y1, WZ.pavement);
  fill(a.access, SEATING.x0, SEATING.y0, SEATING.x1, SEATING.y1, WZ.interior);
  fill(a.access, KITCHEN.x0, KITCHEN.y0, KITCHEN.x1, KITCHEN.y1, WZ.kitchen);
  fill(a.access, OPENING.x0, SHOP.y1 - 1, OPENING.x1, SHOP.y1, WZ.front);
  a.access[KITCHEN_DOOR.y * w + KITCHEN_DOOR.x] = WZ.kitchenDoor;

  // Building zones: the whole shop is owned (buildable) and roofed.
  fill(a.zone, SHOP.x0, SHOP.y0, SHOP.x1, SHOP.y1, ZONE.owned | ZONE.roof);

  // Walls. Back walls full height (−y edge of the first row, −x edge of the first column).
  fill(a.wall, SHOP.x0, SHOP.y0, SHOP.x1, SHOP.y0 + 1, WALL.n, true);
  fill(a.wall, SHOP.x0, SHOP.y0, SHOP.x0 + 1, SHOP.y1, WALL.w, true);
  // East side and front are stored on the tile beyond them, drawn as low sills (cutaway view).
  fill(a.wall, SHOP.x1, SHOP.y0, SHOP.x1 + 1, SHOP.y1, WALL.lowW, true);
  fill(a.wall, SHOP.x0, SHOP.y1, OPENING.x0, SHOP.y1 + 1, WALL.lowN, true);
  fill(a.wall, OPENING.x1, SHOP.y1, SHOP.x1, SHOP.y1 + 1, WALL.lowN, true);
  // Kitchen partition with one door.
  fill(a.wall, KITCHEN.x0, KITCHEN.y1, KITCHEN.x1, KITCHEN.y1 + 1, WALL.lowN, true);
  a.wall[KITCHEN.y1 * w + KITCHEN_DOOR.x] = a.wall[KITCHEN.y1 * w + KITCHEN_DOOR.x]! & ~WALL.lowN;

  // Neighbouring building fronts along the back of the near pavement (on its tiles' −y edge).
  for (const b of BUILDINGS) {
    for (let x = b.x0; x < b.x1; x++) a.facade[PAVEMENT.y0 * w + x] = facadeId(b.tall, b.variant, facadeKind(x - b.x0, b.x1 - b.x0));
  }
  return a;
}
