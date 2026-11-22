import { describe, expect, it } from 'vitest';
import { CATALOG, LAYER } from '../src/shared/catalog';
import { FrameWriter, readFrame } from '../src/shared/diff';
import { WALL, ZONE } from '../src/shared/layout';
import { SimWorld, type ObjectFields } from '../src/sim/world';
import { createM1Area, KITCHEN, KITCHEN_DOOR, OPENING, PAVEMENT, ROAD, CROSSING, SHOP } from '../src/sim/area';
import { WZ } from '../src/shared/rules/access';
import { WorldView } from '../src/game/view';

const T = (key: string) => CATALOG.byKey.get(key)!;
const obj = (key: string, x: number, y: number, extra: Partial<ObjectFields> = {}): ObjectFields => ({
  type: T(key).id,
  x,
  y,
  rot: 0,
  layer: T(key).layer,
  colour: 0,
  parent: 0,
  ...extra,
});

/** Sends the world's pending changes through a real frame into a mirror. */
function sync(world: SimWorld, view: WorldView, snapshot = false): void {
  const w = new FrameWriter();
  w.begin(new ArrayBuffer(1024), 0, 0);
  if (snapshot) {
    const a = world.state.area;
    view.setArea(a.id, a.w, a.h);
    world.writeSnapshot(w);
  } else world.writeChanges(w);
  readFrame(w.finish(), view);
}

function sameOccupancy(a: SimWorld, b: WorldView): void {
  const oa = a.state.occ;
  const ob = b.state.occ;
  // Mirror slots match the worker's slots because handles carry the index.
  for (const k of ['floor', 'furniture', 'ceiling', 'stack', 'wallN', 'wallW'] as const) expect(Array.from(ob[k]), k).toEqual(Array.from(oa[k]));
}

describe('M1 area', () => {
  it('shop is owned and roofed; back walls full height, front, east and kitchen walls low', () => {
    const a = createM1Area();
    const at = (x: number, y: number) => y * a.w + x;
    expect(a.zone[at(SHOP.x0 + 2, SHOP.y0 + 2)]).toBe(ZONE.owned | ZONE.roof);
    expect(a.zone[at(SHOP.x0, PAVEMENT.y0)]).toBe(0);
    expect(a.zone[at(2, 2)]).toBe(0);
    expect(a.wall[at(SHOP.x0, SHOP.y0)]).toBe(WALL.n | WALL.w);
    expect(a.wall[at(SHOP.x0 + 3, SHOP.y0)]).toBe(WALL.n);
    expect(a.wall[at(SHOP.x0, SHOP.y0 + 6)]).toBe(WALL.w);
    expect(a.wall[at(SHOP.x1, SHOP.y0 + 3)]).toBe(WALL.lowW); // east side, on the tile beyond
    expect(a.wall[at(SHOP.x0 + 1, SHOP.y1)]).toBe(WALL.lowN); // front beside the opening
    expect(a.wall[at(OPENING.x0, SHOP.y1)]).toBe(0); // the opening
    expect(a.wall[at(KITCHEN.x0 + 5, KITCHEN.y1)]).toBe(WALL.lowN); // kitchen partition
    expect(a.wall[at(KITCHEN_DOOR.x, KITCHEN.y1)]).toBe(0); // its door
  });

  it('walk zones: pavements, road with one crossing, front, interior, kitchen; the rest blocked', () => {
    const a = createM1Area();
    const at = (x: number, y: number) => y * a.w + x;
    expect(a.access[at(0, PAVEMENT.y0)]).toBe(WZ.pavement);
    expect(a.access[at(5, ROAD.y0 + 2)]).toBe(WZ.road);
    expect(a.access[at(CROSSING.x0, ROAD.y0 + 2)]).toBe(WZ.crossing);
    expect(a.access[at(OPENING.x0, SHOP.y1 - 1)]).toBe(WZ.front);
    expect(a.access[at(OPENING.x0 - 1, SHOP.y1 - 1)]).toBe(WZ.interior);
    expect(a.access[at(KITCHEN.x0, KITCHEN.y0)]).toBe(WZ.kitchen);
    expect(a.access[at(KITCHEN_DOOR.x, KITCHEN_DOOR.y)]).toBe(WZ.kitchenDoor);
    expect(a.access[at(2, 2)]).toBe(WZ.blocked);
    expect(a.access[at(SHOP.x1, SHOP.y0 + 2)]).toBe(WZ.blocked); // the neighbour's building
  });
});

describe('SimWorld + occupancy', () => {
  it('marks a rotated footprint and clears it on remove', () => {
    const world = new SimWorld(createM1Area());
    const W = world.state.area.w;
    const i = world.add(obj('bench', 26, 12, { rot: 1 })); // 2×1 rotated → 1×2
    const f = world.state.occ.furniture;
    expect([f[12 * W + 26], f[13 * W + 26], f[12 * W + 27]]).toEqual([i, i, 0]);
    world.remove(i);
    expect(f.some((v) => v !== 0)).toBe(false);
  });

  it('stacked items use the stack grid, wall items the wall grid for their side, ceiling its own', () => {
    const world = new SimWorld(createM1Area());
    const W = world.state.area.w;
    const table = world.add(obj('table', 27, 12));
    const pot = world.add(obj('teapot', 27, 12, { parent: table }));
    const clock = world.add(obj('wall_clock', 28, SHOP.y0, { rot: 1 }));
    const lamp = world.add(obj('hanging_lamp', 27, 12));
    const o = world.state.occ;
    expect(o.furniture[12 * W + 27]).toBe(table);
    expect(o.stack[12 * W + 27]).toBe(pot);
    expect(o.wallN[SHOP.y0 * W + 28]).toBe(clock);
    expect(o.ceiling[12 * W + 27]).toBe(lamp);
    const kids = new Uint16Array(8);
    expect(Array.from(kids.subarray(0, world.state.childrenOf(table, kids)))).toEqual([pot]);
    expect(LAYER.ceiling).toBe(world.objects.layer[lamp]);
  });

  it('uids are stable and reusable for undo; handles change generation when a slot is reused', () => {
    const world = new SimWorld(createM1Area());
    const a = world.add(obj('stool', 26, 12));
    const uid = world.objects.uid[a]!;
    const h1 = world.objects.handle(a);
    world.remove(a);
    const b = world.add(obj('stool', 26, 12), uid);
    expect(world.objects.indexOfUid(uid)).toBe(b);
    expect(world.objects.indexOf(h1)).toBe(0); // old handle is stale
    expect(world.add(obj('stool', 27, 12))).not.toBe(0);
    expect(world.objects.uid[world.objects.indexOfUid(uid + 1)]).toBe(uid + 1);
  });
});

describe('main-thread mirror', () => {
  it('snapshot + incremental frames give identical occupancy, including slot reuse in one frame', () => {
    const world = new SimWorld(createM1Area());
    const view = new WorldView();
    const table = world.add(obj('table_long', 26, 12));
    world.add(obj('teapot', 26, 12, { parent: table }));
    world.add(obj('rug', 30, 14, { rot: 1 }));
    sync(world, view, true);
    sameOccupancy(world, view);
    expect(Array.from(view.area.zone)).toEqual(Array.from(world.state.area.zone));

    const stool = world.add(obj('stool', 29, 16));
    world.update(table, obj('table_long', 27, 13));
    sync(world, view);
    sameOccupancy(world, view);

    // Remove and reuse the same slot before the next frame.
    world.remove(stool);
    const again = world.add(obj('chair', 33, 10, { rot: 3 }));
    expect(again).toBe(stool);
    sync(world, view);
    sameOccupancy(world, view);
    expect(view.state.objects.count).toBe(world.objects.count);
  });
});
