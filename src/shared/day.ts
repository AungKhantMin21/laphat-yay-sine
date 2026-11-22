// The shop day (DESIGN §2, decided 21 Nov 2026): the clock waits at opening time until the player
// opens the shutters, runs through shop hours, lets the last customers finish, then waits in the
// evening until the player sleeps, which skips the night to the next opening time.
import { MINUTES_PER_DAY } from './layout';
import { SHOP, type ShopRules } from './shop';

export const PHASE = {
  /** Shutters closed; the clock waits for "open". */
  morning: 0,
  /** Shop hours: customers arrive. */
  open: 1,
  /** After closing time: no new customers, the last ones finish. */
  closing: 2,
  /** Shop empty after closing; the clock waits for "sleep". */
  evening: 3,
} as const;
export type Phase = (typeof PHASE)[keyof typeof PHASE];

export function minuteOfDay(gameMinute: number): number {
  return ((gameMinute % MINUTES_PER_DAY) + MINUTES_PER_DAY) % MINUTES_PER_DAY;
}

/**
 * The day phase. `shuttersOpen` is set by "open" and cleared by "sleep";
 * `customers` is how many are still in or heading to the shop.
 */
export function dayPhase(gameMinute: number, shuttersOpen: boolean, customers: number, rules: ShopRules = SHOP): Phase {
  if (!shuttersOpen) return PHASE.morning;
  if (minuteOfDay(gameMinute) < rules.close) return PHASE.open;
  return customers > 0 ? PHASE.closing : PHASE.evening;
}

/**
 * Whether the game clock stands still in this phase. Closing holds it too (M2.5): customers wait as
 * long as it takes to be served, so the clock stops at closing time until the last one has left,
 * instead of running into the night.
 */
export function clockHolds(phase: Phase): boolean {
  return phase !== PHASE.open;
}

/**
 * The next opening time after `gameMinute`: where "sleep" takes the clock. Sleeping after
 * midnight (the last customers lingered) opens later that same calendar day, never skipping one.
 */
export function nextMorning(gameMinute: number, rules: ShopRules = SHOP): number {
  const dayStart = Math.floor(gameMinute / MINUTES_PER_DAY) * MINUTES_PER_DAY;
  const today = dayStart + rules.open;
  return gameMinute < today ? today : today + MINUTES_PER_DAY;
}
