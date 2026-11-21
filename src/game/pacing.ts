// Pure frame-pacing helpers (no DOM), tested in test/pacing.test.ts.

/** Below this a frame counts as "on time" even if rAF fired slightly early. */
const EARLY_MS = 1.5;

/**
 * Decides whether this rAF callback should render under an fps cap.
 * Returns the new "last render" timestamp, or -1 to skip this callback.
 * Keeps phase so a 30 fps cap on a 60 Hz screen renders every other vsync, not a jittery mix.
 */
export function paceFrame(now: number, lastRender: number, maxFps: number): number {
  const interval = 1000 / maxFps;
  const elapsed = now - lastRender;
  if (elapsed < interval - EARLY_MS) return -1;
  // If we fell behind by more than a whole interval, don't try to catch up.
  return elapsed > interval * 2 ? now : lastRender + interval * Math.max(1, Math.floor((elapsed + EARLY_MS) / interval));
}

/** Fixed-step accumulator. Returns how many steps to run; dt is clamped so a stall can't spiral. */
export function fixedSteps(acc: { t: number }, dtMs: number, stepMs: number, maxSteps = 5): number {
  acc.t += Math.min(dtMs, stepMs * maxSteps);
  // The epsilon stops floating-point drift from losing a step (5 × 16.67 ≠ 83.33 exactly).
  const n = Math.min(maxSteps, Math.floor(acc.t / stepMs + 1e-6));
  acc.t = n === maxSteps ? 0 : Math.max(0, acc.t - n * stepMs);
  return n;
}
