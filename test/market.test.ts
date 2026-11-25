// M3 S6: the neighbourhood shops — daily stock from (seed, day), buying only at the counter during
// opening hours with money that never goes negative, carrying (load cap) and putting away inside the
// shop, delivery for a fee (2 game hours, or the next opening when the clock is held).
import { describe, expect, it } from 'vitest';
import raw from '../src/data/market.json';
import { Game } from '../src/sim/game';
import { FrameWriter } from '../src/shared/diff';
import { CATALOG } from '../src/shared/catalog';
import { PHASE } from '../src/shared/day';
import { INGREDIENTS } from '../src/shared/ingredients';
import { ITEM, MARKET, basePrice, buildMarket, dailyStock, deliveryFee, type RawMarket } from '../src/shared/market';
import { NEIGHBOURHOOD } from '../src/shared/neighbourhood';
import type { SimEvent } from '../src/shared/protocol';
import { PLAYER, WS } from '../src/sim/npc/workers';
import { parse, serialize, emptyWorld } from '../src/sim/save/format';

let buf = new ArrayBuffer(1 << 16);
const writer = new FrameWriter();
function steps(g: Game, n: number, events?: SimEvent[]): void {
  for (let k = 0; k < n; k++) {
    writer.begin(buf, g.sim.tick, g.sim.gameMinute);
    g.step(writer);
    buf = writer.finish();
    if (events) events.push(...g.events.splice(0));
    else g.events.length = 0;
  }
}
const shopId = (key: string): number => NEIGHBOURHOOD.shops.find((s) => s.key === key)!.id;
const MARKET_ID = shopId('market');
const FURN = shopId('furniture');
function walkTo(g: Game, a: { k: 'visit'; shop: number } | { k: 'walkTo'; x: number; y: number }, events?: SimEvent[]): void {
  expect(g.act(a).ok).toBe(true);
  for (let k = 0; k < 3000 && (g.workers.qLen[PLAYER]! > 0 || g.workers.state[PLAYER] !== WS.idle); k++) steps(g, 1, events);
}
const rowOf = (g: Game, shop: number, kind: number, id: number): number => g.market.rows[shop]!.findIndex((r) => r.kind === kind && r.id === id);
const TEA = INGREDIENTS.byKey.get('tea')!.id;

describe('market data', () => {
  it('rejects unknown items, fixed objects, bad rows and unknown shops', () => {
    const bad = (patch: (d: RawMarket) => void) => () => {
      const d = JSON.parse(JSON.stringify(raw)) as RawMarket;
      patch(d);
      buildMarket(d);
    };
    expect(bad((d) => d.shops.books!.pool.push({ object: 'unicorn', qty: [1, 1] }))).toThrow(/unknown item/);
    expect(bad((d) => d.shops.books!.pool.push({ object: 'counter', qty: [1, 1] }))).toThrow(/fixed/);
    expect(bad((d) => (d.shops.books!.rows = 99))).toThrow(/rows/);
    expect(bad((d) => (d.shops.bank = { rows: 1, pool: [] }))).toThrow(/unknown shop/);
    expect(bad((d) => delete d.shops.market)).toThrow(/missing/);
  });
});

describe('daily stock', () => {
  it('is the same for the same seed and day, and changes from day to day', () => {
    expect(dailyStock(7, 3)).toEqual(dailyStock(7, 3));
    const days = Array.from({ length: 6 }, (_, d) => JSON.stringify(dailyStock(7, d)));
    expect(new Set(days).size).toBeGreaterThan(1);
  });

  it('every shop shows its row count; prices stay in the factor range on whole steps', () => {
    for (let d = 0; d < 20; d++) {
      const rows = dailyStock(11, d);
      rows.forEach((shop, s) => {
        expect(shop).toHaveLength(MARKET.shops[s]!.rows);
        for (const r of shop) {
          const base = basePrice(r.kind, r.id);
          expect(r.price % MARKET.priceStep).toBe(0);
          expect(r.price).toBeGreaterThanOrEqual(Math.floor((base * MARKET.priceRange[0]) / MARKET.priceStep) * MARKET.priceStep - MARKET.priceStep);
          expect(r.price).toBeLessThanOrEqual(base * MARKET.priceRange[1] + MARKET.priceStep);
          expect(r.qty).toBeGreaterThan(0);
        }
      });
      // The wet market always has all three ingredients.
      expect(rows[MARKET_ID]!.map((r) => r.kind)).toEqual([ITEM.ingredient, ITEM.ingredient, ITEM.ingredient]);
    }
  });

  it('a sold-out item comes back another day', () => {
    const g = Game.create(12);
    const row = g.market.rows[FURN]![0]!;
    const item = { kind: row.kind, id: row.id };
    row.qty = 0;
    let back = false;
    for (let d = 1; d < 30 && !back; d++) back = dailyStock(12, d)[FURN]!.some((r) => r.kind === item.kind && r.id === item.id && r.qty > 0);
    expect(back).toBe(true);
  });
});

describe('buying', () => {
  it('only at the counter, only while open, never into debt', () => {
    const g = Game.create(1);
    const row = rowOf(g, MARKET_ID, ITEM.ingredient, TEA);
    expect(g.act({ k: 'buy', shop: MARKET_ID, item: row, qty: 1 })).toEqual({ ok: false, reason: 'market.err.notHere' });
    walkTo(g, { k: 'visit', shop: MARKET_ID });
    g.builder.money = 10;
    expect(g.act({ k: 'buy', shop: MARKET_ID, item: row, qty: 1 })).toEqual({ ok: false, reason: 'market.err.money' });
    expect(g.builder.money).toBe(10);
    g.builder.money = 1e6;
    const left = g.market.rows[MARKET_ID]![row]!.qty;
    expect(g.act({ k: 'buy', shop: MARKET_ID, item: row, qty: left + 1 })).toEqual({ ok: false, reason: 'market.err.soldOut' });
    // The furniture shop opens at 08:00; it is 06:00 and the shutters are down.
    walkTo(g, { k: 'visit', shop: FURN });
    expect(g.act({ k: 'buy', shop: FURN, item: 0, qty: 1 })).toEqual({ ok: false, reason: 'market.err.closed' });
  });

  it('carried goods are put away the moment the player steps into the shop', () => {
    const g = Game.create(2);
    const events: SimEvent[] = [];
    walkTo(g, { k: 'visit', shop: MARKET_ID });
    const row = rowOf(g, MARKET_ID, ITEM.ingredient, TEA);
    const price = g.market.rows[MARKET_ID]![row]!.price;
    const money = g.builder.money;
    const tea = g.service.stock.count[TEA]!;
    expect(g.act({ k: 'buy', shop: MARKET_ID, item: row, qty: 2 }).ok).toBe(true);
    expect(g.builder.money).toBe(money - 2 * price);
    expect(g.playerState().carry).toEqual([{ kind: ITEM.ingredient, id: TEA, qty: 2 }]);
    expect(g.service.stock.count[TEA]).toBe(tea); // still in hand
    walkTo(g, { k: 'walkTo', x: 31, y: 18 }, events); // the shop's front row
    expect(g.service.stock.count[TEA]).toBe(tea + 2 * INGREDIENTS.byKey.get('tea')!.pack);
    expect(g.market.carry).toEqual([]);
    expect(events.some((e) => e.k === 'putAway')).toBe(true);
  });

  it('the load is capped; the rest can be delivered', () => {
    const g = Game.create(3);
    walkTo(g, { k: 'visit', shop: MARKET_ID });
    g.builder.money = 1e6;
    const row = rowOf(g, MARKET_ID, ITEM.ingredient, TEA);
    g.market.rows[MARKET_ID]![row]!.qty = 20;
    expect(g.act({ k: 'buy', shop: MARKET_ID, item: row, qty: MARKET.carryMax + 1 })).toEqual({ ok: false, reason: 'market.err.tooHeavy' });
    expect(g.act({ k: 'buy', shop: MARKET_ID, item: row, qty: MARKET.carryMax }).ok).toBe(true);
    expect(g.act({ k: 'buy', shop: MARKET_ID, item: row, qty: 1 })).toEqual({ ok: false, reason: 'market.err.tooHeavy' });
    const money = g.builder.money;
    const cost = g.market.rows[MARKET_ID]![row]!.price * 3;
    expect(g.act({ k: 'buy', shop: MARKET_ID, item: row, qty: 3, deliver: true }).ok).toBe(true);
    expect(g.builder.money).toBe(money - cost - deliveryFee(cost));
    expect(deliveryFee(100)).toBe(MARKET.delivery.min);
  });

  it('a delivery bought before opening comes with the opening; one bought in the day comes 2 game hours later', () => {
    const g = Game.create(4);
    const events: SimEvent[] = [];
    walkTo(g, { k: 'visit', shop: MARKET_ID });
    g.builder.money = 1e6;
    const row = rowOf(g, MARKET_ID, ITEM.ingredient, TEA);
    const tea = g.service.stock.count[TEA]!;
    expect(g.act({ k: 'buy', shop: MARKET_ID, item: row, qty: 1, deliver: true }).ok).toBe(true);
    steps(g, 50);
    expect(g.service.stock.count[TEA]).toBe(tea);
    g.act({ k: 'openShop' });
    steps(g, 1, events);
    expect(g.service.stock.count[TEA]).toBe(tea + INGREDIENTS.byKey.get('tea')!.pack);
    // At 09:00 the furniture shop is open: a delivered stool arrives at 11:00.
    g.sim.jumpTo(g.sim.day * 1440 + 9 * 60);
    walkTo(g, { k: 'visit', shop: FURN });
    const k = g.market.rows[FURN]!.findIndex((r) => r.kind === ITEM.object);
    const type = g.market.rows[FURN]![k]!.id;
    const inv = g.builder.inventory[type]!;
    expect(g.act({ k: 'buy', shop: FURN, item: k, qty: 1, deliver: true }).ok).toBe(true);
    const bought = g.sim.gameMinute;
    for (let n = 0; n < 200 * 60 && g.builder.inventory[type] === inv; n++) steps(g, 1, events);
    expect(g.builder.inventory[type]).toBe(inv + 1);
    expect(g.sim.gameMinute - bought).toBeGreaterThanOrEqual(MARKET.delivery.hours * 60);
    expect(g.sim.gameMinute - bought).toBeLessThanOrEqual(MARKET.delivery.hours * 60 + 1);
    expect(events.some((e) => e.k === 'delivered')).toBe(true);
    expect(CATALOG.defs[type]).toBeDefined();
  });

  it('goods still in hand and deliveries still out are home by the morning', () => {
    const g = Game.create(5);
    walkTo(g, { k: 'visit', shop: MARKET_ID });
    g.builder.money = 1e6;
    const row = rowOf(g, MARKET_ID, ITEM.ingredient, TEA);
    const tea = g.service.stock.count[TEA]!;
    g.act({ k: 'buy', shop: MARKET_ID, item: row, qty: 1 });
    g.act({ k: 'openShop' });
    for (let k = 0; k < 24 * 60 * 10 && g.day.phase === PHASE.open; k++) steps(g, 1);
    g.npcs.clear();
    for (let k = 0; k < 100 && g.day.phase !== PHASE.evening; k++) steps(g, 1);
    // Still standing at the market with the tea in hand at closing time.
    expect(g.market.carry.length).toBe(1);
    g.act({ k: 'sleep' });
    expect(g.market.carry).toEqual([]);
    expect(g.service.stock.count[TEA]!).toBeGreaterThanOrEqual(tea + INGREDIENTS.byKey.get('tea')!.pack - 200);
  });
});

describe('saving the neighbourhood (v4)', () => {
  it('keeps stock, materials, today’s purchases, goods in hand and deliveries', () => {
    const g = Game.create(21);
    walkTo(g, { k: 'visit', shop: MARKET_ID });
    g.builder.money = 1e6;
    const row = rowOf(g, MARKET_ID, ITEM.ingredient, TEA);
    g.act({ k: 'buy', shop: MARKET_ID, item: row, qty: 2 });
    g.act({ k: 'buy', shop: MARKET_ID, item: row, qty: 1, deliver: true });
    g.materials[1] = 17;
    const data = g.toSave(0);
    const back = parse(serialize(data));
    expect(back.hood).toEqual(data.hood);
    const { game } = Game.fromSave(back);
    expect(game.market.carry).toEqual(g.market.carry);
    expect(game.market.deliveries).toEqual(g.market.deliveries);
    expect(game.market.rows[MARKET_ID]![row]!.qty).toBe(g.market.rows[MARKET_ID]![row]!.qty);
    expect(Array.from(game.service.stock.count)).toEqual(Array.from(g.service.stock.count));
    expect(game.materials[1]).toBe(17);
  });

  it('purchases from another day are forgotten (that day restocked)', () => {
    const g = Game.create(22);
    const data = g.toSave(0);
    data.hood.marketDay = g.sim.day - 1;
    data.hood.sold = { market: [99, 99, 99] };
    const { game } = Game.fromSave(parse(serialize(data)));
    expect(game.market.rows).toEqual(dailyStock(22, g.sim.day));
  });

  it('a v3 save migrates with a new game’s starting stock and keeps everything else', () => {
    const g = Game.create(23);
    const data = g.toSave(0);
    data.hood = { marketDay: -1, sold: {}, stock: {}, materials: {}, carry: [], deliveries: [], painted: [] };
    data.world = emptyWorld();
    const v5 = serialize(data);
    const v3 = v5.slice(0, v5.byteLength - 11 - 11); // the empty neighbourhood and world blocks
    new DataView(v3).setUint16(4, 3, true);
    const back = parse(v3);
    expect(back.schema).toBe(5);
    expect(back.objects).toEqual(data.objects);
    expect(back.money).toBe(data.money);
    const { game } = Game.fromSave(back);
    expect(game.service.stock.cupsLeft()).toBe(Game.create(1).service.stock.cupsLeft());
  });
});
