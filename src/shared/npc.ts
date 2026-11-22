// NPC values that travel on the wire (NPC_STATE dir/anim, NPC_ORDER state). Shared by the worker and render.

/** Facing, by dominant step axis in tile space. */
export const DIR = { east: 0, west: 1, south: 2, north: 3 } as const;

export const ANIM = { stand: 0, walk: 1, sit: 2 } as const;

/** Order bubble state. */
export const ORDER = {
  none: 0,
  /** The drink bubble: ordered, waiting for the cup. */
  waiting: 1,
  /** Their cup is being poured at the counter. */
  pouring: 2,
  /** Served: drinking. */
  served: 3,
  /** "?" bubble: seated and wants someone to take the order. */
  ask: 4,
} as const;

/** NPC_SPAWN def id for a generic customer (named NPCs come in M5). */
export const NPC_DEF_CUSTOMER = 0;
/** NPC_SPAWN def ids for workers (M2.5). */
export const NPC_DEF_PLAYER = 1;
export const NPC_DEF_WAITER = 2;
