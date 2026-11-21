// Walking cost per tile, derived from the floor type and furniture occupancy (src/data/walk.json).
// Rebuilt only inside the rect around a build change; `version` tells searches in flight to restart.
import raw from '../../data/walk.json';
import { FLOOR, FLOOR_TYPES, WALL } from '../../shared/layout';
import type { AreaGrids, Occupancy } from '../../shared/world-state';

/** The 8 step directions, in move-mask bit order. */
export const DX = [1, -1, 0, 0, 1, 1, -1, -1] as const;
export const DY = [0, 0, 1, -1, 1, -1, 1, -1] as const;

/** walkCost value for a tile nobody can walk on. */
export const BLOCKED = 255;
/** Cheapest tile cost; the A* heuristic assumes no tile is cheaper. */
export const MIN_COST = 10;

export interface WalkConfig {
  /** A* node expansions per sim tick (deterministic budget, ≈ ≤ 2 ms). */
  nodesPerTick: number;
  /** Paths that can exist at once. */
  pathSlots: number;
  /** Longest path in tiles; longer ones fail. */
  maxPathLen: number;
  /** Cost per FLOOR type id (BLOCKED for none). */
  floorCost: Uint8Array;
}

export interface RawWalk {
  nodesPerTick: number;
  pathSlots: number;
  maxPathLen: number;
  floorCost: Record<string, number>;
}

export function buildWalkConfig(d: RawWalk): WalkConfig {
  const posInt = (v: number, where: string, max: number): number => {
    if (!(Number.isInteger(v) && v > 0 && v <= max)) throw new Error(`walk.${where}: whole number 1…${max}`);
    return v;
  };
  const floorCost = new Uint8Array(FLOOR_TYPES).fill(BLOCKED);
  for (const [name, cost] of Object.entries(d.floorCost)) {
    const id = (FLOOR as Record<string, number>)[name];
    if (id === undefined || id === FLOOR.none) throw new Error(`walk.floorCost: unknown floor "${name}"`);
    if (!(Number.isInteger(cost) && cost >= MIN_COST && cost < BLOCKED)) throw new Error(`walk.floorCost.${name}: ${MIN_COST}…${BLOCKED - 1}`);
    floorCost[id] = cost;
  }
  return {
    nodesPerTick: posInt(d.nodesPerTick, 'nodesPerTick', 1_000_000),
    pathSlots: posInt(d.pathSlots, 'pathSlots', 4096),
    maxPathLen: posInt(d.maxPathLen, 'maxPathLen', 4096),
    floorCost,
  };
}

export const WALK: WalkConfig = buildWalkConfig(raw as RawWalk);

export class WalkGrid {
  readonly w: number;
  readonly h: number;
  readonly cost: Uint8Array;
  /**
   * Per tile: bit d set = a step in direction d (DX/DY) onto a walkable tile is allowed
   * (no wall on the edge, no corner cutting). Steps onto a blocked goal are checked separately.
   */
  readonly moves: Uint8Array;
  /** Bumped on every update. */
  version = 0;

  constructor(
    readonly area: AreaGrids,
    readonly occ: Occupancy,
    readonly config: WalkConfig = WALK,
  ) {
    this.w = area.w;
    this.h = area.h;
    this.cost = new Uint8Array(area.w * area.h);
    this.moves = new Uint8Array(area.w * area.h);
    this.update(0, 0, area.w, area.h);
  }

  /** Recomputes the inclusive-exclusive rect (clipped to the area). */
  update(x0: number, y0: number, x1: number, y1: number): void {
    const { w, h } = this;
    const ax = Math.max(0, x0);
    const ay = Math.max(0, y0);
    const bx = Math.min(w, x1);
    const by = Math.min(h, y1);
    const floor = this.area.floor;
    const furn = this.occ.furniture;
    const fc = this.config.floorCost;
    for (let y = ay; y < by; y++) {
      for (let x = ax; x < bx; x++) {
        const t = y * w + x;
        this.cost[t] = furn[t] !== 0 ? BLOCKED : (fc[floor[t]!] ?? BLOCKED);
      }
    }
    // Move masks depend on neighbours, so refresh one tile further out.
    const mx0 = Math.max(0, ax - 1);
    const my0 = Math.max(0, ay - 1);
    const mx1 = Math.min(w, bx + 1);
    const my1 = Math.min(h, by + 1);
    for (let y = my0; y < my1; y++) for (let x = mx0; x < mx1; x++) this.moves[y * w + x] = this.computeMoves(x, y);
    this.version++;
  }

  /** Slow, exact rule for one step from (ax, ay) in direction (dx, dy); `goalOk` lets the target be blocked. */
  stepAllowed(ax: number, ay: number, dx: number, dy: number, goalOk: boolean): boolean {
    const w = this.w;
    const bx = ax + dx;
    const by = ay + dy;
    if (bx < 0 || by < 0 || bx >= w || by >= this.h) return false;
    if (!goalOk && !this.passable(by * w + bx)) return false;
    if (dx === 0 || dy === 0) return this.edgeOpen(ax, ay, bx, by);
    // Diagonal: both side tiles must be walkable and no wall on any of the four edges.
    if (!this.passable(ay * w + bx) || !this.passable(by * w + ax)) return false;
    return this.edgeOpen(ax, ay, bx, ay) && this.edgeOpen(bx, ay, bx, by) && this.edgeOpen(ax, ay, ax, by) && this.edgeOpen(ax, by, bx, by);
  }

  private computeMoves(x: number, y: number): number {
    let m = 0;
    for (let d = 0; d < 8; d++) if (this.stepAllowed(x, y, DX[d]!, DY[d]!, false)) m |= 1 << d;
    return m;
  }

  passable(t: number): boolean {
    return this.cost[t] !== BLOCKED;
  }

  /**
   * Whether the edge between orthogonal neighbours a=(ax,ay) and b is free of back walls.
   * WALL.n sits on a tile's −y edge, WALL.w on its −x edge.
   */
  edgeOpen(ax: number, ay: number, bx: number, by: number): boolean {
    const wall = this.area.wall;
    const w = this.w;
    if (bx === ax) {
      if (by === ay - 1) return (wall[ay * w + ax]! & WALL.n) === 0;
      if (by === ay + 1) return (wall[by * w + bx]! & WALL.n) === 0;
    } else if (by === ay) {
      if (bx === ax - 1) return (wall[ay * w + ax]! & WALL.w) === 0;
      if (bx === ax + 1) return (wall[by * w + bx]! & WALL.w) === 0;
    }
    return false;
  }
}
