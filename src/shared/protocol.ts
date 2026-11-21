// Worker message protocol. See docs/ARCHITECTURE.md §2.
// Bump PROTOCOL_VERSION whenever a message shape or the frame layout in diff.ts changes.
export const PROTOCOL_VERSION = 2;

/** Sim tick rate. */
export const TICK_HZ = 10;
export const TICK_MS = 1000 / TICK_HZ;

export type Tier = 0 | 1 | 2; // Low, Mid, High

export type Action =
  | { k: 'place'; type: number; x: number; y: number; rot: number; colour: number; parent: number }
  | { k: 'move'; id: number; x: number; y: number; rot: number; parent: number }
  | { k: 'rotate'; id: number; rot: number }
  | { k: 'recolour'; id: number; colour: number }
  | { k: 'sell'; id: number }
  | { k: 'undo' }
  | { k: 'redo' }
  | { k: 'walkTo'; x: number; y: number }
  | { k: 'interact'; id: number }
  | { k: 'buy'; shop: number; item: number; qty: number };

export type ToSim =
  | { t: 'init'; v: number; seed: number; tier: Tier; nowMs: number; saveSlot: number; shareCode?: string }
  | { t: 'clock'; running: boolean; nowMs: number }
  | { t: 'tier'; tier: Tier }
  | { t: 'viewport'; area: number; x0: number; y0: number; x1: number; y1: number }
  | { t: 'subscribe'; grids: number }
  | { t: 'act'; seq: number; a: Action }
  | { t: 'save'; reason: 'auto' | 'hidden' | 'manual' }
  | { t: 'recycle'; buf: ArrayBuffer };

/** Events carry text keys + args, never display strings. */
export type SimEvent =
  | { k: 'money'; delta: number; total: number }
  | { k: 'text'; key: string; args?: Record<string, string | number> };

export interface AwaySummary {
  realMs: number;
  days: number;
  events: SimEvent[];
}

export type FromSim =
  | { t: 'ready'; v: number; area: number; w: number; h: number; snapshot: ArrayBuffer }
  | { t: 'frame'; buf: ArrayBuffer }
  | { t: 'ack'; seq: number; ok: boolean; reason?: string; id?: number }
  | { t: 'events'; list: SimEvent[] }
  | { t: 'catchup'; done: number; total: number }
  | { t: 'away'; summary: AwaySummary }
  | { t: 'saved'; reason: string; ok: boolean }
  | { t: 'error'; msg: string; fatal?: boolean };
