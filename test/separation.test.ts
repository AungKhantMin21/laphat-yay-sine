// M4 S9: pavement separation — walkers prefer one of three rows across the pavement (by their slot),
// so two people walking the same way don't overlap in single file. Paths stay valid and cheap.
import { describe, expect, it } from 'vitest';
import { Game } from '../src/sim/game';
import { PATH } from '../src/sim/path/pathfinder';
import { ACCESS } from '../src/shared/rules/access';

function path(g: Game, from: [number, number], to: [number, number], lane: number): number[] {
  const W = g.walk.w;
  const h = g.paths.request(from[1] * W + from[0], to[1] * W + to[0], ACCESS.people, lane);
  for (let k = 0; k < 200 && g.paths.statusOf(h) === PATH.queued; k++) g.paths.tick();
  expect(g.paths.statusOf(h)).toBe(PATH.done);
  const out: number[] = [];
  for (let k = 0; k < g.paths.length(h); k++) out.push(g.paths.tileAt(h, k));
  g.paths.release(h);
  return out;
}

describe('pavement rows', () => {
  it('two walkers along the tea street keep to different rows for most of the way', () => {
    const g = Game.create(71);
    const W = g.walk.w;
    const a = path(g, [0, 20], [22, 20], 0);
    const b = path(g, [0, 20], [22, 20], 2);
    const rowAt = (p: number[], x: number): number => {
      const t = p.find((t) => t % W === x);
      return t === undefined ? -1 : Math.floor(t / W);
    };
    let apart = 0;
    for (let x = 3; x < 20; x++) if (rowAt(a, x) !== rowAt(b, x)) apart++;
    expect(apart).toBeGreaterThanOrEqual(12);
    // Still a short walk: at most a few tiles longer than the straight line.
    expect(a.length).toBeLessThanOrEqual(25);
    expect(b.length).toBeLessThanOrEqual(25);
  });

  it('the same along the market street (a pavement running along y)', () => {
    const g = Game.create(72);
    const W = g.walk.w;
    const a = path(g, [65, 32], [65, 60], 0);
    const b = path(g, [65, 32], [65, 60], 2);
    const colAt = (p: number[], y: number): number => p.find((t) => Math.floor(t / W) === y)! % W;
    let apart = 0;
    for (let y = 35; y < 57; y++) if (colAt(a, y) !== colAt(b, y)) apart++;
    expect(apart).toBeGreaterThanOrEqual(15);
  });
});
