// The shop day in the worker: shutters, phase, today's stats and tomorrow's teaser.
// Phase rules live in shared/day.ts; this keeps the state and applies "open" and "sleep".
import { PHASE, clockHolds, dayPhase, nextMorning, type Phase } from '../../shared/day';
import { emptyDayStats, type DayStats } from '../../shared/protocol';
import type { Sim } from '../sim';
import { pickTeaser, type TeaserPick } from '../../shared/teasers';

/** Tomorrow's teaser: kind key ('' = none) and the guest's drink key. Its effect happens the next day. */
export type Teaser = TeaserPick;

export type DayResult = { ok: true; ended?: { day: number; stats: DayStats } } | { ok: false; reason: string };

export class ShopDay {
  shuttersOpen = false;
  today: DayStats = emptyDayStats();
  teaser: Teaser = { key: '', arg: '' };
  /** Phase as of the last update. */
  phase: Phase = PHASE.morning;
  /** Set when phase or stats change (the worker then posts player state). */
  changed = true;

  /** Recomputes the phase; `customers` = how many are still in or heading to the shop. */
  update(gameMinute: number, customers: number): Phase {
    const p = dayPhase(gameMinute, this.shuttersOpen, customers);
    if (p !== this.phase) {
      this.phase = p;
      this.changed = true;
    }
    return p;
  }

  /** Whether the game clock should stand still now. */
  get holds(): boolean {
    return clockHolds(this.phase);
  }

  open(sim: Sim, customers: number): DayResult {
    if (this.update(sim.gameMinute, customers) !== PHASE.morning) return { ok: false, reason: 'day.err.notNow' };
    this.shuttersOpen = true;
    this.update(sim.gameMinute, customers);
    return { ok: true };
  }

  /** Ends the day: returns its stats, picks tomorrow's teaser, resets the stats and moves the clock to the next opening time. */
  sleep(sim: Sim, customers: number): DayResult {
    if (this.update(sim.gameMinute, customers) !== PHASE.evening) return { ok: false, reason: 'day.err.notNow' };
    const ended = { day: sim.day, stats: this.today };
    // Both draws always happen, so the events stream advances the same way every night.
    const e = sim.rng.events;
    const u1 = e.next();
    const u2 = e.next();
    this.teaser = pickTeaser(this.today, u1, u2);
    this.today = emptyDayStats();
    this.shuttersOpen = false;
    sim.jumpTo(nextMorning(sim.gameMinute));
    this.update(sim.gameMinute, customers);
    this.changed = true;
    return { ok: true, ended };
  }
}
