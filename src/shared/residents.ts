// Residents (M4) from src/data/residents.json: named neighbours who live behind the `entry` doors,
// with a job (a neighbourhood shopkeeper, work off the map, or at home) and daily habits (tea at your
// shop, the wet market, a stroll). Validated once at load.
//
// planDay() turns a resident's habits into today's timed events, deterministically from (save seed,
// day, resident): the same after a reload, and independent of anything else the sim draws.
import raw from '../data/residents.json';
import { DRINKS } from './drinks';
import { NEIGHBOURHOOD, type Neighbourhood } from './neighbourhood';
import { Rng, STREAM, mixSeed } from './rng';
import { SHOP, parseClock } from './shop';

/** Today's event kinds. */
export const RE = {
  /** Shopkeeper: walk to the stall and stand behind the counter. */
  toStall: 1,
  /** Back home (from the stall, or from work off the map). */
  home: 2,
  /** Leave for work by a street end. */
  toWork: 3,
  /** A visit to your tea shop (becomes a customer). */
  tea: 4,
  /** A few minutes at the wet market stalls. */
  market: 5,
  /** Walk to another door on the street and back. */
  stroll: 6,
} as const;

/** A window of the day (minutes) with a daily chance. */
export interface Habit {
  from: number;
  to: number;
  chance: number;
}

export interface ResidentDef {
  id: number;
  key: string;
  /** Index into NEIGHBOURHOOD.doors (−1 for a spare who hasn't moved in). */
  home: number;
  look: number;
  /** NEIGHBOURHOOD.shops index they keep, or −1. */
  keeper: number;
  /** Works off the map: street end (NEIGHBOURHOOD.ends index) and hours; null when not. */
  away: { end: number; from: number; to: number } | null;
  tea: (Habit & { drink: number }) | null;
  market: Habit | null;
  stroll: Habit | null;
}

export interface ResidentRules {
  /** Tiles per second. */
  walkSpeed: number;
  /** Keepers reach the stall `before` minutes before opening and leave `after` minutes after closing ([min, max]). */
  keeper: { before: [number, number]; after: [number, number] };
  away: { jitter: number };
  /** Minutes standing at a market stall ([min, max]). */
  marketDwell: [number, number];
  /** A planned outing that couldn't start within this many minutes is dropped. */
  staleAfter: number;
  residents: ResidentDef[];
  /** Newcomers who can move into a house someone left (M4 property market). */
  spare: ResidentDef[];
  byKey: Map<string, ResidentDef>;
}

type RawHabit = [string, string, number];
interface RawResident {
  key: string;
  home?: number;
  look: number;
  keeper?: string;
  away?: [number, string, string];
  tea?: [string, string, number, string];
  market?: RawHabit;
  stroll?: RawHabit;
}
export interface RawResidents {
  walkSpeed: number;
  keeper: { before: number[]; after: number[] };
  away: { jitter: number };
  marketDwell: number[];
  staleAfter: number;
  residents: RawResident[];
  spare: RawResident[];
}

const pair = (v: number[], at: string): [number, number] => {
  const [a, b] = v as [number, number];
  if (!(v.length === 2 && Number.isInteger(a) && Number.isInteger(b) && a >= 0 && b >= a)) throw new Error(`${at}: expected [min, max] whole minutes`);
  return [a, b];
};

export function buildResidents(d: RawResidents, hood: Neighbourhood = NEIGHBOURHOOD): ResidentRules {
  const byKey = new Map<string, ResidentDef>();
  const shopKey = new Map(hood.shops.map((s) => [s.key, s] as const));
  const keepers = new Set<number>();
  let id = 0;
  const one = (r: RawResident, spare: boolean): ResidentDef => {
    const at = `resident "${r.key}"`;
    if (!/^[a-z][a-z0-9_]*$/.test(r.key)) throw new Error(`${at}: bad key`);
    if (byKey.has(r.key)) throw new Error(`${at}: duplicate key`);
    const home = spare ? -1 : (r.home ?? -1);
    if (!spare && !(Number.isInteger(home) && home >= 0 && home < hood.doors.length)) throw new Error(`${at}: home must be a door 0…${hood.doors.length - 1}`);
    if (!(Number.isInteger(r.look) && r.look >= 0 && r.look < 16)) throw new Error(`${at}: bad look`);
    const habit = (h: RawHabit | undefined, name: string, lo: number, hi: number): Habit | null => {
      if (!h) return null;
      const from = parseClock(h[0], `${at} ${name}`);
      const to = parseClock(h[1], `${at} ${name}`);
      if (!(to > from)) throw new Error(`${at} ${name}: ends before it starts`);
      if (from < lo || to > hi) throw new Error(`${at} ${name}: must fall inside the opening hours`);
      if (!(h[2] > 0 && h[2] <= 1)) throw new Error(`${at} ${name}: chance must be 0…1`);
      return { from, to, chance: h[2] };
    };
    let keeper = -1;
    if (r.keeper !== undefined) {
      const s = shopKey.get(r.keeper);
      if (!s) throw new Error(`${at}: unknown shop "${r.keeper}"`);
      if (keepers.has(s.id)) throw new Error(`${at}: "${r.keeper}" already has a keeper`);
      keepers.add(s.id);
      keeper = s.id;
    }
    let away: ResidentDef['away'] = null;
    if (r.away) {
      if (keeper >= 0) throw new Error(`${at}: a keeper can't also work away`);
      const [end, f, t] = r.away;
      if (!(Number.isInteger(end) && end >= 0 && end < hood.ends.length)) throw new Error(`${at}: away end must be 0…${hood.ends.length - 1}`);
      const from = parseClock(f, `${at} away`);
      const to = parseClock(t, `${at} away`);
      if (!(to > from)) throw new Error(`${at} away: ends before it starts`);
      away = { end, from, to };
    }
    let tea: ResidentDef['tea'] = null;
    if (r.tea) {
      const h = habit([r.tea[0], r.tea[1], r.tea[2]], 'tea', SHOP.open, SHOP.close)!;
      const drink = DRINKS.byKey.get(r.tea[3]);
      if (!drink) throw new Error(`${at} tea: unknown drink "${r.tea[3]}"`);
      tea = { ...h, drink: drink.id };
    }
    const mk = hood.shops.find((s) => s.key === 'market');
    const market = habit(r.market, 'market', mk?.open ?? 0, mk?.close ?? 1440);
    const stroll = habit(r.stroll, 'stroll', 0, 1440);
    const def: ResidentDef = { id: id++, key: r.key, home, look: r.look, keeper, away, tea, market, stroll };
    byKey.set(r.key, def);
    return def;
  };
  const residents = d.residents.map((r) => one(r, false));
  const spare = d.spare.map((r) => one(r, true));
  if (residents.length === 0) throw new Error('residents: need at least one');
  if (!(d.walkSpeed > 0 && d.walkSpeed <= 5)) throw new Error('residents.walkSpeed must be 0…5');
  if (!(d.away.jitter >= 0 && d.staleAfter > 0)) throw new Error('residents: bad away.jitter / staleAfter');
  return {
    walkSpeed: d.walkSpeed,
    keeper: { before: pair(d.keeper.before, 'residents.keeper.before'), after: pair(d.keeper.after, 'residents.keeper.after') },
    away: { jitter: d.away.jitter },
    marketDwell: pair(d.marketDwell, 'residents.marketDwell'),
    staleAfter: d.staleAfter,
    residents,
    spare,
    byKey,
  };
}

export const RESIDENTS: ResidentRules = buildResidents(raw as unknown as RawResidents);

/** One planned event: at `minute` (of the day), do `kind`. */
export interface PlannedEvent {
  minute: number;
  kind: number;
}

/**
 * Today's events for resident `def`, sorted by minute. Work and the stall fix when they're out;
 * outings (tea, market, stroll) are rolled and dropped when they would fall inside those hours.
 */
export function planDay(seed: number, day: number, def: ResidentDef, rules: ResidentRules = RESIDENTS, hood: Neighbourhood = NEIGHBOURHOOD): PlannedEvent[] {
  const r = new Rng(mixSeed((seed ^ Math.imul(day + 1, 0x7f4a7c15) ^ Math.imul(def.id + 1, 0x165667b1)) | 0, STREAM.npcDecide));
  const out: PlannedEvent[] = [];
  // Busy (not at home) between these minutes.
  let busyFrom = 1440;
  let busyTo = -1;
  if (def.keeper >= 0) {
    const s = hood.shops[def.keeper]!;
    const k = rules.keeper;
    busyFrom = s.open - r.range(k.before[0], k.before[1]);
    busyTo = s.close + r.range(k.after[0], k.after[1]);
    out.push({ minute: busyFrom, kind: RE.toStall }, { minute: busyTo, kind: RE.home });
  } else if (def.away) {
    const j = rules.away.jitter;
    busyFrom = def.away.from + r.int(j + 1);
    busyTo = def.away.to + r.int(j + 1);
    out.push({ minute: busyFrom, kind: RE.toWork }, { minute: busyTo, kind: RE.home });
  }
  // Always draw for every habit (present or not) so one resident's plan never shifts another's.
  const outing = (h: Habit | null, kind: number, margin: number): void => {
    const go = r.next();
    const at = r.next();
    if (!h || go >= h.chance) return;
    const m = Math.floor(h.from + at * (h.to - h.from));
    if (m + margin > busyFrom && m < busyTo) return; // they're at work or at the stall then
    out.push({ minute: m, kind });
  };
  outing(def.tea, RE.tea, 75);
  outing(def.market, RE.market, 40);
  outing(def.stroll, RE.stroll, 40);
  out.sort((a, b) => a.minute - b.minute || a.kind - b.kind);
  return out;
}
