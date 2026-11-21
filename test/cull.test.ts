import { describe, expect, it } from 'vitest';
import { SpatialHash } from '../src/render/cull';

const ids = (h: SpatialHash, x0: number, y0: number, x1: number, y1: number): number[] => {
  const out = new Int32Array(64);
  return Array.from(out.subarray(0, h.query(x0, y0, x1, y1, out))).sort((a, b) => a - b);
};

describe('SpatialHash', () => {
  it('finds overlapping boxes once each, including boxes spanning many cells and negative coords', () => {
    const h = new SpatialHash(64, 16);
    h.insert(1, 0, 0, 10, 10);
    h.insert(2, -300, -50, 300, 50); // spans many cells
    h.insert(3, 500, 500, 520, 520);
    expect(ids(h, -5, -5, 20, 20)).toEqual([1, 2]);
    expect(ids(h, 400, 400, 600, 600)).toEqual([3]);
    expect(ids(h, 1000, 1000, 1100, 1100)).toEqual([]);
  });

  it('update moves an item between cells; remove drops it', () => {
    const h = new SpatialHash(64, 4);
    h.insert(1, 0, 0, 8, 8);
    h.update(1, 200, 200, 208, 208);
    expect(ids(h, 0, 0, 50, 50)).toEqual([]);
    expect(ids(h, 190, 190, 210, 210)).toEqual([1]);
    h.update(1, 201, 201, 209, 209); // same cells
    expect(ids(h, 190, 190, 210, 210)).toEqual([1]);
    h.remove(1);
    expect(ids(h, 0, 0, 1000, 1000)).toEqual([]);
  });
});
