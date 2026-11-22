// Tomorrow's teaser (DESIGN §2, M2.8): one line on the sleep screen whose promise really happens
// the next day. Kinds, conditions and effects live in src/data/teasers.json. Calm rules: teasers
// are only good news, and one kind always has no condition, so every night has a teaser.
// Pure: the worker picks (events stream) and applies the effect; ui/ only shows the line.
import raw from '../data/teasers.json';
import { DRINKS } from './drinks';
import { parseClock } from './shop';
import type { DayStats } from './protocol';

export interface TeaserDef {
  key: string;
  weight: number;
  /** All must hold for the day that just ended (best = 0…100). */
  need: { served: number; poured: number; best: number };
  /** Extra customers per game hour in [from, to) minutes of the day. */
  boost: { from: number; to: number; perHour: number } | null;
  /** Added to the shop's appeal all day. */
  appeal: number;
  /** A guest who orders the teaser's drink arrives this many minutes after opening. */
  guest: { after: number } | null;
}

/** A chosen teaser, as saved: kind key ('' = none) and the drink key for guests ('' = none). */
export interface TeaserPick {
  key: string;
  arg: string;
}

export interface RawTeasers {
  kinds: {
    key: string;
    weight: number;
    need?: { served?: number; poured?: number; best?: number };
    boost?: { from: string; to: string; perHour: number };
    appeal?: number;
    guest?: { after: number };
  }[];
}

export function buildTeasers(d: RawTeasers): TeaserDef[] {
  const out: TeaserDef[] = [];
  const seen = new Set<string>();
  for (const k of d.kinds) {
    const at = `teaser "${k.key}"`;
    if (!/^[a-z0-9_]+$/.test(k.key) || seen.has(k.key)) throw new Error(`${at}: key must be unique lower_snake_case`);
    seen.add(k.key);
    if (!(k.weight > 0)) throw new Error(`${at}: weight must be > 0`);
    const n = k.need ?? {};
    const need = { served: n.served ?? 0, poured: n.poured ?? 0, best: n.best ?? 0 };
    if (!(need.served >= 0 && need.poured >= 0 && need.best >= 0 && need.best <= 100)) throw new Error(`${at}: bad need`);
    let boost: TeaserDef['boost'] = null;
    if (k.boost) {
      const from = parseClock(k.boost.from, `${at} boost.from`);
      const to = parseClock(k.boost.to, `${at} boost.to`);
      if (!(from < to) || !(k.boost.perHour > 0 && k.boost.perHour <= 60)) throw new Error(`${at}: bad boost`);
      boost = { from, to, perHour: k.boost.perHour };
    }
    const appeal = k.appeal ?? 0;
    if (!(appeal >= 0 && appeal <= 2)) throw new Error(`${at}: appeal must be 0…2`);
    let guest: TeaserDef['guest'] = null;
    if (k.guest) {
      // The first arrival check after opening is one minute in.
      if (!(Number.isInteger(k.guest.after) && k.guest.after >= 1 && k.guest.after <= 600)) throw new Error(`${at}: guest.after must be 1…600`);
      guest = { after: k.guest.after };
    }
    if (!boost && !appeal && !guest) throw new Error(`${at}: needs an effect (a teaser's promise must happen)`);
    out.push({ key: k.key, weight: k.weight, need, boost, appeal, guest });
  }
  if (!out.some((t) => !t.need.served && !t.need.poured && !t.need.best)) throw new Error('teasers: one kind must have no condition');
  return out;
}

export const TEASERS: TeaserDef[] = buildTeasers(raw as RawTeasers);
const BY_KEY = new Map(TEASERS.map((t) => [t.key, t]));

export function teaserDef(key: string): TeaserDef | undefined {
  return BY_KEY.get(key);
}

const eligible = (t: TeaserDef, s: DayStats): boolean => s.served >= t.need.served && s.poured >= t.need.poured && s.best >= t.need.best;

/**
 * Chooses tonight's teaser from the day's stats. `u1` picks the kind (weighted among eligible),
 * `u2` the guest's drink; the caller always draws both, so the stream advances the same way.
 */
export function pickTeaser(stats: DayStats, u1: number, u2: number, defs: TeaserDef[] = TEASERS): TeaserPick {
  let total = 0;
  for (const t of defs) if (eligible(t, stats)) total += t.weight;
  let left = u1 * total;
  let pick: TeaserDef | null = null;
  for (const t of defs) {
    if (!eligible(t, stats)) continue;
    pick = t; // the last eligible kind also catches rounding at u1 → 1
    left -= t.weight;
    if (left < 0) break;
  }
  if (!pick) return { key: '', arg: '' };
  const n = DRINKS.defs.length;
  return { key: pick.key, arg: pick.guest ? DRINKS.defs[Math.min(n - 1, Math.floor(u2 * n))]!.key : '' };
}

/** Extra customers per game hour from the active teaser at a minute of the day. */
export function teaserRate(t: TeaserPick, minuteOfDay: number): number {
  const b = BY_KEY.get(t.key)?.boost;
  return b && minuteOfDay >= b.from && minuteOfDay < b.to ? b.perHour : 0;
}

/** Appeal added by the active teaser. */
export function teaserAppeal(t: TeaserPick): number {
  return BY_KEY.get(t.key)?.appeal ?? 0;
}

/** The promised guest's drink id if they arrive at this minute of the day, else -1. */
export function teaserGuest(t: TeaserPick, minuteOfDay: number, openMinute: number): number {
  const g = BY_KEY.get(t.key)?.guest;
  if (!g || minuteOfDay !== openMinute + g.after) return -1;
  return DRINKS.byKey.get(t.arg)?.id ?? -1;
}
