// Worker message protocol. See docs/ARCHITECTURE.md §2.
// Bump PROTOCOL_VERSION whenever a message shape or the frame layout in diff.ts changes.
import type { Phase } from './day';
export const PROTOCOL_VERSION = 10;

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
  /** Evening: hire / let go a staff member (staff.json role key). */
  | { k: 'hire'; role: string }
  | { k: 'dismiss'; role: string }
  /** Queue a job from the task board for the player (task handle); up to 3. */
  | { k: 'queueTask'; task: number }
  /** Take a job off the player's queue (not once a cup is in hand). */
  | { k: 'cancelTask'; task: number }
  /** The pour minigame for customer `id` (NPC handle) was closed without pouring. */
  | { k: 'cancelPour'; id: number }
  /** The player poured customer `id`'s cup at the counter: tea and condensed milk as cup fractions. */
  | { k: 'serve'; id: number; tea: number; milk: number }
  /** Errand (M3): walk the player to tile (x, y); replaces a walk already queued. */
  | { k: 'walkTo'; x: number; y: number }
  /** Errand (M3): walk the player to neighbourhood shop `shop` (shared/neighbourhood.ts id); `atShop` on arrival. */
  | { k: 'visit'; shop: number }
  /** At a shop's counter (M3): buy `qty` units of today's row `item`; carried home, or delivered for a fee. */
  | { k: 'buy'; shop: number; item: number; qty: number; deliver?: boolean };

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
  /** Sleep paid tomorrow's wages (`paid` kyat in all); `dayOff` staff are off unpaid (the tin was short). */
  | { k: 'wages'; paid: number; dayOff: number; total: number }
  /** The player reached the counter to brew customer `id`'s `drink`: open the pour minigame. */
  | { k: 'brewReady'; id: number; drink: number }
  /** Nothing on the menu could be made: customer `id` got free plain tea (M3). */
  | { k: 'freeTea'; id: number }
  /** Goods in hand were put away in the shop (M3). */
  | { k: 'putAway'; goods: GoodsLine[] }
  /** Deliveries arrived (M3). */
  | { k: 'delivered'; goods: GoodsLine[] }
  /** The player reached shop `shop`'s counter (M3): open its panel. */
  | { k: 'atShop'; shop: number }
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
  /** The player's queued jobs (task handles, first = in progress), M2.5. */
  queue: number[];
  /** Customer handle the player is pouring for at the counter (0 = not brewing). */
  brewing: number;
  /** Hired staff (role key) and whether they're off today (M2.5). */
  staff: { role: string; dayOff: boolean }[];
  /** Seats in the shop (hiring unlocks). */
  seats: number;
  /** Ingredient portions free to use (shared/ingredients.ts order; reserved ones excluded) (M3). */
  stock: number[];
  /** About how many cups the shelf can still make (the HUD shelf). */
  cupsLeft: number;
  /** Today's rows per neighbourhood shop (qty = units left) (M3). */
  market: { kind: number; id: number; qty: number; price: number }[][];
  /** Goods in the player's hands and their load (≤ market.json carryMax). */
  carry: GoodsLine[];
  carryLoad: number;
  /** Goods on their way. */
  deliveries: GoodsLine[];
  /** Building materials in tiles, per material id. */
  materials: number[];
}

/** `qty` units of an item (shared/market.ts ITEM kind + id). */
export interface GoodsLine {
  kind: number;
  id: number;
  qty: number;
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
