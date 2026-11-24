// The tea shop's own geometry under its M2.5 names, read from the neighbourhood map
// (shared/neighbourhood.ts, src/data/neighbourhood.json), plus building-front sprite ids. Shared by
// the worker (sim/area.ts builds the grids) and the renderer (building fronts, shop front).
import { NEIGHBOURHOOD, doorOffset } from './neighbourhood';
export type { Rect, Building } from './neighbourhood';

const R = NEIGHBOURHOOD.rects;
/** The whole shop building (kitchen + seating). */
export const SHOP = R.shop!;
/** Back kitchen: staff and the player only. */
export const KITCHEN = R.kitchen!;
/** Seating room in front of the kitchen. */
export const SEATING = R.seating!;
/** The open part of the shop front (shutters span it); its row inside the shop is the `front` zone. */
export const OPENING = NEIGHBOURHOOD.opening;
/** The kitchen door: the kitchen-side tile; the partition edge above (x, KITCHEN.y1) is open. */
export const KITCHEN_DOOR = NEIGHBOURHOOD.kitchenDoor;
/** The tea street: near pavement (shop side), road, zebra crossing and far pavement. */
export const PAVEMENT = { y0: R.pavement!.y0, y1: R.pavement!.y1 } as const;
export const ROAD = { y0: R.road!.y0, y1: R.road!.y1 } as const;
export const CROSSING = { x0: R.crossing!.x0, x1: R.crossing!.x1 } as const;
export const FAR_PAVEMENT = { y0: R.farPavement!.y0, y1: R.farPavement!.y1 } as const;
/** Where customers appear and leave (street ends and the doors of some houses). */
export const ENTRIES = NEIGHBOURHOOD.entries;

// ---- building fronts (decor; M3 makes some of them real shops) ----

/** Facade segment kinds, in sprite order. */
export const FACADE_KIND = { pillar: 0, door: 1, window: 2 } as const;
const KINDS = 3;
export const FACADE_VARIANTS = 3;

export const BUILDINGS = NEIGHBOURHOOD.buildings;

/** Facade grid bit: the front stands on the tile's −x edge (sprite mirrored) instead of its −y edge. */
export const FACADE_WEST = 0x80;

/** Facade grid value (1-based; 0 = none) for a segment; `west` for fronts along a −x edge. */
export function facadeId(tall: boolean, variant: number, kind: number, west = false): number {
  return (1 + ((tall ? 0 : 1) * FACADE_VARIANTS + variant) * KINDS + kind) | (west ? FACADE_WEST : 0);
}

/** Atlas frame names by facade grid value (index 0 unused). */
export const FACADE_FRAMES: readonly string[] = (() => {
  const out = [''];
  for (const tall of [true, false]) {
    for (let v = 0; v < FACADE_VARIANTS; v++) for (const k of ['pillar', 'door', 'window']) out.push(`facade/${tall ? 't' : 'l'}${v}_${k}`);
  }
  return out;
})();

/** Segment kind at offset `k` of a building `w` tiles wide: pillars at the ends, a door, windows. */
export function facadeKind(k: number, w: number): number {
  if (k === 0 || k === w - 1) return FACADE_KIND.pillar;
  return k === doorOffset(w) ? FACADE_KIND.door : FACADE_KIND.window;
}

// ---- the shop front (sprites at the front edge: row SHOP.y1's −y edge) ----

/** The signboard hangs on the front wall left of the opening. */
export const SIGN = { x: OPENING.x0 - 2 } as const;
