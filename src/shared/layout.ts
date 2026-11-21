// Capacities and grid constants shared by the worker and the main-thread mirror.
// See docs/ARCHITECTURE.md §3.

export const MAX_OBJECTS = 4096;
export const MAX_NPCS = 256;

/** Largest area grid. Grid index = y * w + x. */
export const MAX_AREA_W = 128;
export const MAX_AREA_H = 96;

/** Property grid ids, in bitmask order for 'subscribe'. */
export const PROP = { comfort: 0, light: 1, noise: 2, warmth: 3, shade: 4, beauty: 5, smell: 6, cover: 7 } as const;
export const PROP_COUNT = 8;

/** Grid values per design level: DESIGN "noise < 2" means value < 2 * LEVEL. */
export const LEVEL = 16;

/** Game clock: 1 game hour = 1 real minute while active, so 1 game minute = 1 real second. */
export const GAME_MINUTES_PER_REAL_SECOND = 1;
export const MINUTES_PER_DAY = 24 * 60;
/** New saves start at 06:00 on day 0. */
export const START_MINUTE = 6 * 60;

/** M0 placeholder street size until area data exists. */
export const M0_AREA_W = 64;
export const M0_AREA_H = 48;

/** Floor tile types (grid values in the `floor` layer). */
export const FLOOR = { none: 0, road: 1, pavement: 2, shopTile: 3, dirt: 4 } as const;
export const FLOOR_TYPES = 5;

/** TILE_PATCH layer ids. */
export const TILE_LAYER = { floor: 0, wall: 1, zone: 2 } as const;

/** `wall` grid bits: a back wall on the tile's north-east edge (−y side) or north-west edge (−x side). */
export const WALL = { n: 1, w: 2 } as const;

/** `zone` grid bits. */
export const ZONE = { owned: 1, roof: 2 } as const;
