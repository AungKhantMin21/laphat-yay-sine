// M4 S6: growing the shop — buy or rent a listed lot at the notice board; the lot joins the shop
// (interior, walkable through the opened party wall, seats and paint work there); rent at Sleep, and
// a lease that can't be paid ends calmly (furniture back to the inventory, never below zero); a bought
// lot survives saving.
import { describe, expect, it } from 'vitest';
import { Game } from '../src/sim/game';
import { CATALOG } from '../src/shared/catalog';
import { FrameWriter } from '../src/shared/diff';
import { PHASE } from '../src/shared/day';
import { ZONE } from '../src/shared/layout';
import { MATERIALS } from '../src/shared/materials';
import { NEIGHBOURHOOD } from '../src/shared/neighbourhood';
import { PROPERTIES, PS } from '../src/shared/properties';
import { WZ } from '../src/shared/rules/access';
import type { SimEvent } from '../src/shared/protocol';
import { PLAYER } from '../src/sim/npc/workers';
import { CS } from '../src/sim/npc/customers';
import { parse, serialize } from '../src/sim/save/format';

const EAST = PROPERTIES.byKey.get('east_lot')!;
const STOOL = CATALOG.byKey.get('stool')!.id;
const buf = new ArrayBuffer(1 << 18);
const w = new FrameWriter();
function step(g: Game, n = 1): void {
  for (let k = 0; k < n; k++) {
    w.begin(buf, g.sim.tick, g.sim.gameMinute);
    g.step(w);
  }
}
/** A game where the east lot is listed and the player stands at the notice board. */
function atBoard(seed: number, layout = true): Game {
  const g = Game.create(seed, layout);
  g.worldDay(3);
  expect(g.properties.props[EAST.id]!.state).toBe(PS.listed);
  const b = NEIGHBOURHOOD.board;
  g.workers.place(PLAYER, b.visitY * g.walkStaff.w + b.visitX);
  return g;
}
const tile = (g: Game, x: number, y: number): number => y * g.world.state.area.w + x;

describe('buying and renting at the notice board', () => {
  it('only while listed, only at the board, never below zero', () => {
    const g = Game.create(41);
    expect(g.act({ k: 'buyProperty', key: 'east_lot' })).toEqual({ ok: false, reason: 'board.err.gone' }); // not listed yet
    g.worldDay(3);
    expect(g.act({ k: 'buyProperty', key: 'east_lot' })).toEqual({ ok: false, reason: 'board.err.notHere' });
    expect(g.act({ k: 'buyProperty', key: 'phone_shop' })).toEqual({ ok: false, reason: 'board.err.notForYou' });
    const b = NEIGHBOURHOOD.board;
    g.workers.place(PLAYER, b.visitY * g.walkStaff.w + b.visitX);
    g.builder.money = EAST.value - 1;
    expect(g.act({ k: 'buyProperty', key: 'east_lot' })).toEqual({ ok: false, reason: 'board.err.money' });
    g.builder.money = EAST.value + 5;
    expect(g.act({ k: 'buyProperty', key: 'east_lot' }).ok).toBe(true);
    expect(g.builder.money).toBe(5);
    expect(g.properties.props[EAST.id]!.state).toBe(PS.owned);
    expect(g.act({ k: 'rentProperty', key: 'east_lot' })).toEqual({ ok: false, reason: 'board.err.gone' });
    expect(g.playerState().listings.find((l) => l.key === 'east_lot')?.state).toBe(PS.owned);
  });

  it('the lot joins the shop: interior, owned, walkable through the party wall; seats and paint work there', () => {
    const g = atBoard(42, false);
    g.builder.money = 1e6;
    const a = g.world.state.area;
    const inLot = tile(g, 38, 16);
    expect(a.access[inLot]).toBe(WZ.blocked);
    expect(g.act({ k: 'buyProperty', key: 'east_lot' }).ok).toBe(true);
    expect(a.access[inLot]).toBe(WZ.interior);
    expect(a.zone[inLot]! & ZONE.owned).toBe(ZONE.owned);
    expect(g.walk.passable(inLot)).toBe(true);
    // Paint: a floor finish in the lot.
    const wood = MATERIALS.byKey.get('floor_wood')!.id;
    g.materials[wood] = 3;
    expect(g.act({ k: 'paint', x: 38, y: 16, material: wood }).ok).toBe(true);
    // The only seat is in the lot: a customer walks in through the shop and sits there.
    g.builder.give(STOOL, 1);
    expect(g.act({ k: 'place', type: STOOL, x: 39, y: 15, rot: 0, colour: 0 }).ok).toBe(true);
    g.act({ k: 'openShop' });
    const h = g.npcs.spawn();
    const i = g.npcs.indexOf(h);
    for (let k = 0; k < 4000 && g.npcs.state[i] === CS.toSeat; k++) step(g);
    expect(g.npcs.seat[i]).toBe(tile(g, 39, 15));
    expect([CS.ordering, CS.asking]).toContain(g.npcs.state[i]);
  });

  it('rent at Sleep; a lease that cannot be paid ends calmly and the furniture comes back', () => {
    const g = atBoard(43);
    g.builder.money = EAST.rent;
    expect(g.act({ k: 'rentProperty', key: 'east_lot' }).ok).toBe(true);
    expect(g.builder.money).toBe(EAST.rent); // nothing up front
    g.builder.give(STOOL, 1);
    expect(g.act({ k: 'place', type: STOOL, x: 38, y: 15, rot: 0, colour: 0 }).ok).toBe(true);
    const stools = g.builder.inventory[STOOL]!;
    // To the evening without customers, then Sleep with an empty tin.
    g.act({ k: 'openShop' });
    for (let k = 0; k < 24 * 60 * 10 && g.day.phase === PHASE.open; k++) {
      g.npcs.clear();
      step(g);
    }
    for (let k = 0; k < 200 && g.day.phase !== PHASE.evening; k++) step(g);
    g.builder.money = 0;
    const events: SimEvent[] = [];
    g.events.length = 0;
    expect(g.act({ k: 'sleep' }).ok).toBe(true);
    events.push(...g.events.splice(0));
    expect(events).toContainEqual({ k: 'leaseEnded', key: 'east_lot', returned: 1, unpaid: true });
    expect(g.builder.money).toBe(0);
    expect(g.builder.inventory[STOOL]).toBe(stools + 1);
    expect(g.world.state.area.access[tile(g, 38, 15)]).toBe(WZ.blocked);
    expect(g.properties.props[EAST.id]!.state).toBe(PS.notSelling);
    // It comes back on the market later.
    let back = false;
    for (let d = g.sim.day + 1; d < g.sim.day + 60 && !back; d++) {
      g.worldDay(d);
      back = g.properties.props[EAST.id]!.state === PS.listed;
    }
    expect(back).toBe(true);
  });

  it('a bought lot and its furniture survive saving and loading', () => {
    const g = atBoard(44);
    g.builder.money = 1e6;
    g.act({ k: 'buyProperty', key: 'east_lot' });
    g.builder.give(STOOL, 1);
    expect(g.act({ k: 'place', type: STOOL, x: 39, y: 17, rot: 0, colour: 0 }).ok).toBe(true);
    const data = g.toSave(0);
    const { game, returned } = Game.fromSave(parse(serialize(data)));
    expect(returned).toBe(0);
    expect(game.world.state.occ.furniture[tile(game, 39, 17)]).not.toBe(0);
    expect(game.world.state.area.access[tile(game, 39, 17)]).toBe(WZ.interior);
    expect(game.toSave(0).hood.painted).toEqual(data.hood.painted);
  });
});
