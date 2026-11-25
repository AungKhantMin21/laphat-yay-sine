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
  for (const k of ['table_long', 'teapot', 'bench', 'wall_clock', 'hanging_lamp', 'rug']) g.builder.give(T(k), 1);
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
    game.builder.give(T('stool'), 1);
    const r = game.act({ k: 'place', type: T('stool'), x: SHOP.x0 + 8, y: SHOP.y0 + 8, rot: 0, colour: 0 });
    expect(game.world.objects.uid[r.index!]).toBeGreaterThanOrEqual(data.nextUid);
  });

  it('matches types by key, so a reordered catalog still loads; unknown keys are skipped, orphans go to the inventory', () => {
    const data = furnished().toSave(0);
    data.objects.push({ uid: 999, key: 'flying_carpet', x: 1, y: 1, rot: 0, layer: 1, colour: 0, flags: 0, parentUid: 0 });
    data.objects.push({ uid: 1000, key: 'teapot', x: 1, y: 1, rot: 0, layer: 1, colour: 0, flags: 0, parentUid: 999 }); // orphan
    data.inventory.flying_carpet = 3;
    data.objects.reverse(); // children before parents in the file
    const { game, skipped, returned } = Game.fromSave(parse(serialize(data)));
    expect(skipped).toBe(1); // the unknown key
    expect(returned).toBe(1); // the teapot whose table no longer exists: kept, in the inventory
    expect(game.builder.inventory[T('teapot')]).toBe((data.inventory.teapot ?? 0) + 1);
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
    // Header + key table + 16 bytes per object, plus (v5) the living world (~0.9 KB of properties and
    // residents). This is the full backup code; share links (M6) get their own compressed layout-only
    // format for DESIGN's 2,000-character target.
    expect(code.length).toBeLessThan(2500);
  });

  it('objects that break the current shop rules go back to the inventory, never lost', () => {
    const data = furnished().toSave(0);
    const n = data.objects.length;
    // Saved before M2.5: a stool on the pavement, a table in the shop's walk-way, a stool in the kitchen.
    data.objects.push({ uid: 900, key: 'stool', x: SHOP.x0, y: SHOP.y1 + 1, rot: 0, layer: 1, colour: 0, flags: 0, parentUid: 0 });
    data.objects.push({ uid: 901, key: 'table', x: SHOP.x0 + 7, y: SHOP.y1 - 1, rot: 0, layer: 1, colour: 0, flags: 0, parentUid: 0 });
    data.objects.push({ uid: 902, key: 'stool', x: SHOP.x0 + 5, y: SHOP.y0 + 1, rot: 0, layer: 1, colour: 0, flags: 0, parentUid: 0 });
    const { game, skipped, returned } = Game.fromSave(parse(serialize(data)));
    expect(skipped).toBe(0);
    expect(returned).toBe(3);
    expect(game.world.objects.count).toBe(n);
    expect(game.builder.inventory[T('stool')]).toBe((data.inventory.stool ?? 0) + 2);
    expect(game.builder.inventory[T('table')]).toBe((data.inventory.table ?? 0) + 1);
  });

  it('a save from before the kitchen gets the missing fixtures, and nothing is removed', () => {
    const data = furnished().toSave(0);
    const fixtures = ['counter', 'kettle', 'sink', 'stove'];
    data.objects = data.objects.filter((o) => !fixtures.includes(o.key));
    const n = data.objects.length;
    const { game, added, returned } = Game.fromSave(parse(serialize(data)));
    expect(added).toBe(4);
    expect(returned).toBe(0);
    expect(game.world.objects.count).toBe(n + 4);
    const o = game.world.objects;
    const keys = new Set<string>();
    for (let i = 1; i < o.capacity; i++) if (o.live[i]) keys.add(CATALOG.defs[o.type[i]!]!.key);
    for (const k of fixtures) expect(keys.has(k), k).toBe(true);
    // Loading again adds nothing more.
    expect(Game.fromSave(game.toSave(0)).added).toBe(0);
  });
});
