import { describe, expect, it } from 'vitest';
import { THRESHOLDS as T, decideTier, p90 } from '../src/platform/tier-policy';

const fast = { cpuScore: T.cpuHigh * 2, p90FrameMs: 16.7 };
const mid = { cpuScore: (T.cpuLow + T.cpuHigh) / 2, p90FrameMs: 20 };
const slow = { cpuScore: T.cpuLow / 2, p90FrameMs: 40 };

describe('decideTier', () => {
  it('2 GB devices are always Low', () => {
    expect(decideTier({ memoryGb: 2, cores: 8 }, fast)).toBe(0);
  });
  it('slow CPU or slow frames → Low', () => {
    expect(decideTier({}, slow)).toBe(0);
    expect(decideTier({}, { cpuScore: fast.cpuScore, p90FrameMs: T.frameLow + 5 })).toBe(0);
  });
  it('fast benchmark with enough memory and cores → High', () => {
    expect(decideTier({ memoryGb: 8, cores: 8 }, fast)).toBe(2);
    expect(decideTier({}, fast)).toBe(2); // Safari/Firefox: no hints
  });
  it('fast benchmark but 4 GB or 4 cores → Mid', () => {
    expect(decideTier({ memoryGb: 4, cores: 8 }, fast)).toBe(1);
    expect(decideTier({ memoryGb: 8, cores: 4 }, fast)).toBe(1);
  });
  it('middle results → Mid', () => {
    expect(decideTier({ memoryGb: 4, cores: 8 }, mid)).toBe(1);
  });
});

describe('p90', () => {
  it('picks the 90th percentile of the filled part only', () => {
    const a = new Float32Array(200);
    for (let i = 0; i < 100; i++) a[i] = i + 1;
    expect(p90(a, 100)).toBe(91);
    expect(p90(a, 0)).toBe(0);
  });
});
