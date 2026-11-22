import { describe, expect, it } from 'vitest';
import { CATALOG } from '../src/shared/catalog';
import { FrameWriter, readFrame } from '../src/shared/diff';
import { LEVEL, PROP } from '../src/shared/layout';
import { falloff, PropertyGrids } from '../src/sim/grids/property-grids';
import { SimWorld } from '../src/sim/world';
import { Builder } from '../src/sim/build/builder';
import { Rng } from '../src/shared/rng';
import { createM1Area, SHOP, PAVEMENT } from '../src/sim/area';

/** A pavement tile in front of the shop (open sky). */
const FRONTAGE = { x0: SHOP.x0, y0: PAVEMENT.y0 };
import { WorldView } from '../src/game/view';

const T = (key: string) => CATALOG.byKey.get(key)!.id;
const X = SHOP.x0 + 5;
const Y = SHOP.y0 + 5;

function setup() {
  const world = new SimWorld(createM1Area());
  const b = new Builder(world, 0, new Uint16Array(CATALOG.defs.length).fill(50));
  const W = world.state.area.w;
  const at = (p: number, x: number, y: number) => world.grids.value[p]![y * W + x]!;
  return { world, b, at, W };
}

describe('falloff', () => {
  it('full on the footprint, fading linearly, zero past the radius', () => {
    expect(falloff(64, 3, 0)).toBe(64);
    expect(falloff(64, 3, 1)).toBe(48);
    expect(falloff(64, 3, 3)).toBe(16);
    expect(falloff(64, 3, 3.2)).toBe(0);
    expect(falloff(-48, 1, 0)).toBe(-48);
  });
});

describe('PropertyGrids', () => {
  it('area base: roofed shop tiles have cover and shade; open tiles have daylight', () => {
    const { at } = setup();
    const base = CATALOG.base;
    expect(at(PROP.cover, X, Y)).toBe(base.roof[PROP.cover]! * LEVEL);
    expect(at(PROP.light, X, Y)).toBe(base.roof[PROP.light]! * LEVEL);
    expect(at(PROP.light, FRONTAGE.x0, FRONTAGE.y0)).toBe(base.open[PROP.light]! * LEVEL);
    expect(at(PROP.cover, FRONTAGE.x0, FRONTAGE.y0)).toBe(0);
  });

  it('a lamp lights its tile fully and fades out to its radius', () => {
    const { b, at } = setup();
    const before = at(PROP.light, X, Y);
    b.place(T('hanging_lamp'), X, Y, 0, 0);
    expect(at(PROP.light, X, Y) - before).toBe(4 * LEVEL);
    expect(at(PROP.light, X + 2, Y) - before).toBe(falloff(4 * LEVEL, 3, 2));
    expect(at(PROP.light, X + 4, Y) - before).toBe(0);
  });

  it('negative contributions clamp at 0 but removing restores exactly (accum keeps the true sum)', () => {
    const { b, world, at } = setup();
    const noise0 = at(PROP.noise, X, Y);
    const plants: number[] = [];
    for (let k = 0; k < 3; k++) plants.push(b.place(T('pot_plant'), X + k, Y, 0, 0).index!);
    expect(at(PROP.noise, X + 1, Y)).toBe(0);
    expect(world.grids.accum[PROP.noise]![Y * world.state.area.w + X + 1]).toBeLessThan(0);
    const radio = b.place(T('radio'), X + 1, Y + 1, 0, 0).index!;
    for (const p of plants) b.pickup(p);
    b.pickup(radio);
    expect(at(PROP.noise, X, Y)).toBe(noise0);
  });

  it('any build sequence fully undone leaves every grid exactly at the area base', () => {
    const { world, b } = setup();
    const base = new PropertyGrids(createM1Area());
    const rng = new Rng(7);
    for (let k = 0; k < 80; k++) {
      const x = SHOP.x0 + rng.int(12);
      const y = SHOP.y0 + rng.int(13);
      const live: number[] = [];
      for (let i = 1; i < 300; i++) if (world.objects.live[i]) live.push(i);
      if (live.length && rng.chance(0.4)) b.move(live[rng.int(live.length)]!, x, y, rng.int(4));
      else b.place(rng.int(CATALOG.defs.length), x, y, rng.int(4), 0);
    }
    while (b.undo().ok);
    for (let p = 0; p < 8; p++) expect(Array.from(world.grids.accum[p]!), `prop ${p}`).toEqual(Array.from(base.accum[p]!));
  });

  it('the dirty rect covers the object and its radius, and only changed properties are marked', () => {
    const { b, world } = setup();
    world.grids.clearDirty();
    b.place(T('hanging_lamp'), X, Y, 0, 0); // light r3, warmth r1
    const g = world.grids;
    expect([g.dx0, g.dy0, g.dx1, g.dy1]).toEqual([X - 3, Y - 3, X + 4, Y + 4]);
    expect(g.dirtyMask).toBe((1 << PROP.light) | (1 << PROP.warmth));
  });

  it('subscribed grids stream to the mirror: full on subscribe, then only dirty rects', () => {
    const { b, world } = setup();
    const view = new WorldView();
    const a = world.state.area;
    view.setArea(a.id, a.w, a.h);
    const send = () => {
      const w = new FrameWriter();
      w.begin(new ArrayBuffer(256), 0, 0);
      world.writeChanges(w);
      const len = w.length;
      readFrame(w.finish(), view);
      return len;
    };
    world.subscribe(1 << PROP.light);
    const full = send();
    expect(full).toBeGreaterThan(a.w * a.h);
    b.place(T('hanging_lamp'), X, Y, 0, 0);
    const patch = send();
    expect(patch).toBeLessThan(200);
    expect(Array.from(view.grids[PROP.light]!)).toEqual(Array.from(world.grids.value[PROP.light]!));
    expect(view.grids[PROP.noise]!.every((v) => v === 0)).toBe(true); // not subscribed
  });
});
