// M4 S7: gossip — a resident you serve passes on the newest street news you haven't heard; each item
// is told once; passers-by don't gossip; your own doings aren't news to you; heard flags are saved.
import { describe, expect, it } from 'vitest';
import { Game } from '../src/sim/game';
import { NEWS } from '../src/shared/properties';
import type { SimEvent } from '../src/shared/protocol';
import { parse, serialize } from '../src/sim/save/format';

type Pay = (id: number, drink: number, score: number, wait: number, poured: boolean) => void;
const pay = (g: Game, h: number): void => (g as unknown as { pay: Pay }).pay(h, 0, 0.9, 10, true);
const gossip = (g: Game): Extract<SimEvent, { k: 'gossip' }>[] => g.events.splice(0).filter((e): e is Extract<SimEvent, { k: 'gossip' }> => e.k === 'gossip');

function residentCustomer(g: Game, key: string): number {
  const r = g.residents.slotOf(key);
  return g.npcs.spawnResident(r, g.residents.home[r]!, 0, 0);
}

describe('gossip', () => {
  it('residents tell the newest unheard item, each item once; passers-by say nothing', () => {
    const g = Game.create(51);
    g.properties.post(1, NEWS.closed, 'barber', '', '');
    g.properties.post(1, NEWS.listed, 'pharmacy', '1', '');
    g.properties.post(1, NEWS.withdrawn, 'tailor', '', '');
    g.events.length = 0;
    pay(g, g.npcs.spawn());
    expect(gossip(g)).toEqual([]);
    pay(g, residentCustomer(g, 'u_hla'));
    const first = gossip(g);
    expect(first).toHaveLength(1);
    expect(first[0]).toMatchObject({ who: 'u_hla', news: { kind: NEWS.listed, prop: 'pharmacy' } });
    pay(g, residentCustomer(g, 'daw_khin'));
    expect(gossip(g)[0]?.news).toMatchObject({ kind: NEWS.closed, prop: 'barber' });
    pay(g, residentCustomer(g, 'u_thein'));
    expect(gossip(g)).toEqual([]); // the withdrawn listing isn't worth telling; nothing else left
    expect(g.properties.news.every((n) => n.heard)).toBe(true);
  });

  it('your own doings are already heard; heard flags survive a reload', () => {
    const g = Game.create(52);
    g.properties.post(2, NEWS.sold, 'gold_shop', '', '');
    g.properties.post(2, NEWS.reopened, 'rice_shop', '', '');
    pay(g, residentCustomer(g, 'u_hla'));
    const { game } = Game.fromSave(parse(serialize(g.toSave(0))));
    game.events.length = 0;
    pay(game, residentCustomer(game, 'daw_khin'));
    expect(gossip(game)[0]?.news).toMatchObject({ kind: NEWS.sold, prop: 'gold_shop' });
    pay(game, residentCustomer(game, 'u_thein'));
    expect(gossip(game)).toEqual([]);
  });
});
