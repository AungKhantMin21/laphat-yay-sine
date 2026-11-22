import rawShop from '../src/data/shop.json';
import { describe, expect, it } from 'vitest';
import { DRINKS, REACTION, REACTION_NAMES, buildDrinks, pourScore, pouredPrice, reactionFor, tipFor, waitFactor, type DrinkDef, type RawDrinks } from '../src/shared/drinks';
import { SHOP, buildShopRules, parseClock, tinLevel, toCoins, type RawShop } from '../src/shared/shop';
import rawDrinks from '../src/data/drinks.json';
import my from '../src/ui/i18n/my.json';

const names = my as Record<string, string>;
const drink = (key: string) => DRINKS.byKey.get(key)!;
/** Pours a full-to-target cup with the given milk share. */
const pourAt = (share: number, fill = DRINKS.pour.fillTarget) => [fill * (1 - share), fill * share] as const;

/** A milk-free drink (none on the menu since 22 Nov 2026) still scores sensibly. */
const noMilk: DrinkDef = { id: 99, key: 'no_milk', name: 'drink.no_milk', price: 500, milk: 0 };

describe('drink data', () => {
  it('loads the four classic presets with Myanmar names', () => {
    for (const key of ['pon_man', 'cho_seint', 'kya_seint']) expect(DRINKS.byKey.has(key), key).toBe(true);
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
    expect(bad((d) => (d.flow.milk = 0))).toThrow(/flow\.milk/);
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

  it('a no-milk drink wants no milk at all', () => {
    const d = noMilk;
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
    expect(pourScore(noMilk, 0.9, -0.2)).toBe(1);
  });
});

describe('payment', () => {
  it('a poured cup always pays its full price', () => {
    for (const d of DRINKS.defs) expect(pouredPrice(d)).toBe(d.price);
  });

  it('tips: none below tipFrom, the most at a perfect pour, whole coins, never decreasing', () => {
    const d = drink('cho_seint');
    expect(tipFor(d, SHOP.pay.tipFrom - 0.01)).toBe(0);
    expect(tipFor(d, 1)).toBe(toCoins(d.price * SHOP.pay.tipMax * SHOP.pay.waitBonus)); // served at once
    let prev = 0;
    for (let s = 0; s <= 1.0001; s += 0.01) {
      const tip = tipFor(d, s);
      expect(tip % SHOP.pay.coin).toBe(0);
      expect(tip).toBeGreaterThanOrEqual(prev);
      prev = tip;
    }
  });

  it('waiting only lowers the tip: a bonus when fast, falling to nothing, never negative', () => {
    const { waitFast, waitSlow, waitBonus } = SHOP.pay;
    expect(waitFactor(0)).toBe(waitBonus);
    expect(waitFactor(waitFast)).toBe(waitBonus);
    expect(waitFactor(waitSlow)).toBe(0);
    expect(waitFactor(waitSlow * 10)).toBe(0);
    let prev = Infinity;
    for (let w = 0; w <= waitSlow + 10; w += 5) {
      const f = waitFactor(w);
      expect(f).toBeLessThanOrEqual(prev);
      expect(f).toBeGreaterThanOrEqual(0);
      prev = f;
    }
    const d = drink('kya_seint');
    expect(tipFor(d, 1, 0)).toBeGreaterThan(tipFor(d, 1, (waitFast + waitSlow) / 2));
    expect(tipFor(d, 1, waitSlow)).toBe(0);
    for (const dd of DRINKS.defs) expect(pouredPrice(dd)).toBe(dd.price); // the price never depends on the wait
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
    const base = rawShop as RawShop;
    const pay = base.pay;
    expect(() => buildShopRules({ ...base, hours: { open: '17:00', close: '06:00' } })).toThrow(/before close/);
    expect(() => buildShopRules({ ...base, pay: { ...pay, coin: 0.5 } })).toThrow(/coin/);
  });

  it('rejects tin sizes that do not increase', () => {
    const base = rawShop as RawShop;
    expect(() => buildShopRules({ ...base, tin: [] })).toThrow(/tin/);
    expect(() => buildShopRules({ ...base, tin: [100, 100] })).toThrow(/increase/);
    expect(() => buildShopRules({ ...base, tin: [0] })).toThrow(/tin\[0\]/);
  });
});

describe('savings tin', () => {
  const rules = buildShopRules({ ...(rawShop as RawShop), tin: [1000, 5000, 20000] });
  it('uses the smallest tin that holds the savings', () => {
    expect(tinLevel(0, rules)).toEqual({ size: 0, fill: 0 });
    expect(tinLevel(500, rules)).toEqual({ size: 0, fill: 0.5 });
    expect(tinLevel(1000, rules)).toEqual({ size: 0, fill: 1 });
    expect(tinLevel(1050, rules)).toEqual({ size: 1, fill: 0.21 });
    expect(tinLevel(20000, rules)).toEqual({ size: 2, fill: 1 });
  });

  it('stays full past the largest tin, and treats negative money as empty', () => {
    expect(tinLevel(1e9, rules)).toEqual({ size: 2, fill: 1 });
    expect(tinLevel(-5, rules)).toEqual({ size: 0, fill: 0 });
  });

  it('the start money sits in the first tin, part full', () => {
    const t = tinLevel(20000);
    expect(t.size).toBe(0);
    expect(t.fill).toBeGreaterThan(0);
    expect(t.fill).toBeLessThan(1);
    expect(SHOP.tin.length).toBeGreaterThan(1);
  });

  it('fills into a caller-owned object without allocating', () => {
    const out = { size: -1, fill: -1 };
    expect(tinLevel(2500, rules, out)).toBe(out);
    expect(out).toEqual({ size: 1, fill: 0.5 });
  });
});
