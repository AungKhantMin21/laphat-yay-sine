// M2.5 S5: the player character works the shop through real actions — queue a job, walk there
// (staff access: the kitchen too), do it. Brewing opens the pour minigame (brewReady) and waits for
// the player's pour; the tray carries 2; cups end up washed on the shelf.
import { describe, expect, it } from 'vitest';
import { Game } from '../src/sim/game';
import { SERVICE } from '../src/shared/catalog';
import { FrameWriter, readFrame, type FrameHandler } from '../src/shared/diff';
import { DRINKS } from '../src/shared/drinks';
import { NONE } from '../src/shared/ids';
import { WORKER_SLOT0 } from '../src/shared/layout';
import { NPC_DEF_PLAYER, ORDER } from '../src/shared/npc';
import { ACCESS, mayEnter } from '../src/shared/rules/access';
import type { SimEvent } from '../src/shared/protocol';
import { CS } from '../src/sim/npc/customers';
import { PLAYER, QUEUE_MAX, WS } from '../src/sim/npc/workers';
import { CUP } from '../src/sim/service/cups';
import { TASK } from '../src/sim/service/task-board';

let buf = new ArrayBuffer(1 << 16);
const writer = new FrameWriter();
const events: SimEvent[] = [];
let offZone = 0;
function steps(g: Game, n: number): void {
  for (let k = 0; k < n; k++) {
    writer.begin(buf, g.sim.tick, g.sim.gameMinute);
    g.step(writer);
    buf = writer.finish();
    events.push(...g.events.splice(0));
    // The player only ever stands on tiles staff may walk on.
    const p = g.workers;
    const t = Math.floor(p.y[PLAYER]!) * g.walk.w + Math.floor(p.x[PLAYER]!);
    if (!mayEnter(ACCESS.staff, g.world.state.area.access[t]!)) offZone++;
  }
}
function until(g: Game, done: () => boolean, max = 5000): number {
  for (let k = 0; k < max; k++) {
    if (done()) return k;
    steps(g, 1);
  }
  throw new Error('timed out');
}

/** The start shop, open, with one customer asking to order. */
function shopWithCustomer(seed = 1): { g: Game; h: number; i: number } {
  const g = Game.create(seed);
  g.act({ k: 'openShop' });
  events.length = 0;
  const h = g.npcs.spawn();
  const i = g.npcs.indexOf(h);
  until(g, () => g.npcs.state[i] === CS.asking);
  return { g, h, i };
}

/** Queue the job of `kind` for `target` and wait until it's off the board. */
function doJob(g: Game, kind: number, target: number): void {
  const t = g.service.board.find(kind, target);
  expect(t, `job ${kind} for ${target}`).not.toBe(NONE);
  expect(g.act({ k: 'queueTask', task: t }).ok).toBe(true);
  until(g, () => g.service.board.indexOf(t) === 0 || g.workers.state[PLAYER] === WS.brewing);
}

/** Pours a perfect cup for customer i when the minigame is open. */
function pour(g: Game, h: number, i: number): void {
  const drink = DRINKS.defs[g.npcs.drink[i]!]!;
  const target = Math.min(1, Math.max(0, drink.milk + g.npcs.milkShift[i]!));
  expect(g.act({ k: 'serve', id: h, tea: 0.9 * (1 - target), milk: 0.9 * target }).ok).toBe(true);
}

describe('the player character', () => {
  it('starts beside the counter and is sent to the main thread as an NPC in a worker slot', () => {
    const g = Game.create(1);
    expect(g.workers.alive[PLAYER]).toBe(1);
    const counter = g.service.fixtureTile(SERVICE.counter);
    expect(counter).toBeGreaterThanOrEqual(0);
    const W = g.walk.w;
    const t = g.workers.tile[PLAYER]!;
    expect(Math.abs((t % W) - (counter % W))).toBeLessThanOrEqual(2);
    expect(g.walkStaff.passable(t)).toBe(true);
    const spawns: number[][] = [];
    const h = { npcSpawn: (hh: number, def: number) => spawns.push([hh, def]), header() {}, npcDespawn() {}, npcState() {}, objUpsert() {}, objRemove() {}, gridPatch() {}, tilePatch() {}, world() {}, npcOrder() {}, task() {}, cup() {} } as unknown as FrameHandler;
    const w = new FrameWriter();
    w.begin(new ArrayBuffer(1 << 16), 0, 0);
    g.writeSnapshot(w);
    readFrame(w.finish(), h);
    expect(spawns).toContainEqual([g.workers.handle(PLAYER), NPC_DEF_PLAYER]);
    expect(g.workers.handle(PLAYER) & 0xffff).toBe(WORKER_SLOT0);
  });

  it('takes the order, brews with the pour minigame, serves, clears and washes — all by walking there', () => {
    const { g, h, i } = shopWithCustomer();
    offZone = 0;
    const money0 = g.builder.money;
    doJob(g, TASK.order, h);
    expect(g.npcs.order[i]).toBe(ORDER.waiting);
    // Brew: the player walks to the counter and the pour minigame opens.
    doJob(g, TASK.brew, h);
    expect(g.workers.state[PLAYER]).toBe(WS.brewing);
    expect(g.npcs.order[i]).toBe(ORDER.pouring);
    expect(events).toContainEqual({ k: 'brewReady', id: h, drink: g.npcs.drink[i] });
    expect(g.playerState().brewing).toBe(h);
    pour(g, h, i);
    expect(g.workers.state[PLAYER]).toBe(WS.idle);
    const cup = g.service.cups.forCustomer.indexOf(h);
    expect(g.service.cups.place[cup]).toBe(CUP.counter);
    // Serve: to the counter for the cup, then to the table.
    doJob(g, TASK.serve, cup);
    expect(g.npcs.order[i]).toBe(ORDER.served);
    expect(g.builder.money).toBeGreaterThan(money0);
    expect(g.service.cups.place[cup]).toBe(CUP.table);
    // They drink and leave; clear the cup to the sink, wash it.
    until(g, () => g.npcs.state[i] === CS.leaving);
    doJob(g, TASK.clear, cup);
    expect(g.service.cups.place[cup]).toBe(CUP.sink);
    doJob(g, TASK.wash, 0);
    expect(g.service.cups.place[cup]).toBe(CUP.shelf);
    expect(offZone).toBe(0);
  });

  it('the tray carries two: queued serves share one trip to the counter', () => {
    const g = Game.create(2);
    g.act({ k: 'openShop' });
    const hs = [g.npcs.spawn(), g.npcs.spawn()];
    const is = hs.map((h) => g.npcs.indexOf(h));
    until(g, () => is.every((i) => g.npcs.state[i] === CS.asking));
    for (let k = 0; k < 2; k++) doJob(g, TASK.order, hs[k]!);
    for (let k = 0; k < 2; k++) {
      doJob(g, TASK.brew, hs[k]!);
      pour(g, hs[k]!, is[k]!);
    }
    const cups = hs.map((h) => g.service.cups.forCustomer.indexOf(h));
    for (const c of cups) expect(g.act({ k: 'queueTask', task: g.service.board.find(TASK.serve, c) }).ok).toBe(true);
    // After the first pick-up, both cups are on the player's tray.
    until(g, () => g.service.cups.place[cups[0]!] === CUP.tray);
    expect(g.service.cups.carried(PLAYER)).toBe(2);
    until(g, () => is.every((i) => g.npcs.order[i] === ORDER.served));
  });

  it('queue rules: at most three, no duplicates, cancel before the cup is in hand', () => {
    const g = Game.create(3);
    g.act({ k: 'openShop' });
    const hs = [g.npcs.spawn(), g.npcs.spawn(), g.npcs.spawn(), g.npcs.spawn()];
    until(g, () => hs.every((h) => g.npcs.state[g.npcs.indexOf(h)] === CS.asking));
    const tasks = hs.map((h) => g.service.board.find(TASK.order, h));
    for (let k = 0; k < QUEUE_MAX; k++) expect(g.act({ k: 'queueTask', task: tasks[k]! }).ok).toBe(true);
    expect(g.act({ k: 'queueTask', task: tasks[3]! })).toEqual({ ok: false, reason: 'serve.err.queueFull' });
    expect(g.act({ k: 'queueTask', task: tasks[0]! })).toEqual({ ok: false, reason: 'serve.err.queued' }); // already queued
    expect(g.playerState().queue).toEqual(tasks.slice(0, 3));
    // Cancel the second: it goes back on the board, unclaimed; the fourth now fits.
    expect(g.act({ k: 'cancelTask', task: tasks[1]! }).ok).toBe(true);
    expect(g.service.board.claimedBy[g.service.board.indexOf(tasks[1]!)]).toBe(0);
    expect(g.act({ k: 'queueTask', task: tasks[3]! }).ok).toBe(true);
    expect(g.act({ k: 'queueTask', task: tasks[3]! })).toEqual({ ok: false, reason: 'serve.err.queued' });
    expect(g.workers.queuePos(tasks[0]!)).toBe(1);
    expect(g.workers.queuePos(tasks[3]!)).toBe(3);
  });

  it('a cup in hand can’t be cancelled; closing the pour puts the brew back on the board', () => {
    const { g, h, i } = shopWithCustomer(4);
    doJob(g, TASK.order, h);
    doJob(g, TASK.brew, h);
    const brew = g.service.board.find(TASK.brew, h);
    expect(g.act({ k: 'cancelPour', id: h }).ok).toBe(true);
    expect(g.workers.state[PLAYER]).toBe(WS.idle);
    expect(g.npcs.order[i]).toBe(ORDER.waiting);
    expect(g.service.board.claimedBy[g.service.board.indexOf(brew)]).toBe(0);
    doJob(g, TASK.brew, h);
    pour(g, h, i);
    const cup = g.service.cups.forCustomer.indexOf(h);
    const serve = g.service.board.find(TASK.serve, cup);
    g.act({ k: 'queueTask', task: serve });
    until(g, () => g.service.cups.place[cup] === CUP.tray);
    expect(g.act({ k: 'cancelTask', task: serve })).toEqual({ ok: false, reason: 'serve.err.carrying' });
  });

  it('with every cup dirty, brewing tells the player and the job stays on the board', () => {
    const { g, h } = shopWithCustomer(5);
    for (let c = 1; c <= g.service.cups.count; c++) g.service.cups.move(c, CUP.sink, -1, 0);
    doJob(g, TASK.order, h);
    const brew = g.service.board.find(TASK.brew, h);
    g.act({ k: 'queueTask', task: brew });
    until(g, () => events.some((e) => e.k === 'text' && e.key === 'serve.err.noCups'));
    expect(g.service.board.indexOf(brew)).not.toBe(0);
    expect(g.workers.state[PLAYER]).toBe(WS.idle);
  });

  it('sleeping clears the queue and brings the player back beside the counter', () => {
    const { g, h } = shopWithCustomer(6);
    g.act({ k: 'queueTask', task: g.service.board.find(TASK.order, h) });
    steps(g, 5);
    g.workers.reset();
    expect(g.playerState().queue).toEqual([]);
    expect(g.workers.tile[PLAYER]).toBe(g.workers.homeTile());
  });
});

/**
 * A player who taps like a person would: keeps up to three jobs queued (serve > brew > order > clear,
 * wash when out of cups), pours a good cup whenever the minigame opens. Returns the day's numbers.
 */
function playDay(seed: number) {
  const g = Game.create(seed);
  g.act({ k: 'openShop' });
  events.length = 0;
  const prefer = [TASK.serve, TASK.brew, TASK.order, TASK.clear, TASK.wash];
  for (let k = 0; k < 24 * 60 * 10 && g.day.phase !== 3 /* PHASE.evening */; k++) {
    steps(g, 1);
    const b = g.service.board;
    const p = g.workers;
    if (p.state[PLAYER] === WS.brewing) {
      const h = p.brewFor[PLAYER]!;
      pour(g, h, g.npcs.indexOf(h));
      continue;
    }
    while (p.qLen[PLAYER]! < QUEUE_MAX) {
      // Out of clean cups: clear and wash first (brewing would only say "no clean cups").
      const noCups = !g.service.canBrew();
      let pick = 0;
      for (const kind of noCups ? [TASK.wash, TASK.clear, TASK.serve, TASK.order] : prefer) {
        for (let t = 1; t < b.capacity && !pick; t++) {
          if (b.live[t] && b.kind[t] === kind && b.claimedBy[t] === 0) pick = b.handle(t);
        }
        if (pick) break;
      }
      if (!pick || !g.act({ k: 'queueTask', task: pick }).ok) break;
    }
  }
  const served = events.filter((e): e is Extract<SimEvent, { k: 'served' }> => e.k === 'served');
  return { g, served: served.length, avgWait: served.reduce((s, e) => s + e.wait, 0) / Math.max(1, served.length), maxWait: Math.max(0, ...served.map((e) => e.wait)) };
}

describe('a full day, played through actions by a walking player', () => {
  it('everyone is served by evening, and the wait stays reasonable for one person', () => {
    const r = playDay(7);
    expect(r.g.day.phase).toBe(3);
    expect(r.served).toBeGreaterThan(15);
    expect(r.avgWait).toBeLessThanOrEqual(60);
    expect(offZone).toBe(0);
  });
});
