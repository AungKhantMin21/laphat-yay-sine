import { describe, expect, it } from 'vitest';
import { CATALOG, sellValue } from '../src/shared/catalog';
import { Rng } from '../src/shared/rng';
import { SimWorld } from '../src/sim/world';
import { Builder, HISTORY_MAX } from '../src/sim/build/builder';
import { createM1Area, SHOP } from '../src/sim/area';

const T = (key: string) => CATALOG.byKey.get(key)!.id;
const X = SHOP.x0 + 3;
const Y = SHOP.y0 + 3;

function setup(money = 10000, stock = 5) {
  const world = new SimWorld(createM1Area());
  const inv = new Uint16Array(CATALOG.defs.length).fill(stock);
  const b = new Builder(world, money, inv);
  return { world, b, inv };
}

/** Canonical, order-independent picture of the world for comparisons. */
function picture(world: SimWorld): string {
  const s = world.objects;
  const rows: string[] = [];
  for (let i = 1; i < s.capacity; i++) {
    if (!s.live[i]) continue;
    const p = s.parent[i]!;
    rows.push([s.uid[i], s.type[i], s.x[i], s.y[i], s.rot[i], s.colour[i], p ? s.uid[p] : 0].join(','));
  }
  const o = world.state.occ;
  const occ = (['floor', 'furniture', 'ceiling', 'stack', 'wallN', 'wallW'] as const).map((k) => Array.from(o[k], (v) => (v ? s.uid[v] : 0)).join(''));
  return rows.sort().join(';') + '|' + occ.join('|');
}

describe('Builder', () => {
  it('placing takes one from the inventory; no stock or a bad spot changes nothing', () => {
    const { b, inv } = setup(0, 1);
    expect(b.place(T('stool'), X, Y, 0, 0).ok).toBe(true);
    expect(inv[T('stool')]).toBe(0);
    expect(b.place(T('stool'), X + 1, Y, 0, 0)).toEqual({ ok: false, reason: 'build.err.noItem' });
    expect(b.place(T('chair'), X, Y, 0, 0)).toEqual({ ok: false, reason: 'build.err.blocked' });
    expect(inv[T('chair')]).toBe(1);
  });

  it('a small item placed on a table stands on it and moves, rotates and comes back with it', () => {
    const { world, b, inv } = setup();
    const table = b.place(T('table_long'), X, Y, 0, 0).index!;
    const pot = b.place(T('teapot'), X + 1, Y, 0, 0).index!;
    expect(world.objects.parent[pot]).toBe(table);

    expect(b.move(table, X + 2, Y + 2, 0).ok).toBe(true);
    expect([world.objects.x[pot], world.objects.y[pot]]).toEqual([X + 3, Y + 2]);
    expect(b.rotate(table, 1).ok).toBe(true); // 2×1 → 1×2: offset (1,0) → (0,1)
    expect([world.objects.x[pot], world.objects.y[pot]]).toEqual([X + 2, Y + 3]);

    const before = inv[T('teapot')]!;
    expect(b.pickup(table).ok).toBe(true);
    expect(world.objects.count).toBe(0);
    expect(inv[T('teapot')]).toBe(before + 1);
    expect(b.undo().ok).toBe(true);
    expect(world.objects.count).toBe(2);
    expect(world.objects.parent[world.objects.indexOfUid(world.objects.uid[pot]!)]).toBeGreaterThan(0);
  });

  it('selling pays 70%; items on it go back to the inventory; undo takes the money back', () => {
    const { b, inv } = setup(0);
    const counter = b.place(T('counter'), X, Y, 0, 0).index!;
    b.place(T('radio'), X, Y, 0, 0);
    const radios = inv[T('radio')]!;
    expect(b.sell(counter).ok).toBe(true);
    expect(b.money).toBe(sellValue(CATALOG.defs[T('counter')]!));
    expect(inv[T('radio')]).toBe(radios + 1);
    expect(inv[T('counter')]).toBe(4); // sold, not returned
    expect(b.undo().ok).toBe(true);
    expect(b.money).toBe(0);
  });

  it('undoing a sale needs the money still to be there (calm: nothing changes, no debt)', () => {
    const { b } = setup(0);
    const s = b.place(T('stool'), X, Y, 0, 0).index!;
    b.sell(s);
    b.money = 100; // spent elsewhere
    expect(b.undo()).toEqual({ ok: false, reason: 'build.err.noMoney' });
    expect(b.money).toBe(100);
    expect(b.canUndo).toBe(true);
  });

  it('recolour only on recolourable objects, within the ramps', () => {
    const { world, b } = setup();
    const stool = b.place(T('stool'), X, Y, 0, 0).index!;
    expect(b.recolour(stool, 3).ok).toBe(true);
    expect(world.objects.colour[stool]).toBe(3);
    expect(b.recolour(stool, 99).ok).toBe(true);
    expect(world.objects.colour[stool]).toBe(0);
    const clock = b.place(T('wall_clock'), SHOP.x0 + 2, SHOP.y0, 1, 0).index!;
    expect(b.recolour(clock, 2).reason).toBe('build.err.noRecolour');
  });

  it('a new command clears redo; history keeps the last 100', () => {
    const { b } = setup(0, 200);
    const s = b.place(T('stool'), X, Y, 0, 0).index!;
    b.undo();
    expect(b.canRedo).toBe(true);
    b.place(T('stool'), X, Y, 0, 0);
    expect(b.canRedo).toBe(false);
    for (let k = 0; k < HISTORY_MAX + 20; k++) b.recolour(b.place(T('stool'), X + (k % 2), Y + 1, 0, 0).index ?? s, k % 4);
    let undos = 0;
    while (b.undo().ok) undos++;
    expect(undos).toBe(HISTORY_MAX);
  });

  it('any random sequence fully undoes to the start and fully redoes to the end', () => {
    for (let seed = 1; seed <= 25; seed++) {
      const { world, b, inv } = setup(5000, 3);
      const rng = new Rng(seed);
      const start = { pic: picture(world), money: b.money, inv: Array.from(inv) };
      const live = (): number[] => {
        const out: number[] = [];
        for (let i = 1; i < world.objects.capacity; i++) if (world.objects.live[i]) out.push(i);
        return out;
      };
      for (let step = 0; step < 60; step++) {
        const objs = live();
        const pick = objs.length ? objs[rng.int(objs.length)]! : 0;
        const x = SHOP.x0 + rng.int(SHOP.x1 - SHOP.x0);
        const y = SHOP.y0 + rng.int(SHOP.y1 - SHOP.y0 + 2);
        switch (objs.length ? rng.int(6) : 0) {
          case 0: b.place(rng.int(CATALOG.defs.length), x, y, rng.int(4), rng.int(8)); break;
          case 1: b.move(pick, x, y, rng.int(4)); break;
          case 2: b.rotate(pick, rng.int(4)); break;
          case 3: b.recolour(pick, rng.int(8)); break;
          case 4: b.pickup(pick); break;
          case 5: b.sell(pick); break;
        }
      }
      const end = { pic: picture(world), money: b.money, inv: Array.from(inv) };
      while (b.undo().ok);
      expect({ pic: picture(world), money: b.money, inv: Array.from(inv) }, `seed ${seed} undo`).toEqual(start);
      while (b.redo().ok);
      expect({ pic: picture(world), money: b.money, inv: Array.from(inv) }, `seed ${seed} redo`).toEqual(end);
    }
  });
});
