import { describe, expect, it, vi } from 'vitest';
import rawTeasers from '../src/data/teasers.json';
import my from '../src/ui/i18n/my.json';
import { DRINKS } from '../src/shared/drinks';
import { FrameWriter } from '../src/shared/diff';
import { MINUTES_PER_DAY } from '../src/shared/layout';
import { emptyDayStats, TICK_HZ, type DayStats } from '../src/shared/protocol';
import { SHOP } from '../src/shared/shop';
import { TEASERS, buildTeasers, pickTeaser, teaserAppeal, teaserGuest, teaserRate, type RawTeasers } from '../src/shared/teasers';
import { Game } from '../src/sim/game';

const names = my as Record<string, string>;
const stats = (s: Partial<DayStats>): DayStats => ({ ...emptyDayStats(), ...s });
const writer = new FrameWriter();
function runTo(g: Game, minute: number): void {
  for (let i = 0; i < MINUTES_PER_DAY * TICK_HZ && g.sim.gameMinute < minute; i++) {
    writer.begin(new ArrayBuffer(8192), g.sim.tick, g.sim.gameMinute);
    g.step(writer);
  }
}

describe('teaser data', () => {
  it('every kind has a Myanmar line and a real effect', () => {
    for (const t of TEASERS) {
      expect(names[`teaser.${t.key}`], t.key).toBeTruthy();
      expect(t.boost !== null || t.appeal > 0 || t.guest !== null, t.key).toBe(true);
    }
  });

  it('rejects kinds without an effect and sets without an unconditional kind', () => {
    const bad = (patch: (d: RawTeasers) => void) => {
      const d = JSON.parse(JSON.stringify(rawTeasers)) as RawTeasers;
      patch(d);
      return () => buildTeasers(d);
    };
    expect(bad((d) => (d.kinds[0] = { key: 'empty', weight: 1 }))).toThrow(/effect/);
    expect(bad((d) => (d.kinds = d.kinds.filter((k) => k.need && Object.keys(k.need).length > 0)))).toThrow(/no condition/);
    expect(bad((d) => (d.kinds[1]!.key = d.kinds[0]!.key))).toThrow(/unique/);
    expect(bad((d) => (d.kinds[0]!.guest = { after: 0 }))).toThrow(/guest/);
  });
});

describe('picking a teaser', () => {
  it('a quiet day still gets one: only unconditional kinds are eligible', () => {
    const free = TEASERS.filter((t) => !t.need.served && !t.need.poured && !t.need.best).map((t) => t.key);
    for (let u = 0; u < 1; u += 0.05) expect(free).toContain(pickTeaser(stats({}), u, 0.5).key);
  });

  it('a good day can pick every kind, weighted, and guests get a drink', () => {
    const seen = new Map<string, number>();
    const good = stats({ served: 50, poured: 30, best: 100 });
    for (let k = 0; k < 1000; k++) {
      const p = pickTeaser(good, k / 1000, (k * 7919 % 1000) / 1000);
      seen.set(p.key, (seen.get(p.key) ?? 0) + 1);
      const def = TEASERS.find((t) => t.key === p.key)!;
      expect(p.arg === '' ? null : DRINKS.byKey.get(p.arg)?.key).toBe(def.guest ? p.arg : null);
    }
    const total = TEASERS.reduce((a, t) => a + t.weight, 0);
    for (const t of TEASERS) expect(seen.get(t.key)! / 1000, t.key).toBeCloseTo(t.weight / total, 1);
    expect(pickTeaser(good, 0.999999999, 0.999999999).key).toBe(TEASERS[TEASERS.length - 1]!.key);
  });
});

describe('teaser effects the next day', () => {
  const guestKind = TEASERS.find((t) => t.guest)!;
  const boostKind = TEASERS.find((t) => t.boost)!;
  const appealKind = TEASERS.find((t) => t.appeal > 0)!;

  it('effects are read from the active teaser only', () => {
    expect(teaserRate({ key: boostKind.key, arg: '' }, boostKind.boost!.from)).toBe(boostKind.boost!.perHour);
    expect(teaserRate({ key: boostKind.key, arg: '' }, boostKind.boost!.to)).toBe(0);
    expect(teaserAppeal({ key: appealKind.key, arg: '' })).toBe(appealKind.appeal);
    expect(teaserRate({ key: '', arg: '' }, 400)).toBe(0);
    expect(teaserAppeal({ key: 'gone_kind', arg: '' })).toBe(0);
    expect(teaserGuest({ key: '', arg: '' }, SHOP.open + 1, SHOP.open)).toBe(-1);
  });

  it('a promised guest arrives on time and orders the promised drink', () => {
    const g = Game.create(5);
    const drink = DRINKS.defs[DRINKS.defs.length - 1]!;
    g.day.teaser = { key: guestKind.key, arg: drink.key };
    const spawn = vi.spyOn(g.npcs, 'spawn');
    g.act({ k: 'openShop' });
    runTo(g, SHOP.open + guestKind.guest!.after + 1);
    expect(spawn).toHaveBeenCalledWith(drink.id);
    expect(spawn.mock.calls.filter((c) => c[0] === drink.id)).toHaveLength(1);
  });

  it('a "friends" morning brings more customers than the same morning without it', () => {
    const arrivals = (key: string) => {
      let n = 0;
      for (let seed = 1; seed <= 8; seed++) n += arrivalsFor(key, seed);
      return n;
    };
    const arrivalsFor = (key: string, seed: number) => {
      const g = Game.create(seed);
      g.day.teaser = { key, arg: '' };
      const spawn = vi.spyOn(g.npcs, 'spawn');
      g.act({ k: 'openShop' });
      runTo(g, boostKind.boost!.to);
      return spawn.mock.calls.length;
    };
    // An empty shop has the minimum appeal; expect at least half the promised extra customers.
    const b = boostKind.boost!;
    const promised = 8 * b.perHour * ((b.to - b.from) / 60) * SHOP.arrivals.appeal.min;
    expect(arrivals(boostKind.key)).toBeGreaterThan(arrivals('') + promised / 2);
  });

  it('sleeping picks the next teaser deterministically from the seed', () => {
    const night = () => {
      const g = Game.create(21);
      g.act({ k: 'openShop' });
      runTo(g, SHOP.close);
      g.act({ k: 'sleep' });
      return g.day.teaser;
    };
    expect(night()).toEqual(night());
  });
});
