// Which job a tap means (M2.5), read from the task-board mirror in game/view.ts. Pure: the renderer
// finds what was tapped (a customer, a cup on a table, the counter or the sink); this picks the task.
import { MAX_TASKS } from '../shared/layout';
import { ORDER } from '../shared/npc';
import type { WorldView } from './view';

/** Task kinds (sim/service/task-board.ts TASK; they travel in the TASK frame section). */
export const TASK_KIND = { order: 1, brew: 2, serve: 3, clear: 4, wash: 5 } as const;

/** CUP places (sim/service/cups.ts). */
const CUP_COUNTER = 1;
const CUP_TRAY = 2;

/** The live task of `kind` with `target`, or 0. */
export function findTask(v: WorldView, kind: number, target: number): number {
  for (let i = 1; i < MAX_TASKS; i++) if (v.taskKind[i] === kind && v.taskTarget[i] === target) return v.taskHandle(i);
  return 0;
}

/** The first live task of `kind` not yet in the player's queue (else the first queued one), or 0. */
export function firstTask(v: WorldView, kind: number): number {
  let queued = 0;
  for (let i = 1; i < MAX_TASKS; i++) {
    if (v.taskKind[i] !== kind) continue;
    if (!v.taskQueue[i]) return v.taskHandle(i);
    if (!queued) queued = v.taskHandle(i);
  }
  return queued;
}

/**
 * Tapping a customer: take their order if they're asking; bring their cup if it's ready (on the
 * counter or already on a tray); otherwise brew it.
 */
export function taskForCustomer(v: WorldView, customer: number, slot: number): number {
  const o = v.npcOrderState[slot];
  if (o === ORDER.ask) return findTask(v, TASK_KIND.order, customer);
  if (o !== ORDER.waiting && o !== ORDER.pouring) return 0;
  for (let c = 1; c <= v.cupCount; c++) {
    if (v.cupFor[c] !== customer) continue;
    const p = v.cupPlace[c];
    if (p === CUP_COUNTER || p === CUP_TRAY) return findTask(v, TASK_KIND.serve, c);
  }
  return findTask(v, TASK_KIND.brew, customer);
}
