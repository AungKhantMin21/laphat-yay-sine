// Drink presets and pour scoring, from src/data/drinks.json. Pure: the worker scores the pour
// (authority) and the pour minigame uses the same functions for its live hint.
//
// M2 pour model: the player pours tea, then condensed milk, as fractions of the cup (tea + milk ≤ 1).
// A preset targets a milk share of the drink; the cup should also be about full. M5 adds more
// ingredients and the sweet/strong/creamy taste axes.
import raw from '../data/drinks.json';
import { SHOP, toCoins, type ShopRules } from './shop';

export interface DrinkDef {
  id: number;
  key: string;
  /** i18n key for the display name. */
  name: string;
  /** Kyat for a poured cup (before tip). */
  price: number;
  /** Target condensed-milk share of the drink, 0…1. */
  milk: number;
}

export interface PourRules {
  /** Ideal fill level of the cup. */
  fillTarget: number;
  /** Fill this close below the target still counts as full. */
  fillSlack: number;
  /** Below the slack, the fill score falls to 0 over this much. */
  fillFalloff: number;
  /** Milk share this close to the target counts as perfect. */
  ratioSlack: number;
  /** Beyond the slack, the ratio score falls to 0 over this much. */
  ratioFalloff: number;
}

/** Pour speed while holding, in cup fractions per real second. */
export interface PourFlow {
  tea: number;
  milk: number;
}

export interface Drinks {
  defs: DrinkDef[];
  byKey: Map<string, DrinkDef>;
  pour: PourRules;
  flow: PourFlow;
  /** Score thresholds for the customer's reaction. */
  reactions: { great: number; good: number };
}

export interface RawDrinks {
  pour: PourRules;
  flow: PourFlow;
  reactions: { great: number; good: number };
  presets: { key: string; price: number; milk: number }[];
}

const frac = (v: number, where: string): number => {
  if (!(v >= 0 && v <= 1)) throw new Error(`${where}: must be 0…1`);
  return v;
};

export function buildDrinks(d: RawDrinks): Drinks {
  const p = d.pour;
  const pour: PourRules = {
    fillTarget: frac(p.fillTarget, 'pour.fillTarget'),
    fillSlack: frac(p.fillSlack, 'pour.fillSlack'),
    fillFalloff: frac(p.fillFalloff, 'pour.fillFalloff'),
    ratioSlack: frac(p.ratioSlack, 'pour.ratioSlack'),
    ratioFalloff: frac(p.ratioFalloff, 'pour.ratioFalloff'),
  };
  if (pour.fillFalloff <= 0 || pour.ratioFalloff <= 0) throw new Error('pour: falloffs must be > 0');
  const flowOk = (v: number, where: string): number => {
    if (!(v > 0 && v <= 5)) throw new Error(`${where}: must be > 0 and ≤ 5 (cups per second)`);
    return v;
  };
  const flow: PourFlow = { tea: flowOk(d.flow.tea, 'flow.tea'), milk: flowOk(d.flow.milk, 'flow.milk') };
  const reactions = { great: frac(d.reactions.great, 'reactions.great'), good: frac(d.reactions.good, 'reactions.good') };
  if (reactions.good >= reactions.great) throw new Error('reactions: good must be below great');
  if (d.presets.length === 0 || d.presets.length > 255) throw new Error('presets: need 1…255');
  const defs: DrinkDef[] = [];
  const byKey = new Map<string, DrinkDef>();
  d.presets.forEach((r, id) => {
    const at = `drink "${r.key}"`;
    if (!/^[a-z0-9_]+$/.test(r.key)) throw new Error(`${at}: key must be lower_snake_case`);
    if (byKey.has(r.key)) throw new Error(`${at}: duplicate key`);
    if (!(Number.isInteger(r.price) && r.price > 0)) throw new Error(`${at}: price must be a whole number > 0`);
    const def: DrinkDef = { id, key: r.key, name: `drink.${r.key}`, price: r.price, milk: frac(r.milk, `${at} milk`) };
    defs.push(def);
    byKey.set(r.key, def);
  });
  return { defs, byKey, pour, flow, reactions };
}

export const DRINKS: Drinks = buildDrinks(raw as RawDrinks);

/** 1 inside the slack, then a straight line down to 0 over the falloff. */
function soft(err: number, slack: number, falloff: number): number {
  const over = err - slack;
  return over <= 0 ? 1 : Math.max(0, 1 - over / falloff);
}

/**
 * How well a pour matches a drink, 0…1. `tea` and `milk` are cup fractions (clamped so the cup
 * holds at most 1). `shift` moves the target milk share for a customer's own taste (±).
 */
export function pourScore(drink: DrinkDef, tea: number, milk: number, shift = 0, rules: PourRules = DRINKS.pour): number {
  const t = Math.max(0, tea);
  const m = Math.max(0, milk);
  const fill = Math.min(1, t + m);
  if (fill <= 0) return 0;
  const target = Math.min(1, Math.max(0, drink.milk + shift));
  const ratioErr = Math.abs(m / (t + m) - target);
  const fillErr = Math.max(0, rules.fillTarget - fill);
  return soft(ratioErr, rules.ratioSlack, rules.ratioFalloff) * soft(fillErr, rules.fillSlack, rules.fillFalloff);
}

/** A poured cup always pays its full price; the score only adds a tip. */
export function pouredPrice(drink: DrinkDef): number {
  return drink.price;
}

/**
 * Tip multiplier for a wait of `waitMin` game minutes (= real seconds) between asking to order and
 * getting the cup: `waitBonus` when fast, falling linearly to 0 when slow. Never below 0.
 */
export function waitFactor(waitMin: number, rules: ShopRules = SHOP): number {
  const { waitFast, waitSlow, waitBonus } = rules.pay;
  if (waitMin <= waitFast) return waitBonus;
  if (waitMin >= waitSlow) return 0;
  return (waitBonus * (waitSlow - waitMin)) / (waitSlow - waitFast);
}

/**
 * Tip for a cup: 0 below `tipFrom`, rising to `tipMax` × price at a perfect pour, times the wait
 * factor (fast service raises it, a long wait lowers it to nothing; the price is always paid).
 */
export function tipFor(drink: DrinkDef, score: number, waitMin = 0, rules: ShopRules = SHOP): number {
  const { tipFrom, tipMax } = rules.pay;
  if (score < tipFrom || tipFrom >= 1) return 0;
  const k = (Math.min(1, score) - tipFrom) / (1 - tipFrom);
  return toCoins(drink.price * tipMax * k * waitFactor(waitMin, rules), rules);
}

/** Customer reaction on the wire (i18n keys `react.<name>`). */
export const REACTION = { great: 0, good: 1, ok: 2 } as const;
export type Reaction = (typeof REACTION)[keyof typeof REACTION];
export const REACTION_NAMES = ['great', 'good', 'ok'] as const;

export function reactionFor(score: number, drinks: Drinks = DRINKS): Reaction {
  if (score >= drinks.reactions.great) return REACTION.great;
  if (score >= drinks.reactions.good) return REACTION.good;
  return REACTION.ok;
}
