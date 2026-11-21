import { describe, expect, it } from 'vitest';
import { AreaGrids, WorldState } from '../src/shared/world-state';
import { FLOOR, WALL } from '../src/shared/layout';
import { BLOCKED, WALK, WalkGrid, buildWalkConfig, type WalkConfig } from '../src/sim/path/walk-grid';
import { PATH, PathFinder } from '../src/sim/path/pathfinder';
import { Rng } from '../src/shared/rng';
import { Game } from '../src/sim/game';
import { CATALOG } from '../src/shared/catalog';
import { SHOP } from '../src/sim/area';
import rawWalk from '../src/data/walk.json';

/** A small test area: all pavement; '#' in the map = blocked by marking furniture occupancy. */
function makeArea(map: string[]): { walk: WalkGrid; area: AreaGrids; state: WorldState } {
  const h = map.length;
  const w = map[0]!.length;
  const area = new AreaGrids(0, w, h);
  area.floor.fill(FLOOR.pavement);
  const state = new WorldState(area);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const c = map[y]![x];
      if (c === '#') state.occ.furniture[y * w + x] = 1;
      if (c === 'r') area.floor[y * w + x] = FLOOR.road;
      if (c === ' ') area.floor[y * w + x] = FLOOR.none;
    }
  }
  return { walk: new WalkGrid(area, state.occ), area, state };
}

function find(pf: PathFinder, from: number, to: number, budget = 1_000_000): number {
  const h = pf.request(from, to);
  pf.tick(budget);
  return h;
}

function tilesOf(pf: PathFinder, h: number): number[] {
  const out: number[] = [];
  for (let k = 0; k < pf.length(h); k++) out.push(pf.tileAt(h, k));
  return out;
}

/** Independent reference: plain Dijkstra over the same movement rules (O(n²), fine for tests). */
function referenceCost(walk: WalkGrid, from: number, to: number): number {
  const w = walk.w;
  const n = walk.w * walk.h;
  const dist = new Array<number>(n).fill(Infinity);
  const done = new Array<boolean>(n).fill(false);
  const free = (t: number) => walk.cost[t] !== BLOCKED;
  dist[from] = 0;
  for (;;) {
    let u = -1;
    for (let t = 0; t < n; t++) if (!done[t] && dist[t]! < Infinity && (u < 0 || dist[t]! < dist[u]!)) u = t;
    if (u < 0) return Infinity;
    if (u === to) return dist[u]!;
    done[u] = true;
    const ux = u % w;
    const uy = Math.floor(u / w);
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dy) continue;
        const vx = ux + dx;
        const vy = uy + dy;
        if (vx < 0 || vy < 0 || vx >= w || vy >= walk.h) continue;
        const v = vy * w + vx;
        if (!free(v) && v !== to) continue;
        let ok: boolean;
        if (!dx || !dy) ok = walk.edgeOpen(ux, uy, vx, vy);
        else
          ok = free(uy * w + vx) && free(vy * w + ux) && walk.edgeOpen(ux, uy, vx, uy) && walk.edgeOpen(vx, uy, vx, vy) && walk.edgeOpen(ux, uy, ux, vy) && walk.edgeOpen(ux, vy, vx, vy);
        if (!ok) continue;
        const c = free(v) ? walk.cost[v]! : 10;
        const step = dx && dy ? Math.floor((c * 14 + 5) / 10) : c;
        if (dist[u]! + step < dist[v]!) dist[v] = dist[u]! + step;
      }
    }
  }
}

/** Cost of a found path under the same rules, checking every step is legal. */
function pathCost(pf: PathFinder, from: number, h: number, goal: number): number {
  const walk = pf.walk;
  let cost = 0;
  let prev = from;
  for (const t of tilesOf(pf, h)) {
    expect(pf.canStep(prev, t, goal), `step ${prev}→${t}`).toBe(true);
    const c = walk.cost[t] === BLOCKED ? 10 : walk.cost[t]!;
    const diag = prev % walk.w !== t % walk.w && Math.floor(prev / walk.w) !== Math.floor(t / walk.w);
    cost += diag ? Math.floor((c * 14 + 5) / 10) : c;
    prev = t;
  }
  expect(prev).toBe(goal);
  return cost;
}

describe('walk config', () => {
  it('loads walk.json; rejects unknown floors and costs below the heuristic minimum', () => {
    expect(WALK.floorCost[FLOOR.pavement]).toBe(10);
    expect(WALK.floorCost[FLOOR.none]).toBe(BLOCKED);
    expect(() => buildWalkConfig({ ...rawWalk, floorCost: { lava: 10 } })).toThrow(/unknown floor/);
    expect(() => buildWalkConfig({ ...rawWalk, floorCost: { road: 5 } })).toThrow(/10…254/);
  });
});

describe('A*', () => {
  it('walks a straight open line in Chebyshev steps', () => {
    const { walk } = makeArea(['........', '........', '........']);
    const pf = new PathFinder(walk);
    const h = find(pf, 0, 2 * 8 + 7);
    expect(pf.statusOf(h)).toBe(PATH.done);
    expect(pf.length(h)).toBe(7);
    expect(pf.tileAt(h, 6)).toBe(23);
  });

  it('start = goal gives an empty, finished path', () => {
    const { walk } = makeArea(['...']);
    const pf = new PathFinder(walk);
    const h = find(pf, 1, 1);
    expect(pf.statusOf(h)).toBe(PATH.done);
    expect(pf.length(h)).toBe(0);
  });

  it('goes around obstacles, never through them', () => {
    const map = ['..........', '.######...', '......#...', '.####.#...', '......#...'];
    const { walk } = makeArea(map);
    const pf = new PathFinder(walk);
    const from = 0;
    const goal = 4 * 10 + 7;
    const h = find(pf, from, goal);
    expect(pf.statusOf(h)).toBe(PATH.done);
    for (const t of tilesOf(pf, h)) expect(map[Math.floor(t / 10)]![t % 10]).not.toBe('#');
    expect(pathCost(pf, from, h, goal)).toBe(referenceCost(walk, from, goal));
  });

  it('never cuts a corner between two blocked tiles', () => {
    const { walk } = makeArea(['.#', '#.']);
    const pf = new PathFinder(walk);
    expect(pf.statusOf(find(pf, 0, 3))).toBe(PATH.failed);
    expect(pf.canStep(0, 3)).toBe(false);
  });

  it('a blocked goal (a seat) is reachable as the destination but never walked through', () => {
    const map = ['.....', '..#..', '.....'];
    const { walk } = makeArea(map);
    const pf = new PathFinder(walk);
    const seat = 1 * 5 + 2;
    const h = find(pf, 0, seat);
    expect(pf.statusOf(h)).toBe(PATH.done);
    expect(pf.tileAt(h, pf.length(h) - 1)).toBe(seat);
    // Through the seat to the other side is not allowed: the path goes around.
    const h2 = find(pf, 1 * 5 + 1, 1 * 5 + 3);
    expect(tilesOf(pf, h2)).not.toContain(seat);
  });

  it('prefers cheaper floor: walks the pavement round a road strip when that is cheaper', () => {
    const { walk } = makeArea(['.....', 'rrrrr', '.....']);
    const pf = new PathFinder(walk);
    const h = find(pf, 1 * 5 + 0, 1 * 5 + 4);
    const cost = pathCost(pf, 5, h, 9);
    expect(cost).toBe(referenceCost(walk, 5, 9));
  });

  it('back walls block the edge they stand on', () => {
    const { walk, area } = makeArea(['....', '....', '....']);
    // A west wall along x = 2 for every row: the only way across is... none.
    for (let y = 0; y < 3; y++) area.wall[y * 4 + 2] = area.wall[y * 4 + 2]! | WALL.w;
    walk.update(0, 0, 4, 3); // walls only change on area load; the cached move masks need a refresh
    const pf = new PathFinder(walk);
    expect(pf.statusOf(find(pf, 0, 3))).toBe(PATH.failed);
    // Open a gap in the middle row: the path must use it.
    area.wall[1 * 4 + 2] = 0;
    walk.update(0, 0, 4, 3);
    const h = find(pf, 0, 3);
    expect(pf.statusOf(h)).toBe(PATH.done);
    expect(tilesOf(pf, h)).toContain(1 * 4 + 2);
    expect(pathCost(pf, 0, h, 3)).toBe(referenceCost(walk, 0, 3));
  });

  it('north walls block vertical steps and the diagonals across them', () => {
    const { walk, area } = makeArea(['...', '...']);
    for (let x = 0; x < 3; x++) area.wall[1 * 3 + x] = area.wall[1 * 3 + x]! | WALL.n;
    walk.update(0, 0, 3, 2);
    const pf = new PathFinder(walk);
    expect(pf.canStep(0, 3)).toBe(false);
    expect(pf.canStep(0, 4)).toBe(false);
    expect(pf.canStep(3, 0)).toBe(false);
    expect(pf.statusOf(find(pf, 0, 5))).toBe(PATH.failed);
  });

  it('missing floor is not walkable; an enclosed goal fails', () => {
    const { walk } = makeArea(['.. ..', '.. ..']);
    const pf = new PathFinder(walk);
    expect(pf.statusOf(find(pf, 0, 4))).toBe(PATH.failed);
  });

  it('is optimal on random grids (same cost as a plain Dijkstra)', () => {
    const rng = new Rng(2024);
    for (let trial = 0; trial < 40; trial++) {
      const w = 6 + rng.int(10);
      const h = 4 + rng.int(8);
      const map: string[] = [];
      for (let y = 0; y < h; y++) {
        let row = '';
        for (let x = 0; x < w; x++) row += rng.chance(0.25) ? '#' : rng.chance(0.15) ? 'r' : '.';
        map.push(row);
      }
      const { walk, area } = makeArea(map);
      for (let t = 0; t < w * h; t++) if (rng.chance(0.08)) area.wall[t] = area.wall[t]! | (rng.chance(0.5) ? WALL.n : WALL.w);
      walk.update(0, 0, w, h);
      const pf = new PathFinder(walk);
      const from = rng.int(w * h);
      const goal = rng.int(w * h);
      const ref = referenceCost(walk, from, goal);
      const hd = find(pf, from, goal);
      if (ref === Infinity) expect(pf.statusOf(hd), `trial ${trial}`).toBe(PATH.failed);
      else {
        expect(pf.statusOf(hd), `trial ${trial}`).toBe(PATH.done);
        expect(pathCost(pf, from, hd, goal), `trial ${trial}`).toBe(ref);
      }
    }
  });
});

describe('budget, queue and pool', () => {
  const MAP = ['............', '.#########..', '..........#.', '#########.#.', '............'];

  it('a search split across many ticks gives the same path as one big tick', () => {
    const a = makeArea(MAP);
    const b = makeArea(MAP);
    const pa = new PathFinder(a.walk);
    const pb = new PathFinder(b.walk);
    const ha = find(pa, 0, 4 * 12 + 0);
    const hb = pb.request(0, 4 * 12 + 0);
    let ticks = 0;
    while (pb.statusOf(hb) === PATH.queued) {
      pb.tick(3);
      ticks++;
    }
    expect(ticks).toBeGreaterThan(5);
    expect(tilesOf(pb, hb)).toEqual(tilesOf(pa, ha));
  });

  it('serves requests in order within the budget', () => {
    const { walk } = makeArea(MAP);
    const pf = new PathFinder(walk);
    const h1 = pf.request(0, 11);
    const h2 = pf.request(0, 2);
    pf.tick(1);
    expect(pf.statusOf(h1)).toBe(PATH.queued);
    expect(pf.statusOf(h2)).toBe(PATH.queued);
    pf.tick(1000);
    expect(pf.statusOf(h1)).toBe(PATH.done);
    expect(pf.statusOf(h2)).toBe(PATH.done);
  });

  it('release cancels queued and running searches; stale handles read as none', () => {
    const { walk } = makeArea(MAP);
    const pf = new PathFinder(walk);
    const running = pf.request(0, 4 * 12);
    const queued = pf.request(0, 11);
    const after = pf.request(0, 2);
    pf.tick(2);
    pf.release(running);
    pf.release(queued);
    expect(pf.statusOf(running)).toBe(PATH.none);
    pf.tick(1000);
    expect(pf.statusOf(after)).toBe(PATH.done);
    expect(pf.inUse).toBe(1);
    const reused = pf.request(0, 1); // may reuse a released slot with a new generation
    expect(pf.statusOf(queued)).toBe(PATH.none);
    pf.tick(1000);
    expect(pf.statusOf(reused)).toBe(PATH.done);
  });

  it('returns NONE when every path slot is in use', () => {
    const { walk } = makeArea(['....']);
    const cfg: WalkConfig = { ...WALK, pathSlots: 2 };
    const pf = new PathFinder(walk, cfg);
    expect(pf.request(0, 1)).not.toBe(0);
    expect(pf.request(0, 2)).not.toBe(0);
    expect(pf.request(0, 3)).toBe(0);
  });

  it('a path longer than maxPathLen fails instead of overflowing its slot', () => {
    const { walk } = makeArea(['..........']);
    const pf = new PathFinder(walk, { ...WALK, maxPathLen: 4 });
    expect(pf.statusOf(find(pf, 0, 9))).toBe(PATH.failed);
    expect(pf.statusOf(find(pf, 0, 4))).toBe(PATH.done);
  });

  it('a dirty-rect update leaves the same costs and move masks as a full rebuild', () => {
    const rng = new Rng(77);
    const { walk, state, area } = makeArea(['..........', '..........', '..........', '..........', '..........', '..........']);
    for (let t = 0; t < 60; t++) if (rng.chance(0.1)) area.wall[t] = area.wall[t]! | WALL.n;
    walk.update(0, 0, 10, 6);
    for (let k = 0; k < 30; k++) {
      const x = rng.int(10);
      const y = rng.int(6);
      state.occ.furniture[y * 10 + x] = state.occ.furniture[y * 10 + x]! ^ 1;
      walk.update(x, y, x + 1, y + 1);
    }
    const full = new WalkGrid(area, state.occ);
    expect(Array.from(walk.cost)).toEqual(Array.from(full.cost));
    expect(Array.from(walk.moves)).toEqual(Array.from(full.moves));
  });

  it('restarts a search in flight when the walk grid changes', () => {
    const { walk, state } = makeArea(['......', '......', '......']);
    const pf = new PathFinder(walk);
    const h = pf.request(0, 5);
    pf.tick(2);
    // Block the whole middle column except the bottom row, mid-search.
    state.occ.furniture[3] = 1;
    state.occ.furniture[9] = 1;
    walk.update(3, 0, 4, 2);
    pf.tick(10_000);
    expect(pf.statusOf(h)).toBe(PATH.done);
    for (const t of tilesOf(pf, h)) expect([3, 9]).not.toContain(t);
  });
});

describe('walk grid in the game', () => {
  const T = (key: string) => CATALOG.byKey.get(key)!.id;

  it('building updates walk costs only around the change, and paths avoid new furniture', () => {
    const g = Game.create(5);
    const W = g.walk.w;
    const at = (x: number, y: number) => y * W + x;
    const x = SHOP.x0 + 4;
    const y = SHOP.y0 + 4;
    expect(g.walk.passable(at(x, y))).toBe(true);
    const r = g.act({ k: 'place', type: T('table_long'), x, y, rot: 0, colour: 0 });
    expect(r.ok).toBe(true);
    const v = g.walk.version;
    g.syncWalk();
    expect(g.walk.version).toBe(v + 1);
    expect(g.walk.passable(at(x, y))).toBe(false);
    expect(g.walk.passable(at(x + 1, y))).toBe(false);
    // A small item on the table doesn't change walking; a rug on the floor doesn't block.
    g.act({ k: 'place', type: T('teapot'), x, y, rot: 0, colour: 0 });
    g.act({ k: 'place', type: T('rug'), x: SHOP.x0 + 7, y: SHOP.y0 + 6, rot: 0, colour: 0 });
    g.syncWalk();
    expect(g.walk.version).toBe(v + 1);
    expect(g.walk.passable(at(SHOP.x0 + 7, SHOP.y0 + 6))).toBe(true);
    // Picking the table up frees the tiles again.
    g.act({ k: 'pickup', id: g.world.objects.handle(r.index!) });
    g.syncWalk();
    expect(g.walk.passable(at(x, y))).toBe(true);
  });

  it('customers can walk from the street into the shop, but not through the back walls', () => {
    const g = Game.create(5);
    const W = g.walk.w;
    const at = (x: number, y: number) => y * W + x;
    const h = find(g.paths, at(2, 24), at(SHOP.x0 + 2, SHOP.y0 + 2));
    expect(g.paths.statusOf(h)).toBe(PATH.done);
    // Behind the back wall to just inside it: must go around, so the path is long.
    const behind = at(SHOP.x0 - 1, SHOP.y0 + 2);
    const inside = at(SHOP.x0, SHOP.y0 + 2);
    expect(g.paths.canStep(behind, inside)).toBe(false);
    const h2 = find(g.paths, behind, inside);
    expect(g.paths.statusOf(h2)).toBe(PATH.done);
    expect(g.paths.length(h2)).toBeGreaterThan(5);
  });

  it('a corner-to-corner search keeps every tick within the node budget and finishes over a few ticks', () => {
    const g = Game.create(5);
    const W = g.walk.w;
    const h = g.paths.request(0, (g.walk.h - 1) * W + W - 1);
    let ticks = 0;
    while (g.paths.statusOf(h) === PATH.queued && ticks < 20) {
      const before = g.paths.expansions;
      g.paths.tick();
      expect(g.paths.expansions - before).toBeLessThanOrEqual(WALK.nodesPerTick);
      ticks++;
    }
    expect(g.paths.statusOf(h)).toBe(PATH.done);
    expect(ticks).toBeLessThanOrEqual(3);
  });
});
