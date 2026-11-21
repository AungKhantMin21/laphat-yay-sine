import { describe, expect, it } from 'vitest';
import { fixedSteps, paceFrame } from '../src/game/pacing';

/** Simulates a display at `hz` for `ms` and counts rendered frames under a cap. */
function rendered(hz: number, cap: number, ms = 1000, jitter = 0): number {
  let last = 0;
  let n = 0;
  for (let i = 1; i * (1000 / hz) <= ms; i++) {
    const now = i * (1000 / hz) + (i % 2 ? jitter : -jitter);
    const next = paceFrame(now, last, cap);
    if (next >= 0) {
      last = next;
      n++;
    }
  }
  return n;
}

describe('paceFrame', () => {
  it('60 cap on a 60 Hz screen renders every vsync', () => {
    expect(rendered(60, 60)).toBeGreaterThanOrEqual(59);
  });
  it('30 cap on a 60 Hz screen renders every other vsync, even with jitter', () => {
    const n = rendered(60, 30, 1000, 0.8);
    expect(n).toBeGreaterThanOrEqual(29);
    expect(n).toBeLessThanOrEqual(31);
  });
  it('60 cap on a 120 Hz screen halves the frame rate', () => {
    const n = rendered(120, 60);
    expect(n).toBeGreaterThanOrEqual(59);
    expect(n).toBeLessThanOrEqual(61);
  });
  it('after a long stall it does not try to catch up', () => {
    expect(paceFrame(1000, 0, 30)).toBe(1000);
  });
});

describe('fixedSteps', () => {
  it('runs one step per 16.67 ms and keeps the remainder', () => {
    const acc = { t: 0 };
    expect(fixedSteps(acc, 20, 1000 / 60)).toBe(1);
    expect(acc.t).toBeCloseTo(20 - 1000 / 60);
  });
  it('clamps a long stall to maxSteps and drops the backlog', () => {
    const acc = { t: 0 };
    expect(fixedSteps(acc, 5000, 1000 / 60, 5)).toBe(5);
    expect(acc.t).toBe(0);
  });
});
