// M3 S5: ingredients. Reserved when an order is taken, used at brew, released if the customer goes
// before their cup is made; a customer whose drink can't be made picks one that can; with nothing
// makeable they get free plain tea and leave content. A zero-stock day still ends cleanly.
import { describe, expect, it } from 'vitest';
import raw from '../src/data/ingredients.json';
import { Game } from '../src/sim/game';
import { FrameWriter } from '../src/shared/diff';
import { PHASE } from '../src/shared/day';
import { DRINKS } from '../src/shared/drinks';
import { INGREDIENTS, buildIngredients, type RawIngredients } from '../src/shared/ingredients';
import { ORDER } from '../src/shared/npc';
import { TICK_HZ, type SimEvent } from '../src/shared/protocol';
import { Stock } from '../src/sim/service/stock';
import { TASK } from '../src/sim/service/task-board';
import { Bot } from './bot';

let buf = new ArrayBuffer(1 << 16);
const writer = new FrameWriter();
function step(g: Game, events?: SimEvent[]): void {
  writer.begin(buf, g.sim.tick, g.sim.gameMinute);
  g.step(writer);
  buf = writer.finish();
  if (events) events.push(...g.events.splice(0));
  else g.events.length = 0;
}
const ING = (key: string): number => INGREDIENTS.byKey.get(key)!.id;
const drink = (key: string) => DRINKS.byKey.get(key)!;
function empty(g: Game): void {
  for (let k = 0; k < g.service.stock.count.length; k++) g.service.stock.count[k] = 0;
}
/** A seated customer asking to order (fixed drink). */
function asking(g: Game, key: string): number {
  const h = g.npcs.spawn(drink(key).id);
  const i = g.npcs.indexOf(h);
  for (let k = 0; k < 3000 && g.npcs.order[i] !== ORDER.ask; k++) step(g);
  expect(g.npcs.order[i]).toBe(ORDER.ask);
  return h;
}

describe('ingredient data', () => {
  it('rejects bad packs and prices; every drink uses known ingredients', () => {
    const bad = (patch: (d: RawIngredients) => void) => () => {
      const d = JSON.parse(JSON.stringify(raw)) as RawIngredients;
      patch(d);
      buildIngredients(d);
    };
    expect(bad((d) => (d.ingredients[0]!.pack = 0))).toThrow(/pack/);
    expect(bad((d) => (d.ingredients[0]!.price = -1))).toThrow(/price/);
    expect(bad((d) => d.ingredients.push({ ...d.ingredients[0]! }))).toThrow(/duplicate/);
    for (const d of DRINKS.defs) expect(d.uses.some((n) => n > 0), d.key).toBe(true);
  });

  it('a new game starts with about two days of stock', () => {
    const g = Game.create(1);
    expect(g.service.stock.cupsLeft()).toBeGreaterThanOrEqual(60);
    expect(g.playerState().cupsLeft).toBe(g.service.stock.cupsLeft());
  });
});

describe('the stock', () => {
  it('never goes negative and cupsLeft follows the best-stocked drink', () => {
    const s = new Stock();
    s.add(ING('tea'), 3);
    s.add(ING('condensed'), 4);
    expect(s.canMake(drink('pon_man'))).toBe(false); // needs evaporated milk
    expect(s.canMake(drink('cho_seint'))).toBe(true);
    expect(s.cupsLeft()).toBe(2); // no evaporated milk for the usual mix; cho seint: min(tea 3, condensed 4 / 2)
    s.reserve(drink('cho_seint'));
    s.consume(drink('cho_seint'));
    s.consume(drink('cho_seint'));
    s.consume(drink('cho_seint'));
    for (let k = 0; k < s.count.length; k++) expect(s.count[k]).toBeGreaterThanOrEqual(0);
    s.add(ING('tea'), -99);
    expect(s.count[ING('tea')]).toBe(0);
  });
});

describe('ingredients in service', () => {
  it('taking an order reserves, brewing uses, a customer leaving before the brew releases', () => {
    const g = Game.create(2);
    g.act({ k: 'openShop' });
    const st = g.service.stock;
    const tea0 = st.count[ING('tea')]!;
    const h = asking(g, 'kya_seint');
    expect(g.service.takeOrder(h)).toBe('');
    expect(st.reserved[ING('tea')]).toBe(2);
    expect(g.playerState().stock[ING('tea')]).toBe(tea0 - 2);
    expect(g.service.brew(h, 0.9, true)).toBe('');
    expect(st.count[ING('tea')]).toBe(tea0 - 2);
    expect(st.reserved[ING('tea')]).toBe(0);
    // Another one orders, then goes before anyone brews: nothing is used.
    const h2 = asking(g, 'pon_man');
    g.service.takeOrder(h2);
    expect(st.reserved[ING('evaporated')]).toBe(1);
    g.npcs.clear();
    expect(st.reserved[ING('evaporated')]).toBe(0);
    expect(st.count[ING('tea')]).toBe(tea0 - 2);
  });

  it("a drink that can't be made is swapped for one that can", () => {
    const g = Game.create(3);
    g.act({ k: 'openShop' });
    g.service.stock.count[ING('evaporated')] = 0; // no pon man
    const h = asking(g, 'pon_man');
    expect(g.service.takeOrder(h)).toBe('');
    const i = g.npcs.indexOf(h);
    expect(DRINKS.defs[g.npcs.drink[i]!]!.key).not.toBe('pon_man');
    expect(g.service.board.find(TASK.brew, h)).not.toBe(0);
  });

  it('with nothing makeable the customer gets free plain tea, pays nothing and leaves content', () => {
    const g = Game.create(4);
    g.act({ k: 'openShop' });
    empty(g);
    const money = g.builder.money;
    const events: SimEvent[] = [];
    const h = asking(g, 'cho_seint');
    expect(g.service.takeOrder(h)).toBe('');
    step(g, events);
    expect(events).toContainEqual({ k: 'freeTea', id: h });
    expect(g.npcs.order[g.npcs.indexOf(h)]).toBe(ORDER.served);
    expect(g.service.board.find(TASK.brew, h)).toBe(0);
    for (let k = 0; k < 3000 && g.npcs.indexOf(h); k++) step(g);
    expect(g.npcs.indexOf(h)).toBe(0); // drank it and went home
    expect(g.builder.money).toBe(money);
  });

  it('a whole day on an empty shelf still ends cleanly, and the teaser says to restock', () => {
    const g = Game.create(5);
    empty(g);
    const bot = new Bot(g, 0);
    g.act({ k: 'openShop' });
    for (let k = 0; k < 24 * 60 * TICK_HZ && g.day.phase !== PHASE.evening; k++) {
      step(g);
      bot.tick();
    }
    expect(g.day.phase).toBe(PHASE.evening);
    expect(g.day.today.served).toBe(0);
    expect(g.act({ k: 'sleep' }).ok).toBe(true);
    expect(g.day.teaser.key).toBe('lowStock');
  });
});
