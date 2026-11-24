// M3 S2: the neighbourhood map from src/data/neighbourhood.json — validation, zones, building
// fronts on both back edges, and every errand within the 40-second walking cap.
import { describe, expect, it } from 'vitest';
import raw from '../src/data/neighbourhood.json';
import { NEIGHBOURHOOD, buildNeighbourhood, spanTile, type RawNeighbourhood } from '../src/shared/neighbourhood';
import { ACCESS, WZ, mayEnter } from '../src/shared/rules/access';
import { FACADE_WEST } from '../src/shared/street';
import { SHOP as SHOP_RULES } from '../src/shared/shop';
import { createArea, OPENING, SHOP } from '../src/sim/area';
import { Game } from '../src/sim/game';
import { PATH } from '../src/sim/path/pathfinder';

const N = NEIGHBOURHOOD;

describe('neighbourhood data', () => {
  const bad = (patch: (d: RawNeighbourhood) => void) => () => {
    const d = JSON.parse(JSON.stringify(raw)) as RawNeighbourhood;
    patch(d);
    buildNeighbourhood(d);
  };

  it('rejects bad sizes, rects, paint keys, overlapping fronts and shops without a proper visit tile', () => {
    expect(bad((d) => (d.size = [200, 50]))).toThrow(/size/);
    expect(bad((d) => (d.rects.road = [0, 22, 999, 28]))).toThrow(/bounds/);
    expect(bad((d) => delete d.rects.kitchen)).toThrow(/missing rect "kitchen"/);
    expect(bad((d) => d.paint.push(['road', 'lava', 'road']))).toThrow(/unknown floor/);
    expect(bad((d) => d.paint.push(['road', 'road', 'sky']))).toThrow(/unknown zone/);
    expect(bad((d) => d.buildings.push({ ...d.buildings[0]! }))).toThrow(/overlaps/);
    expect(bad((d) => (d.shops[0]!.visit = d.shops[0]!.to))).toThrow(/visit/);
    expect(bad((d) => (d.shops[0]!.hours = ['11:00', '05:00']))).toThrow(/closes before/);
  });

  it('has the four shops and keeps the tea shop where saves expect it', () => {
    expect(N.shops.map((s) => s.key)).toEqual(['market', 'books', 'furniture', 'hardware']);
    expect(SHOP).toEqual({ x0: 24, y0: 9, x1: 36, y1: 19 });
    expect(OPENING).toEqual({ x0: 30, x1: 34 });
    // Errands fit the held clock: every shop is open at shutters-up or at closing time.
    for (const s of N.shops) expect(s.open <= SHOP_RULES.open || s.close >= SHOP_RULES.close).toBe(true);
  });
});

describe('the neighbourhood grids', () => {
  const a = createArea();
  const at = (x: number, y: number): number => y * a.w + x;

  it('entries and visit tiles are pavement; counters and keepers are blocked', () => {
    for (const e of N.entries) expect(a.access[at(e.x, e.y)]).toBe(WZ.pavement);
    for (const s of N.shops) {
      expect(a.access[at(s.visitX, s.visitY)]).toBe(WZ.pavement);
      expect(a.access[at(s.keeperX, s.keeperY)]).toBe(WZ.blocked);
      const counter = s.edge === 'n' ? at(s.visitX, s.at - 1) : at(s.at - 1, s.visitY);
      expect(a.access[counter]).toBe(WZ.blocked);
    }
  });

  it('building fronts sit on the back edge of their street, marked west on −x edges', () => {
    for (const b of N.buildings) {
      for (let p = b.from; p < b.to; p++) {
        const t = spanTile(b, p);
        const f = a.facade[at(t.x, t.y)]!;
        expect(f).not.toBe(0);
        expect((f & FACADE_WEST) !== 0).toBe(b.edge === 'w');
        expect(mayEnter(ACCESS.people, a.access[at(t.x, t.y)]!)).toBe(true);
      }
    }
  });

  it('all walkable street tiles form one connected network for customers', () => {
    const seen = new Uint8Array(a.w * a.h);
    const start = at(N.entries[0]!.x, N.entries[0]!.y);
    const q = [start];
    seen[start] = 1;
    while (q.length) {
      const c = q.pop()!;
      const x = c % a.w;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
        const nx = x + dx;
        const ny = (c - x) / a.w + dy;
        if (nx < 0 || ny < 0 || nx >= a.w || ny >= a.h) continue;
        const n = at(nx, ny);
        const z = a.access[n]!;
        if (seen[n] || !(z === WZ.pavement || z === WZ.crossing)) continue;
        seen[n] = 1;
        q.push(n);
      }
    }
    for (let t = 0; t < a.w * a.h; t++) if (a.access[t] === WZ.pavement || a.access[t] === WZ.crossing) expect(seen[t], `tile ${t % a.w},${Math.floor(t / a.w)}`).toBe(1);
  });
});

describe('errands', () => {
  it('every shop is within the 40-second cap from the shop front (≤ 130 path tiles), on allowed zones', () => {
    const g = Game.create(1);
    const W = g.walk.w;
    const from = (SHOP.y1 - 1) * W + OPENING.x0;
    for (const s of N.shops) {
      const h = g.paths.request(from, s.visitY * W + s.visitX, ACCESS.staff);
      g.paths.tick(1_000_000);
      expect(g.paths.statusOf(h), s.key).toBe(PATH.done);
      const n = g.paths.length(h);
      expect(n, s.key).toBeLessThanOrEqual(130);
      for (let k = 0; k < n; k++) {
        const z = g.world.state.area.access[g.paths.tileAt(h, k)]!;
        expect(z === WZ.road, `${s.key} steps on the road`).toBe(false);
      }
      g.paths.release(h);
    }
  });
});
