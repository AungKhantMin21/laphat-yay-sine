// The neighbourhood shops in the worker (M3): today's rows for every shop (shared/market.ts
// dailyStock, deterministic from the save seed and the day) minus what was bought today, the goods
// the player carries, and deliveries on their way. Buying happens only at the shop's counter during
// its hours; money never goes below zero. Goods are put away as soon as the player steps into the
// shop; deliveries arrive when due (or overnight). Nothing here runs per tick unless goods are pending.
import { MINUTES_PER_DAY } from '../../shared/layout';
import { ITEM, MARKET, dailyStock, deliveryFee, unitLoad, type MarketRow, type MarketRules } from '../../shared/market';
import { NEIGHBOURHOOD } from '../../shared/neighbourhood';

/** Goods in hand or on their way: `qty` units (packs or objects) of an item. */
export interface Goods {
  kind: number;
  id: number;
  qty: number;
}

export interface Delivery extends Goods {
  /** Absolute game minute it arrives (or the next opening, if the clock is held). */
  due: number;
}

/** Where purchases go: the kitchen stock, the build inventory, the materials. */
export interface GoodsSink {
  receive(g: Goods): void;
}

export interface BuyResult {
  reason: string;
  /** Kyat paid in all (goods + delivery fee). */
  paid: number;
}

export class Market {
  /** Day the rows are for (−1 = not yet built). */
  day = -1;
  /** Today's rows per shop (qty = units left). */
  rows: MarketRow[][] = [];
  /** Units bought today per shop and row (saved). */
  sold: number[][] = [];
  carry: Goods[] = [];
  deliveries: Delivery[] = [];
  /** Rows, carry or deliveries changed: Game sends a new PlayerState. */
  changed = false;

  constructor(
    private readonly seed: number,
    readonly rules: MarketRules = MARKET,
  ) {}

  /** Builds the rows for `day` (a new day restocks every shop). Cheap when the day is unchanged. */
  refresh(day: number): void {
    if (day === this.day) return;
    this.day = day;
    this.rows = dailyStock(this.seed, day, this.rules);
    this.sold = this.rows.map((r) => r.map(() => 0));
    this.changed = true;
  }

  /** Restores today's purchases from a save (rows for `day` are rebuilt, then reduced). */
  restore(day: number, sold: number[][]): void {
    this.day = -1;
    this.refresh(day);
    sold.forEach((r, s) =>
      r.forEach((n, k) => {
        const row = this.rows[s]?.[k];
        if (!row) return;
        const take = Math.min(row.qty, Math.max(0, n | 0));
        row.qty -= take;
        this.sold[s]![k] = take;
      }),
    );
  }

  /** Load of the goods in hand. */
  load(): number {
    let n = 0;
    for (const g of this.carry) n += unitLoad(g.kind, g.id) * g.qty;
    return n;
  }

  /**
   * Buys `qty` of row `row` at shop `shop`. `minuteOfDay` for the hours, `atCounter` = the player
   * stands at the shop's visit tile. Money is checked here; the caller takes `paid` from the tin.
   */
  buy(shop: number, row: number, qty: number, deliver: boolean, money: number, minuteOfDay: number, atCounter: boolean, now: number, clockHeld: boolean): BuyResult {
    const no = (reason: string): BuyResult => ({ reason, paid: 0 });
    const site = NEIGHBOURHOOD.shops[shop];
    const r = this.rows[shop]?.[row];
    if (!site || !r) return no('market.err.gone');
    if (minuteOfDay < site.open || minuteOfDay >= site.close) return no('market.err.closed');
    if (!atCounter) return no('market.err.notHere');
    if (!(Number.isInteger(qty) && qty >= 1)) return no('market.err.gone');
    if (qty > r.qty) return no('market.err.soldOut');
    const cost = r.price * qty;
    const fee = deliver ? deliveryFee(cost, this.rules) : 0;
    if (cost + fee > money) return no('market.err.money');
    if (!deliver && this.load() + unitLoad(r.kind, r.id) * qty > this.rules.carryMax) return no('market.err.tooHeavy');
    r.qty -= qty;
    this.sold[shop]![row]! += qty;
    if (deliver) {
      // Bought while the clock is held (morning before opening, or the evening): it comes with
      // the next opening; otherwise `hours` later.
      const due = clockHeld ? -1 : now + this.rules.delivery.hours * 60;
      this.deliveries.push({ kind: r.kind, id: r.id, qty, due });
    } else {
      const same = this.carry.find((g) => g.kind === r.kind && g.id === r.id);
      if (same) same.qty += qty;
      else this.carry.push({ kind: r.kind, id: r.id, qty });
    }
    this.changed = true;
    return { reason: '', paid: cost + fee };
  }

  /** The player stepped into the shop: everything in hand is put away. Returns the goods (or null). */
  putAway(sink: GoodsSink): Goods[] | null {
    if (this.carry.length === 0) return null;
    const out = this.carry;
    for (const g of out) sink.receive(g);
    this.carry = [];
    this.changed = true;
    return out;
  }

  /**
   * Deliveries that are due at `now` (absolute game minute) arrive; `opening` = the shop just opened
   * (anything waiting for the next opening comes too). Returns what arrived (or null).
   */
  deliverDue(now: number, opening: boolean, sink: GoodsSink): Goods[] | null {
    if (this.deliveries.length === 0) return null;
    let out: Goods[] | null = null;
    this.deliveries = this.deliveries.filter((d) => {
      if (!(opening || (d.due >= 0 && d.due <= now))) return true;
      sink.receive(d);
      (out ??= []).push({ kind: d.kind, id: d.id, qty: d.qty });
      return false;
    });
    if (out) this.changed = true;
    return out;
  }

  /** Everything still on its way arrives (overnight, at Sleep). */
  deliverAll(sink: GoodsSink): Goods[] | null {
    return this.deliverDue(Number.MAX_SAFE_INTEGER, true, sink);
  }
}

/** Minute of the day for an absolute game minute. */
export function dayMinute(minute: number): number {
  return ((minute % MINUTES_PER_DAY) + MINUTES_PER_DAY) % MINUTES_PER_DAY;
}

export { ITEM };
