import { describe, expect, it } from 'vitest';
import { CATALOG } from '../src/shared/catalog';
import { fromBase64Url, toBase64Url } from '../src/shared/base64';
import { Game } from '../src/sim/game';
import { migrate, parse, serialize, SAVE_SCHEMA, type SaveData } from '../src/sim/save/format';
import { FrameWriter } from '../src/shared/diff';
import { SHOP } from '../src/sim/area';

const T = (key: string) => CATALOG.byKey.get(key)!.id;

function furnished(): Game {
  const g = Game.create(1234);
  const P = (k: string, x: number, y: number, rot = 0, colour = 0) => g.act({ k: 'place', type: T(k), x: SHOP.x0 + x, y: SHOP.y0 + y, rot, colour });
  P('table_long', 3, 3, 1, 4);
  P('teapot', 3, 4, 0, 2);
  P('bench', 5, 3, 1);
  P('wall_clock', 4, 0, 1);
  P('hanging_lamp', 3, 3, 0, 5);
  P('rug', 7, 6, 0, 3);
  // Advance the clock and RNG so they are not at their defaults.
  const w = new FrameWriter();
  w.begin(new ArrayBuffer(4096), 0, 0);
  for (let i = 0; i < 37; i++) g.step(w);
  g.sim.rng.market.next();
  return g;
}

/** Everything that must survive a save: objects (by uid), money, inventory, clock, RNG. */
function picture(g: Game) {
  const d = g.toSave(0);
  return { ...d, savedAt: 0, objects: [...d.objects].sort((a, b) => a.uid - b.uid) };
}

describe('save format', () => {
  it('round-trips a game exactly: objects, stacking, uids, money, inventory, clock and RNG', () => {
    const g = furnished();
    const data = g.toSave(1_700_000_000_000);
    const back = parse(serialize(data));
    expect(back).toEqual(data);
    const { game, skipped } = Game.fromSave(back);
    expect(skipped).toBe(0);
    expect(picture(game)).toEqual(picture(g));
    // Occupancy and grids are rebuilt identically.
    const byUid = (x: Game, grid: Uint16Array) => Array.from(grid, (i) => (i ? x.world.objects.uid[i] : 0));
    for (const k of ['furniture', 'stack', 'wallN', 'ceiling', 'floor'] as const) {
      expect(byUid(game, game.world.state.occ[k]), k).toEqual(byUid(g, g.world.state.occ[k]));
    }
    expect(Array.from(game.world.grids.accum[1]!)).toEqual(Array.from(g.world.grids.accum[1]!));
    // New objects after loading never reuse an old uid.
    const r = game.act({ k: 'place', type: T('stool'), x: SHOP.x0 + 9, y: SHOP.y0 + 9, rot: 0, colour: 0 });
    expect(game.world.objects.uid[r.index!]).toBeGreaterThanOrEqual(data.nextUid);
  });

  it('matches types by key, so a reordered catalog still loads; unknown keys are skipped', () => {
    const data = furnished().toSave(0);
    data.objects.push({ uid: 999, key: 'flying_carpet', x: 1, y: 1, rot: 0, layer: 1, colour: 0, flags: 0, parentUid: 0 });
    data.objects.push({ uid: 1000, key: 'teapot', x: 1, y: 1, rot: 0, layer: 1, colour: 0, flags: 0, parentUid: 999 }); // orphan
    data.inventory.flying_carpet = 3;
    data.objects.reverse(); // children before parents in the file
    const { game, skipped } = Game.fromSave(parse(serialize(data)));
    expect(skipped).toBe(2);
    const teapot = game.world.objects.indexOfUid(data.objects.find((o) => o.key === 'teapot' && o.uid !== 1000)!.uid);
    expect(game.world.objects.type[teapot]).toBe(T('teapot'));
    expect(game.world.objects.parent[teapot]).toBeGreaterThan(0);
  });

  it('rejects garbage, truncation and saves from a newer version', () => {
    expect(() => parse(new ArrayBuffer(4))).toThrow();
    expect(() => parse(new TextEncoder().encode('hello world, not a save').buffer)).toThrow('not a save');
    const buf = serialize(furnished().toSave(0));
    expect(() => parse(buf.slice(0, buf.byteLength - 5))).toThrow('truncated');
    new DataView(buf).setUint16(4, SAVE_SCHEMA + 1, true);
    expect(() => parse(buf)).toThrow('schema');
  });

  it('runs migrations in order and checks each step', () => {
    const steps = {
      1: (s: { schema: number }) => ({ ...s, schema: 2, a: 1 }),
      2: (s: { schema: number }) => ({ ...s, schema: 3, b: 2 }),
    };
    expect(migrate({ schema: 1 }, steps, 3)).toEqual({ schema: 3, a: 1, b: 2 });
    expect(() => migrate({ schema: 1 }, { 1: (s) => ({ ...s, schema: 5 }) }, 3)).toThrow('must produce 2');
    expect(() => migrate({ schema: 2 }, {}, 3)).toThrow('no migration');
  });

  it('a save code is base64url of the binary save and survives the round trip', () => {
    const data: SaveData = furnished().toSave(5);
    const code = toBase64Url(new Uint8Array(serialize(data)));
    expect(code).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(parse(fromBase64Url(code).buffer as ArrayBuffer)).toEqual(data);
    expect(() => fromBase64Url('not a code!')).toThrow();
    // Header + key table + 16 bytes per object: a typical shop stays well under DESIGN's 2,000 characters.
    expect(code.length).toBeLessThan(600);
  });
});
