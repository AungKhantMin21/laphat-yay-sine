// Area tile data (M3): the whole neighbourhood from src/data/neighbourhood.json — streets with
// explicit walk zones (shared/rules/access.ts), building fronts, the four shops (blocked counters
// with a pavement visit tile) and the walled tea shop with a front opening and a back kitchen.
import { FLOOR, WALL, ZONE } from '../shared/layout';
import { WZ } from '../shared/rules/access';
import { AreaGrids } from '../shared/world-state';
import { NEIGHBOURHOOD, spanTile } from '../shared/neighbourhood';
import { KITCHEN, KITCHEN_DOOR, OPENING, SEATING, SHOP, facadeId, facadeKind } from '../shared/street';
import type { Expansion } from '../shared/properties';

export { CROSSING, ENTRIES, FAR_PAVEMENT, KITCHEN, KITCHEN_DOOR, OPENING, PAVEMENT, ROAD, SEATING, SHOP } from '../shared/street';
export type { Rect } from '../shared/street';

/**
 * The neighbourhood grids, with `spaces` (M4: lots you bought or rented) joined to the shop: shop
 * floor, interior zone, owned and roofed; a back wall, a low sill on the pavement side, its outer side
 * wall, and the party wall opened over `opening` rows. The building front there goes.
 */
export function createArea(spaces: readonly Expansion[] = []): AreaGrids {
  const N = NEIGHBOURHOOD;
  const a = new AreaGrids(0, N.w, N.h);
  const w = a.w;
  const fill = (grid: Uint8Array, x0: number, y0: number, x1: number, y1: number, v: number, or = false): void => {
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) grid[y * w + x] = or ? grid[y * w + x]! | v : v;
  };
  // Streets: floors and walk zones in data order (everything else stays dirt and blocked).
  a.floor.fill(FLOOR.dirt);
  for (const p of N.paint) {
    fill(a.floor, p.rect.x0, p.rect.y0, p.rect.x1, p.rect.y1, p.floor);
    fill(a.access, p.rect.x0, p.rect.y0, p.rect.x1, p.rect.y1, p.zone);
  }
  // The tea shop.
  fill(a.floor, SEATING.x0, SEATING.y0, SEATING.x1, SEATING.y1, FLOOR.shopTile);
  fill(a.floor, KITCHEN.x0, KITCHEN.y0, KITCHEN.x1, KITCHEN.y1, FLOOR.kitchen);
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

  // Neighbouring building fronts on the street's back edge (a pavement tile's −y or −x edge).
  for (const b of N.buildings) {
    const n = b.to - b.from;
    for (let p = b.from; p < b.to; p++) {
      const t = spanTile(b, p);
      a.facade[t.y * w + t.x] = facadeId(b.tall, b.variant, facadeKind(p - b.from, n), b.edge === 'w');
    }
  }
  // The four shops' fronts are sprites (render); their counter row stays blocked filler.
  for (const e of spaces) joinSpace(a, e);
  return a;
}

function joinSpace(a: AreaGrids, e: Expansion): void {
  const w = a.w;
  const { x0, y0, x1, y1 } = e.rect;
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const t = y * w + x;
      a.floor[t] = FLOOR.shopTile;
      a.access[t] = WZ.interior;
      a.zone[t] = ZONE.owned | ZONE.roof;
    }
  }
  for (let x = x0; x < x1; x++) {
    a.wall[y0 * w + x] = a.wall[y0 * w + x]! | WALL.n; // back wall
    a.wall[y1 * w + x] = a.wall[y1 * w + x]! | WALL.lowN; // front sill on the pavement row
    a.facade[y1 * w + x] = 0;
  }
  const [o0, o1] = e.opening;
  if (e.join === 'w') {
    // The space is east of the shop: the shop's east sill (on column x0) opens; its own east side is a sill.
    for (let y = o0; y < o1; y++) a.wall[y * w + x0] = a.wall[y * w + x0]! & ~WALL.lowW;
    for (let y = y0; y < y1; y++) a.wall[y * w + x1] = a.wall[y * w + x1]! | WALL.lowW;
  } else {
    // West of the shop: the shop's west back wall (on column x1) opens; its own west side is a back wall.
    for (let y = o0; y < o1; y++) a.wall[y * w + x1] = a.wall[y * w + x1]! & ~WALL.w;
    for (let y = y0; y < y1; y++) a.wall[y * w + x0] = a.wall[y * w + x0]! | WALL.w;
  }
}
