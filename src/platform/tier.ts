// Device tier: stored result → else start Low, benchmark 2 s after the first frames, upgrade silently.
// `?tier=low|mid|high` forces a tier for testing; a settings override is stored in meta.
import type { Tier } from '../shared/protocol';
import { STORE, dbGet, dbPut, safe } from '../shared/db';
import { BENCH_VERSION, FIRST_RUN_TIER, TIER_NAMES, decideTier, p90, percentile, type BenchResult, type DeviceHints } from './tier-policy';

export interface DeviceRecord {
  tier: Tier;
  bench: BenchResult | null;
  benchVersion: number;
  ua: string;
  /** Player's choice in settings; wins over the benchmark. */
  override: Tier | null;
}

const KEY = 'device';

export function deviceHints(): DeviceHints {
  const nav = navigator as Navigator & { deviceMemory?: number };
  return { memoryGb: nav.deviceMemory, cores: navigator.hardwareConcurrency || undefined };
}

function urlTier(): Tier | null {
  const q = new URLSearchParams(location.search).get('tier');
  const i = TIER_NAMES.indexOf(q as (typeof TIER_NAMES)[number]);
  return i >= 0 ? (i as Tier) : null;
}

export interface TierState {
  tier: Tier;
  /** Why this tier: url, override, stored, first-run. */
  source: 'url' | 'override' | 'stored' | 'first-run';
  record: DeviceRecord | null;
  needsBench: boolean;
}

export async function loadTier(): Promise<TierState> {
  const forced = urlTier();
  const record = (await safe(dbGet<DeviceRecord>(STORE.meta, KEY), undefined)) ?? null;
  const stale = !record || record.benchVersion !== BENCH_VERSION || record.ua !== navigator.userAgent || !record.bench;
  if (forced !== null) return { tier: forced, source: 'url', record, needsBench: false };
  if (record?.override != null) return { tier: record.override, source: 'override', record, needsBench: false };
  if (record && !stale) return { tier: record.tier, source: 'stored', record, needsBench: false };
  return { tier: FIRST_RUN_TIER, source: 'first-run', record, needsBench: true };
}

export async function saveTier(tier: Tier, bench: BenchResult | null, override: Tier | null): Promise<void> {
  const rec: DeviceRecord = { tier, bench, benchVersion: BENCH_VERSION, ua: navigator.userAgent, override };
  await safe(dbPut(STORE.meta, KEY, rec), undefined);
}

// --- Benchmark ---------------------------------------------------------------------------
// Each frame adds a 6 ms slice of sim-like typed-array work while the game renders normally.
// cpuScore = p75 of per-slice work rates (units per second of slice time) after warm-up, so a
// few slices on an efficiency core or before JIT optimisation don't drag the score down.
// p90FrameMs = frame intervals under that extra load.

const SLICE_MS = 6;
const N = 4096;
const xs = new Float32Array(N);
const vs = new Float32Array(N);
const grid = new Int16Array(128 * 96);

function workUnit(seed: number): number {
  let acc = seed;
  for (let i = 0; i < N; i++) {
    vs[i] = vs[i]! * 0.98 + ((acc = (Math.imul(acc, 1103515245) + 12345) | 0) & 0xff) * 0.001;
    xs[i] = xs[i]! + vs[i]!;
    const g = (acc >>> 8) % grid.length;
    grid[g] = (grid[g]! + (xs[i]! | 0)) & 0x7fff;
  }
  return acc;
}

/** Frames ignored at the start while the JIT warms up the workload. */
const WARMUP_FRAMES = 10;

export function runBenchmark(durationMs = 2000): Promise<BenchResult> {
  return new Promise((resolve) => {
    const intervals = new Float32Array(600);
    const rates = new Float32Array(600);
    let n = 0;
    let r = 0;
    let frames = 0;
    let start = 0;
    let last = 0;
    let seed = 1;
    const frame = (now: number): void => {
      if (!start) start = last = now;
      else if (n < intervals.length) intervals[n++] = now - last;
      last = now;
      const t0 = performance.now();
      let t = t0;
      let units = 0;
      while (t - t0 < SLICE_MS) {
        seed = workUnit(seed);
        units++;
        t = performance.now();
      }
      if (++frames > WARMUP_FRAMES && r < rates.length) rates[r++] = (units * 1000) / (t - t0);
      if (now - start < durationMs) requestAnimationFrame(frame);
      else resolve({ cpuScore: Math.round(percentile(rates, r, 0.75)), p90FrameMs: Math.round(p90(intervals, n) * 10) / 10 });
    };
    requestAnimationFrame(frame);
  });
}

export { decideTier };
