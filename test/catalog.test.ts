import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { CATALOG, LAYER, buildCatalog, footH, footW, sellValue, spriteFrame } from '../src/shared/catalog';
import start from '../src/data/start.json';
import my from '../src/ui/i18n/my.json';
import raw from '../src/data/objects.json';

const palette = new Set(
  readFileSync('art/palette.hex', 'utf8')
    .split('\n')
    .filter((l) => /^[0-9a-f]{6}$/i.test(l.trim()))
    .map((l) => parseInt(l, 16)),
);

describe('catalog data', () => {
  it('loads and validates objects.json', () => {
    expect(CATALOG.defs.length).toBeGreaterThan(10);
    expect(CATALOG.byKey.get('table')?.surface).toBeGreaterThan(0);
  });

  it('every recolour ramp uses palette colours only', () => {
    for (const ramp of CATALOG.ramps) for (const c of ramp) expect(palette.has(c)).toBe(true);
  });

  it('start.json only names real objects', () => {
    for (const key of Object.keys(start.inventory)) expect(CATALOG.byKey.has(key)).toBe(true);
  });

  it('every object has a Myanmar name', () => {
    for (const d of CATALOG.defs) expect((my as Record<string, string>)[d.name], d.name).toBeTruthy();
  });

  it('rotation swaps the footprint on odd turns; sprites wrap by distinct orientations', () => {
    const bench = CATALOG.byKey.get('bench')!;
    expect([footW(bench, 0), footH(bench, 0)]).toEqual([2, 1]);
    expect([footW(bench, 1), footH(bench, 1)]).toEqual([1, 2]);
    expect(spriteFrame(bench, 3)).toBe('obj/bench_r1');
    expect(spriteFrame(CATALOG.byKey.get('stool')!, 2)).toBe('obj/stool_r0');
  });

  it('sells back at 70%, rounded down', () => {
    expect(sellValue(CATALOG.byKey.get('teapot')!)).toBe(1750);
  });
});

describe('catalog validation', () => {
  const base = raw as unknown as Parameters<typeof buildCatalog>[0];
  const withObj = (o: Record<string, unknown>) => ({ ...base, objects: [o as never] });
  const ok = { key: 'x', w: 1, h: 1, layer: 'furniture', price: 1, rots: 1 };

  it('accepts a minimal object', () => {
    expect(buildCatalog(withObj(ok)).defs[0]!.layer).toBe(LAYER.furniture);
  });
  it.each([
    [{ ...ok, layer: 'roof' }, 'unknown layer'],
    [{ ...ok, w: 4 }, 'footprint'],
    [{ ...ok, w: 3, h: 3 }, 'footprint'],
    [{ ...ok, rots: 3 }, 'rots'],
    [{ ...ok, price: -1 }, 'price'],
    [{ ...ok, props: { taste: [1, 1] } }, 'unknown property'],
    [{ ...ok, props: { light: [1, 9] } }, 'radius'],
    [{ ...ok, small: true, w: 2 }, 'small'],
    [{ ...ok, layer: 'wall', surface: 4 }, 'surface'],
    [{ ...ok, layer: 'ceiling', w: 2 }, 'wall and ceiling'],
  ])('rejects %j', (o, msg) => {
    expect(() => buildCatalog(withObj(o))).toThrow(msg);
  });
  it('rejects duplicate keys', () => {
    expect(() => buildCatalog({ ...base, objects: [ok, ok] as never })).toThrow('duplicate');
  });
});
