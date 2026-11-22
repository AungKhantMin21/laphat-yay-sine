// Area tile data. M2.5: one street with the tea shop, explicit walk zones (shared/rules/access.ts)
// and a walled shop with a front opening and a back kitchen. Real areas load from src/data in M3.
import { FLOOR, M0_AREA_H, M0_AREA_W, WALL, ZONE } from '../shared/layout';
import { WZ } from '../shared/rules/access';
import { AreaGrids } from '../shared/world-state';

/** Rects are inclusive-exclusive. */
export interface Rect {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/** The whole shop building (kitchen + seating). */
export const SHOP = { x0: 24, y0: 9, x1: 36, y1: 19 } as const;
/** Back kitchen: staff and the player only. */
export const KITCHEN = { x0: 24, y0: 9, x1: 36, y1: 12 } as const;
/** Seating room in front of the kitchen. */
export const SEATING = { x0: 24, y0: 12, x1: 36, y1: 19 } as const;
/** The open part of the shop front (shutters span it); its row inside the shop is the `front` zone. */
export const OPENING = { x0: 30, x1: 34 } as const;
/** The kitchen door: the kitchen-side tile; the partition edge above (26, 12) is open. */
export const KITCHEN_DOOR = { x: 26, y: 11 } as const;
/** Near pavement (shop side), road, zebra crossing and far pavement. */
export const PAVEMENT = { y0: 19, y1: 22 } as const;
export const ROAD = { y0: 22, y1: 28 } as const;
export const CROSSING = { x0: 30, x1: 32 } as const;
export const FAR_PAVEMENT = { y0: 28, y1: 31 } as const;
/** Pavement rows where customers appear and leave, at x = 0 and x = w − 1. */
export const SPAWN_ROWS: readonly number[] = [19, 20, 21, 28, 29, 30];

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
  return a;
}
