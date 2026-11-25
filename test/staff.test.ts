// M2.5 S7: staff. Hiring unlocks by savings and seats; wages come out of the tin at Sleep, or the
// staff member takes an unpaid day off (never debt); the waiter takes orders, serves and clears by
// utility on the same task board; the player can take a job over; the roster survives saving.
import { describe, expect, it } from 'vitest';
import rawStaff from '../src/data/staff.json';
import { Game } from '../src/sim/game';
import { FrameWriter } from '../src/shared/diff';
import { PHASE } from '../src/shared/day';
import { DRINKS } from '../src/shared/drinks';
import { STAFF, buildStaff, hireBlock, type RawStaff } from '../src/shared/staff';
import type { SimEvent } from '../src/shared/protocol';
import { CS } from '../src/sim/npc/customers';
import { PLAYER, QUEUE_MAX, WS } from '../src/sim/npc/workers';
import { CUP } from '../src/sim/service/cups';
import { TASK } from '../src/sim/service/task-board';
import { parse, serialize } from '../src/sim/save/format';

const WAITER = STAFF.byKey.get('waiter')!;
const WAITER_W = 2;

let buf = new ArrayBuffer(1 << 16);
const writer = new FrameWriter();
function steps(g: Game, n: number, events?: SimEvent[]): void {
  for (let k = 0; k < n; k++) {
    writer.begin(buf, g.sim.tick, g.sim.gameMinute);
    g.step(writer);
    buf = writer.finish();
    if (events) events.push(...g.events.splice(0));
    else g.events.length = 0;
  }
}

/** Opens, runs to closing time, sends the unserved customers home (nobody serves here), reaches the evening. */
function toEvening(g: Game): void {
  g.act({ k: 'openShop' });
  for (let k = 0; k < 24 * 60 * 10 && g.day.phase === PHASE.open; k++) steps(g, 1);
  g.npcs.clear();
  for (let k = 0; k < 100 && g.day.phase !== PHASE.evening; k++) steps(g, 1);
  expect(g.day.phase).toBe(PHASE.evening);
}

describe('staff data', () => {
  it('rejects unknown jobs, roles without jobs and bad wages', () => {
    const bad = (patch: (d: RawStaff) => void) => () => {
      const d = JSON.parse(JSON.stringify(rawStaff)) as RawStaff;
      patch(d);
      buildStaff(d);
    };
    expect(bad((d) => (d.roles[0]!.jobs = { juggle: 1 }))).toThrow(/unknown job/);
    expect(bad((d) => (d.roles[0]!.jobs = {}))).toThrow(/at least one/);
    expect(bad((d) => (d.roles[0]!.wage = -5))).toThrow(/wage/);
    expect(STAFF.roles.filter((r) => r.hireable).map((r) => r.key)).toEqual(['waiter']);
  });

  it('unlocks by savings and seats', () => {
    expect(hireBlock(WAITER, WAITER.unlock.savings - 1, 99)).toBe('staff.err.savings');
    expect(hireBlock(WAITER, WAITER.unlock.savings, WAITER.unlock.seats - 1)).toBe('staff.err.seats');
    expect(hireBlock(WAITER, WAITER.unlock.savings, WAITER.unlock.seats)).toBe('');
    expect(hireBlock(STAFF.byKey.get('cook')!, 1e9, 99)).toBe('staff.err.notYet');
  });
});

describe('hiring and wages', () => {
  it('hire in the evening; the first wage is paid at Sleep and the waiter starts the next morning', () => {
    const g = Game.create(1);
    expect(g.act({ k: 'hire', role: 'waiter' })).toEqual({ ok: false, reason: 'day.err.notNow' });
    toEvening(g);
    g.builder.money = 1000;
    expect(g.act({ k: 'hire', role: 'waiter' })).toEqual({ ok: false, reason: 'staff.err.savings' });
    g.builder.money = WAITER.unlock.savings + 500;
    expect(g.act({ k: 'hire', role: 'waiter' }).ok).toBe(true);
    expect(g.act({ k: 'hire', role: 'waiter' })).toEqual({ ok: false, reason: 'staff.err.hired' });
    expect(g.workers.alive[WAITER_W]).toBe(0);
    g.events.length = 0;
    expect(g.act({ k: 'sleep' }).ok).toBe(true);
    expect(g.builder.money).toBe(WAITER.unlock.savings + 500 - WAITER.wage);
    expect(g.events).toContainEqual({ k: 'wages', paid: WAITER.wage, dayOff: 0, total: g.builder.money });
    expect(g.workers.alive[WAITER_W]).toBe(1);
    expect(g.playerState().staff).toEqual([{ role: 'waiter', dayOff: false }]);
  });

  it('a short tin means an unpaid day off — never debt — and they come back once it can pay', () => {
    const g = Game.create(2);
    toEvening(g);
    g.builder.money = WAITER.unlock.savings;
    g.act({ k: 'hire', role: 'waiter' });
    g.builder.money = WAITER.wage - 1; // spent on furniture before sleeping
    g.act({ k: 'sleep' });
    expect(g.builder.money).toBe(WAITER.wage - 1);
    expect(g.staff[0]!.dayOff).toBe(true);
    expect(g.workers.alive[WAITER_W]).toBe(0);
    toEvening(g);
    g.builder.money = WAITER.wage;
    g.act({ k: 'sleep' });
    expect(g.builder.money).toBe(0);
    expect(g.staff[0]!.dayOff).toBe(false);
    expect(g.workers.alive[WAITER_W]).toBe(1);
  });

  it('letting go removes them at once', () => {
    const g = Game.create(3);
    toEvening(g);
    g.builder.money = 1e6;
    g.act({ k: 'hire', role: 'waiter' });
    g.act({ k: 'sleep' });
    toEvening(g);
    expect(g.act({ k: 'dismiss', role: 'waiter' }).ok).toBe(true);
    expect(g.workers.alive[WAITER_W]).toBe(0);
    expect(g.staff).toEqual([]);
    expect(g.act({ k: 'dismiss', role: 'waiter' })).toEqual({ ok: false, reason: 'staff.err.notHired' });
  });

  it('the roster survives saving (v3), and older saves load with no staff', () => {
    const g = Game.create(4);
    toEvening(g);
    g.builder.money = 1e6;
    g.act({ k: 'hire', role: 'waiter' });
    g.act({ k: 'sleep' });
    const data = g.toSave(0);
    const back = parse(serialize(data));
    expect(back.staff).toEqual(data.staff);
    const { game } = Game.fromSave(back);
    expect(game.workers.alive[WAITER_W]).toBe(1);
    expect(game.playerState().staff).toEqual([{ role: 'waiter', dayOff: false }]);
  });
});

/** A hired waiter, the shop open. */
function withWaiter(seed: number): Game {
  const g = Game.create(seed);
  toEvening(g);
  g.builder.money = 1e6;
  g.act({ k: 'hire', role: 'waiter' });
  g.act({ k: 'sleep' });
  g.act({ k: 'openShop' });
  return g;
}

describe('the waiter at work', () => {
  it('takes orders and serves ready cups by itself; never brews', () => {
    const g = withWaiter(5);
    const h = g.npcs.spawn();
    const i = g.npcs.indexOf(h);
    for (let k = 0; k < 3000 && g.npcs.state[i] !== CS.waiting; k++) steps(g, 1);
    expect(g.npcs.state[i]).toBe(CS.waiting); // the waiter took the order
    steps(g, 300);
    expect(g.service.board.find(TASK.brew, h)).not.toBe(0); // brewing is the player's job
    expect(g.service.brew(h, 0.9, true)).toBe('');
    for (let k = 0; k < 3000 && g.npcs.state[i] !== CS.drinking; k++) steps(g, 1);
    expect(g.npcs.state[i]).toBe(CS.drinking); // the waiter served it
    for (let k = 0; k < 5000 && g.service.cups.countIn(CUP.sink) === 0; k++) steps(g, 1);
    expect(g.service.cups.countIn(CUP.sink)).toBe(1); // and cleared it
  });

  it('the player can take a job the waiter claimed', () => {
    const g = withWaiter(6);
    const h = g.npcs.spawn();
    const i = g.npcs.indexOf(h);
    for (let k = 0; k < 3000 && g.npcs.state[i] !== CS.asking; k++) steps(g, 1);
    const t = g.service.board.find(TASK.order, h);
    // The waiter may be busy with another early customer (a resident) first.
    for (let k = 0; k < 3000 && g.service.board.claimedBy[g.service.board.indexOf(t)] !== WAITER_W; k++) steps(g, 1);
    expect(g.service.board.claimedBy[g.service.board.indexOf(t)]).toBe(WAITER_W);
    expect(g.act({ k: 'queueTask', task: t }).ok).toBe(true);
    expect(g.service.board.claimedBy[g.service.board.indexOf(t)]).toBe(PLAYER);
    expect(g.workers.state[WAITER_W]).toBe(WS.idle);
  });

  it('a waiter shortens the wait over a whole day (player brews and washes; the waiter does the rest)', () => {
    const day = (hire: boolean) => {
      const g = hire ? withWaiter(7) : Game.create(7);
      if (!hire) g.act({ k: 'openShop' });
      const events: SimEvent[] = [];
      for (let k = 0; k < 24 * 60 * 10 && g.day.phase !== PHASE.evening; k++) {
        steps(g, 1, events);
        const p = g.workers;
        if (p.state[PLAYER] === WS.brewing) {
          const ch = p.brewFor[PLAYER]!;
          const ci = g.npcs.indexOf(ch);
          const d = DRINKS.defs[g.npcs.drink[ci]!]!;
          const m = Math.min(1, Math.max(0, d.milk + g.npcs.milkShift[ci]!));
          g.act({ k: 'serve', id: ch, tea: 0.9 * (1 - m), milk: 0.9 * m });
          continue;
        }
        const b = g.service.board;
        const kinds = hire ? [TASK.wash, TASK.brew] : !g.service.canBrew() ? [TASK.wash, TASK.clear, TASK.serve, TASK.order] : [TASK.serve, TASK.brew, TASK.order, TASK.clear, TASK.wash];
        while (p.qLen[PLAYER]! < QUEUE_MAX) {
          let pick = 0;
          for (const kind of kinds) {
            for (let t = 1; t < b.capacity && !pick; t++) if (b.live[t] && b.kind[t] === kind && b.claimedBy[t] === 0) pick = b.handle(t);
            if (pick) break;
          }
          if (!pick || !g.act({ k: 'queueTask', task: pick }).ok) break;
        }
      }
      expect(g.day.phase).toBe(PHASE.evening);
      const served = events.filter((e): e is Extract<SimEvent, { k: 'served' }> => e.k === 'served');
      return served.reduce((s, e) => s + e.wait, 0) / Math.max(1, served.length);
    };
    const solo = day(false);
    const withHelp = day(true);
    expect(withHelp).toBeLessThan(solo);
  });
});
