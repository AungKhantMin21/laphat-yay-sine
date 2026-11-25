// The neighbourhood map (M3) from src/data/neighbourhood.json: named rects, the order they are
// painted in (floor + walk zone), building fronts, the four shops and the customer entry points.
// Validated once at load. sim/area.ts builds the grids from it; shared/street.ts exposes the tea
// shop's own rects under their M2.5 names (their values never change: saves store object tiles).
import raw from '../data/neighbourhood.json';
import { FLOOR, MAX_AREA_H, MAX_AREA_W } from './layout';
import { WZ } from './rules/access';
import { parseClock } from './shop';

/** Rects are inclusive-exclusive. */
export interface Rect {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/**
 * A run of tiles along a street's back edge. `n`: pavement row `at`, tiles from…to−1 along x; the
 * building stands on row at−1 and its front is on the pavement tiles' −y edge. `w`: pavement column
 * `at`, tiles along y; the building is at column at−1, its front on the −x edge. Only back edges
 * (away from the camera) can carry tall fronts in the cutaway view.
 */
export interface EdgeSpan {
  edge: 'n' | 'w';
  at: number;
  from: number;
  to: number;
}

export interface Building extends EdgeSpan {
  /** Two storeys (48 px) or one (24 px). */
  tall: boolean;
  variant: number;
  /** Customers come out of (and go back into) its door. */
  entry: boolean;
}

export interface ShopSite extends EdgeSpan {
  /** Index in NEIGHBOURHOOD.shops (the wire/save id is the key). */
  id: number;
  key: string;
  /** Where the player stands to buy (a pavement tile in front of the counter). */
  visitX: number;
  visitY: number;
  /** Behind the counter (blocked; the keeper is drawn there). */
  keeperX: number;
  keeperY: number;
  /** Minutes of the day. */
  open: number;
  close: number;
}

export interface Entry {
  x: number;
  y: number;
  weight: number;
}

export interface Neighbourhood {
  w: number;
  h: number;
  rects: Record<string, Rect>;
  paint: { rect: Rect; floor: number; zone: number }[];
  opening: { x0: number; x1: number };
  kitchenDoor: { x: number; y: number };
  buildings: Building[];
  shops: ShopSite[];
  /** Street entry points plus the doors of `entry` buildings. */
  entries: Entry[];
  /** The street ends (map edges) only: where people come from and go to off the map (M4). */
  ends: { x: number; y: number }[];
  /** Door tiles (on the pavement) of the `entry` buildings, in building order: where residents live (M4). */
  doors: { x: number; y: number; building: number }[];
}

interface RawSpan {
  edge: string;
  at: number;
  from: number;
  to: number;
}
export interface RawNeighbourhood {
  size: number[];
  rects: Record<string, number[]>;
  shopOpening: number[];
  kitchenDoor: number[];
  paint: string[][];
  buildings: (RawSpan & { tall: boolean; variant: number; entry: boolean })[];
  shops: (RawSpan & { key: string; visit: number; hours: string[] })[];
  entries: { tile: number[]; weight: number }[];
  entryDoorWeight: number;
}

/** Tile on the pavement side of span position p. */
export function spanTile(s: EdgeSpan, p: number): { x: number; y: number } {
  return s.edge === 'n' ? { x: p, y: s.at } : { x: s.at, y: p };
}

/** Offset of the door in a building front `w` tiles wide (the facade segment rule in shared/street.ts). */
export function doorOffset(w: number): number {
  return 1 + ((w - 2) >> 1);
}

const REQUIRED = ['shop', 'kitchen', 'seating', 'pavement', 'road', 'crossing', 'farPavement'] as const;
const FACADE_VARIANTS = 3;

export function buildNeighbourhood(d: RawNeighbourhood): Neighbourhood {
  const [w, h] = d.size as [number, number];
  if (!(Number.isInteger(w) && Number.isInteger(h) && w >= 8 && h >= 8 && w <= MAX_AREA_W && h <= MAX_AREA_H)) throw new Error(`neighbourhood: bad size ${d.size}`);
  const inX = (x: number): boolean => Number.isInteger(x) && x >= 0 && x < w;
  const inY = (y: number): boolean => Number.isInteger(y) && y >= 0 && y < h;

  const rects: Record<string, Rect> = {};
  for (const [name, r] of Object.entries(d.rects)) {
    const [x0, y0, x1, y1] = r as [number, number, number, number];
    if (r.length !== 4 || !inX(x0) || !inY(y0) || !(x1 > x0 && x1 <= w && y1 > y0 && y1 <= h)) throw new Error(`neighbourhood rect "${name}": bad bounds`);
    rects[name] = { x0, y0, x1, y1 };
  }
  for (const k of REQUIRED) if (!rects[k]) throw new Error(`neighbourhood: missing rect "${k}"`);

  const floorKeys = FLOOR as Record<string, number>;
  const zoneKeys = WZ as Record<string, number>;
  const paint = d.paint.map(([rect, floor, zone]) => {
    const at = `neighbourhood paint "${rect}"`;
    if (!rect || !rects[rect]) throw new Error(`${at}: unknown rect`);
    if (!floor || !(floor in floorKeys) || floorKeys[floor] === 0) throw new Error(`${at}: unknown floor "${floor}"`);
    if (!zone || !(zone in zoneKeys)) throw new Error(`${at}: unknown zone "${zone}"`);
    return { rect: rects[rect]!, floor: floorKeys[floor]!, zone: zoneKeys[zone]! };
  });

  const span = (s: RawSpan, at: string): EdgeSpan => {
    if (s.edge !== 'n' && s.edge !== 'w') throw new Error(`${at}: edge must be "n" or "w"`);
    const along = s.edge === 'n' ? inX : inY;
    const across = s.edge === 'n' ? inY : inX;
    if (!across(s.at) || s.at < 2 || !along(s.from) || !(s.to > s.from && (s.edge === 'n' ? s.to <= w : s.to <= h))) throw new Error(`${at}: bad span`);
    return { edge: s.edge, at: s.at, from: s.from, to: s.to };
  };
  // No two fronts on the same tiles.
  const taken = new Set<string>();
  const claim = (s: EdgeSpan, at: string): void => {
    for (let p = s.from; p < s.to; p++) {
      const k = `${s.edge}${s.at}:${p}`;
      if (taken.has(k)) throw new Error(`${at}: overlaps another front at ${p}`);
      taken.add(k);
    }
  };

  const buildings = d.buildings.map((b, i) => {
    const at = `neighbourhood building ${i}`;
    const s = span(b, at);
    claim(s, at);
    if (!(Number.isInteger(b.variant) && b.variant >= 0 && b.variant < FACADE_VARIANTS)) throw new Error(`${at}: variant must be 0…${FACADE_VARIANTS - 1}`);
    return { ...s, tall: !!b.tall, variant: b.variant, entry: !!b.entry };
  });

  const keys = new Set<string>();
  const shops = d.shops.map((r, id) => {
    const at = `neighbourhood shop "${r.key}"`;
    if (keys.has(r.key)) throw new Error(`${at}: duplicate key`);
    keys.add(r.key);
    const s = span(r, at);
    claim(s, at);
    if (!(Number.isInteger(r.visit) && r.visit >= s.from && r.visit < s.to)) throw new Error(`${at}: visit must be inside the front`);
    const [o, c] = r.hours;
    const open = parseClock(o ?? '', `${at} hours`);
    const close = parseClock(c ?? '', `${at} hours`);
    if (!(close > open)) throw new Error(`${at}: closes before it opens`);
    const v = spanTile(s, r.visit);
    const keeper = s.edge === 'n' ? { x: v.x, y: s.at - 2 } : { x: s.at - 2, y: v.y };
    return { ...s, id, key: r.key, visitX: v.x, visitY: v.y, keeperX: keeper.x, keeperY: keeper.y, open, close };
  });

  const entries: Entry[] = d.entries.map((e, i) => {
    const [x, y] = e.tile as [number, number];
    if (!inX(x) || !inY(y) || !(e.weight > 0)) throw new Error(`neighbourhood entry ${i}: bad tile or weight`);
    return { x, y, weight: e.weight };
  });
  if (!(d.entryDoorWeight > 0)) throw new Error('neighbourhood: entryDoorWeight must be > 0');
  const ends = entries.map((e) => ({ x: e.x, y: e.y }));
  const doors: Neighbourhood['doors'] = [];
  buildings.forEach((b, building) => {
    if (!b.entry) return;
    const t = spanTile(b, b.from + doorOffset(b.to - b.from));
    entries.push({ ...t, weight: d.entryDoorWeight });
    doors.push({ ...t, building });
  });
  if (entries.length === 0) throw new Error('neighbourhood: needs at least one entry');

  const [ox0, ox1] = d.shopOpening as [number, number];
  const [kx, ky] = d.kitchenDoor as [number, number];
  const shop = rects.shop!;
  if (!(ox0 >= shop.x0 && ox1 <= shop.x1 && ox1 > ox0)) throw new Error('neighbourhood: shopOpening must be inside the shop front');
  if (!inX(kx) || !inY(ky)) throw new Error('neighbourhood: bad kitchenDoor');

  return { w, h, rects, paint, opening: { x0: ox0, x1: ox1 }, kitchenDoor: { x: kx, y: ky }, buildings, shops, entries, ends, doors };
}

export const NEIGHBOURHOOD: Neighbourhood = buildNeighbourhood(raw as RawNeighbourhood);
