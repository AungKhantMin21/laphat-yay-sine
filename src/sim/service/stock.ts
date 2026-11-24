// The kitchen stock (M3): ingredient portions on the shelf. A cup's ingredients are reserved when
// its order is taken and used when it is brewed, so an order once taken can always be made —
// service never waits on stock. Typed arrays, no allocation.
import type { DrinkDef } from '../../shared/drinks';
import { DRINKS } from '../../shared/drinks';
import { INGREDIENTS } from '../../shared/ingredients';
import { CUSTOMERS } from '../../shared/customers';

export class Stock {
  /** Portions on the shelf, per ingredient id (reserved ones included). */
  readonly count: Int32Array;
  /** Portions promised to orders taken but not brewed yet. */
  readonly reserved: Int32Array;
  /** Counts changed: Game sends a new PlayerState. */
  changed = false;

  /** Portions per cup of the usual order mix (customers.json weights), per ingredient. */
  private readonly perCup: Float64Array;

  constructor(n = INGREDIENTS.defs.length) {
    this.count = new Int32Array(n);
    this.reserved = new Int32Array(n);
    this.perCup = new Float64Array(n);
    for (const d of DRINKS.defs) {
      const w = (CUSTOMERS.orderWeight[d.id] ?? 0) / CUSTOMERS.orderTotal;
      for (let k = 0; k < n; k++) this.perCup[k] = this.perCup[k]! + w * (d.uses[k] ?? 0);
    }
  }

  available(k: number): number {
    return this.count[k]! - this.reserved[k]!;
  }

  canMake(d: DrinkDef): boolean {
    for (let k = 0; k < d.uses.length; k++) if (d.uses[k]! > this.available(k)) return false;
    return true;
  }

  /** The first drink (menu order) that can be made, or −1. */
  firstMakeable(): number {
    for (const d of DRINKS.defs) if (this.canMake(d)) return d.id;
    return -1;
  }

  /** Promises a cup's ingredients (call only after canMake). */
  reserve(d: DrinkDef): void {
    for (let k = 0; k < d.uses.length; k++) this.reserved[k] = this.reserved[k]! + d.uses[k]!;
    this.changed = true;
  }

  /** The order went away unbrewed: the ingredients are free again. */
  release(d: DrinkDef): void {
    for (let k = 0; k < d.uses.length; k++) this.reserved[k] = Math.max(0, this.reserved[k]! - d.uses[k]!);
    this.changed = true;
  }

  /** The cup was brewed: its reserved ingredients are used up. */
  consume(d: DrinkDef): void {
    for (let k = 0; k < d.uses.length; k++) {
      const n = d.uses[k]!;
      this.reserved[k] = Math.max(0, this.reserved[k]! - n);
      this.count[k] = Math.max(0, this.count[k]! - n);
    }
    this.changed = true;
  }

  add(k: number, n: number): void {
    this.count[k] = Math.max(0, this.count[k]! + n);
    this.changed = true;
  }

  /** No orders are open (the day ended): nothing stays promised. */
  clearReservations(): void {
    this.reserved.fill(0);
    this.changed = true;
  }

  /**
   * About how many more cups the shelf can make (the HUD shelf): cups of the usual order mix, or of
   * the best-stocked single drink if that is more (one ingredient ran out but others can still be made).
   */
  cupsLeft(): number {
    let mix = Infinity;
    for (let k = 0; k < this.perCup.length; k++) if (this.perCup[k]! > 0) mix = Math.min(mix, this.available(k) / this.perCup[k]!);
    let best = mix === Infinity ? 0 : Math.floor(mix);
    for (const d of DRINKS.defs) {
      let n = Infinity;
      for (let k = 0; k < d.uses.length; k++) if (d.uses[k]! > 0) n = Math.min(n, Math.floor(this.available(k) / d.uses[k]!));
      if (n !== Infinity && n > best) best = n;
    }
    return best;
  }
}
