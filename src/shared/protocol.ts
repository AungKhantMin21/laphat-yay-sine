// Worker message protocol. See docs/ARCHITECTURE.md §2.
// Bump PROTOCOL_VERSION whenever a message shape or the frame layout in diff.ts changes.
export const PROTOCOL_VERSION = 4;

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
  | { t: 'exportSave' }
  | { t: 'importSave'; code: string };

/** Events carry text keys + args, never display strings. */
export type SimEvent =
  | { k: 'money'; delta: number; total: number }
  | { k: 'text'; key: string; args?: Record<string, string | number> };

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
}

export type FromSim =
  | { t: 'ready'; v: number; area: number; w: number; h: number; snapshot: ArrayBuffer }
  | { t: 'frame'; buf: ArrayBuffer }
  /** id = handle of the placed/moved object; reason = i18n key when refused. */
  | { t: 'ack'; seq: number; ok: boolean; reason?: string; id?: number }
  | { t: 'state'; state: PlayerState }
  /** After init: whether this is a new game, and game days caught up after being away. */
  | { t: 'loaded'; fresh: boolean; awayDays: number; skipped: number }
  | { t: 'exported'; code: string }
  /** reason = i18n key when the code was refused. */
  | { t: 'imported'; ok: boolean; reason?: string }
  | { t: 'events'; list: SimEvent[] }
  | { t: 'catchup'; done: number; total: number }
  | { t: 'away'; summary: AwaySummary }
  | { t: 'saved'; reason: string; ok: boolean }
  | { t: 'error'; msg: string; fatal?: boolean };
