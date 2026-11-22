// M2 gate: three full seeded shop days, headless. The same seed must give the same days
// (money, stats, teasers, RNG states), no customer may get stuck, and money only goes up.
import { describe, expect, it } from 'vitest';
import { Game } from '../src/sim/game';
import { CATALOG } from '../src/shared/catalog';
import { FrameWriter } from '../src/shared/diff';
import { PHASE } from '../src/shared/day';
import { DRINKS } from '../src/shared/drinks';
import { SHOP } from '../src/shared/shop';
import { TICK_HZ, type DayStats } from '../src/shared/protocol';
import { CS } from '../src/sim/npc/customers';

const T = (key: string): number => CATALOG.byKey.get(key)!.id;

let buf = new ArrayBuffer(1 << 16);
const writer = new FrameWriter();
function step(g: Game): void {
  writer.begin(buf, g.sim.tick, g.sim.gameMinute);
  g.step(writer);
  buf = writer.finish();
}

function place(g: Game, key: string, x: number, y: number): void {
  const r = g.act({ k: 'place', type: T(key), x, y, rot: 0, colour: 0 });
  expect(r.ok, `${key} at ${x},${y}: ${r.reason}`).toBe(true);
}

/** The furnished shop from test/customers.test.ts: 11 seats, tables, a bench and a radio. */
function furnished(seed: number): Game {
  const g = Game.create(seed);
  for (const key of ['stool', 'table', 'radio', 'bench']) g.builder.give(T(key), 40);
  g.builder.money = 1_000_000;
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

interface DayResult {
  money: number;
  stats: DayStats;
  teaser: { key: string; arg: string };
  rng: number[];
  clock: number;
}

interface Run {
  /** Money before the first day. */
  start: number;
  days: DayResult[];
  /** Longest a customer was alive, in ticks. */
  maxLife: number;
  /** Money events that did not raise the total. */
  drops: number;
  served: number;
}

/**
 * Plays `n` days: open, run to the evening (the player pours every other waiting customer's
 * cup, the rest are auto-served), wait for the street to empty, sleep.
 */
function play(seed: number, n: number): Run {
  const g = furnished(seed);
  const born = new Map<number, number>();
  const days: DayResult[] = [];
  let maxLife = 0;
  let drops = 0;
  let served = 0;
  const start = g.builder.money;
  let last = start;
  let turn = 0;
  /** Customers the player already chose to pour for or leave to auto-serve. */
  const decided = new Set<number>();
  const track = (): void => {
    const c = g.npcs;
    for (let i = 1; i < c.capacity; i++) {
      if (!c.alive[i]) continue;
      const h = c.handle(i);
      if (!born.has(h)) born.set(h, g.sim.tick);
      if (c.state[i] === CS.waiting && !decided.has(h)) {
        decided.add(h);
        if (turn++ % 2 === 1) continue;
        // A good, not perfect, pour aimed at this customer's taste.
        const drink = DRINKS.defs[c.drink[i]!]!;
        const target = Math.min(1, Math.max(0, drink.milk + c.milkShift[i]!));
        if (g.act({ k: 'startPour', id: h }).ok) g.act({ k: 'serve', id: h, tea: 0.85 * (1 - target), milk: 0.85 * target });
      }
    }
    for (const [h, t] of born) {
      if (g.npcs.indexOf(h)) continue;
      maxLife = Math.max(maxLife, g.sim.tick - t);
      born.delete(h);
      decided.delete(h);
    }
    for (const e of g.events.splice(0)) {
      if (e.k === 'served') served++;
      if (e.k !== 'money') continue;
      if (e.delta <= 0 || e.total <= last) drops++;
      last = e.total;
    }
  };
  for (let d = 0; d < n; d++) {
    expect(g.act({ k: 'openShop' }).ok).toBe(true);
    track();
    for (let k = 0; k < 24 * 60 * TICK_HZ && g.day.phase !== PHASE.evening; k++) {
      step(g);
      track();
    }
    expect(g.day.phase).toBe(PHASE.evening);
    expect(g.customers()).toBe(0);
    for (let k = 0; k < 2000 && g.npcs.count > 0; k++) {
      step(g);
      track();
    }
    expect(g.npcs.count, `day ${d}: NPCs left on the street`).toBe(0);
    expect(g.paths.inUse).toBe(0);
    const stats = { ...g.day.today };
    expect(g.act({ k: 'sleep' }).ok).toBe(true);
    track();
    const r = g.sim.rng;
    days.push({
      money: g.builder.money,
      stats,
      teaser: { ...g.day.teaser },
      rng: [r.market.state, r.npcDecide.state, r.events.state, r.cosmetic.state],
      clock: g.sim.clock,
    });
  }
  return { start, days, maxLife, drops, served };
}

describe('M2 gate: three seeded days', () => {
  const a = play(3, 3);

  it('the same seed gives the same three days', () => {
    expect(play(3, 3)).toEqual(a);
  });

  it('a different seed gives different days', () => {
    expect(play(4, 3).days).not.toEqual(a.days);
  });

  it('customers come every day, some cups are poured, and money only goes up', () => {
    expect(a.drops).toBe(0);
    let money = a.start;
    for (const d of a.days) {
      expect(d.stats.served).toBeGreaterThan(20);
      expect(d.stats.poured).toBeGreaterThan(0);
      expect(d.stats.poured).toBeLessThan(d.stats.served);
      expect(d.money - money).toBe(d.stats.earned);
      expect(d.stats.earned).toBeGreaterThan(0);
      money = d.money;
      expect(d.teaser.key).not.toBe('');
    }
    expect(a.served).toBe(a.days.reduce((s, d) => s + d.stats.served, 0));
  });

  it('nobody gets stuck: every customer leaves within the longest possible visit', () => {
    // Order, wait out the auto-serve (pours here are instant), drink, plus two full stuck-guard
    // walks (in and out) — far more than crossing the street takes.
    const s = SHOP.service;
    const visit = (s.orderDelay + s.autoServe + s.drink + 2 * s.stuck) * TICK_HZ;
    expect(a.maxLife).toBeGreaterThan(0);
    expect(a.maxLife).toBeLessThan(visit);
  });
});
