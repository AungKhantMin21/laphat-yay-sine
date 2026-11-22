// Worker message protocol. See docs/ARCHITECTURE.md §2.
// Bump PROTOCOL_VERSION whenever a message shape or the frame layout in diff.ts changes.
import type { Phase } from './day';
export const PROTOCOL_VERSION = 9;

/** Sim tick rate. */
export const TICK_HZ = 10;
export const TICK_MS = 1000 / TICK_HZ;

export type Tier = 0 | 1 | 2; // Low, Mid, High

export type Action =
  | { k: 'place'; type: number; x: number; y: number; rot: number; colour: number }
  | { k: 'move'; id: number; x: number; y: number; rot: number }
  | { k: 'rotate'; id: number; rot: number }
  | { k: 'recolour'; id: number; colour: number }
  | { k: 'sell'; id: number }
  | { k: 'pickup'; id: number }
  | { k: 'undo' }
  | { k: 'redo' }
  /** Morning: open the shutters; the clock starts and customers may come. */
  | { k: 'openShop' }
  /** Evening: end the day; the clock jumps to the next opening time and the game saves. */
  | { k: 'sleep' }
  /** The pour minigame opened for customer `id` (NPC handle): their auto-serve waits. */
  | { k: 'startPour'; id: number }
  | { k: 'cancelPour'; id: number }
  /** Serve customer `id` a poured cup: tea and condensed milk as cup fractions. */
  | { k: 'serve'; id: number; tea: number; milk: number }
  | { k: 'walkTo'; x: number; y: number }
  | { k: 'interact'; id: number }
  | { k: 'buy'; shop: number; item: number; qty: number };

export type ToSim =
  /** The worker loads the save in `saveSlot` or starts a new game (`seed` only for tests/debug). */
  | { t: 'init'; v: number; tier: Tier; nowMs: number; saveSlot: number; seed?: number; shareCode?: string }
  | { t: 'clock'; running: boolean; nowMs: number }
  | { t: 'tier'; tier: Tier }
  | { t: 'viewport'; area: number; x0: number; y0: number; x1: number; y1: number }
  | { t: 'subscribe'; grids: number }
  | { t: 'act'; seq: number; a: Action }
  | { t: 'save'; reason: 'auto' | 'hidden' | 'manual' }
  | { t: 'recycle'; buf: ArrayBuffer }
  /** Debug: add items to the inventory. */
  | { t: 'give'; type: number; qty: number }
  /** Debug: move the game clock forward to `minute` (never back). */
  | { t: 'jump'; minute: number }
  /** Debug (perf gate): `n` customers arrive at once. */
  | { t: 'crowd'; n: number }
  | { t: 'exportSave' }
  | { t: 'importSave'; code: string };

/** Events carry text keys + args, never display strings. */
export type SimEvent =
  | { k: 'money'; delta: number; total: number }
  | { k: 'text'; key: string; args?: Record<string, string | number> }
  /** The day that just ended (sent on sleep). */
  | { k: 'dayEnd'; day: number; stats: DayStats }
  /**
   * Customer `id` (NPC handle) got drink `drink` and paid `price` + `tip` kyat after waiting `wait`
   * game minutes (= real seconds) since asking to order. `poured` = the player poured it (else staff
   * brewed it); `reaction` = shared/drinks.ts REACTION.
   */
  | { k: 'served'; id: number; drink: number; poured: boolean; price: number; tip: number; reaction: number; wait: number }
  /** Tomorrow's teaser (sent on sleep after dayEnd): i18n `teaser.<key>`; `drink` = guest's drink id or -1. */
  | { k: 'teaser'; key: string; drink: number };

/** What happened in one shop day. */
export interface DayStats {
  /** Customers who were served and paid. */
  served: number;
  /** Of those, cups the player poured (the rest were auto-served). */
  poured: number;
  /** Kyat taken in, tips included. */
  earned: number;
  tips: number;
  /** Best pour score of the day, 0–100. */
  best: number;
}

export function emptyDayStats(): DayStats {
  return { served: 0, poured: 0, earned: 0, tips: 0, best: 0 };
}

export interface AwaySummary {
  realMs: number;
  days: number;
  events: SimEvent[];
}

/** Player economy and build history, sent whenever it changes. */
export interface PlayerState {
  money: number;
  /** Count per object type id. */
  inventory: number[];
  canUndo: boolean;
  canRedo: boolean;
  /** Shop day phase (shared/day.ts PHASE). */
  phase: Phase;
  /** Game day number, from 0. */
  day: number;
  today: DayStats;
}

export type FromSim =
  | { t: 'ready'; v: number; area: number; w: number; h: number; snapshot: ArrayBuffer }
  | { t: 'frame'; buf: ArrayBuffer }
  /** id = handle of the placed/moved object; reason = i18n key when refused. */
  | { t: 'ack'; seq: number; ok: boolean; reason?: string; id?: number }
  | { t: 'state'; state: PlayerState }
  /** After init: whether this is a new game, and game days caught up after being away. */
  /** `returned`: saved objects that no longer fit the shop's rules, moved to the inventory. */
  | { t: 'loaded'; fresh: boolean; awayDays: number; skipped: number; returned: number }
  | { t: 'exported'; code: string }
  /** reason = i18n key when the code was refused. */
  | { t: 'imported'; ok: boolean; reason?: string }
  | { t: 'events'; list: SimEvent[] }
  | { t: 'catchup'; done: number; total: number }
  | { t: 'away'; summary: AwaySummary }
  | { t: 'saved'; reason: string; ok: boolean }
  | { t: 'error'; msg: string; fatal?: boolean };
