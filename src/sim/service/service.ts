// The service loop's rules: which jobs exist and what doing each one changes. Workers (the player
// and staff, sim/npc/workers.ts) walk to the right place and then call these. Every cup is made by a
// person; customers never leave unserved, and waiting only lowers the tip.
//
//   customer asks ─▶ ORDER ─takeOrder─▶ BREW ─brew─▶ cup on the counter, SERVE
//   SERVE ─pickUp─▶ cup on the tray ─serve─▶ cup on the table, customer pays and drinks
//   customer leaves ─▶ CLEAR ─pickUpDirty─▶ tray ─dropAtSink─▶ sink, WASH ─washOne─▶ shelf
import { CATALOG, SERVICE } from '../../shared/catalog';
import { NONE } from '../../shared/ids';
import { SHOP, type ShopRules } from '../../shared/shop';
import type { Customers, CustomerHooks } from '../npc/customers';
import type { SimWorld } from '../world';
import { CUP, Cups } from './cups';
import { TASK, TaskBoard } from './task-board';

/** The shop takes the money: customer handle, drink id, pour score 0…1, wait in game minutes, poured by the player. */
export type OnPaid = (customer: number, drink: number, score: number, wait: number, poured: boolean) => void;

export class Service implements CustomerHooks {
  readonly board = new TaskBoard();
  readonly cups: Cups;
  /** Sim tick (set by tick()); jobs remember when they were posted. */
  private now = 0;

  constructor(
    private readonly world: SimWorld,
    private readonly customers: Customers,
    private readonly onPaid: OnPaid,
    readonly rules: ShopRules = SHOP,
  ) {
    this.cups = new Cups(rules.kitchen.cups);
    customers.hooks = this;
  }

  tick(now: number): void {
    this.now = now;
  }

  // ---- fixtures ----

  /** Origin tile of the first placed object with this service role (SERVICE.*), or −1. */
  fixtureTile(service: number): number {
    const s = this.world.objects;
    const W = this.world.state.area.w;
    for (let i = 1; i < s.capacity; i++) {
      if (s.live[i] && CATALOG.defs[s.type[i]!]!.service === service) return s.y[i]! * W + s.x[i]!;
    }
    return -1;
  }

  // ---- customer hooks ----

  asked(i: number): void {
    this.post(TASK.order, this.customers.handle(i));
  }

  finished(i: number, tile: number): void {
    const h = this.customers.handle(i);
    const c = this.cups;
    for (let k = 1; k <= c.count; k++) {
      if (c.forCustomer[k] !== h || c.place[k] !== CUP.table) continue;
      c.forCustomer[k] = 0;
      c.dirty[k] = 1;
      c.tile[k] = tile;
      c.changed.push(k);
      this.post(TASK.clear, k);
    }
  }

  gone(i: number): void {
    const h = this.customers.handle(i);
    const b = this.board;
    b.remove(b.find(TASK.order, h));
    b.remove(b.find(TASK.brew, h));
    // A cup already brewed for them goes back on the shelf, unused (nothing is lost).
    const c = this.cups;
    for (let k = 1; k <= c.count; k++) {
      if (c.forCustomer[k] !== h) continue;
      b.remove(b.find(TASK.serve, k));
      c.forCustomer[k] = 0;
      c.move(k, CUP.shelf, -1, 0);
    }
  }

  // ---- jobs (worker `w` is at the right place; each returns '' or an i18n error key) ----

  /** Takes customer `h`'s order: the drink bubble shows and a brew job goes up. */
  takeOrder(h: number): string {
    const i = this.customers.indexOf(h);
    if (!i || !this.customers.orderTaken(i)) return 'serve.err.gone';
    this.board.remove(this.board.find(TASK.order, h));
    this.post(TASK.brew, h);
    return '';
  }

  /** A clean cup is free for brewing. */
  canBrew(): boolean {
    return this.cups.clean() !== 0;
  }

  /** The pour for customer `h` starts or stops (their bubble shows it). */
  pouring(h: number, on: boolean): void {
    const i = this.customers.indexOf(h);
    if (i) this.customers.pouring(i, on);
  }

  /** Brews customer `h`'s drink with pour `score` (0…1): a full cup waits on the counter to be served. */
  brew(h: number, score: number, poured: boolean): string {
    const i = this.customers.indexOf(h);
    const b = this.board;
    const task = b.find(TASK.brew, h);
    if (!i || task === NONE || !this.customers.awaitingCup(i)) return 'serve.err.gone';
    const c = this.cups.clean();
    if (c === 0) return 'serve.err.noCups';
    this.customers.pouring(i, false);
    const cups = this.cups;
    cups.drink[c] = this.customers.drink[i]!;
    cups.score[c] = score;
    cups.forCustomer[c] = h;
    cups.poured[c] = poured ? 1 : 0;
    cups.move(c, CUP.counter, -1, 0);
    b.remove(task);
    this.post(TASK.serve, c);
    return '';
  }

  /** Worker `w` takes ready cup `c` from the counter onto their tray. */
  pickUp(c: number, w: number): string {
    const cups = this.cups;
    if (c < 1 || c > cups.count || cups.place[c] !== CUP.counter) return 'serve.err.gone';
    if (cups.carried(w) >= this.rules.kitchen.tray) return 'serve.err.trayFull';
    cups.move(c, CUP.tray, -1, w);
    return '';
  }

  /** Worker `w` puts cup `c` (on their tray) down for its customer, who pays. */
  serve(c: number, w: number): string {
    const cups = this.cups;
    if (c < 1 || c > cups.count || cups.place[c] !== CUP.tray || cups.holder[c] !== w) return 'serve.err.gone';
    const h = cups.forCustomer[c]!;
    const i = this.customers.indexOf(h);
    if (!i || !this.customers.seated(i)) return 'serve.err.gone';
    const wait = this.customers.served(i);
    if (wait < 0) return 'serve.err.gone';
    const poured = cups.poured[c] === 1;
    cups.move(c, CUP.table, this.customers.seat[i]!, 0);
    this.board.remove(this.board.find(TASK.serve, c));
    this.onPaid(h, cups.drink[c]!, cups.score[c]!, wait, poured);
    return '';
  }

  /** Worker `w` takes used cup `c` off its table onto their tray. */
  pickUpDirty(c: number, w: number): string {
    const cups = this.cups;
    if (c < 1 || c > cups.count || cups.place[c] !== CUP.table || cups.dirty[c] !== 1) return 'serve.err.gone';
    if (cups.carried(w) >= this.rules.kitchen.tray) return 'serve.err.trayFull';
    cups.move(c, CUP.tray, -1, w);
    return '';
  }

  /** Worker `w` drops used cup `c` (on their tray) in the sink; it waits to be washed. */
  dropAtSink(c: number, w: number): string {
    const cups = this.cups;
    if (c < 1 || c > cups.count || cups.place[c] !== CUP.tray || cups.holder[c] !== w || cups.dirty[c] !== 1) return 'serve.err.gone';
    cups.move(c, CUP.sink, -1, 0);
    this.board.remove(this.board.find(TASK.clear, c));
    if (this.board.find(TASK.wash, 0) === NONE) this.post(TASK.wash, 0);
    return '';
  }

  /** Washes one dirty cup in the sink back onto the shelf. Returns false when the sink is empty. */
  washOne(): boolean {
    const cups = this.cups;
    for (let c = 1; c <= cups.count; c++) {
      if (cups.place[c] !== CUP.sink) continue;
      cups.dirty[c] = 0;
      cups.move(c, CUP.shelf, -1, 0);
      if (cups.countIn(CUP.sink) === 0) this.board.remove(this.board.find(TASK.wash, 0));
      return true;
    }
    this.board.remove(this.board.find(TASK.wash, 0));
    return false;
  }

  /** Night: every job goes and every cup is washed and back on the shelf. */
  endOfDay(): void {
    this.board.clear();
    this.cups.reset();
  }

  /** Has `sink`, `counter`… : the shop can serve at all. */
  hasFixture(service: number): boolean {
    return this.fixtureTile(service) >= 0;
  }

  private post(kind: number, target: number): void {
    // Bound: each seated customer has at most one of order/brew/serve (the seating room has 84
    // tiles), plus one clear per cup and one wash, so the 128-job board can't fill up.
    this.board.add(kind, target, this.now);
  }
}

export { CUP, SERVICE, TASK };
