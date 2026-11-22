import { describe, expect, it } from 'vitest';
import { Game } from '../src/sim/game';
import { CATALOG } from '../src/shared/catalog';
import { FrameWriter, readFrame, type FrameHandler } from '../src/shared/diff';
import { PHASE } from '../src/shared/day';
import { DRINKS, REACTION } from '../src/shared/drinks';
import { NONE } from '../src/shared/ids';
import { CUP } from '../src/sim/service/cups';
import { TASK } from '../src/sim/service/task-board';
import { Bot } from './bot';
import { CUSTOMERS, buildCustomers, pickOrder } from '../src/shared/customers';
import { SHOP, arrivalRate } from '../src/shared/shop';
import { ORDER } from '../src/shared/npc';
import { TICK_HZ } from '../src/shared/protocol';
import { CS } from '../src/sim/npc/customers';
import type { SimEvent } from '../src/shared/protocol';

const T = (key: string): number => CATALOG.byKey.get(key)!.id;
const W = 64;
const tileOf = (x: number, y: number): number => y * W + x;

let buf = new ArrayBuffer(1 << 16);
const writer = new FrameWriter();
function steps(g: Game, n: number): void {
  for (let k = 0; k < n; k++) {
    writer.begin(buf, g.sim.tick, g.sim.gameMinute);
    g.step(writer);
    buf = writer.finish();
  }
}
/** Steps until `done` or `max` steps. Returns steps taken. */
function until(g: Game, done: () => boolean, max = 20_000): number {
  for (let k = 0; k < max; k++) {
    if (done()) return k;
    steps(g, 1);
  }
  return max;
}

function place(g: Game, key: string, x: number, y: number, rot = 0): number {
  const r = g.act({ k: 'place', type: T(key), x, y, rot, colour: 0 });
  expect(r.ok, `${key} at ${x},${y}: ${r.reason}`).toBe(true);
  return r.index!;
}

/** A game with stock to build a big shop. */
function game(seed = 1): Game {
  const g = Game.create(seed, false);
  for (const key of ['stool', 'table', 'radio', 'bench', 'chair']) g.builder.give(T(key), 40);
  g.builder.money = 1_000_000;
  return g;
}

describe('customer data', () => {
  it('orders follow the weights; unknown drinks and bad ranges are refused', () => {
    expect(pickOrder(0)).toBe(0);
    expect(pickOrder(0.9999)).toBe(DRINKS.defs.length - 1);
    const counts = new Array<number>(DRINKS.defs.length).fill(0);
    const n = CUSTOMERS.orderTotal * 100;
    for (let k = 0; k < n; k++) counts[pickOrder(k / n)]!++;
    CUSTOMERS.orderWeight.forEach((w, id) => expect(counts[id]).toBe(100 * w));
    const ok = { walkSpeed: 1, looks: 2, milkShift: [0, 0] as [number, number], noiseTaste: [0, 0] as [number, number], orders: { pon_man: 1 } };
    expect(() => buildCustomers({ ...ok, orders: { nope: 1 } })).toThrow(/unknown drink/);
    expect(() => buildCustomers({ ...ok, noiseTaste: [1, -1] })).toThrow(/noiseTaste/);
    expect(() => buildCustomers({ ...ok, orders: { pon_man: 0 } })).toThrow(/at least one/);
  });

  it('arrival rate is piecewise by hour, zero before the first entry', () => {
    expect(arrivalRate(0)).toBe(0);
    expect(arrivalRate(SHOP.open)).toBe(SHOP.arrivals.rate[0]);
    expect(arrivalRate(SHOP.arrivals.from[1]! - 1)).toBe(SHOP.arrivals.rate[0]);
    expect(arrivalRate(SHOP.arrivals.from[1]!)).toBe(SHOP.arrivals.rate[1]);
  });
});

describe('customers', () => {
  it('with no free seat a customer walks on by and leaves at the far edge', () => {
    const g = game();
    const h = g.npcs.spawn();
    const i = g.npcs.indexOf(h);
    expect(g.npcs.state[i]).toBe(CS.leaving);
    expect(g.customers()).toBe(0);
    const startX = g.npcs.x[i]!;
    const n = until(g, () => !g.npcs.indexOf(h));
    expect(n).toBeLessThan(2000);
    expect(g.npcs.count).toBe(0);
    expect(g.npcs.x[i]! < W / 2).toBe(startX > W / 2); // ended on the other side
  });

  it('seat choice is deterministic for a seed', () => {
    const pick = (seed: number): number[] => {
      const g = game(seed);
      for (let x = 25; x < 35; x += 2) place(g, 'stool', x, 14);
      place(g, 'table', 30, 15);
      const out: number[] = [];
      for (let k = 0; k < 4; k++) out.push(g.npcs.seat[g.npcs.indexOf(g.npcs.spawn())]!);
      return out;
    };
    expect(pick(7)).toEqual(pick(7));
    expect(new Set(pick(7)).size).toBe(4); // each reserves a different seat
  });

  it('a quiet-loving customer avoids the radio; a lively one sits by it', () => {
    const g = game();
    place(g, 'stool', 26, 14);
    place(g, 'stool', 33, 14);
    place(g, 'radio', 33, 16);
    const i = g.npcs.indexOf(g.npcs.spawn());
    g.npcs.noiseTaste[i] = 1;
    g.npcs.choose(i);
    expect(g.npcs.seat[i]).toBe(tileOf(26, 14));
    g.npcs.noiseTaste[i] = -1;
    g.npcs.choose(i);
    expect(g.npcs.seat[i]).toBe(tileOf(33, 14));
  });

  it('a seat next to a table is preferred', () => {
    const g = game();
    place(g, 'stool', 26, 14);
    place(g, 'stool', 33, 14);
    place(g, 'table', 33, 15);
    const i = g.npcs.indexOf(g.npcs.spawn());
    g.npcs.noiseTaste[i] = 0;
    g.npcs.choose(i);
    expect(g.npcs.seat[i]).toBe(tileOf(33, 14));
  });

  it('a walled-in seat is never chosen', () => {
    const g = game();
    // A stool in the middle of the room, boxed in by tables on all eight sides.
    place(g, 'stool', 29, 14);
    for (const [x, y] of [[28, 13], [29, 13], [30, 13], [28, 14], [30, 14], [28, 15], [29, 15], [30, 15]] as const) place(g, 'table', x, y);
    g.syncWalk(); // in play, arrivals happen inside step() after the walk grid has synced
    const h = g.npcs.spawn();
    expect(g.npcs.state[g.npcs.indexOf(h)]).toBe(CS.leaving);
  });

  it('walks in, sits, asks, waits as long as it takes; a person takes the order, brews, serves; they pay, drink and leave the cup', () => {
    const g = game();
    place(g, 'stool', 30, 15);
    const sv = g.service;
    const money0 = g.builder.money;
    const h = g.npcs.spawn();
    const i = g.npcs.indexOf(h);
    expect(g.npcs.state[i]).toBe(CS.toSeat);
    expect(g.customers()).toBe(1);
    until(g, () => g.npcs.state[i] === CS.asking);
    expect(g.npcs.tile[i]).toBe(tileOf(30, 15));
    expect(g.npcs.order[i]).toBe(ORDER.ask);
    expect(sv.board.find(TASK.order, h)).not.toBe(NONE);
    // Nobody comes: they keep waiting, calmly, for a long time (no auto-serve, no leaving).
    steps(g, 600 * TICK_HZ);
    expect(g.npcs.state[i]).toBe(CS.asking);
    expect(g.builder.money).toBe(money0);
    // Take the order → brew job; brew → cup on the counter and a serve job.
    expect(sv.takeOrder(h)).toBe('');
    expect(g.npcs.order[i]).toBe(ORDER.waiting);
    expect(sv.board.find(TASK.order, h)).toBe(NONE);
    expect(sv.board.find(TASK.brew, h)).not.toBe(NONE);
    expect(sv.brew(h, 1, true)).toBe('');
    expect(sv.cups.countIn(CUP.counter)).toBe(1);
    const cup = sv.cups.forCustomer.indexOf(h);
    expect(sv.board.find(TASK.serve, cup)).not.toBe(NONE);
    // Carry and serve: full price, but no tip after waiting this long.
    g.events.length = 0;
    expect(sv.pickUp(cup, 1)).toBe('');
    expect(sv.serve(cup, 1)).toBe('');
    const drink = DRINKS.defs[g.npcs.drink[i]!]!;
    expect(g.builder.money - money0).toBe(drink.price);
    expect(g.events[0]).toMatchObject({ k: 'served', id: h, drink: drink.id, poured: true, price: drink.price, tip: 0, reaction: REACTION.great });
    expect((g.events[0] as Extract<SimEvent, { k: 'served' }>).wait).toBeGreaterThanOrEqual(600);
    expect(g.day.today).toMatchObject({ served: 1, poured: 1, earned: drink.price, best: 100 });
    expect(g.npcs.state[i]).toBe(CS.drinking);
    expect(sv.cups.place[cup]).toBe(CUP.table);
    // Done drinking: they leave, the cup stays to be cleared to the sink and washed.
    until(g, () => g.npcs.state[i] === CS.leaving);
    expect(g.customers()).toBe(0);
    expect(sv.board.find(TASK.clear, cup)).not.toBe(NONE);
    expect(sv.pickUpDirty(cup, 1)).toBe('');
    expect(sv.dropAtSink(cup, 1)).toBe('');
    expect(sv.board.find(TASK.wash, 0)).not.toBe(NONE);
    expect(sv.washOne()).toBe(true);
    expect(sv.cups.place[cup]).toBe(CUP.shelf);
    expect(sv.board.find(TASK.wash, 0)).toBe(NONE);
    until(g, () => !g.npcs.indexOf(h));
    expect(g.npcs.count).toBe(0);
  });

  it('fast service earns a bigger tip than a slow one; the price is always the same', () => {
    const tipAfter = (waitSteps: number) => {
      const g = game(3);
      place(g, 'stool', 30, 15);
      const h = g.npcs.spawn();
      const i = g.npcs.indexOf(h);
      until(g, () => g.npcs.state[i] === CS.asking);
      steps(g, waitSteps);
      g.service.takeOrder(h);
      g.service.brew(h, 1, true);
      const cup = g.service.cups.forCustomer.indexOf(h);
      g.service.pickUp(cup, 1);
      g.events.length = 0;
      g.service.serve(cup, 1);
      return g.events[0] as Extract<SimEvent, { k: 'served' }>;
    };
    const fast = tipAfter(5 * TICK_HZ);
    const mid = tipAfter(80 * TICK_HZ);
    const slow = tipAfter(400 * TICK_HZ);
    expect(fast.tip).toBeGreaterThan(mid.tip);
    expect(mid.tip).toBeGreaterThan(slow.tip);
    expect(slow.tip).toBe(0);
    expect(fast.price).toBe(slow.price);
  });

  it('no clean cup: brewing waits until someone washes', () => {
    const g = game();
    const sv = g.service;
    // Every cup dirty in the sink.
    for (let c = 1; c <= sv.cups.count; c++) sv.cups.move(c, CUP.sink, -1, 0);
    place(g, 'stool', 30, 15);
    const h = g.npcs.spawn();
    until(g, () => g.npcs.state[g.npcs.indexOf(h)] === CS.asking);
    sv.takeOrder(h);
    expect(sv.canBrew()).toBe(false);
    expect(sv.brew(h, 1, true)).toBe('serve.err.noCups');
    expect(sv.washOne()).toBe(true);
    expect(sv.brew(h, 1, true)).toBe('');
  });

  it('a customer who leaves unserved (their seat was sold, no other seat) takes no cup: it goes back on the shelf', () => {
    const g = game();
    const sv = g.service;
    const stool = place(g, 'stool', 30, 15);
    const h = g.npcs.spawn();
    until(g, () => g.npcs.state[g.npcs.indexOf(h)] === CS.asking);
    sv.takeOrder(h);
    sv.brew(h, 1, true);
    const cup = sv.cups.forCustomer.indexOf(h);
    expect(g.act({ k: 'sell', id: g.world.objects.handle(stool) }).ok).toBe(true);
    steps(g, 1);
    expect(g.npcs.state[g.npcs.indexOf(h)]).toBe(CS.leaving);
    expect(sv.cups.place[cup]).toBe(CUP.shelf);
    expect(sv.board.find(TASK.serve, cup)).toBe(NONE);
    expect(sv.board.find(TASK.brew, h)).toBe(NONE);
  });

  it('picking up an occupied seat makes the customer choose again; a served one leaves instead', () => {
    const g = game();
    const a = place(g, 'stool', 27, 15);
    place(g, 'stool', 32, 15);
    const h = g.npcs.spawn();
    const i = g.npcs.indexOf(h);
    until(g, () => g.npcs.state[i] === CS.asking);
    g.service.takeOrder(h);
    expect(g.npcs.state[i]).toBe(CS.waiting);
    const first = g.npcs.seat[i]!;
    const firstObj = g.world.state.occ.furniture[first]!;
    expect(g.act({ k: 'pickup', id: g.world.objects.handle(firstObj) }).ok).toBe(true);
    steps(g, 1);
    expect(g.npcs.state[i]).toBe(CS.toSeat);
    expect(g.npcs.order[i]).toBe(ORDER.waiting); // the order stands
    expect(g.npcs.seat[i]).not.toBe(first);
    until(g, () => g.npcs.state[i] === CS.waiting);
    // Served and drinking: selling the seat sends them home; their cup stays to be cleared.
    g.service.brew(h, 0.8, true);
    const cup = g.service.cups.forCustomer.indexOf(h);
    g.service.pickUp(cup, 1);
    expect(g.service.serve(cup, 1)).toBe('');
    expect(g.npcs.state[i]).toBe(CS.drinking);
    const second = g.world.state.occ.furniture[g.npcs.seat[i]!]!;
    expect(g.act({ k: 'sell', id: g.world.objects.handle(second) }).ok).toBe(true);
    steps(g, 1);
    expect(g.npcs.state[i]).toBe(CS.leaving);
    expect(g.service.board.find(TASK.clear, cup)).not.toBe(NONE);
    expect(a).toBeGreaterThan(0);
  });

  it('moving a seat sends its customer to the new spot; furniture built in the way makes walkers re-path', () => {
    const g = game();
    const s = place(g, 'stool', 30, 13);
    const h = g.npcs.spawn();
    const i = g.npcs.indexOf(h);
    steps(g, 30); // on the way
    expect(g.npcs.state[i]).toBe(CS.toSeat);
    // Wall off row 16 except one gap: the walker must go round.
    for (let x = 24; x < 36; x++) if (x !== 34) place(g, 'table', x, 16);
    expect(g.act({ k: 'move', id: g.world.objects.handle(s), x: 28, y: 13, rot: 0 }).ok).toBe(true);
    until(g, () => g.npcs.state[i] === CS.asking);
    expect(g.npcs.tile[i]).toBe(tileOf(28, 13));
  });

  it('frames carry spawn, state and order sections', () => {
    const g = game();
    place(g, 'stool', 30, 15);
    const log: string[] = [];
    const h = g.npcs.spawn();
    const handler = {
      header() {},
      npcSpawn: (hh: number) => log.push(`spawn ${hh === h}`),
      npcDespawn: () => log.push('despawn'),
      npcState: () => log.push('state'),
      npcOrder: (_h: number, _d: number, st: number) => log.push(`order ${st}`),
      objUpsert() {},
      objRemove() {},
      gridPatch() {},
      tilePatch() {},
      world() {},
      task() {},
      cup() {},
    } as FrameHandler;
    for (let k = 0; k < 2000 && !log.includes(`order ${ORDER.ask}`); k++) {
      writer.begin(buf, g.sim.tick, g.sim.gameMinute);
      g.step(writer);
      buf = writer.finish();
      readFrame(buf, handler);
    }
    expect(log[0]).toBe('spawn true');
    expect(log).toContain('state');
    expect(log).toContain(`order ${ORDER.ask}`);
  });

  it('sleep sends everyone home', () => {
    const g = game();
    g.act({ k: 'openShop' });
    g.npcs.spawn();
    g.npcs.spawn();
    g.npcs.clear();
    expect(g.npcs.count).toBe(0);
  });
});

describe('a headless shop day', () => {
  function furnished(seed: number): Game {
    const g = game(seed);
    // Two rows of stools at tables, a bench and a radio corner.
    for (let x = 25; x < 35; x += 3) {
      place(g, 'stool', x, 14);
      place(g, 'table', x, 15);
      place(g, 'stool', x, 16);
    }
    place(g, 'bench', 26, 17);
    place(g, 'table', 26, 18);
    place(g, 'radio', 34, 18);
    place(g, 'stool', 33, 17);
    return g;
  }

  function runDay(g: Game): { events: SimEvent[]; maxInShop: number } {
    const events: SimEvent[] = [];
    let maxInShop = 0;
    const bot = new Bot(g, 15); // one job every 1.5 s, like a busy player
    expect(g.act({ k: 'openShop' }).ok).toBe(true);
    for (let k = 0; k < 24 * 60 * TICK_HZ && g.day.phase !== PHASE.evening; k++) {
      steps(g, 1);
      bot.tick();
      maxInShop = Math.max(maxInShop, g.customers());
      events.push(...g.events.splice(0));
    }
    return { events, maxInShop };
  }

  it('customers come and pay, money only rises, and the shop empties into the evening', () => {
    const g = furnished(3);
    const m0 = g.builder.money;
    let last = m0;
    const { events, maxInShop } = runDay(g);
    expect(g.day.phase).toBe(PHASE.evening);
    for (const e of events) {
      if (e.k !== 'money') continue;
      expect(e.delta).toBeGreaterThan(0);
      expect(e.total).toBeGreaterThan(last);
      last = e.total;
    }
    const served = events.filter((e) => e.k === 'served').length;
    expect(served).toBeGreaterThan(20);
    expect(g.day.today.served).toBe(served);
    expect(g.builder.money).toBe(m0 + g.day.today.earned);
    expect(maxInShop).toBeGreaterThan(1);
    // Every NPC is gone soon after: nobody stuck in the shop or on the street.
    expect(g.customers()).toBe(0);
    until(g, () => g.npcs.count === 0, 2000);
    expect(g.npcs.count).toBe(0);
    expect(g.paths.inUse).toBe(0);
    expect(Array.from(g.npcs.seatRes).every((v) => v === 0)).toBe(true);
  });

  it('the same seed gives the same day', () => {
    const a = furnished(11);
    const b = furnished(11);
    runDay(a);
    runDay(b);
    expect(a.day.today).toEqual(b.day.today);
    expect(a.sim.clock).toBe(b.sim.clock);
    expect(a.sim.rng.npcDecide.state).toBe(b.sim.rng.npcDecide.state);
  });

  it('an empty shop still gets passers-by but earns nothing', () => {
    const g = game(5);
    const { events } = runDay(g);
    expect(events.some((e) => e.k === 'served')).toBe(false);
    expect(g.day.today.served).toBe(0);
  });
});
