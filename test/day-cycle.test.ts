import start from '../src/data/start.json';
import { describe, expect, it } from 'vitest';
import { Game } from '../src/sim/game';
import { FrameWriter, readFrame, type FrameHandler } from '../src/shared/diff';
import { PHASE } from '../src/shared/day';
import { SHOP } from '../src/shared/shop';
import { MINUTES_PER_DAY, START_MINUTE } from '../src/shared/layout';
import { TICK_HZ } from '../src/shared/protocol';
import { parse, serialize, SAVE_SCHEMA, emptyWorld } from '../src/sim/save/format';

const writer = new FrameWriter();
function steps(g: Game, n: number): void {
  writer.begin(new ArrayBuffer(4096), g.sim.tick, g.sim.gameMinute);
  for (let i = 0; i < n; i++) g.step(writer);
}
/** Steps until the game minute reaches `minute` (or `max` steps pass). */
function runTo(g: Game, minute: number, max = MINUTES_PER_DAY * TICK_HZ): void {
  for (let i = 0; i < max && g.sim.gameMinute < minute; i++) steps(g, 1);
}

describe('shop day cycle', () => {
  it('a new game waits at opening time with the shutters closed', () => {
    const g = Game.create(1, false);
    expect(g.sim.gameMinute).toBe(START_MINUTE);
    expect(g.playerState().phase).toBe(PHASE.morning);
    steps(g, 600);
    expect(g.sim.gameMinute).toBe(START_MINUTE);
    expect(g.sim.tick).toBe(600); // steps still run (build, animation) while the clock holds
  });

  it('opening starts the clock; open → evening at closing time with an empty shop; then it holds', () => {
    const g = Game.create(1, false);
    expect(g.act({ k: 'openShop' }).ok).toBe(true);
    expect(g.playerState().phase).toBe(PHASE.open);
    steps(g, 10);
    expect(g.sim.gameMinute).toBe(START_MINUTE + 1);
    runTo(g, SHOP.close);
    expect(g.sim.gameMinute).toBe(SHOP.close);
    expect(g.playerState().phase).toBe(PHASE.evening);
    steps(g, 1000);
    expect(g.sim.gameMinute).toBe(SHOP.close);
  });

  it('open and sleep are refused outside their phase', () => {
    const g = Game.create(1, false);
    expect(g.act({ k: 'sleep' })).toEqual({ ok: false, reason: 'day.err.notNow' });
    g.act({ k: 'openShop' });
    expect(g.act({ k: 'openShop' })).toEqual({ ok: false, reason: 'day.err.notNow' });
    expect(g.act({ k: 'sleep' }).ok).toBe(false);
  });

  it('sleep reports the day, resets the stats and moves to the next opening time, exactly one day on', () => {
    const g = Game.create(1, false);
    g.act({ k: 'openShop' });
    runTo(g, SHOP.close);
    g.day.today.served = 7;
    g.day.today.earned = 8400;
    expect(g.act({ k: 'sleep' }).ok).toBe(true);
    expect(g.events).toEqual([
      { k: 'dayEnd', day: 0, stats: expect.objectContaining({ served: 7, earned: 8400 }) },
      { k: 'teaser', key: g.day.teaser.key, drink: expect.any(Number) },
    ]);
    expect(g.day.teaser.key).not.toBe('');
    expect(g.sim.gameMinute).toBe(MINUTES_PER_DAY + SHOP.open);
    expect(g.sim.day).toBe(1);
    const p = g.playerState();
    expect(p.phase).toBe(PHASE.morning);
    expect(p.day).toBe(1);
    expect(p.today.served).toBe(0);
  });

  it('announces the new day in the next frame after sleeping', () => {
    const g = Game.create(1, false);
    g.act({ k: 'openShop' });
    runTo(g, SHOP.close);
    g.act({ k: 'sleep' });
    const w = new FrameWriter();
    w.begin(new ArrayBuffer(4096), 0, 0);
    g.step(w);
    let day = -1;
    readFrame(w.finish(), { header() {}, npcSpawn() {}, npcDespawn() {}, npcState() {}, task() {}, cup() {}, world: (_a: number, _b: number, d: number) => (day = d) } as unknown as FrameHandler);
    expect(day).toBe(1);
  });

  it('state changes are flagged once for the worker to post', () => {
    const g = Game.create(1, false);
    g.takeChanged();
    expect(g.takeChanged()).toBe(false);
    g.act({ k: 'openShop' });
    expect(g.takeChanged()).toBe(true);
    expect(g.takeChanged()).toBe(false);
  });
});

describe('save v2', () => {
  function midDay(): Game {
    const g = Game.create(99);
    g.act({ k: 'openShop' });
    runTo(g, START_MINUTE + 125);
    g.day.today = { served: 12, poured: 9, earned: 14350, tips: 1350, best: 96 };
    g.day.teaser = { key: 'friends', arg: 'cho_seint' };
    return g;
  }

  it('round-trips the clock, shutters, today and the teaser', () => {
    const g = midDay();
    const data = g.toSave(1);
    expect(data.schema).toBe(SAVE_SCHEMA);
    const back = parse(serialize(data));
    expect(back).toEqual(data);
    const { game } = Game.fromSave(back);
    expect(game.sim.gameMinute).toBe(g.sim.gameMinute);
    expect(game.playerState()).toEqual(g.playerState());
    expect(game.day.teaser).toEqual(g.day.teaser);
  });

  it('a mid-day save reloads still open, and the clock keeps running', () => {
    const { game } = Game.fromSave(parse(serialize(midDay().toSave(1))));
    expect(game.playerState().phase).toBe(PHASE.open);
    const m = game.sim.gameMinute;
    steps(game, 10);
    expect(game.sim.gameMinute).toBe(m + 1);
  });

  it('migrates a v1 save: clock = tick, shutters open, empty day', () => {
    // A v1 file is the current layout without the trailing day block (20 B + 2 empty teaser strings)
    // and the staff block (1 B, empty), with schema 1.
    const g = midDay();
    const data = g.toSave(1);
    data.teaser = { key: '', arg: '' };
    data.staff = [];
    data.hood = { marketDay: -1, sold: {}, stock: {}, materials: {}, carry: [], deliveries: [], painted: [] };
    data.world = emptyWorld();
    const v5 = serialize(data);
    // Day block (20) + two empty teaser strings (2) + empty staff (1) + empty neighbourhood (11) + empty world (11).
    const v1 = v5.slice(0, v5.byteLength - 20 - 2 - 1 - 11 - 11);
    new DataView(v1).setUint16(4, 1, true);
    const back = parse(v1);
    expect(back.schema).toBe(5); // v1 → v2 → v3 → v4 → v5
    expect(back.staff).toEqual([]);
    expect(back.hood.stock).toEqual(start.stock);
    expect(back.clock).toBe(back.tick);
    expect(back.shuttersOpen).toBe(true);
    expect(back.today).toEqual({ served: 0, poured: 0, earned: 0, tips: 0, best: 0 });
    expect(back.teaser).toEqual({ key: '', arg: '' });
    expect(back.objects).toEqual(data.objects);
    expect(back.money).toBe(data.money);
    const { game } = Game.fromSave(back);
    expect(game.sim.gameMinute).toBe(START_MINUTE + Math.floor(back.tick / TICK_HZ));
  });

  it('rejects a v2 save cut inside the day block', () => {
    const buf = serialize(midDay().toSave(1));
    expect(() => parse(buf.slice(0, buf.byteLength - 4))).toThrow('truncated');
  });
});
