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
    /** An auto-served cup pays this fraction of the price. */
    autoFactor: number;
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
    /** Seated → order bubble. */
    orderDelay: number;
    /** Order bubble → auto-served cup, unless a pour is in progress. */
    autoServe: number;
    /** Served → leaves. */
    drink: number;
    /** A pour in progress holds the auto-serve at most this long (a lost pour UI can't stall the day). */
    pourHold: number;
    /** A walker who hasn't reached their goal after this long gives up (leaves, or vanishes if leaving). */
    stuck: number;
  };
  /** Seat utility weights, per design level of each property near the seat. */
  seat: { comfort: number; light: number; beauty: number; shade: number; warmth: number; noise: number; table: number; distance: number; jitter: number };
}

export interface RawShop {
  hours: { open: string; close: string };
  pay: ShopRules['pay'];
  arrivals: { perHour: { from: string; rate: number }[]; appeal: ShopRules['arrivals']['appeal'] };
  service: ShopRules['service'];
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
  return {
    open,
    close,
    pay: {
      coin: p.coin,
      tipFrom: frac(p.tipFrom, 'pay.tipFrom'),
      tipMax: frac(p.tipMax, 'pay.tipMax'),
      autoFactor: frac(p.autoFactor, 'pay.autoFactor'),
    },
    arrivals: buildArrivals(d.arrivals),
    service: checkAll({ ...d.service }, 'service', 0, 24 * 60),
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
