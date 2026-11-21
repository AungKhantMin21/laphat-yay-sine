import { describe, expect, it } from 'vitest';
import { DRINKS, REACTION, REACTION_NAMES, autoPrice, buildDrinks, pourScore, pouredPrice, reactionFor, tipFor, type RawDrinks } from '../src/shared/drinks';
import { SHOP, buildShopRules, parseClock, toCoins } from '../src/shared/shop';
import rawDrinks from '../src/data/drinks.json';
import my from '../src/ui/i18n/my.json';

const names = my as Record<string, string>;
const drink = (key: string) => DRINKS.byKey.get(key)!;
/** Pours a full-to-target cup with the given milk share. */
const pourAt = (share: number, fill = DRINKS.pour.fillTarget) => [fill * (1 - share), fill * share] as const;

describe('drink data', () => {
  it('loads the four classic presets with Myanmar names', () => {
    for (const key of ['pon_man', 'cho_seint', 'kya_seint', 'plain']) expect(DRINKS.byKey.has(key), key).toBe(true);
    for (const d of DRINKS.defs) expect(names[d.name], d.name).toBeTruthy();
  });

  it('every reaction has a Myanmar line', () => {
    for (const r of REACTION_NAMES) expect(names[`react.${r}`], r).toBeTruthy();
  });

  it('presets are told apart by milk share: no two overlap within the perfect slack', () => {
    const milk = DRINKS.defs.map((d) => d.milk).sort((a, b) => a - b);
    for (let i = 1; i < milk.length; i++) expect(milk[i]! - milk[i - 1]!).toBeGreaterThan(2 * DRINKS.pour.ratioSlack);
  });

  it('rejects bad data', () => {
    const bad = (patch: (d: RawDrinks) => void) => {
      const d = structuredClone(rawDrinks) as RawDrinks;
      patch(d);
      return () => buildDrinks(d);
    };
    expect(bad((d) => (d.presets[1]!.key = d.presets[0]!.key))).toThrow(/duplicate/);
    expect(bad((d) => (d.presets[0]!.milk = 1.5))).toThrow(/0…1/);
    expect(bad((d) => (d.presets[0]!.price = 0))).toThrow(/price/);
    expect(bad((d) => (d.reactions.good = d.reactions.great))).toThrow(/good/);
    expect(bad((d) => (d.pour.ratioFalloff = 0))).toThrow(/falloff/);
  });
});

describe('pour score', () => {
  it('a pour at the preset target scores 1', () => {
    for (const d of DRINKS.defs) {
      const [t, m] = pourAt(d.milk);
      expect(pourScore(d, t, m), d.key).toBeCloseTo(1, 9);
    }
  });

  it('an empty cup scores 0; overfilling is clamped, not punished', () => {
    const d = drink('pon_man');
    expect(pourScore(d, 0, 0)).toBe(0);
    const [t, m] = pourAt(d.milk, 1.4);
    expect(pourScore(d, t, m)).toBeCloseTo(1, 9);
  });

  it('falls off smoothly with milk share error, reaching 0 far away', () => {
    const d = drink('pon_man');
    let prev = 1;
    for (let err = 0; err <= 0.5; err += 0.05) {
      const s = pourScore(d, ...pourAt(Math.min(1, d.milk + err)));
      expect(s).toBeLessThanOrEqual(prev + 1e-12);
      prev = s;
    }
    expect(pourScore(d, ...pourAt(1))).toBe(0);
  });

  it('a half-full cup scores lower than a full one', () => {
    const d = drink('cho_seint');
    expect(pourScore(d, ...pourAt(d.milk, 0.45))).toBeLessThan(pourScore(d, ...pourAt(d.milk)));
  });

  it('plain tea wants no milk at all', () => {
    const d = drink('plain');
    expect(pourScore(d, 0.9, 0)).toBe(1);
    expect(pourScore(d, 0.6, 0.3)).toBeLessThan(0.5);
  });

  it('a customer taste shift moves the perfect point', () => {
    const d = drink('pon_man');
    const sweeter = pourAt(d.milk + 0.15);
    expect(pourScore(d, ...sweeter, 0.15)).toBeCloseTo(1, 9);
    expect(pourScore(d, ...sweeter, 0)).toBeLessThan(1);
  });

  it('negative inputs are treated as nothing poured', () => {
    expect(pourScore(drink('plain'), 0.9, -0.2)).toBe(1);
  });
});

describe('payment', () => {
  it('a poured cup always pays its full price', () => {
    for (const d of DRINKS.defs) expect(pouredPrice(d)).toBe(d.price);
  });

  it('tips: none below tipFrom, the most at a perfect pour, whole coins, never decreasing', () => {
    const d = drink('cho_seint');
    expect(tipFor(d, SHOP.pay.tipFrom - 0.01)).toBe(0);
    expect(tipFor(d, 1)).toBe(toCoins(d.price * SHOP.pay.tipMax));
    let prev = 0;
    for (let s = 0; s <= 1.0001; s += 0.01) {
      const tip = tipFor(d, s);
      expect(tip % SHOP.pay.coin).toBe(0);
      expect(tip).toBeGreaterThanOrEqual(prev);
      prev = tip;
    }
  });

  it('auto-serve pays less than a poured cup, but still pays', () => {
    for (const d of DRINKS.defs) {
      expect(autoPrice(d)).toBeGreaterThan(0);
      expect(autoPrice(d)).toBeLessThan(pouredPrice(d));
      expect(autoPrice(d) % SHOP.pay.coin).toBe(0);
    }
  });

  it('reactions follow the score thresholds', () => {
    expect(reactionFor(1)).toBe(REACTION.great);
    expect(reactionFor(DRINKS.reactions.good)).toBe(REACTION.good);
    expect(reactionFor(0)).toBe(REACTION.ok);
  });
});

describe('shop rules', () => {
  it('parses clock times and rejects nonsense', () => {
    expect(parseClock('06:00', 'x')).toBe(360);
    expect(parseClock('17:30', 'x')).toBe(1050);
    expect(() => parseClock('6:00', 'x')).toThrow();
    expect(() => parseClock('24:00', 'x')).toThrow();
  });

  it('rejects closing before opening and fractional coins', () => {
    const pay = { coin: 50, tipFrom: 0.5, tipMax: 0.3, autoFactor: 0.7 };
    expect(() => buildShopRules({ hours: { open: '17:00', close: '06:00' }, pay })).toThrow(/before close/);
    expect(() => buildShopRules({ hours: { open: '06:00', close: '17:00' }, pay: { ...pay, coin: 0.5 } })).toThrow(/coin/);
  });
});
