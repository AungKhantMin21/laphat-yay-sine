// M3 S4: errands — the player walks the neighbourhood by tapping the street (`walkTo`) or a shop
// (`visit`). Errands share the 3-slot queue with service jobs, are the player's alone (staff never
// take them), leave the board when done or cancelled, and arrive exactly on the tile.
import { describe, expect, it } from 'vitest';
import { Game } from '../src/sim/game';
import { FrameWriter } from '../src/shared/diff';
import { NEIGHBOURHOOD } from '../src/shared/neighbourhood';
import { PHASE } from '../src/shared/day';
import { DIR } from '../src/shared/npc';
import type { SimEvent } from '../src/shared/protocol';
import { PLAYER, QUEUE_MAX, WS } from '../src/sim/npc/workers';
import { TASK } from '../src/sim/service/task-board';
import { Bot } from './bot';

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
const W = NEIGHBOURHOOD.w;
const market = NEIGHBOURHOOD.shops.find((s) => s.key === 'market')!;
const hardware = NEIGHBOURHOOD.shops.find((s) => s.key === 'hardware')!;
const playerTile = (g: Game): number => g.workers.tile[PLAYER]!;
/** Runs until the player has nothing queued and stands still (or the limit). */
function untilIdle(g: Game, limit: number, events?: SimEvent[]): number {
  let k = 0;
  for (; k < limit && (g.workers.qLen[PLAYER]! > 0 || g.workers.state[PLAYER] !== WS.idle); k++) steps(g, 1, events);
  return k;
}

describe('walking errands', () => {
  it('walkTo walks the player onto that very street tile, then the errand leaves the board', () => {
    const g = Game.create(1);
    expect(g.act({ k: 'walkTo', x: 40, y: 20 }).ok).toBe(true);
    expect(g.service.board.count[TASK.go]).toBe(1);
    untilIdle(g, 600);
    expect(playerTile(g)).toBe(20 * W + 40);
    expect(g.service.board.count[TASK.go]).toBe(0);
  });

  it('refuses the road, filler and tiles off the map; a new walk replaces the queued one', () => {
    const g = Game.create(2);
    expect(g.act({ k: 'walkTo', x: 10, y: 24 })).toEqual({ ok: false, reason: 'walk.err.cantGo' }); // road
    expect(g.act({ k: 'walkTo', x: 5, y: 5 })).toEqual({ ok: false, reason: 'walk.err.cantGo' }); // filler
    expect(g.act({ k: 'walkTo', x: -1, y: 20 })).toEqual({ ok: false, reason: 'walk.err.cantGo' });
    expect(g.act({ k: 'walkTo', x: 10, y: 20 }).ok).toBe(true);
    expect(g.act({ k: 'walkTo', x: 50, y: 20 }).ok).toBe(true);
    expect(g.workers.qLen[PLAYER]).toBe(1);
    expect(g.service.board.count[TASK.go]).toBe(1);
    untilIdle(g, 600);
    expect(playerTile(g)).toBe(20 * W + 50);
  });

  it('a visit ends at the shop counter, facing it, with an atShop event — the farthest shop within 40 s', () => {
    const g = Game.create(3);
    const events: SimEvent[] = [];
    expect(g.act({ k: 'visit', shop: hardware.id }).ok).toBe(true);
    expect(g.act({ k: 'visit', shop: hardware.id })).toEqual({ ok: false, reason: 'serve.err.queued' });
    expect(g.act({ k: 'visit', shop: 99 })).toEqual({ ok: false, reason: 'serve.err.gone' });
    const ticks = untilIdle(g, 2000, events);
    expect(playerTile(g)).toBe(hardware.visitY * W + hardware.visitX);
    expect(g.workers.dir[PLAYER]).toBe(DIR.north);
    expect(events).toContainEqual({ k: 'atShop', shop: hardware.id });
    expect(ticks / 10).toBeLessThanOrEqual(40); // seconds (10 Hz)
  });

  it('errands and service share the queue (max 3, in order) and can be cancelled', () => {
    const g = Game.create(4);
    g.act({ k: 'openShop' });
    const h = g.npcs.spawn();
    const i = g.npcs.indexOf(h);
    for (let k = 0; k < 3000 && !g.service.board.find(TASK.order, h); k++) steps(g, 1);
    const order = g.service.board.find(TASK.order, h);
    expect(g.act({ k: 'queueTask', task: order }).ok).toBe(true);
    expect(g.act({ k: 'visit', shop: market.id }).ok).toBe(true);
    expect(g.act({ k: 'visit', shop: hardware.id }).ok).toBe(true);
    expect(g.workers.qLen[PLAYER]).toBe(QUEUE_MAX);
    expect(g.act({ k: 'walkTo', x: 40, y: 20 })).toEqual({ ok: false, reason: 'serve.err.queueFull' });
    // Cancel the hardware visit: it leaves the board.
    const visit = g.service.board.find(TASK.visit, hardware.id);
    expect(g.act({ k: 'cancelTask', task: visit }).ok).toBe(true);
    expect(g.service.board.count[TASK.visit]).toBe(1);
    // The order comes first, then the market.
    const events: SimEvent[] = [];
    untilIdle(g, 3000, events);
    expect(g.npcs.state[i]).not.toBe(0);
    expect(g.service.board.find(TASK.order, h)).toBe(0);
    expect(events.filter((e) => e.k === 'atShop')).toEqual([{ k: 'atShop', shop: market.id }]);
    expect(g.day.phase).toBe(PHASE.open);
  });

  it('staff never take errands, even ones left open on the board', () => {
    const g = Game.create(5);
    g.act({ k: 'openShop' });
    g.staff.push({ role: 'waiter', hiredDay: 0, dayOff: false });
    g.spawnStaff();
    expect(g.workers.alive[2]).toBe(1);
    const h = g.service.board.add(TASK.go, 20 * W + 40, 0);
    steps(g, 200);
    expect(g.service.board.claimedBy[g.service.board.indexOf(h)]).toBe(0);
  });

  it('is deterministic: the same errands give the same walk', () => {
    const run = (): number[] => {
      const g = Game.create(6);
      g.act({ k: 'visit', shop: market.id });
      const out: number[] = [];
      for (let k = 0; k < 400; k++) {
        steps(g, 1);
        out.push(playerTile(g));
      }
      return out;
    };
    expect(run()).toEqual(run());
  });
});

describe('three days with a morning market trip', () => {
  /** Each morning: walk to the wet market, buy what the shelf needs (carry), walk back, open; a bot serves. */
  function play(seed: number): { money: number; stock: number[]; served: number; trips: number }[] {
    const g = Game.create(seed);
    const bot = new Bot(g, 0);
    const out: { money: number; stock: number[]; served: number; trips: number }[] = [];
    for (let d = 0; d < 3; d++) {
      let trips = 0;
      untilIdle(g, 1);
      expect(g.act({ k: 'visit', shop: market.id }).ok).toBe(true);
      untilIdle(g, 3000);
      // Two packs of each ingredient the shelf is lowest on, within the load cap.
      const rows = g.market.rows[market.id]!;
      const order = rows.map((r, k) => k).sort((a, b) => g.service.stock.count[rows[a]!.id]! - g.service.stock.count[rows[b]!.id]!);
      for (const k of order) if (g.act({ k: 'buy', shop: market.id, item: k, qty: 1 }).ok) trips++;
      expect(g.act({ k: 'walkTo', x: 31, y: 18 }).ok).toBe(true);
      untilIdle(g, 3000);
      expect(g.market.carry).toEqual([]);
      expect(g.act({ k: 'openShop' }).ok).toBe(true);
      for (let k = 0; k < 24 * 60 * 10 && g.day.phase !== PHASE.evening; k++) {
        steps(g, 1);
        bot.tick();
      }
      const served = g.day.today.served;
      expect(g.act({ k: 'sleep' }).ok).toBe(true);
      out.push({ money: g.builder.money, stock: Array.from(g.service.stock.count), served, trips });
    }
    return out;
  }

  it('is deterministic, serves every day and the shelf never runs dry', () => {
    const a = play(8);
    expect(play(8)).toEqual(a);
    for (const d of a) {
      expect(d.served).toBeGreaterThan(15);
      expect(d.trips).toBeGreaterThan(0);
      expect(Math.min(...d.stock)).toBeGreaterThan(0);
    }
  });
});

describe('closing time on a big map', () => {
  it('customers still walking to a seat go home when the shop closes; seated ones are served first', () => {
    const g = Game.create(9);
    g.act({ k: 'openShop' });
    for (let k = 0; k < 4; k++) g.npcs.spawn();
    const states = (): number[] => Array.from({ length: g.npcs.capacity }, (_, i) => (g.npcs.alive[i] ? g.npcs.state[i]! : -1));
    const seated = (st: number[]): number[] => st.flatMap((s, i) => (s >= 2 && s !== 5 ? [i] : []));
    const walking = (st: number[]): number[] => st.flatMap((s, i) => (s === 1 ? [i] : []));
    for (let k = 0; k < 3000 && !(seated(states()).length > 0 && walking(states()).length > 0); k++) steps(g, 1);
    const sit = seated(states());
    const walk = walking(states());
    expect(sit.length).toBeGreaterThan(0);
    expect(walk.length).toBeGreaterThan(0);
    g.sim.jumpTo(g.sim.day * 1440 + 17 * 60);
    steps(g, 2);
    expect(g.day.phase).toBe(PHASE.closing);
    for (const i of walk) expect(g.npcs.state[i]).toBe(5); // leaving
    for (const i of sit) expect(g.npcs.state[i]).not.toBe(5);
  });
});
