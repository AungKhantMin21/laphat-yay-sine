import { describe, expect, it } from 'vitest';
import { Game } from '../src/sim/game';
import { CATALOG } from '../src/shared/catalog';
import { FrameWriter, readFrame, type FrameHandler } from '../src/shared/diff';
import { PHASE } from '../src/shared/day';
import { DRINKS, REACTION, autoPrice, tipFor } from '../src/shared/drinks';
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
  const g = Game.create(seed);
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
      for (let x = 25; x < 35; x += 2) place(g, 'stool', x, 12);
      place(g, 'table', 30, 13);
      const out: number[] = [];
      for (let k = 0; k < 4; k++) out.push(g.npcs.seat[g.npcs.indexOf(g.npcs.spawn())]!);
      return out;
    };
    expect(pick(7)).toEqual(pick(7));
    expect(new Set(pick(7)).size).toBe(4); // each reserves a different seat
  });

  it('a quiet-loving customer avoids the radio; a lively one sits by it', () => {
    const g = game();
    place(g, 'stool', 26, 12);
    place(g, 'stool', 33, 12);
    place(g, 'radio', 33, 14);
    const i = g.npcs.indexOf(g.npcs.spawn());
    g.npcs.noiseTaste[i] = 1;
    g.npcs.choose(i);
    expect(g.npcs.seat[i]).toBe(tileOf(26, 12));
    g.npcs.noiseTaste[i] = -1;
    g.npcs.choose(i);
    expect(g.npcs.seat[i]).toBe(tileOf(33, 12));
  });

  it('a seat next to a table is preferred', () => {
    const g = game();
    place(g, 'stool', 26, 12);
    place(g, 'stool', 33, 12);
    place(g, 'table', 33, 13);
    const i = g.npcs.indexOf(g.npcs.spawn());
    g.npcs.noiseTaste[i] = 0;
    g.npcs.choose(i);
    expect(g.npcs.seat[i]).toBe(tileOf(33, 12));
  });

  it('a walled-in seat is never chosen', () => {
    const g = game();
    // Two stools against the back wall, boxed in by tables on every open side.
    place(g, 'stool', 25, 9);
    place(g, 'stool', 26, 9);
    for (const [x, y] of [[24, 9], [27, 9], [24, 10], [25, 10], [26, 10], [27, 10]] as const) place(g, 'table', x, y);
    g.syncWalk(); // in play, arrivals happen inside step() after the walk grid has synced
    const h = g.npcs.spawn();
    expect(g.npcs.state[g.npcs.indexOf(h)]).toBe(CS.leaving);
  });

  it('walks in, sits, orders, is auto-served after the delay at the lower price, drinks and leaves', () => {
    const g = game();
    place(g, 'stool', 30, 15);
    const money0 = g.builder.money;
    const h = g.npcs.spawn();
    const i = g.npcs.indexOf(h);
    expect(g.npcs.state[i]).toBe(CS.toSeat);
    expect(g.customers()).toBe(1);
    until(g, () => g.npcs.state[i] === CS.waiting);
    expect(g.npcs.tile[i]).toBe(tileOf(30, 15));
    expect(g.npcs.order[i]).toBe(ORDER.waiting);
    g.events.length = 0;
    const waited = until(g, () => g.npcs.state[i] !== CS.waiting);
    expect(waited).toBe(SHOP.service.autoServe * TICK_HZ);
    const drink = DRINKS.defs[g.npcs.drink[i]!]!;
    expect(g.builder.money - money0).toBe(autoPrice(drink));
    expect(g.events[0]).toEqual({ k: 'served', id: h, drink: drink.id, poured: false, price: autoPrice(drink), tip: 0, reaction: REACTION.auto });
    expect(g.events[1]).toEqual({ k: 'money', delta: autoPrice(drink), total: g.builder.money });
    expect(g.day.today).toMatchObject({ served: 1, poured: 0, earned: autoPrice(drink) });
    expect(g.npcs.state[i]).toBe(CS.drinking);
    until(g, () => g.npcs.state[i] === CS.leaving);
    expect(g.customers()).toBe(0);
    until(g, () => !g.npcs.indexOf(h));
    expect(g.npcs.count).toBe(0);
  });

  it('an open pour holds the auto-serve; a poured cup pays full price plus tip', () => {
    const g = game();
    place(g, 'stool', 30, 15);
    const h = g.npcs.spawn();
    const i = g.npcs.indexOf(h);
    until(g, () => g.npcs.state[i] === CS.waiting);
    expect(g.act({ k: 'startPour', id: h }).ok).toBe(true);
    expect(g.npcs.order[i]).toBe(ORDER.pouring);
    steps(g, SHOP.service.autoServe * TICK_HZ + 10);
    expect(g.npcs.state[i]).toBe(CS.waiting); // still waiting for the player's cup
    const drink = DRINKS.defs[g.npcs.drink[i]!]!;
    const target = Math.min(1, Math.max(0, drink.milk + g.npcs.milkShift[i]!));
    const money0 = g.builder.money;
    g.events.length = 0;
    expect(g.act({ k: 'serve', id: h, tea: 0.9 * (1 - target), milk: 0.9 * target }).ok).toBe(true);
    const tip = tipFor(drink, 1);
    expect(tip).toBeGreaterThan(0);
    expect(g.builder.money - money0).toBe(drink.price + tip);
    expect(g.events[0]).toMatchObject({ k: 'served', poured: true, price: drink.price, tip, reaction: REACTION.great });
    expect(g.day.today).toMatchObject({ served: 1, poured: 1, best: 100, tips: tip });
    expect(g.npcs.state[i]).toBe(CS.drinking);
    // Serving twice, or a gone customer, is refused.
    expect(g.act({ k: 'serve', id: h, tea: 0.5, milk: 0.4 })).toEqual({ ok: false, reason: 'pour.err.gone' });
    expect(g.act({ k: 'startPour', id: 12345 }).ok).toBe(false);
  });

  it('a lost pour UI cannot stall the customer forever', () => {
    const g = game();
    place(g, 'stool', 30, 15);
    const h = g.npcs.spawn();
    const i = g.npcs.indexOf(h);
    until(g, () => g.npcs.state[i] === CS.waiting);
    g.act({ k: 'startPour', id: h });
    const n = until(g, () => g.npcs.order[i] === ORDER.served);
    expect(n).toBeLessThanOrEqual((SHOP.service.pourHold + SHOP.service.autoServe) * TICK_HZ + 1);
  });

  it('picking up an occupied seat makes the customer choose again; a served one leaves instead', () => {
    const g = game();
    const a = place(g, 'stool', 27, 15);
    place(g, 'stool', 32, 15);
    const h = g.npcs.spawn();
    const i = g.npcs.indexOf(h);
    until(g, () => g.npcs.state[i] === CS.waiting);
    const first = g.npcs.seat[i]!;
    const firstObj = g.world.state.occ.furniture[first]!;
    expect(g.act({ k: 'pickup', id: g.world.objects.handle(firstObj) }).ok).toBe(true);
    steps(g, 1);
    expect(g.npcs.state[i]).toBe(CS.toSeat);
    expect(g.npcs.order[i]).toBe(ORDER.waiting); // the order stands
    expect(g.npcs.seat[i]).not.toBe(first);
    until(g, () => g.npcs.state[i] === CS.waiting);
    // Served and drinking: selling the seat sends them home.
    g.act({ k: 'serve', id: h, tea: 0.6, milk: 0.3 });
    expect(g.npcs.state[i]).toBe(CS.drinking);
    const second = g.world.state.occ.furniture[g.npcs.seat[i]!]!;
    expect(g.act({ k: 'sell', id: g.world.objects.handle(second) }).ok).toBe(true);
    steps(g, 1);
    expect(g.npcs.state[i]).toBe(CS.leaving);
    expect(a).toBeGreaterThan(0);
  });

  it('moving a seat sends its customer to the new spot; furniture built in the way makes walkers re-path', () => {
    const g = game();
    const s = place(g, 'stool', 30, 12);
    const h = g.npcs.spawn();
    const i = g.npcs.indexOf(h);
    steps(g, 30); // on the way
    expect(g.npcs.state[i]).toBe(CS.toSeat);
    // Wall off row 16 except one gap: the walker must go round.
    for (let x = 24; x < 36; x++) if (x !== 34) place(g, 'table', x, 16);
    expect(g.act({ k: 'move', id: g.world.objects.handle(s), x: 28, y: 11, rot: 0 }).ok).toBe(true);
    until(g, () => g.npcs.state[i] === CS.waiting);
    expect(g.npcs.tile[i]).toBe(tileOf(28, 11));
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
    } as FrameHandler;
    for (let k = 0; k < 2000 && !log.includes(`order ${ORDER.waiting}`); k++) {
      writer.begin(buf, g.sim.tick, g.sim.gameMinute);
      g.step(writer);
      buf = writer.finish();
      readFrame(buf, handler);
    }
    expect(log[0]).toBe('spawn true');
    expect(log).toContain('state');
    expect(log).toContain(`order ${ORDER.waiting}`);
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
      place(g, 'stool', x, 11);
      place(g, 'table', x, 12);
      place(g, 'stool', x, 13);
    }
    place(g, 'bench', 26, 16);
    place(g, 'table', 26, 17);
    place(g, 'radio', 34, 17);
    place(g, 'stool', 33, 16);
    return g;
  }

  function runDay(g: Game): { events: SimEvent[]; maxInShop: number } {
    const events: SimEvent[] = [];
    let maxInShop = 0;
    expect(g.act({ k: 'openShop' }).ok).toBe(true);
    for (let k = 0; k < 24 * 60 * TICK_HZ && g.day.phase !== PHASE.evening; k++) {
      steps(g, 1);
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
