// Offline catch-up rule (docs/ARCHITECTURE.md §2):
// away < 1 real hour → none; otherwise 1 game day per full real day away, at most 7.

export const HOUR_MS = 3_600_000;
export const DAY_MS = 24 * HOUR_MS;
export const MAX_CATCHUP_DAYS = 7;

export function catchupDays(awayMs: number): number {
  if (!(awayMs >= HOUR_MS)) return 0; // also rejects NaN and negative clock jumps
  return Math.min(MAX_CATCHUP_DAYS, Math.floor(awayMs / DAY_MS));
}
