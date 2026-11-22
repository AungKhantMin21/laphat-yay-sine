import { describe, expect, it } from 'vitest';
import { BASE_H, DEFAULT_ZOOM, computeSize } from '../src/render/size';

describe('computeSize', () => {
  it('1080p desktop is exactly 480×270 at ×4', () => {
    expect(computeSize(1920, 1080, 1)).toEqual({ w: 480, h: 270, scale: 4, devW: 1920, devH: 1080, devPerCss: 1, zoom: 0 });
  });

  it('a 20:9 phone in landscape sees more street, not bars', () => {
    const s = computeSize(915, 412, 2.625); // Pixel 7
    expect(s.scale).toBe(4);
    expect(s.h).toBeGreaterThanOrEqual(BASE_H);
    expect(s.w).toBeGreaterThan(480);
    expect(s.w * s.scale).toBeGreaterThanOrEqual(s.devW);
    expect(s.h * s.scale).toBeGreaterThanOrEqual(s.devH);
  });

  it('always uses a whole-number scale of at least 1', () => {
    for (const [w, h, d] of [[320, 200, 1], [844, 390, 3], [1366, 768, 1], [2560, 1440, 1.5]] as const) {
      const s = computeSize(w, h, d);
      expect(Number.isInteger(s.scale)).toBe(true);
      expect(s.scale).toBeGreaterThanOrEqual(1);
      expect((s.w - 1) * s.scale).toBeLessThan(s.devW);
    }
  });

  it('zoom changes the whole-number scale within range: never wider than 270 rows, up to three steps in', () => {
    expect(computeSize(1920, 1080, 1, 1, 1).scale).toBe(5);
    expect(computeSize(1920, 1080, 1, 1, -1).scale).toBe(4); // clamped to the widest view
    expect(computeSize(1920, 1080, 1, 1, 9).scale).toBe(7); // clamped to three steps in
    expect(computeSize(480, 270, 1, 1, -1).scale).toBe(1);
  });

  it('the default zoom makes characters readable on a landscape phone', () => {
    // iPhone-class phone in landscape: 844×390 CSS px at dpr 3.
    const s = computeSize(844, 390, 3, 1, DEFAULT_ZOOM);
    expect(s.h).toBeGreaterThanOrEqual(180);
    expect(s.h).toBeLessThanOrEqual(240);
    // A 24 px character is about 40 CSS px tall.
    expect((24 * s.scale) / 3).toBeGreaterThanOrEqual(38);
  });

  it('render scale lowers device pixels for low-tier phones', () => {
    const full = computeSize(844, 390, 3);
    const half = computeSize(844, 390, 3, 0.5);
    expect(half.devW).toBe(Math.round(full.devW / 2));
  });
});
