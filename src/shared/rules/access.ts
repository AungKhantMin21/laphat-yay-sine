// Walk access: which walk zones each kind of walker may enter. The only place these rules live
// (CLAUDE.md); the worker's walk grids and placement both read them. Pure, allocation-free.

/** Walk zone of a tile (the area `access` grid). Exclusive values, not bits. */
export const WZ = {
  /** Filler, building fronts, anything not listed: nobody walks here. */
  blocked: 0,
  /** Vehicles only (M4); people never step on it. */
  road: 1,
  /** The zebra crossing: the only road tiles people may use. */
  crossing: 2,
  pavement: 3,
  /** Shop front opening and door tiles: the only ways into the shop. Nothing may be placed here. */
  front: 4,
  /** Shop interior (seating). */
  interior: 5,
  /** Back kitchen: staff and the player only. */
  kitchen: 6,
  /** The kitchen-side tile of the kitchen door: staff only, nothing may be placed here. */
  kitchenDoor: 7,
} as const;
export const WZ_COUNT = 8;

/** Access classes: who is walking. */
export const ACCESS = { people: 0, staff: 1 } as const;
export type AccessClass = (typeof ACCESS)[keyof typeof ACCESS];
export const ACCESS_CLASSES = 2;

const bit = (z: number): number => 1 << z;
const PEOPLE = bit(WZ.pavement) | bit(WZ.crossing) | bit(WZ.front) | bit(WZ.interior);
/** Zones each class may enter, as bitmasks over WZ values (index = class). */
export const ACCESS_ZONES: readonly number[] = [PEOPLE, PEOPLE | bit(WZ.kitchen) | bit(WZ.kitchenDoor)];

export function mayEnter(cls: number, zone: number): boolean {
  return (ACCESS_ZONES[cls]! & (1 << zone)) !== 0;
}

/** Zones inside the shop building (behind the front line). */
export function isShopZone(zone: number): boolean {
  return zone === WZ.front || zone === WZ.interior || zone === WZ.kitchen || zone === WZ.kitchenDoor;
}

/** Walk-way tiles that must stay clear: nothing is ever placed on them. */
export function keepClear(zone: number): boolean {
  return zone === WZ.front || zone === WZ.kitchenDoor;
}
