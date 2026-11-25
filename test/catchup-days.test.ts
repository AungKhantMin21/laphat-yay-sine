// M4 S8: offline catch-up at abstract LOD — a caught-up day moves the world exactly like a played one
// (property market, market stock, residents), the shop sells only with staff (capped by the shelf,
// never below zero), wages and rent are paid as at Sleep, and it is deterministic.
import { describe, expect, it } from 'vitest';
import { Game } from '../src/sim/game';
import { FrameWriter } from '../src/shared/diff';
import { PHASE } from '../src/shared/day';
import { START_MINUTE } from '../src/shared/layout';

const buf = new ArrayBuffer(1 << 18);
const w = new FrameWriter();
function step(g: Game): void {
  w.begin(buf, g.sim.tick, g.sim.gameMinute);
  g.step(w);
}
/** A played day with nobody served: open, close, Sleep. */
function liveDay(g: Game): void {
  g.act({ k: 'openShop' });
  for (let k = 0; k < 20000 && g.day.phase !== PHASE.evening; k++) {
    g.npcs.clear();
    step(g);
  }
  expect(g.act({ k: 'sleep' }).ok).toBe(true);
}
const world = (g: Game): string =>
  JSON.stringify([
    g.sim.day,
    g.properties.props,
    g.properties.news.map((n) => [n.id, n.day, n.kind, n.prop, n.a, n.b]),
    g.market.rows,
    g.residents.who.map((d) => d?.key ?? ''),
    Array.from(g.residents.home),
    g.spares,
  ]);

describe('catch-up days', () => {
  it('a caught-up day moves the street exactly like a played one (no staff: the shop stays shut)', () => {
    const live = Game.create(61);
    const away = Game.create(61);
    const money = away.builder.money;
    for (let d = 0; d < 7; d++) {
      liveDay(live);
      const r = away.abstractDay();
      expect(r.cups).toBe(0);
      expect(r.earned).toBe(0);
    }
    expect(world(away)).toBe(world(live));
    expect(away.builder.money).toBe(money);
    expect(away.sim.gameMinute).toBe(7 * 1440 + START_MINUTE);
    expect(away.day.phase).toBe(PHASE.morning);
  }, 30000);

  it('with staff the shop sells, as far as the shelf allows; nothing goes below zero', () => {
    const g = Game.create(62);
    g.staff.push({ role: 'waiter', hiredDay: 0, dayOff: false });
    g.builder.money = 50_000;
    let cups = 0;
    for (let d = 0; d < 7; d++) {
      const r = g.abstractDay();
      cups += r.cups;
      for (const n of g.service.stock.count) expect(n).toBeGreaterThanOrEqual(0);
      expect(g.builder.money).toBeGreaterThanOrEqual(0);
    }
    expect(cups).toBeGreaterThan(20);
    // The start shelf (~67 cups) runs out: later days sell nothing more.
    expect(cups).toBeLessThanOrEqual(70);
    expect(g.service.stock.cupsLeft()).toBeLessThan(3);
  });

  it('a short tin: staff take an unpaid day off, the money never goes negative', () => {
    const g = Game.create(63);
    g.staff.push({ role: 'waiter', hiredDay: 0, dayOff: false });
    g.service.stock.count.fill(0); // nothing to sell
    g.builder.money = 1000;
    const r = g.abstractDay();
    expect(r.cups).toBe(0);
    expect(r.wages).toBe(0);
    expect(g.staff[0]!.dayOff).toBe(true);
    expect(g.builder.money).toBe(1000);
  });

  it('is deterministic', () => {
    const run = (): string => {
      const g = Game.create(64);
      g.staff.push({ role: 'waiter', hiredDay: 0, dayOff: false });
      g.builder.money = 300_000;
      const out = [];
      for (let d = 0; d < 7; d++) out.push(g.abstractDay());
      return JSON.stringify([out, world(g), g.builder.money, Array.from(g.service.stock.count)]);
    };
    expect(run()).toBe(run());
  });
});
