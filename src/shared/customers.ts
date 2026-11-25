// Generic customers (no named regulars until M5), from src/data/customers.json: walking speed,
// how many looks exist, taste ranges and how often each drink is ordered. Validated once at load.
import raw from '../data/customers.json';
import { DRINKS, type Drinks } from './drinks';

export interface CustomerRules {
  /** Tiles per real second. */
  walkSpeed: number;
  /** Placeholder looks (sprite variants). */
  looks: number;
  /** A customer's own shift of the target milk share, drawn uniformly from [lo, hi]. */
  milkShift: [number, number];
  /** −1 likes noise (a lively radio corner) … +1 wants quiet; drawn uniformly from [lo, hi]. */
  noiseTaste: [number, number];
  /** Order weight per drink id (DRINKS.defs order); sums to `orderTotal`. */
  orderWeight: number[];
  orderTotal: number;
  /** Share of the usual arrivals that named residents bring (M4): generic arrivals are scaled by 1 − this. */
  residentShare: number;
}

export interface RawCustomers {
  walkSpeed: number;
  looks: number;
  milkShift: [number, number];
  noiseTaste: [number, number];
  orders: Record<string, number>;
  residentShare?: number;
}

function range(r: [number, number], where: string, lo: number, hi: number): [number, number] {
  if (!(Array.isArray(r) && r.length === 2 && r[0] >= lo && r[1] <= hi && r[0] <= r[1])) throw new Error(`${where}: need [lo, hi] within ${lo}…${hi}`);
  return [r[0], r[1]];
}

export function buildCustomers(d: RawCustomers, drinks: Drinks = DRINKS): CustomerRules {
  if (!(d.walkSpeed > 0 && d.walkSpeed <= 8)) throw new Error('walkSpeed: must be 0…8 tiles/s');
  if (!(Number.isInteger(d.looks) && d.looks >= 1 && d.looks <= 255)) throw new Error('looks: whole number 1…255');
  const orderWeight = new Array<number>(drinks.defs.length).fill(0);
  let orderTotal = 0;
  for (const [key, w] of Object.entries(d.orders)) {
    const def = drinks.byKey.get(key);
    if (!def) throw new Error(`orders: unknown drink "${key}"`);
    if (!(Number.isInteger(w) && w >= 0)) throw new Error(`orders.${key}: whole number ≥ 0`);
    orderWeight[def.id] = w;
    orderTotal += w;
  }
  if (orderTotal <= 0) throw new Error('orders: at least one drink needs a weight');
  const residentShare = d.residentShare ?? 0;
  if (!(residentShare >= 0 && residentShare < 1)) throw new Error('residentShare: must be 0…<1');
  return {
    walkSpeed: d.walkSpeed,
    looks: d.looks,
    milkShift: range(d.milkShift, 'milkShift', -0.5, 0.5),
    noiseTaste: range(d.noiseTaste, 'noiseTaste', -1, 1),
    orderWeight,
    orderTotal,
    residentShare,
  };
}

export const CUSTOMERS: CustomerRules = buildCustomers(raw as unknown as RawCustomers);

/** Drink id for a uniform draw u in [0, 1). */
export function pickOrder(u: number, rules: CustomerRules = CUSTOMERS): number {
  let left = u * rules.orderTotal;
  const w = rules.orderWeight;
  for (let id = 0; id < w.length; id++) {
    left -= w[id]!;
    if (left < 0) return id;
  }
  let last = w.length - 1;
  while (last > 0 && w[last] === 0) last--;
  return last;
}
