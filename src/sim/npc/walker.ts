// Path following shared by customers and workers: request a path, step along it at a fixed speed,
// re-path when something was built in the way, give up after a stuck timeout. Struct-of-arrays
// fields are passed in, so nothing is allocated per tick.
import { NONE } from '../../shared/ids';
import { DIR } from '../../shared/npc';
import { PATH, type PathFinder } from '../path/pathfinder';

export const WALKING = 0;
export const ARRIVED = 1;
export const FAILED = 2;

/** The walker fields path following reads and writes (indexed by walker slot). */
export interface WalkerSoA {
  readonly x: Float32Array;
  readonly y: Float32Array;
  /** Last tile reached. */
  readonly tile: Int32Array;
  readonly goal: Int32Array;
  readonly path: Uint32Array;
  readonly pathStep: Uint16Array;
  /** Ticks walking toward the current goal. */
  readonly walkT: Uint16Array;
  readonly dir: Uint8Array;
}

/**
 * One tick of walking walker `i` toward `goal[i]` for access class `cls`. With `stopNextTo`, the walk
 * ends on the tile beside the goal (goals are usually furniture: a seat, the counter, the sink).
 * Returns WALKING, ARRIVED or FAILED.
 */
export function walkStep(s: WalkerSoA, i: number, paths: PathFinder, w: number, speed: number, stuck: number, cls: number, stopNextTo: boolean): number {
  if (++s.walkT[i]! >= stuck) return FAILED;
  let h = s.path[i]!;
  const goal = s.goal[i]!;
  if (h === NONE) {
    if (s.tile[i] === goal) return ARRIVED;
    h = paths.request(s.tile[i]!, goal, cls);
    if (h === NONE) return WALKING; // pool full: try again next tick
    s.path[i] = h;
    s.pathStep[i] = 0;
  }
  const st = paths.statusOf(h);
  if (st === PATH.queued) return WALKING;
  if (st !== PATH.done) return FAILED;
  const len = paths.length(h);
  const k = s.pathStep[i]!;
  if (k >= len) return arrive(s, i, paths);
  const next = paths.tileAt(h, k);
  if (stopNextTo && next === goal) return arrive(s, i, paths);
  if (!paths.canStep(s.tile[i]!, next, goal, cls)) {
    drop(s, i, paths); // something was built in the way: search again next tick
    return WALKING;
  }
  const nx = next % w;
  const ny = (next - nx) / w;
  const dx = nx + 0.5 - s.x[i]!;
  const dy = ny + 0.5 - s.y[i]!;
  const d = Math.sqrt(dx * dx + dy * dy);
  if (d <= speed) {
    s.x[i] = nx + 0.5;
    s.y[i] = ny + 0.5;
    s.tile[i] = next;
    s.pathStep[i] = k + 1;
  } else {
    s.x[i] = s.x[i]! + (dx / d) * speed;
    s.y[i] = s.y[i]! + (dy / d) * speed;
  }
  const ax = dx < 0 ? -dx : dx;
  const ay = dy < 0 ? -dy : dy;
  s.dir[i] = ax >= ay ? (dx > 0 ? DIR.east : DIR.west) : dy > 0 ? DIR.south : DIR.north;
  if (s.pathStep[i]! >= len) return arrive(s, i, paths);
  return WALKING;
}

/** Faces walker `i` toward tile `t` (after arriving next to it). */
export function face(s: WalkerSoA, i: number, t: number, w: number): void {
  const tx = t % w;
  const ty = (t - tx) / w;
  const dx = tx + 0.5 - s.x[i]!;
  const dy = ty + 0.5 - s.y[i]!;
  const ax = dx < 0 ? -dx : dx;
  const ay = dy < 0 ? -dy : dy;
  if (ax === 0 && ay === 0) return;
  s.dir[i] = ax >= ay ? (dx > 0 ? DIR.east : DIR.west) : dy > 0 ? DIR.south : DIR.north;
}

function arrive(s: WalkerSoA, i: number, paths: PathFinder): number {
  drop(s, i, paths);
  return ARRIVED;
}

export function drop(s: WalkerSoA, i: number, paths: PathFinder): void {
  const h = s.path[i]!;
  if (h !== NONE) paths.release(h);
  s.path[i] = NONE;
  s.pathStep[i] = 0;
}
