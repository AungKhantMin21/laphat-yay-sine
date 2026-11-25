// M4 S5: the property market — daily states from (seed, day), listings that always end and come
// back, the east lot listed on day 3, houses changing hands (a resident moves away, a newcomer moves
// in), news, and save v5 (round trip, and v4 → v5 keeps everything).
import { describe, expect, it } from 'vitest';
import raw from '../src/data/properties.json';
import { Game } from '../src/sim/game';
import { NEIGHBOURHOOD } from '../src/shared/neighbourhood';
import { LISTING, PROPERTIES, PS, buildProperties, type RawProperties } from '../src/shared/properties';
import { NEWS, PropertyMarket } from '../src/sim/world/property-market';
import { emptyWorld, parse, serialize } from '../src/sim/save/format';

const noHooks = { houseSold: () => null };

describe('property data', () => {
  it('validates buildings, kinds and the spaces that join the shop', () => {
    const bad = (f: (d: RawProperties) => void) => () => {
      const d = JSON.parse(JSON.stringify(raw)) as RawProperties;
      f(d);
      buildProperties(d);
    };
    expect(bad((d) => (d.properties[2]!.building = 99))).toThrow(/unknown building/);
    expect(bad((d) => (d.properties[3]!.building = d.properties[2]!.building))).toThrow(/already a property/);
    expect(bad((d) => (d.properties[2]!.kind = 'castle'))).toThrow(/unknown kind/);
    expect(bad((d) => (d.properties[0]!.expand!.rect = [50, 12, 55, 19]))).toThrow(/join the shop/);
  });

  it('the four neighbourhood shops are never properties (they never close)', () => {
    const shopTiles = new Set<string>();
    for (const s of NEIGHBOURHOOD.shops) for (let p = s.from; p < s.to; p++) shopTiles.add(`${s.edge}${s.at}:${p}`);
    for (const def of PROPERTIES.defs) {
      const b = NEIGHBOURHOOD.buildings[def.building]!;
      for (let p = b.from; p < b.to; p++) expect(shopTiles.has(`${b.edge}${b.at}:${p}`)).toBe(false);
    }
  });
});

describe('the daily roll', () => {
  it('is deterministic for a seed, and the east lot lists on day 3', () => {
    const run = (): string => {
      const m = new PropertyMarket(9, () => '');
      for (let d = 1; d <= 60; d++) m.rollDay(d, noHooks);
      return JSON.stringify([m.props, m.news]);
    };
    expect(run()).toBe(run());
    const m = new PropertyMarket(9, () => '');
    const east = PROPERTIES.byKey.get('east_lot')!;
    m.rollDay(1, noHooks);
    m.rollDay(2, noHooks);
    expect(m.props[east.id]!.state).toBe(PS.notSelling);
    m.rollDay(3, noHooks);
    expect(m.props[east.id]!.state).toBe(PS.listed);
    expect(m.props[east.id]!.listing).toBe(LISTING.both);
    expect(m.news.at(-1)).toMatchObject({ kind: NEWS.listed, prop: 'east_lot', day: 3 });
    // A day is rolled once.
    const before = JSON.stringify(m.props);
    m.rollDay(3, noHooks);
    expect(JSON.stringify(m.props)).toBe(before);
  });

  it('over a year every listing ends (sold or withdrawn), the street keeps moving, and the lots come back', () => {
    const m = new PropertyMarket(4, () => '');
    const listedDays = new Map<string, number>();
    let longest = 0;
    let listings = 0;
    const lotListings = new Map<string, number>();
    for (let d = 1; d <= 365; d++) {
      m.rollDay(d, noHooks);
      PROPERTIES.defs.forEach((def, i) => {
        const p = m.props[i]!;
        if (p.state === PS.listed) {
          if (!listedDays.has(def.key)) {
            listings++;
            if (def.expand) lotListings.set(def.key, (lotListings.get(def.key) ?? 0) + 1);
          }
          listedDays.set(def.key, (listedDays.get(def.key) ?? 0) + 1);
          longest = Math.max(longest, listedDays.get(def.key)!);
        } else listedDays.delete(def.key);
        expect(p.price).toBeGreaterThanOrEqual(0);
      });
    }
    expect(longest).toBeLessThanOrEqual(PROPERTIES.rules.expiry[1] + 1);
    expect(listings).toBeGreaterThan(8);
    expect(lotListings.get('east_lot')!).toBeGreaterThanOrEqual(3);
    expect(lotListings.get('west_hall')!).toBeGreaterThanOrEqual(1);
    expect(m.news.length).toBeGreaterThan(0);
  });
});

describe('houses changing hands', () => {
  it('a sold house: its owner moves away and a newcomer moves in behind the same door', () => {
    const g = Game.create(12);
    let moved: { a: string; b: string; prop: string } | undefined;
    for (let d = 1; d <= 3000 && !moved; d++) {
      g.worldDay(d);
      moved = g.properties.news.find((n) => n.kind === NEWS.moved);
    }
    expect(moved).toBeDefined();
    const res = g.residents;
    expect(res.slotOf(moved!.a)).toBe(-1);
    const r = res.slotOf(moved!.b);
    expect(r).toBeGreaterThanOrEqual(0);
    expect(res.doorOf(r)).toBe(PROPERTIES.byKey.get(moved!.prop)!.door);
    expect(g.spares).toContain(moved!.a);
    expect(g.properties.props[PROPERTIES.byKey.get(moved!.prop)!.id]!.owner).toBe(moved!.b);
  });
});

describe('save v5', () => {
  it('properties, news and residents survive a round trip', () => {
    const g = Game.create(13);
    for (let d = 1; d <= 120; d++) g.worldDay(d);
    g.residents.visits[3] = 17;
    const data = g.toSave(0);
    expect(data.world.props.length).toBe(PROPERTIES.defs.length);
    const back = parse(serialize(data));
    expect(back.world.props).toEqual(data.world.props.map((p) => ({ ...p, fortune: Math.round(p.fortune * 255) / 255 })));
    const { game } = Game.fromSave(back);
    const again = game.toSave(0);
    expect(again.world.news).toEqual(data.world.news);
    expect(again.world.residents).toEqual(data.world.residents);
    expect(again.world.rolledDay).toBe(120);
    expect(game.properties.buildingFlags()).toEqual(g.properties.buildingFlags());
  });

  it('a v4 save upgrades to a new living world and keeps everything else', () => {
    const g = Game.create(14);
    const data = g.toSave(0);
    data.world = emptyWorld();
    const v5 = serialize(data);
    const v4 = v5.slice(0, v5.byteLength - 11);
    new DataView(v4).setUint16(4, 4, true);
    const back = parse(v4);
    expect(back.schema).toBe(5);
    expect(back.world).toEqual(emptyWorld());
    expect({ ...back, world: null }).toEqual({ ...data, world: null });
    const { game } = Game.fromSave(back);
    expect(game.residents.slotOf('daw_mya')).toBeGreaterThanOrEqual(0);
    game.worldDay(3);
    expect(game.properties.props[PROPERTIES.byKey.get('east_lot')!.id]!.state).toBe(PS.listed);
  });
});
