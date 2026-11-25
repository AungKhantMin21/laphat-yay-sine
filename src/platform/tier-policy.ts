// Pure tier decision + per-tier settings (no DOM), tested in test/tier.test.ts.
import type { Tier } from '../shared/protocol';

export const TIER = { low: 0, mid: 1, high: 2 } as const;
export const TIER_NAMES = ['low', 'mid', 'high'] as const;

/** Bump when the benchmark or thresholds change, so stored results are re-measured. */
export const BENCH_VERSION = 2;

export interface TierSettings {
  maxFps: number;
  /** Fraction of devicePixelRatio to render at (CSS upscales the rest, pixelated). */
  maxDevPerCss: number;
  maxAnimatedNpcs: number;
  /** Vehicles on the road at once (M4, decoration). */
  maxVehicles: number;
  particles: boolean;
  weatherFx: boolean;
  lighting: boolean;
  /** Floor chunk textures kept alive (each ≈ 192 KB). */
  chunkTextures: number;
  /** Music decode sample rate (null = device default). */
  audioSampleRate: number | null;
}

export const TIER_SETTINGS: Record<Tier, TierSettings> = {
  0: { maxFps: 30, maxDevPerCss: 2, maxAnimatedNpcs: 12, maxVehicles: 3, particles: false, weatherFx: false, lighting: false, chunkTextures: 32, audioSampleRate: 22050 },
  1: { maxFps: 60, maxDevPerCss: 3, maxAnimatedNpcs: 25, maxVehicles: 6, particles: true, weatherFx: true, lighting: false, chunkTextures: 48, audioSampleRate: null },
  2: { maxFps: 60, maxDevPerCss: 4, maxAnimatedNpcs: 40, maxVehicles: 6, particles: true, weatherFx: true, lighting: true, chunkTextures: 64, audioSampleRate: null },
};

export interface DeviceHints {
  /** navigator.deviceMemory in GB (Chrome/Android only; rounded down, capped at 8). */
  memoryGb?: number;
  cores?: number;
}

export interface BenchResult {
  /** Work units per ms of the CPU workload (higher is faster). */
  cpuScore: number;
  /** 90th-percentile frame interval (ms) while rendering under the benchmark load. */
  p90FrameMs: number;
}

/**
 * Calibrated 21 Nov 2026 (bench v2) in Chrome on an Apple-silicon laptop: cpuScore ≈ 74 000 at 1×,
 * 17 700 at 4× and 11 800 at 6× DevTools CPU throttling. 6× must land on Low.
 * Retune on the real device matrix (docs/M0.md) — the perf overlay shows the measured score.
 */
export const THRESHOLDS = { cpuLow: 15000, cpuHigh: 30000, frameLow: 30, frameHigh: 18 };

/** Before the first benchmark every device starts Low, then upgrades silently (docs/RISKS.md). */
export const FIRST_RUN_TIER: Tier = 0;

export function decideTier(h: DeviceHints, b: BenchResult): Tier {
  const t = THRESHOLDS;
  if (h.memoryGb !== undefined && h.memoryGb <= 2) return 0;
  if (b.cpuScore < t.cpuLow || b.p90FrameMs > t.frameLow) return 0;
  const lowMemory = h.memoryGb !== undefined && h.memoryGb < 6;
  const fewCores = h.cores !== undefined && h.cores < 6;
  if (b.cpuScore >= t.cpuHigh && b.p90FrameMs <= t.frameHigh && !lowMemory && !fewCores) return 2;
  return 1;
}

/** Percentile (0–1) of the first `count` values of a buffer. */
export function percentile(values: Float32Array, count: number, p: number): number {
  if (count === 0) return 0;
  const a = Array.from(values.subarray(0, count)).sort((x, y) => x - y);
  return a[Math.min(a.length - 1, Math.floor(a.length * p))]!;
}

export function p90(values: Float32Array, count: number): number {
  return percentile(values, count, 0.9);
}

/** DESIGN.md §10 budgets. Low uses the low-end column; Mid and High use the mid/high column. */
export interface Budget {
  fps: number;
  frameMs: number;
  drawCalls: number;
  textureMB: number;
  heapMB: number;
}
export const BUDGETS: Record<Tier, Budget> = {
  0: { fps: 30, frameMs: 25, drawCalls: 40, textureMB: 48, heapMB: 100 },
  1: { fps: 60, frameMs: 12, drawCalls: 80, textureMB: 96, heapMB: 150 },
  2: { fps: 60, frameMs: 12, drawCalls: 80, textureMB: 96, heapMB: 150 },
};
