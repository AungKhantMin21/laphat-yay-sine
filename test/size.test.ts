import { describe, expect, it } from 'vitest';
import { BASE_H, computeSize } from '../src/render/size';

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

  it('zoom changes the whole-number scale within range, never below ×1', () => {
    expect(computeSize(1920, 1080, 1, 1, 1).scale).toBe(5);
    expect(computeSize(1920, 1080, 1, 1, -1).scale).toBe(3);
    expect(computeSize(1920, 1080, 1, 1, -5).scale).toBe(3); // clamped to one step out
    expect(computeSize(1920, 1080, 1, 1, 9).scale).toBe(6); // clamped to two steps in
    expect(computeSize(480, 270, 1, 1, -1).scale).toBe(1);
  });

  it('render scale lowers device pixels for low-tier phones', () => {
    const full = computeSize(844, 390, 3);
    const half = computeSize(844, 390, 3, 0.5);
    expect(half.devW).toBe(Math.round(full.devW / 2));
  });
});
