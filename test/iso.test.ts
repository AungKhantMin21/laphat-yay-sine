import { describe, expect, it } from 'vitest';
import { areaBounds, isoX, isoY, tileAtX, tileAtY, tileXf, tileYf } from '../src/shared/iso';

describe('iso math', () => {
  it('neighbours step by (16, 8) and (−16, 8)', () => {
    expect([isoX(1, 0), isoY(1, 0)]).toEqual([16, 8]);
    expect([isoX(0, 1), isoY(0, 1)]).toEqual([-16, 8]);
  });

  it('screen → tile inverts tile → screen', () => {
    for (let tx = -3; tx < 20; tx++) {
      for (let ty = -3; ty < 20; ty++) {
        expect(tileXf(isoX(tx, ty), isoY(tx, ty))).toBeCloseTo(tx);
        expect(tileYf(isoX(tx, ty), isoY(tx, ty))).toBeCloseTo(ty);
      }
    }
  });

  it('a point inside a diamond picks that tile, edges included', () => {
    const tx = 5;
    const ty = 3;
    const x = isoX(tx, ty);
    const y = isoY(tx, ty);
    // centre, and just inside each corner
    for (const [dx, dy] of [[0, 8], [0, 0.5], [15, 8], [-15.5, 8], [0, 15.5]]) {
      expect([tileAtX(x + dx!, y + dy!), tileAtY(x + dx!, y + dy!)]).toEqual([tx, ty]);
    }
  });

  it('area bounds cover every tile diamond', () => {
    const [x0, y0, x1, y1] = areaBounds(4, 3);
    for (let tx = 0; tx < 4; tx++) {
      for (let ty = 0; ty < 3; ty++) {
        expect(isoX(tx, ty) - 16).toBeGreaterThanOrEqual(x0);
        expect(isoX(tx, ty) + 16).toBeLessThanOrEqual(x1);
        expect(isoY(tx, ty)).toBeGreaterThanOrEqual(y0);
        expect(isoY(tx, ty) + 16).toBeLessThanOrEqual(y1);
      }
    }
  });
});
