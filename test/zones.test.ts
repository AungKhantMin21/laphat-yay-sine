// M2.5 walk zones: every path a customer can take — from every spawn point to every seat and back
// out — stays on allowed zones, enters the shop only through the front opening, never crosses a
// wall, and never enters the kitchen. Staff reach the kitchen through its door.
import { describe, expect, it } from 'vitest';
import { Game } from '../src/sim/game';
import { CATALOG, LAYER, footH, footW } from '../src/shared/catalog';
import { ACCESS, WZ, isShopZone, mayEnter } from '../src/shared/rules/access';
import { PATH } from '../src/sim/path/pathfinder';
import { KITCHEN, KITCHEN_DOOR, SEATING, SPAWN_ROWS } from '../src/sim/area';
import { Rng } from '../src/shared/rng';
import { FrameWriter } from '../src/shared/diff';

const T = (key: string): number => CATALOG.byKey.get(key)!.id;

function game(seed: number): Game {
  const g = Game.create(seed);
  for (const key of ['stool', 'table', 'bench', 'chair', 'table_long']) g.builder.give(T(key), 60);
  g.builder.money = 10_000_000;
  return g;
}

/** Random furniture, through the real placement rules (illegal spots are refused). */
function furnishRandomly(g: Game, seed: number, tries: number): void {
  const r = new Rng(seed);
  const keys = ['stool', 'stool', 'stool', 'table', 'bench', 'chair', 'table_long'];
  for (let k = 0; k < tries; k++) {
    const key = keys[r.int(keys.length)]!;
    g.act({ k: 'place', type: T(key), x: SEATING.x0 + r.int(SEATING.x1 - SEATING.x0), y: KITCHEN.y0 + r.int(SEATING.y1 - KITCHEN.y0), rot: r.int(4), colour: 0 });
  }
  g.syncWalk();
}

/** Every seat tile of floor-standing seating furniture. */
function seats(g: Game): number[] {
  const s = g.world.objects;
  const W = g.walk.w;
  const out: number[] = [];
  for (let o = 1; o < s.capacity; o++) {
    if (!s.live[o] || s.layer[o] !== LAYER.furniture || s.parent[o] !== 0) continue;
    const def = CATALOG.defs[s.type[o]!]!;
    if (def.seat <= 0) continue;
    let k = 0;
    for (let dy = 0; dy < footH(def, s.rot[o]!); dy++) for (let dx = 0; dx < footW(def, s.rot[o]!) && k < def.seat; dx++, k++) out.push((s.y[o]! + dy) * W + s.x[o]! + dx);
  }
  return out;
}

function spawns(g: Game): number[] {
  const W = g.walk.w;
  return SPAWN_ROWS.flatMap((y) => [y * W, y * W + W - 1]);
}

/** Finds a path (all at once) and returns its tiles including the start, or null if it failed. */
function route(g: Game, from: number, to: number, cls: number): number[] | null {
  const h = g.paths.request(from, to, cls);
  g.paths.tick(1_000_000);
  const ok = g.paths.statusOf(h) === PATH.done;
  const tiles = ok ? [from, ...Array.from({ length: g.paths.length(h) }, (_, k) => g.paths.tileAt(h, k))] : null;
  g.paths.release(h);
  return tiles;
}

/** Checks one customer route; returns a description of the first problem, or ''. */
function badStep(g: Game, tiles: number[], goal: number): string {
  const acc = g.world.state.area.access;
  for (let k = 0; k < tiles.length; k++) {
    const t = tiles[k]!;
    if (!mayEnter(ACCESS.people, acc[t]!)) return `tile ${t} in zone ${acc[t]}`;
    if (k === 0) continue;
    const p = tiles[k - 1]!;
    if (!g.paths.canStep(p, t, goal)) return `step ${p}→${t} crosses a wall or blocked corner`;
    // Into the shop from outside: only onto a front tile; out of the shop: only from one.
    const pin = isShopZone(acc[p]!);
    const tin = isShopZone(acc[t]!);
    if (!pin && tin && acc[t] !== WZ.front) return `entered the shop at ${t} (zone ${acc[t]})`;
    if (pin && !tin && acc[p] !== WZ.front) return `left the shop from ${p} (zone ${acc[p]})`;
  }
  return '';
}

function checkLayout(g: Game): { routes: number; seats: number } {
  let routes = 0;
  const all = seats(g);
  for (const seat of all) {
    for (const s of spawns(g)) {
      const into = route(g, s, seat, ACCESS.people);
      if (!into) continue; // a walled-in seat: customers never choose it (customers.test.ts)
      expect(badStep(g, into, seat), `in: spawn ${s} → seat ${seat}`).toBe('');
      const out = route(g, seat, s, ACCESS.people);
      expect(out, `out: seat ${seat} → spawn ${s}`).not.toBeNull();
      expect(badStep(g, out!, seat), `out: seat ${seat} → spawn ${s}`).toBe('');
      routes += 2;
    }
  }
  return { routes, seats: all.length };
}

describe('walk zones', () => {
  it('a furnished shop: every spawn ↔ every seat stays on allowed zones and uses the front', () => {
    const g = game(1);
    furnishRandomly(g, 99, 400);
    const r = checkLayout(g);
    expect(r.seats).toBeGreaterThan(6);
    expect(r.routes).toBeGreaterThan(100);
  });

  it('holds for random layouts too', () => {
    for (let seed = 1; seed <= 5; seed++) {
      const g = game(seed);
      furnishRandomly(g, seed * 31, 60);
      checkLayout(g);
    }
  });

  it('customers never reach the kitchen; staff do, through its door', () => {
    const g = game(2);
    furnishRandomly(g, 7, 200);
    const W = g.walk.w;
    const door = KITCHEN_DOOR.y * W + KITCHEN_DOOR.x;
    const acc = g.world.state.area.access;
    let staffRoutes = 0;
    for (let t = 0; t < acc.length; t++) {
      if (acc[t] !== WZ.kitchen || !g.walkStaff.passable(t)) continue;
      expect(route(g, spawns(g)[0]!, t, ACCESS.people), `customer to kitchen tile ${t}`).toBeNull();
      // Furniture may box in a kitchen corner (only the door must stay open); every route in uses the door.
      const s = route(g, spawns(g)[0]!, t, ACCESS.staff);
      if (!s) continue;
      expect(s).toContain(door);
      staffRoutes++;
    }
    expect(staffRoutes).toBeGreaterThan(5);
    expect(route(g, spawns(g)[0]!, door, ACCESS.staff)).not.toBeNull();
  });

  it('spawned customers walk only on allowed zones all day', () => {
    const g = game(4);
    furnishRandomly(g, 4, 200);
    g.act({ k: 'openShop' });
    const acc = g.world.state.area.access;
    const W = g.walk.w;
    let seen = 0;
    const w = new FrameWriter();
    let buf = new ArrayBuffer(1 << 16);
    for (let k = 0; k < 3000; k++) {
      if (k % 5 === 0) g.npcs.spawn();
      w.begin(buf, g.sim.tick, g.sim.gameMinute);
      g.step(w);
      buf = w.finish();
      for (let i = 1; i < g.npcs.capacity; i++) {
        if (!g.npcs.alive[i]) continue;
        const t = Math.floor(g.npcs.y[i]!) * W + Math.floor(g.npcs.x[i]!);
        expect(mayEnter(ACCESS.people, acc[t]!), `customer on tile ${t} zone ${acc[t]}`).toBe(true);
        seen++;
      }
      g.events.length = 0;
    }
    expect(seen).toBeGreaterThan(1000);
  });
});
