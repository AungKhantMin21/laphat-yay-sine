// The shop's cups: a fixed set (shop.json kitchen.cups), each in exactly one place. Washing keeps
// them coming: with no clean cup on the shelf, brewing waits (slower service, never a failure).
// Struct of arrays; cup ids are 1…count (0 = none).
import { IndexQueue } from '../../shared/ids';

export const CUP = {
  /** Clean, on the shelf behind the counter. */
  shelf: 0,
  /** Full, waiting on the counter for someone to serve it. */
  counter: 1,
  /** On a worker's tray (full on the way to a table, or dirty on the way to the sink). */
  tray: 2,
  /** On a table: being drunk, then empty until cleared. */
  table: 3,
  /** Dirty, in the sink. */
  sink: 4,
} as const;

export class Cups {
  readonly count: number;
  readonly place: Uint8Array;
  /** Drink id (meaningful while full). */
  readonly drink: Uint8Array;
  /** Pour score 0…1 of the cup's tea (tip), set when brewed. */
  readonly score: Float32Array;
  /** Customer handle it was brewed for (0 = none / used). */
  readonly forCustomer: Uint32Array;
  /** Tile it stands on (table seat tile; −1 elsewhere) and the worker carrying it (0 = none). */
  readonly tile: Int32Array;
  readonly holder: Uint8Array;
  /** Empty (after drinking, until washed). */
  readonly dirty: Uint8Array;
  /** Poured by the player (pour minigame) rather than brewed by staff. */
  readonly poured: Uint8Array;
  /** Cups that changed since the last frame (CUP section, S5). */
  readonly changed: IndexQueue;

  constructor(count: number) {
    this.count = count;
    const n = count + 1;
    this.place = new Uint8Array(n);
    this.drink = new Uint8Array(n);
    this.score = new Float32Array(n);
    this.forCustomer = new Uint32Array(n);
    this.tile = new Int32Array(n).fill(-1);
    this.holder = new Uint8Array(n);
    this.dirty = new Uint8Array(n);
    this.poured = new Uint8Array(n);
    this.changed = new IndexQueue(n);
    this.reset();
  }

  /** All cups clean on the shelf (new day, or after loading). */
  reset(): void {
    for (let c = 1; c <= this.count; c++) this.move(c, CUP.shelf, -1, 0);
    this.dirty.fill(0);
    this.poured.fill(0);
    this.forCustomer.fill(0);
  }

  /** A clean cup from the shelf, or 0. */
  clean(): number {
    for (let c = 1; c <= this.count; c++) if (this.place[c] === CUP.shelf) return c;
    return 0;
  }

  move(c: number, place: number, tile: number, holder: number): void {
    this.place[c] = place;
    this.tile[c] = tile;
    this.holder[c] = holder;
    this.changed.push(c);
  }

  /** How many cups are in `place`. */
  countIn(place: number): number {
    let n = 0;
    for (let c = 1; c <= this.count; c++) if (this.place[c] === place) n++;
    return n;
  }

  /** How many cups worker `w` carries. */
  carried(w: number): number {
    let n = 0;
    for (let c = 1; c <= this.count; c++) if (this.place[c] === CUP.tray && this.holder[c] === w) n++;
    return n;
  }
}
