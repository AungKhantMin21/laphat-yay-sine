// The M2.5 tea shop street as pure data: geometry shared by the worker (sim/area.ts builds the
// grids from it) and the renderer (building fronts, shop front). Real areas load from src/data in M3.

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
/** The kitchen door: the kitchen-side tile; the partition edge above (x, KITCHEN.y1) is open. */
export const KITCHEN_DOOR = { x: 26, y: 11 } as const;
/** Near pavement (shop side), road, zebra crossing and far pavement. */
export const PAVEMENT = { y0: 19, y1: 22 } as const;
export const ROAD = { y0: 22, y1: 28 } as const;
export const CROSSING = { x0: 30, x1: 32 } as const;
export const FAR_PAVEMENT = { y0: 28, y1: 31 } as const;
/** Pavement rows where customers appear and leave, at x = 0 and x = w − 1. Shop side first. */
export const SPAWN_ROWS: readonly number[] = [19, 20, 21, 28, 29, 30];

// ---- building fronts (decor; M3 makes some of them real shops) ----

/** Facade segment kinds, in sprite order. */
export const FACADE_KIND = { pillar: 0, door: 1, window: 2 } as const;
const KINDS = 3;
export const FACADE_VARIANTS = 3;

/** One neighbouring building: tiles x0…x1−1 of the pavement's back edge. */
export interface Building {
  x0: number;
  x1: number;
  /** Two storeys (48 px) or one (24 px). Buildings right next to the shop are low so they never cover its room. */
  tall: boolean;
  variant: number;
}

export const BUILDINGS: readonly Building[] = [
  { x0: 0, x1: 6, tall: true, variant: 0 },
  { x0: 6, x1: 11, tall: true, variant: 1 },
  { x0: 11, x1: 17, tall: true, variant: 2 },
  { x0: 17, x1: 24, tall: true, variant: 0 },
  // x = 36 is a narrow alley beside the shop.
  { x0: 37, x1: 41, tall: false, variant: 1 },
  { x0: 41, x1: 45, tall: false, variant: 2 },
  { x0: 45, x1: 51, tall: true, variant: 1 },
  { x0: 51, x1: 57, tall: true, variant: 2 },
  { x0: 57, x1: 64, tall: true, variant: 0 },
];

/** Facade grid value (1-based; 0 = none) for a segment. */
export function facadeId(tall: boolean, variant: number, kind: number): number {
  return 1 + ((tall ? 0 : 1) * FACADE_VARIANTS + variant) * KINDS + kind;
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
  return k === 1 + ((w - 2) >> 1) ? FACADE_KIND.door : FACADE_KIND.window;
}

// ---- the shop front (sprites at the front edge: row SHOP.y1's −y edge) ----

/** The signboard hangs on the front wall left of the opening. */
export const SIGN = { x: OPENING.x0 - 2 } as const;
