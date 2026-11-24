// M2.5 service loop, headless: the task board, cups, and three full seeded days worked by a bot
// player (test/bot.ts). The same seed gives the same days; everyone is served; money only rises;
// no job is left over at night; cups are never lost.
import { describe, expect, it } from 'vitest';
import { Game } from '../src/sim/game';
import { FrameWriter } from '../src/shared/diff';
import { PHASE } from '../src/shared/day';
import { NONE } from '../src/shared/ids';
import { SHOP } from '../src/shared/shop';
import { TICK_HZ, type DayStats } from '../src/shared/protocol';
import { TASK, TaskBoard } from '../src/sim/service/task-board';
import { CUP, Cups } from '../src/sim/service/cups';
import { Bot } from './bot';

let buf = new ArrayBuffer(1 << 16);
const writer = new FrameWriter();
function step(g: Game): void {
  writer.begin(buf, g.sim.tick, g.sim.gameMinute);
  g.step(writer);
  buf = writer.finish();
}

describe('task board', () => {
  it('posts, finds, claims and removes jobs; stale handles are ignored; counts per kind', () => {
    const b = new TaskBoard();
    const a = b.add(TASK.order, 77, 5);
    const c = b.add(TASK.brew, 77, 6);
    expect(b.find(TASK.order, 77)).toBe(a);
    expect(b.find(TASK.brew, 77)).toBe(c);
    expect(b.count[TASK.order]).toBe(1);
    expect(b.claim(a, 1)).toBe(true);
    expect(b.claimedBy[b.indexOf(a)]).toBe(1);
    b.unclaim(a);
    expect(b.claimedBy[b.indexOf(a)]).toBe(0);
    b.remove(a);
    expect(b.indexOf(a)).toBe(0);
    expect(b.find(TASK.order, 77)).toBe(NONE);
    b.remove(a); // stale: no effect
    expect(b.count[TASK.order]).toBe(0);
    const again = b.add(TASK.order, 78, 7);
    expect(again).not.toBe(a); // the slot may be reused, the handle never
    b.clear();
    expect(b.count.every((n) => n === 0)).toBe(true);
  });

  it('a full board refuses new jobs instead of overwriting', () => {
    const b = new TaskBoard();
    for (let k = 1; k < b.capacity; k++) expect(b.add(TASK.clear, k, 0)).not.toBe(NONE);
    expect(b.add(TASK.clear, 999, 0)).toBe(NONE);
  });
});

describe('cups', () => {
  it('start clean on the shelf; each cup is always in exactly one place', () => {
    const c = new Cups(SHOP.kitchen.cups);
    expect(c.countIn(CUP.shelf)).toBe(SHOP.kitchen.cups);
    c.move(1, CUP.tray, -1, 1);
    c.move(2, CUP.sink, -1, 0);
    let total = 0;
    for (const p of Object.values(CUP)) total += c.countIn(p);
    expect(total).toBe(SHOP.kitchen.cups);
    expect(c.carried(1)).toBe(1);
    c.reset();
    expect(c.countIn(CUP.shelf)).toBe(SHOP.kitchen.cups);
  });
});

interface DayResult {
  money: number;
  stats: DayStats;
  teaser: { key: string; arg: string };
  rng: number[];
  clock: number;
}

/** Plays `n` days of the start shop with a bot doing one job every `period` ticks. */
function play(seed: number, n: number, period = 15) {
  const g = Game.create(seed);
  const bot = new Bot(g, period);
  const days: DayResult[] = [];
  let drops = 0;
  let last = g.builder.money;
  let waits = 0;
  let waitSum = 0;
  let maxWait = 0;
  let cupsLost = 0;
  const drain = (): void => {
    for (const e of g.events.splice(0)) {
      if (e.k === 'served') {
        waits++;
        waitSum += e.wait;
        maxWait = Math.max(maxWait, e.wait);
      }
      if (e.k !== 'money') continue;
      if (e.delta <= 0 || e.total <= last) drops++;
      last = e.total;
    }
  };
  for (let d = 0; d < n; d++) {
    // A morning market trip (M3): the bot keeps the kitchen stocked.
    for (let k = 0; k < g.service.stock.count.length; k++) g.service.stock.add(k, 200 - g.service.stock.count[k]!);
    expect(g.act({ k: 'openShop' }).ok).toBe(true);
    for (let k = 0; k < 24 * 60 * TICK_HZ && g.day.phase !== PHASE.evening; k++) {
      step(g);
      bot.tick();
      drain();
      if (k % 600 === 0) {
        let total = 0;
        for (const p of Object.values(CUP)) total += g.service.cups.countIn(p);
        if (total !== g.service.cups.count) cupsLost++;
      }
    }
    expect(g.day.phase, `day ${d} reached the evening`).toBe(PHASE.evening);
    // Everyone who sat down was served: nothing left to take, brew or serve.
    const b = g.service.board;
    expect(b.count[TASK.order]! + b.count[TASK.brew]! + b.count[TASK.serve]!, `day ${d}: open service jobs`).toBe(0);
    // The bot tidies up: clear and wash until nothing is left.
    for (let k = 0; k < 600 && (b.count[TASK.clear]! > 0 || b.count[TASK.wash]! > 0); k++) {
      step(g);
      bot.tick();
      drain();
    }
    expect(b.count[TASK.clear]! + b.count[TASK.wash]!, `day ${d}: tidy at night`).toBe(0);
    expect(g.service.cups.countIn(CUP.shelf)).toBe(g.service.cups.count);
    const stats = { ...g.day.today };
    expect(g.act({ k: 'sleep' }).ok).toBe(true);
    drain();
    const r = g.sim.rng;
    days.push({ money: g.builder.money, stats, teaser: { ...g.day.teaser }, rng: [r.market.state, r.npcDecide.state, r.events.state, r.cosmetic.state], clock: g.sim.clock });
  }
  return { days, drops, cupsLost, avgWait: waitSum / Math.max(1, waits), maxWait, served: waits };
}

describe('three seeded shop days, worked by a bot', () => {
  const a = play(3, 3);

  it('the same seed gives the same days', () => {
    expect(play(3, 3)).toEqual(a);
    expect(play(4, 3).days).not.toEqual(a.days);
  });

  it('customers are served every day, money only rises, cups are never lost', () => {
    expect(a.drops).toBe(0);
    expect(a.cupsLost).toBe(0);
    for (const d of a.days) {
      expect(d.stats.served).toBeGreaterThan(15);
      expect(d.stats.poured).toBe(d.stats.served);
      expect(d.stats.earned).toBeGreaterThan(0);
      expect(d.teaser.key).not.toBe('');
    }
  });

  it('a solo player keeps the wait reasonable at the data arrival rates (tuning check)', () => {
    // One job every 1.5 s stands in for walking; S5 measures the real walking worker.
    expect(a.avgWait).toBeLessThanOrEqual(60);
  });
});
