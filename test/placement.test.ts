import { describe, expect, it } from 'vitest';
import { CATALOG } from '../src/shared/catalog';
import { checkPlacement, newPlaceResult } from '../src/shared/rules/placement';
import { SimWorld, type ObjectFields } from '../src/sim/world';
import { createM1Area, KITCHEN, KITCHEN_DOOR, OPENING, PAVEMENT, SHOP } from '../src/sim/area';
import { ZONE } from '../src/shared/layout';

/** A pavement tile in front of the shop (not owned, open sky). */
const FRONTAGE = { x0: SHOP.x0, y0: PAVEMENT.y0 };

const T = (key: string) => CATALOG.byKey.get(key)!;
const fields = (key: string, x: number, y: number, rot = 0, parent = 0): ObjectFields => ({ type: T(key).id, x, y, rot, layer: T(key).layer, colour: 0, parent });

function setup() {
  const world = new SimWorld(createM1Area());
  const check = (key: string, x: number, y: number, rot = 0, ignore = 0) => {
    const r = checkPlacement(world.state, T(key).id, x, y, rot, ignore, newPlaceResult());
    return r.ok ? (r.parent ? `ok on ${r.parent}` : 'ok') : r.reason;
  };
  return { world, check };
}

const IN = { x: SHOP.x0 + 3, y: SHOP.y0 + 3 };

describe('placement rules', () => {
  it('only on owned tiles, inside the area', () => {
    const { check } = setup();
    expect(check('stool', IN.x, IN.y)).toBe('ok');
    expect(check('stool', FRONTAGE.x0, FRONTAGE.y0)).toBe('build.err.notOwned'); // the pavement is for walking
    expect(check('stool', 2, 2)).toBe('build.err.notOwned');
    expect(check('stool', -1, 0)).toBe('build.err.outside');
    expect(check('bench', SHOP.x1 - 1, IN.y)).toBe('build.err.notOwned'); // second tile off the shop's edge
  });

  it('furniture cannot overlap; rotation changes which tiles are taken', () => {
    const { world, check } = setup();
    world.add(fields('bench', IN.x, IN.y)); // covers (x,y) and (x+1,y)
    expect(check('stool', IN.x + 1, IN.y)).toBe('build.err.blocked');
    expect(check('stool', IN.x, IN.y + 1)).toBe('ok');
    world.add(fields('bench', IN.x + 4, IN.y, 1)); // rotated: (x+4,y) and (x+4,y+1)
    expect(check('stool', IN.x + 4, IN.y + 1)).toBe('build.err.blocked');
    expect(check('stool', IN.x + 5, IN.y)).toBe('ok');
  });

  it('a moved object ignores its own tiles', () => {
    const { world, check } = setup();
    const b = world.add(fields('bench', IN.x, IN.y));
    expect(check('bench', IN.x + 1, IN.y)).toBe('build.err.blocked');
    expect(check('bench', IN.x + 1, IN.y, 0, b)).toBe('ok');
  });

  it('rugs go under furniture; furniture goes on rugs', () => {
    const { world, check } = setup();
    world.add(fields('table', IN.x, IN.y));
    expect(check('rug', IN.x, IN.y)).toBe('ok');
    world.add(fields('rug', IN.x + 3, IN.y));
    expect(check('stool', IN.x + 3, IN.y)).toBe('ok');
    expect(check('rug', IN.x + 4, IN.y + 1)).toBe('build.err.blocked'); // overlaps the first rug
  });

  it('small items stand on the floor or on a free surface slot', () => {
    const { world, check } = setup();
    const table = world.add(fields('table', IN.x, IN.y));
    world.add(fields('stool', IN.x + 2, IN.y));
    expect(check('teapot', IN.x, IN.y)).toBe(`ok on ${table}`);
    expect(check('teapot', IN.x + 2, IN.y)).toBe('build.err.noSurface'); // stools have no surface
    expect(check('pot_plant', IN.x + 1, IN.y)).toBe('ok'); // on the floor
    world.add(fields('teapot', IN.x, IN.y, 0, table));
    expect(check('radio', IN.x, IN.y)).toBe('build.err.blocked'); // slot taken
    expect(check('stool', IN.x, IN.y)).toBe('build.err.blocked'); // big furniture can't stack
  });

  it('a long surface has one slot per tile', () => {
    const { world, check } = setup();
    const t = world.add(fields('table_long', IN.x, IN.y));
    world.add(fields('teapot', IN.x, IN.y, 0, t));
    expect(check('radio', IN.x + 1, IN.y)).toBe(`ok on ${t}`);
  });

  it('wall items need a back wall on the side their rotation faces', () => {
    const { world, check } = setup();
    expect(check('wall_clock', SHOP.x0 + 3, SHOP.y0, 1)).toBe('ok'); // north wall
    expect(check('wall_clock', SHOP.x0 + 3, SHOP.y0, 0)).toBe('build.err.noWall'); // no west wall there
    expect(check('wall_clock', SHOP.x0, SHOP.y0 + 4, 0)).toBe('ok'); // west wall
    expect(check('poster', IN.x, IN.y, 1)).toBe('build.err.noWall');
    world.add(fields('wall_clock', SHOP.x0, SHOP.y0, 1));
    expect(check('poster', SHOP.x0, SHOP.y0, 1)).toBe('build.err.blocked');
    expect(check('poster', SHOP.x0, SHOP.y0, 0)).toBe('ok'); // corner tile: the other wall is free
  });

  it('ceiling items need a roof and a free ceiling tile', () => {
    const { world, check } = setup();
    expect(check('hanging_lamp', FRONTAGE.x0, FRONTAGE.y0)).toBe('build.err.notOwned');
    const W = world.state.area.w;
    world.state.area.zone[IN.y * W + IN.x + 4] = ZONE.owned; // an owned tile without a roof
    expect(check('hanging_lamp', IN.x + 4, IN.y)).toBe('build.err.noRoof');
    expect(check('hanging_lamp', IN.x, IN.y)).toBe('ok');
    world.add(fields('table', IN.x, IN.y));
    expect(check('ceiling_fan', IN.x, IN.y)).toBe('ok'); // furniture below doesn't matter
    world.add(fields('ceiling_fan', IN.x, IN.y));
    expect(check('hanging_lamp', IN.x, IN.y)).toBe('build.err.blocked');
  });

  it('walk zones: seats only in the seating room, nothing on the walk-way, kitchen for other furniture', () => {
    const { check } = setup();
    expect(check('stool', KITCHEN.x0 + 4, KITCHEN.y0 + 1)).toBe('build.err.seatOutside');
    expect(check('shelf', KITCHEN.x0 + 4, KITCHEN.y0)).toBe('ok');
    expect(check('stool', OPENING.x0, SHOP.y1 - 1)).toBe('build.err.walkway');
    expect(check('shelf', KITCHEN_DOOR.x, KITCHEN_DOOR.y)).toBe('build.err.walkway');
    expect(check('pot_plant', OPENING.x0 + 1, SHOP.y1 - 1)).toBe('build.err.walkway'); // small items on the floor too
    expect(check('rug', OPENING.x0, SHOP.y1 - T('rug').h)).toBe('ok'); // rugs don't block walking, even on the walk-way
  });

  it('furniture may not cut the kitchen door off from the shop front', () => {
    const { world, check } = setup();
    // Wall the door in from the seating side: (x−1, y+1), (x, y+1) and (x+1, y+1) below the door.
    const y = KITCHEN_DOOR.y + 1;
    world.add(fields('stool', KITCHEN_DOOR.x - 1, y));
    world.add(fields('stool', KITCHEN_DOOR.x + 1, y));
    expect(check('stool', KITCHEN_DOOR.x, y)).toBe('build.err.blocksWay');
    // Furniture that leaves a way round is fine.
    expect(check('stool', KITCHEN_DOOR.x + 3, y + 2)).toBe('ok');
  });
});
