// Shop rules from src/data/shop.json: opening hours and how customers pay. Validated once at load.
import raw from '../data/shop.json';
import { MINUTES_PER_DAY } from './layout';

export interface ShopRules {
  /** Minute of the day the shutters open (the clock waits here until the player opens). */
  open: number;
  /** Minute of the day after which no new customers come. */
  close: number;
  pay: {
    /** Every amount is rounded down to a whole number of these (kyat). */
    coin: number;
    /** Poured cups scoring below this get no tip. */
    tipFrom: number;
    /** Tip at a perfect pour, as a fraction of the price. */
    tipMax: number;
    /**
     * Tip multiplier by how long the customer waited from asking to order to getting the cup
     * (game minutes = real seconds): `waitBonus` up to `waitFast`, falling to 0 at `waitSlow`.
     * Waiting never costs the price, only the tip.
     */
    waitFast: number;
    waitSlow: number;
    waitBonus: number;
  };
  arrivals: {
    /** Customers per game hour from each start minute (sorted; before the first = 0). */
    from: number[];
    rate: number[];
    /** Shop appeal multiplies the rate: base + perSeat × min(seats, seatCap) + comfort/beauty × average seat level, clamped. */
    appeal: { base: number; perSeat: number; seatCap: number; comfort: number; beauty: number; min: number; max: number };
  };
  /** Service timings in game minutes (= real seconds). */
  service: {
    /** Seated → asks to order. */
    orderDelay: number;
    /** Served → leaves. */
    drink: number;
    /** A walker who hasn't reached their goal after this long gives up (leaves, or vanishes if leaving). */
    stuck: number;
    /** Workers' walking speed in tiles per game minute (= real second). */
    walkSpeed: number;
    /** How long each job takes once the worker is there. `brew` is for staff (the player pours by hand). */
    takeOrder: number;
    pickUp: number;
    serve: number;
    clear: number;
    /** Per cup. */
    wash: number;
    brew: number;
  };
  /** Cups in the shop (a fixed set: washing keeps them coming) and how many a tray carries. */
  kitchen: { cups: number; tray: number };
  /** Savings tin sizes in kyat, increasing: savings move to the next tin once a tin is full. */
  tin: number[];
  /** Seat utility weights, per design level of each property near the seat. */
  seat: { comfort: number; light: number; beauty: number; shade: number; warmth: number; noise: number; table: number; distance: number; jitter: number };
}

export interface RawShop {
  hours: { open: string; close: string };
  pay: ShopRules['pay'];
  arrivals: { perHour: { from: string; rate: number }[]; appeal: ShopRules['arrivals']['appeal'] };
  service: ShopRules['service'];
  kitchen: ShopRules['kitchen'];
  tin: number[];
  seat: ShopRules['seat'];
}

/** "HH:MM" → minute of the day. */
export function parseClock(s: string, where: string): number {
  const m = /^(\d{2}):(\d{2})$/.exec(s);
  const h = m ? Number(m[1]) : NaN;
  const min = m ? Number(m[2]) : NaN;
  if (!(h >= 0 && h < 24 && min >= 0 && min < 60)) throw new Error(`${where}: expected "HH:MM", got "${s}"`);
  return h * 60 + min;
}

const frac = (v: number, where: string): number => {
  if (!(v >= 0 && v <= 1)) throw new Error(`${where}: must be 0…1`);
  return v;
};

const num = (v: number, where: string, lo = -1e6, hi = 1e6): number => {
  if (!(typeof v === 'number' && v >= lo && v <= hi)) throw new Error(`${where}: must be a number ${lo}…${hi}`);
  return v;
};

function checkAll<T extends object>(o: T, where: string, lo: number, hi: number): T {
  for (const [k, v] of Object.entries(o)) num(v as number, `${where}.${k}`, lo, hi);
  return o;
}

export function buildShopRules(d: RawShop): ShopRules {
  const open = parseClock(d.hours.open, 'hours.open');
  const close = parseClock(d.hours.close, 'hours.close');
  if (!(open < close && close < MINUTES_PER_DAY)) throw new Error('hours: open must be before close on the same day');
  const p = d.pay;
  if (!(Number.isInteger(p.coin) && p.coin > 0)) throw new Error('pay.coin: must be a whole number > 0');
  if (!(p.waitFast < p.waitSlow)) throw new Error('pay: waitFast must be below waitSlow');
  return {
    open,
    close,
    pay: {
      coin: p.coin,
      tipFrom: frac(p.tipFrom, 'pay.tipFrom'),
      tipMax: frac(p.tipMax, 'pay.tipMax'),
      waitFast: num(p.waitFast, 'pay.waitFast', 0, 24 * 60),
      waitSlow: num(p.waitSlow, 'pay.waitSlow', 0, 24 * 60),
      waitBonus: num(p.waitBonus, 'pay.waitBonus', 1, 3),
    },
    arrivals: buildArrivals(d.arrivals),
    service: checkAll({ ...d.service }, 'service', 0, 24 * 60),
    kitchen: buildKitchen(d.kitchen),
    tin: buildTin(d.tin),
    seat: checkAll({ ...d.seat }, 'seat', -100, 100),
  };
}

function buildArrivals(a: RawShop['arrivals']): ShopRules['arrivals'] {
  const from: number[] = [];
  const rate: number[] = [];
  a.perHour.forEach((r, i) => {
    const m = parseClock(r.from, `arrivals.perHour[${i}].from`);
    if (from.length > 0 && m <= from[from.length - 1]!) throw new Error('arrivals.perHour: times must increase');
    from.push(m);
    rate.push(num(r.rate, `arrivals.perHour[${i}].rate`, 0, 60));
  });
  const ap = checkAll({ ...a.appeal }, 'arrivals.appeal', -10, 100);
  if (!(ap.min >= 0 && ap.min <= ap.max)) throw new Error('arrivals.appeal: need 0 ≤ min ≤ max');
  return { from, rate, appeal: ap };
}

function buildKitchen(k: RawShop['kitchen']): ShopRules['kitchen'] {
  if (!(Number.isInteger(k.cups) && k.cups >= 1 && k.cups <= 64)) throw new Error('kitchen.cups: whole number 1…64');
  if (!(Number.isInteger(k.tray) && k.tray >= 1 && k.tray <= 4)) throw new Error('kitchen.tray: whole number 1…4');
  return { cups: k.cups, tray: k.tray };
}

function buildTin(t: number[]): number[] {
  if (!Array.isArray(t) || t.length === 0 || t.length > 16) throw new Error('tin: need 1…16 sizes');
  t.forEach((v, i) => {
    if (!(Number.isInteger(v) && v > 0)) throw new Error(`tin[${i}]: must be a whole number > 0`);
    if (i > 0 && v <= t[i - 1]!) throw new Error('tin: sizes must increase');
  });
  return [...t];
}

/** Which savings tin holds `money` (index into `tin`), and how full it is (0…1). */
export interface TinLevel {
  size: number;
  fill: number;
}

/** The smallest tin that holds the savings; past the largest tin it simply stays full. */
export function tinLevel(money: number, rules: ShopRules = SHOP, out: TinLevel = { size: 0, fill: 0 }): TinLevel {
  const tin = rules.tin;
  const m = Math.max(0, money);
  let i = 0;
  while (i < tin.length - 1 && m > tin[i]!) i++;
  out.size = i;
  out.fill = Math.min(1, m / tin[i]!);
  return out;
}

/** Customers per game hour at a minute of the day (before appeal). */
export function arrivalRate(minuteOfDay: number, rules: ShopRules = SHOP): number {
  const { from, rate } = rules.arrivals;
  let r = 0;
  for (let k = 0; k < from.length && from[k]! <= minuteOfDay; k++) r = rate[k]!;
  return r;
}

export const SHOP: ShopRules = buildShopRules(raw as RawShop);

/** Rounds kyat down to whole coins. */
export function toCoins(kyat: number, rules: ShopRules = SHOP): number {
  const c = rules.pay.coin;
  return Math.floor(kyat / c) * c;
}
