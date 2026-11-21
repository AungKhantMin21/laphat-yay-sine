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
}

export interface RawShop {
  hours: { open: string; close: string };
  pay: ShopRules['pay'];
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
  };
}

export const SHOP: ShopRules = buildShopRules(raw as RawShop);

/** Rounds kyat down to whole coins. */
export function toCoins(kyat: number, rules: ShopRules = SHOP): number {
  const c = rules.pay.coin;
  return Math.floor(kyat / c) * c;
}
