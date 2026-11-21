import { describe, expect, it } from 'vitest';
import { CATALOG } from '../src/shared/catalog';
import start from '../src/data/start.json';
import { Game } from '../src/sim/game';
import { SHOP } from '../src/sim/area';

const T = (key: string) => CATALOG.byKey.get(key)!.id;

describe('Game', () => {
  it('starts with the money and inventory from start.json', () => {
    const g = Game.create(1);
    const s = g.playerState();
    expect(s.money).toBe(start.money);
    expect(s.inventory[T('stool')]).toBe(start.inventory.stool);
    expect(s.canUndo).toBe(false);
  });

  it('routes wire actions by handle and refuses stale handles', () => {
    const g = Game.create(1);
    const r = g.act({ k: 'place', type: T('stool'), x: SHOP.x0 + 2, y: SHOP.y0 + 2, rot: 0, colour: 2 });
    expect(r.ok).toBe(true);
    const h = g.world.objects.handle(r.index!);
    expect(g.act({ k: 'recolour', id: h, colour: 4 }).ok).toBe(true);
    expect(g.act({ k: 'pickup', id: h }).ok).toBe(true);
    expect(g.act({ k: 'sell', id: h })).toEqual({ ok: false, reason: 'build.err.gone' });
    expect(g.act({ k: 'undo' }).ok).toBe(true);
    expect(g.playerState().canRedo).toBe(true);
  });
});
