// Object catalog: parsed and validated once from src/data/objects.json, used by both threads.
// Type id = index in the objects array. Saves store keys, never ids (ids may change).
import raw from '../data/objects.json';
import { PROP, PROP_COUNT } from './layout';

export const LAYER = { floor: 0, furniture: 1, wall: 2, ceiling: 3 } as const;
export type LayerName = keyof typeof LAYER;
export const LAYER_COUNT = 4;

export interface ObjectDef {
  id: number;
  key: string;
  /** i18n key for the display name. */
  name: string;
  w: number;
  h: number;
  layer: number;
  price: number;
  /** Atlas frame prefix; frames are `${sprite}_r${rot % rots}`. */
  sprite: string;
  /** Distinct sprite orientations: 1 (symmetric), 2 or 4. */
  rots: number;
  /** Height in px of a surface small items can stand on (0 = none). */
  surface: number;
  /** 1×1 item that can stand on the floor or on a surface. */
  small: boolean;
  recolour: boolean;
  /** Seats it offers (customers, M2). */
  seat: number;
  /** Per property: level (−8…8 design levels) and radius in tiles (0–4). */
  propLevel: Int8Array;
  propRadius: Uint8Array;
}

export interface Catalog {
  defs: ObjectDef[];
  byKey: Map<string, ObjectDef>;
  /** Recolour ramps as RGB ints, light → dark. Ramp 0 is the key ramp the art is drawn in. */
  ramps: number[][];
  /** Area base contribution per property for roofed and open owned tiles (design levels). */
  base: { roof: Int8Array; open: Int8Array };
}

interface RawObject {
  key: string;
  w: number;
  h: number;
  layer: string;
  price: number;
  rots: number;
  surface?: number;
  small?: boolean;
  recolour?: boolean;
  seat?: number;
  props?: Record<string, [number, number]>;
}

export interface RawCatalog {
  ramps: string[][];
  zoneBase: Record<'roof' | 'open', Record<string, number>>;
  objects: RawObject[];
}

const MAX_RADIUS = 4;

function propVector(src: Record<string, number> | undefined, where: string): Int8Array {
  const out = new Int8Array(PROP_COUNT);
  for (const [name, level] of Object.entries(src ?? {})) {
    const p = (PROP as Record<string, number>)[name];
    if (p === undefined) throw new Error(`${where}: unknown property "${name}"`);
    out[p] = level;
  }
  return out;
}

export function buildCatalog(data: RawCatalog): Catalog {
  const ramps = data.ramps.map((r, i) => {
    if (r.length !== 3) throw new Error(`ramp ${i}: needs 3 shades`);
    return r.map((h) => parseInt(h, 16));
  });
  const defs: ObjectDef[] = [];
  const byKey = new Map<string, ObjectDef>();
  data.objects.forEach((o, id) => {
    const at = `object "${o.key}"`;
    if (!/^[a-z0-9_]+$/.test(o.key)) throw new Error(`${at}: key must be lower_snake_case`);
    if (byKey.has(o.key)) throw new Error(`${at}: duplicate key`);
    const layer = (LAYER as Record<string, number>)[o.layer];
    if (layer === undefined) throw new Error(`${at}: unknown layer "${o.layer}"`);
    if (!(o.w >= 1 && o.h >= 1 && Math.max(o.w, o.h) <= 3 && Math.min(o.w, o.h) <= 2)) throw new Error(`${at}: footprint must be 1×1 to 3×2`);
    if (![1, 2, 4].includes(o.rots)) throw new Error(`${at}: rots must be 1, 2 or 4`);
    if (!Number.isInteger(o.price) || o.price < 0) throw new Error(`${at}: price must be a whole number ≥ 0`);
    const surface = o.surface ?? 0;
    const small = o.small ?? false;
    if (surface > 0 && layer !== LAYER.furniture) throw new Error(`${at}: only furniture can have a surface`);
    if (small && (layer !== LAYER.furniture || o.w !== 1 || o.h !== 1 || surface > 0)) throw new Error(`${at}: small items are 1×1 furniture without a surface`);
    if ((layer === LAYER.wall || layer === LAYER.ceiling) && (o.w !== 1 || o.h !== 1)) throw new Error(`${at}: wall and ceiling items are 1×1`);
    const propLevel = new Int8Array(PROP_COUNT);
    const propRadius = new Uint8Array(PROP_COUNT);
    for (const [name, pair] of Object.entries(o.props ?? {})) {
      const p = (PROP as Record<string, number>)[name];
      if (p === undefined) throw new Error(`${at}: unknown property "${name}"`);
      const [level, radius] = pair;
      if (!Number.isInteger(level) || level < -8 || level > 8) throw new Error(`${at}: ${name} level must be −8…8`);
      if (!Number.isInteger(radius) || radius < 0 || radius > MAX_RADIUS) throw new Error(`${at}: ${name} radius must be 0…${MAX_RADIUS}`);
      propLevel[p] = level;
      propRadius[p] = radius;
    }
    const def: ObjectDef = {
      id,
      key: o.key,
      name: `obj.${o.key}`,
      w: o.w,
      h: o.h,
      layer,
      price: o.price,
      sprite: `obj/${o.key}`,
      rots: o.rots,
      surface,
      small,
      recolour: o.recolour ?? false,
      seat: o.seat ?? 0,
      propLevel,
      propRadius,
    };
    defs.push(def);
    byKey.set(o.key, def);
  });
  return {
    defs,
    byKey,
    ramps,
    base: { roof: propVector(data.zoneBase.roof, 'zoneBase.roof'), open: propVector(data.zoneBase.open, 'zoneBase.open') },
  };
}

export const CATALOG: Catalog = buildCatalog(raw as unknown as RawCatalog);

/** Footprint after rotation: odd rotations swap width and depth. */
export function footW(def: ObjectDef, rot: number): number {
  return rot & 1 ? def.h : def.w;
}
export function footH(def: ObjectDef, rot: number): number {
  return rot & 1 ? def.w : def.h;
}

/** Atlas frame for an object at a rotation. */
export function spriteFrame(def: ObjectDef, rot: number): string {
  return `${def.sprite}_r${rot % def.rots}`;
}

/** Sell-back value: 70% of price, rounded down (DESIGN §3). */
export function sellValue(def: ObjectDef): number {
  return Math.floor((def.price * 7) / 10);
}
