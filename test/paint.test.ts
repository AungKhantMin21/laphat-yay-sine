// M3 S8: the paint tool — floor finishes and wall colours from hardware-stall materials, only inside
// the player's shop (walls: the shop's own, sills included), one tile of material each, undo gives it
// back, the change streams to the main thread and survives saving.
import { describe, expect, it } from 'vitest';
import { Game } from '../src/sim/game';
import { FrameWriter, readFrame } from '../src/shared/diff';
import { FLOOR } from '../src/shared/layout';
import { MATERIALS } from '../src/shared/materials';
import { NEIGHBOURHOOD } from '../src/shared/neighbourhood';
import { OPENING, SHOP } from '../src/sim/area';
import { WorldView } from '../src/game/view';
import { parse, serialize } from '../src/sim/save/format';

const M = (key: string): number => MATERIALS.byKey.get(key)!.id;
const WOOD = M('floor_wood');
const GREEN = M('paint_green');
function game(seed: number): Game {
  const g = Game.create(seed);
  g.materials[WOOD] = 10;
  g.materials[GREEN] = 10;
  return g;
}
const at = (g: Game, x: number, y: number): number => y * g.world.state.area.w + x;
// A free seating tile (the start layout leaves the front row clear) and a back-wall tile.
const FX = OPENING.x0;
const FY = SHOP.y1 - 1;

describe('the paint tool', () => {
  it('lays a floor finish inside the shop, one material tile each; not on the street', () => {
    const g = game(1);
    expect(g.act({ k: 'paint', x: FX, y: FY, material: WOOD }).ok).toBe(true);
    expect(g.world.state.area.floor[at(g, FX, FY)]).toBe(FLOOR.wood);
    expect(g.materials[WOOD]).toBe(9);
    expect(g.act({ k: 'paint', x: FX, y: FY, material: WOOD })).toEqual({ ok: false, reason: 'build.err.samePaint' });
    expect(g.act({ k: 'paint', x: 5, y: 20, material: WOOD })).toEqual({ ok: false, reason: 'build.err.paintOutside' }); // pavement
    expect(g.act({ k: 'paint', x: -1, y: 0, material: WOOD })).toEqual({ ok: false, reason: 'build.err.paintOutside' });
    g.materials[WOOD] = 0;
    expect(g.act({ k: 'paint', x: FX + 1, y: FY, material: WOOD })).toEqual({ ok: false, reason: 'build.err.noMaterial' });
  });

  it("colours the shop's walls — back walls, the front sill and the east sill — and nothing else", () => {
    const g = game(2);
    expect(g.act({ k: 'paint', x: SHOP.x0 + 3, y: SHOP.y0, material: GREEN }).ok).toBe(true); // back wall
    expect(g.act({ k: 'paint', x: SHOP.x0 + 1, y: SHOP.y1, material: GREEN }).ok).toBe(true); // front sill (on the pavement row)
    expect(g.act({ k: 'paint', x: SHOP.x1, y: SHOP.y0 + 3, material: GREEN }).ok).toBe(true); // east sill
    expect(g.world.state.area.paint[at(g, SHOP.x0 + 3, SHOP.y0)]).toBe(2);
    expect(g.act({ k: 'paint', x: FX, y: FY, material: GREEN })).toEqual({ ok: false, reason: 'build.err.noWall' });
    expect(g.act({ k: 'paint', x: 5, y: 19, material: GREEN })).toEqual({ ok: false, reason: 'build.err.noWall' }); // a neighbour's front
    expect(g.materials[GREEN]).toBe(7);
  });

  it('undo gives the material back and restores the tile; redo paints again', () => {
    const g = game(3);
    const before = g.world.state.area.floor[at(g, FX, FY)];
    g.act({ k: 'paint', x: FX, y: FY, material: WOOD });
    expect(g.act({ k: 'undo' }).ok).toBe(true);
    expect(g.world.state.area.floor[at(g, FX, FY)]).toBe(before);
    expect(g.materials[WOOD]).toBe(10);
    expect(g.act({ k: 'redo' }).ok).toBe(true);
    expect(g.world.state.area.floor[at(g, FX, FY)]).toBe(FLOOR.wood);
    expect(g.materials[WOOD]).toBe(9);
  });

  it('streams the painted tiles to the main-thread mirror', () => {
    const g = game(4);
    const v = new WorldView();
    v.setArea(0, NEIGHBOURHOOD.w, NEIGHBOURHOOD.h);
    const w = new FrameWriter();
    w.begin(new ArrayBuffer(1 << 16), 0, 0);
    g.writeSnapshot(w);
    readFrame(w.finish(), v);
    g.act({ k: 'paint', x: FX, y: FY, material: WOOD });
    g.act({ k: 'paint', x: SHOP.x0 + 3, y: SHOP.y0, material: GREEN });
    w.begin(new ArrayBuffer(1 << 16), 1, 0);
    g.step(w);
    readFrame(w.finish(), v);
    expect(v.area.floor[at(g, FX, FY)]).toBe(FLOOR.wood);
    expect(v.area.paint[at(g, SHOP.x0 + 3, SHOP.y0)]).toBe(2);
  });

  it('the paint survives saving and loading', () => {
    const g = game(5);
    g.act({ k: 'paint', x: FX, y: FY, material: WOOD });
    g.act({ k: 'paint', x: SHOP.x0 + 3, y: SHOP.y0, material: GREEN });
    const data = g.toSave(0);
    expect(data.hood.painted).toHaveLength(2);
    const { game: back } = Game.fromSave(parse(serialize(data)));
    expect(back.world.state.area.floor[at(g, FX, FY)]).toBe(FLOOR.wood);
    expect(back.world.state.area.paint[at(g, SHOP.x0 + 3, SHOP.y0)]).toBe(2);
    expect(back.materials[WOOD]).toBe(9);
  });
});
