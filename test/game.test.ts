import { describe, expect, it } from 'vitest';
import { CATALOG } from '../src/shared/catalog';
import start from '../src/data/start.json';
import { Game } from '../src/sim/game';
import { SHOP } from '../src/sim/area';

const T = (key: string) => CATALOG.byKey.get(key)!.id;

describe('Game', () => {
  it('starts with the money from start.json, an empty inventory and the start layout placed', () => {
    const g = Game.create(1);
    const s = g.playerState();
    expect(s.money).toBe(start.money);
    expect(s.inventory.every((n) => n === 0)).toBe(true);
    expect(g.world.objects.count).toBe(start.layout.length);
    expect(s.canUndo).toBe(false);
    // The kettle stands on the counter; 8 stools give 8 seats.
    const o = g.world.objects;
    let kettleOnCounter = false;
    let seats = 0;
    for (let i = 1; i < o.capacity; i++) {
      if (!o.live[i]) continue;
      if (o.type[i] === T('kettle')) kettleOnCounter = o.type[o.parent[i]!] === T('counter');
      seats += CATALOG.defs[o.type[i]!]!.seat;
    }
    expect(kettleOnCounter).toBe(true);
    expect(seats).toBe(8);
  });

  it('fixed shop objects can be moved but never picked up or sold', () => {
    const g = Game.create(1);
    const o = g.world.objects;
    let counter = 0;
    for (let i = 1; i < o.capacity; i++) if (o.live[i] && o.type[i] === T('counter')) counter = i;
    const h = o.handle(counter);
    expect(g.act({ k: 'pickup', id: h })).toEqual({ ok: false, reason: 'build.err.fixed' });
    expect(g.act({ k: 'sell', id: h })).toEqual({ ok: false, reason: 'build.err.fixed' });
    expect(g.act({ k: 'move', id: h, x: 27, y: 17, rot: 0 }).ok).toBe(true);
  });

  it('routes wire actions by handle and refuses stale handles', () => {
    const g = Game.create(1);
    g.builder.give(T('stool'), 1);
    const r = g.act({ k: 'place', type: T('stool'), x: SHOP.x0 + 2, y: SHOP.y0 + 5, rot: 0, colour: 2 });
    expect(r.ok).toBe(true);
    const h = g.world.objects.handle(r.index!);
    expect(g.act({ k: 'recolour', id: h, colour: 4 }).ok).toBe(true);
    expect(g.act({ k: 'pickup', id: h }).ok).toBe(true);
    expect(g.act({ k: 'sell', id: h })).toEqual({ ok: false, reason: 'build.err.gone' });
    expect(g.act({ k: 'undo' }).ok).toBe(true);
    expect(g.playerState().canRedo).toBe(true);
  });
});
