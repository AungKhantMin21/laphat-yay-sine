// The neighbourhood shops' goods (M3) from src/data/market.json. Each morning every shop shows a few
// rows from its pool: item, quantity and a price factor, drawn from a stream seeded by (save seed,
// day). Pure and deterministic, so the stock is the same after a reload; only what was bought today
// is saved. Prices round to whole `priceStep` kyat.
import raw from '../data/market.json';
import { CATALOG, footH, footW } from './catalog';
import { INGREDIENTS } from './ingredients';
import { MATERIALS } from './materials';
import { NEIGHBOURHOOD } from './neighbourhood';
import { Rng, STREAM, mixSeed } from './rng';

/** What a row sells. */
export const ITEM = { ingredient: 0, object: 1, material: 2 } as const;

export interface PoolEntry {
  kind: number;
  /** Ingredient, catalog or material id. */
  id: number;
  qty: [number, number];
}

export interface MarketRules {
  /** Pools by shop id (NEIGHBOURHOOD.shops order). */
  shops: { rows: number; pool: PoolEntry[] }[];
  priceRange: [number, number];
  priceStep: number;
  delivery: { share: number; min: number; hours: number };
  /** Load the player can carry (an ingredient or material pack is 1; furniture is its footprint). */
  carryMax: number;
}

/** One row of a shop's stock today. */
export interface MarketRow {
  kind: number;
  id: number;
  /** Units left today (packs, or objects). */
  qty: number;
  /** Kyat per unit today. */
  price: number;
}

interface RawEntry {
  ingredient?: string;
  object?: string;
  material?: string;
  qty: number[];
}
export interface RawMarket {
  priceRange: number[];
  priceStep: number;
  delivery: { share: number; min: number; hours: number };
  carryMax: number;
  shops: Record<string, { rows: number; pool: RawEntry[] }>;
}

export function buildMarket(d: RawMarket): MarketRules {
  const [lo, hi] = d.priceRange as [number, number];
  if (!(lo > 0 && hi >= lo && hi <= 3)) throw new Error('market.priceRange: need 0 < lo ≤ hi ≤ 3');
  if (!(Number.isInteger(d.priceStep) && d.priceStep > 0)) throw new Error('market.priceStep: whole number > 0');
  const dl = d.delivery;
  if (!(dl.share >= 0 && dl.share <= 1 && dl.min >= 0 && dl.hours > 0 && dl.hours <= 24)) throw new Error('market.delivery: bad values');
  if (!(Number.isInteger(d.carryMax) && d.carryMax >= 1 && d.carryMax <= 16)) throw new Error('market.carryMax: 1…16');
  const shops = NEIGHBOURHOOD.shops.map((s) => {
    const r = d.shops[s.key];
    const at = `market shop "${s.key}"`;
    if (!r) throw new Error(`${at}: missing`);
    const pool = r.pool.map((e, k): PoolEntry => {
      const where = `${at} pool ${k}`;
      let kind = -1;
      let id = -1;
      if (e.ingredient !== undefined) [kind, id] = [ITEM.ingredient, INGREDIENTS.byKey.get(e.ingredient)?.id ?? -1];
      else if (e.object !== undefined) [kind, id] = [ITEM.object, CATALOG.byKey.get(e.object)?.id ?? -1];
      else if (e.material !== undefined) [kind, id] = [ITEM.material, MATERIALS.byKey.get(e.material)?.id ?? -1];
      if (kind < 0 || id < 0) throw new Error(`${where}: unknown item`);
      if (kind === ITEM.object && CATALOG.defs[id]!.fixed) throw new Error(`${where}: fixed objects aren't sold`);
      const [q0, q1] = e.qty as [number, number];
      if (!(Number.isInteger(q0) && Number.isInteger(q1) && q0 >= 1 && q1 >= q0 && q1 <= 99)) throw new Error(`${where}: qty must be [lo, hi] within 1…99`);
      return { kind, id, qty: [q0, q1] };
    });
    if (!(Number.isInteger(r.rows) && r.rows >= 1 && r.rows <= pool.length)) throw new Error(`${at}: rows must be 1…pool size`);
    return { rows: r.rows, pool };
  });
  for (const key of Object.keys(d.shops)) if (!NEIGHBOURHOOD.shops.some((s) => s.key === key)) throw new Error(`market: unknown shop "${key}"`);
  return { shops, priceRange: [lo, hi], priceStep: d.priceStep, delivery: { ...dl }, carryMax: d.carryMax };
}

export const MARKET: MarketRules = buildMarket(raw as RawMarket);

/** Base kyat per unit of an item. */
export function basePrice(kind: number, id: number): number {
  if (kind === ITEM.ingredient) return INGREDIENTS.defs[id]!.price;
  if (kind === ITEM.material) return MATERIALS.defs[id]!.price;
  return CATALOG.defs[id]!.price;
}

/** Load of one unit: a pack is 1, furniture is its footprint. */
export function unitLoad(kind: number, id: number): number {
  if (kind !== ITEM.object) return 1;
  const def = CATALOG.defs[id]!;
  return footW(def, 0) * footH(def, 0);
}

/** i18n key of an item's name. */
export function itemName(kind: number, id: number): string {
  if (kind === ITEM.ingredient) return INGREDIENTS.defs[id]!.name;
  if (kind === ITEM.material) return MATERIALS.defs[id]!.name;
  return `obj.${CATALOG.defs[id]!.key}`;
}

/** Delivery fee for goods worth `cost` kyat. */
export function deliveryFee(cost: number, rules: MarketRules = MARKET): number {
  const step = rules.priceStep;
  return Math.max(rules.delivery.min, Math.round((cost * rules.delivery.share) / step) * step);
}

/** Every shop's rows on `day` (before today's purchases), from the save seed. */
export function dailyStock(seed: number, day: number, rules: MarketRules = MARKET): MarketRow[][] {
  const r = new Rng(mixSeed((seed ^ Math.imul(day + 1, 0x2c1b3c6d)) | 0, STREAM.market));
  const [lo, hi] = rules.priceRange;
  return rules.shops.map((shop) => {
    // Pick `rows` distinct pool entries (partial Fisher–Yates over indexes), shown in pool order.
    const idx = shop.pool.map((_, k) => k);
    for (let k = 0; k < shop.rows; k++) {
      const j = k + r.int(idx.length - k);
      [idx[k], idx[j]] = [idx[j]!, idx[k]!];
    }
    return idx
      .slice(0, shop.rows)
      .sort((a, b) => a - b)
      .map((k) => {
        const e = shop.pool[k]!;
        const qty = e.qty[0] + r.int(e.qty[1] - e.qty[0] + 1);
        const factor = lo + (hi - lo) * r.next();
        const price = Math.max(rules.priceStep, Math.round((basePrice(e.kind, e.id) * factor) / rules.priceStep) * rules.priceStep);
        return { kind: e.kind, id: e.id, qty, price };
      });
  });
}
