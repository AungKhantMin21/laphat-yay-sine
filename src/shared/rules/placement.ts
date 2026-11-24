// Placement rules, shared by the worker (authority) and build mode's ghost on the main thread.
// Also where the paint tool may paint (M3).
// Pure and allocation-free: the caller passes a result object to fill (the ghost checks every move).
import { CATALOG, LAYER, ZONE_RULE, footH, footW } from '../catalog';
import { MAX_AREA_H, MAX_AREA_W, WALL, WALL_N, WALL_W, ZONE } from '../layout';
import { wallGridFor, type WorldState } from '../world-state';
import { ACCESS, WZ, isShopZone, keepClear, mayEnter } from './access';

export interface PlaceResult {
  ok: boolean;
  /** i18n key explaining a refusal ('' when ok). */
  reason: string;
  /** Slot index of the surface a small item will stand on (0 = floor). */
  parent: number;
}

export function newPlaceResult(): PlaceResult {
  return { ok: false, reason: '', parent: 0 };
}

function isFree(v: number, ignore: number): boolean {
  return v === 0 || v === ignore;
}

const fail = (out: PlaceResult, reason: string): PlaceResult => {
  out.ok = false;
  out.reason = reason;
  out.parent = 0;
  return out;
};

/**
 * Can `type` go at (x, y) with rotation `rot`? `ignore` is the slot being moved (its own tiles
 * count as free). A moved surface carries its stacked items, so they never block it.
 */
export function checkPlacement(world: WorldState, type: number, x: number, y: number, rot: number, ignore: number, out: PlaceResult): PlaceResult {
  const def = CATALOG.defs[type];
  if (!def) return fail(out, 'build.err.unknown');
  const a = world.area;
  const occ = world.occ;
  const W = a.w;
  const fw = footW(def, rot);
  const fh = footH(def, rot);
  if (x < 0 || y < 0 || x + fw > a.w || y + fh > a.h) return fail(out, 'build.err.outside');
  for (let dy = 0; dy < fh; dy++) {
    for (let dx = 0; dx < fw; dx++) if (!(a.zone[(y + dy) * W + x + dx]! & ZONE.owned)) return fail(out, 'build.err.notOwned');
  }
  const t = y * W + x;

  switch (def.layer) {
    case LAYER.floor:
      for (let dy = 0; dy < fh; dy++)
        for (let dx = 0; dx < fw; dx++) if (!isFree(occ.floor[(y + dy) * W + x + dx]!, ignore)) return fail(out, 'build.err.blocked');
      break;

    case LAYER.furniture: {
      if (def.small) {
        const under = occ.furniture[t]!;
        if (!isFree(under, ignore)) {
          const surface = CATALOG.defs[world.objects.type[under]!];
          if (!surface || surface.surface === 0) return fail(out, 'build.err.noSurface');
          if (!isFree(occ.stack[t]!, ignore)) return fail(out, 'build.err.blocked');
          out.ok = true;
          out.reason = '';
          out.parent = under;
          return out;
        }
        // Otherwise it stands on the floor like any furniture.
      }
      for (let dy = 0; dy < fh; dy++) {
        for (let dx = 0; dx < fw; dx++) {
          const tt = (y + dy) * W + x + dx;
          const z = a.access[tt]!;
          if (!isShopZone(z)) return fail(out, 'build.err.notOwned');
          if (keepClear(z)) return fail(out, 'build.err.walkway');
          // Seats belong in the seating room: customers never enter the kitchen.
          if ((def.seat > 0 || def.zone === ZONE_RULE.seating) && z !== WZ.interior) return fail(out, 'build.err.seatOutside');
          if (def.zone === ZONE_RULE.kitchen && z !== WZ.kitchen) return fail(out, 'build.err.kitchenOnly');
          if (!isFree(occ.furniture[tt]!, ignore)) return fail(out, 'build.err.blocked');
        }
      }
      if (!wayStaysOpen(world, x, y, fw, fh, ignore)) return fail(out, 'build.err.blocksWay');
      break;
    }

    case LAYER.wall: {
      const need = rot & 1 ? WALL.n : WALL.w;
      if (!(a.wall[t]! & need)) return fail(out, 'build.err.noWall');
      if (!isFree(wallGridFor(occ, rot)[t]!, ignore)) return fail(out, 'build.err.blocked');
      break;
    }

    case LAYER.ceiling:
      if (!(a.zone[t]! & ZONE.roof)) return fail(out, 'build.err.noRoof');
      if (!isFree(occ.ceiling[t]!, ignore)) return fail(out, 'build.err.blocked');
      break;
  }
  out.ok = true;
  out.reason = '';
  out.parent = 0;
  return out;
}

// ---- the way through the shop ----

// Scratch for the flood fill (no allocation per check; the ghost checks on every move).
const queue = new Int32Array(MAX_AREA_W * MAX_AREA_H);
const stamp = new Uint32Array(MAX_AREA_W * MAX_AREA_H);
let stampId = 0;

/**
 * Would furniture covering the rect (x, y, fw, fh) still leave every walk-way tile (the shop front and
 * the kitchen door) connected for staff? `ignore` is the object being moved (its tiles count as free).
 * 4-way search is exact here: walkers never cut corners, so a diagonal step always has an orthogonal pair.
 */
export function wayStaysOpen(world: WorldState, x: number, y: number, fw: number, fh: number, ignore: number): boolean {
  const a = world.area;
  const W = a.w;
  const H = a.h;
  const n = W * H;
  const acc = a.access;
  const furn = world.occ.furniture;
  const wall = a.wall;
  if (++stampId === 0xffffffff) {
    stamp.fill(0);
    stampId = 1;
  }
  const id = stampId;
  // Start from the first walk-way tile; count how many there are.
  let start = -1;
  let ways = 0;
  for (let t = 0; t < n; t++) {
    if (!keepClear(acc[t]!)) continue;
    ways++;
    if (start < 0) start = t;
  }
  if (start < 0) return true;
  let head = 0;
  let tail = 0;
  queue[tail++] = start;
  stamp[start] = id;
  let found = 1;
  while (head < tail) {
    const c = queue[head++]!;
    const cx = c % W;
    const cy = (c - cx) / W;
    // −y, +y, −x, +x; walls live on the −y / −x edge of the tile they belong to.
    for (let d = 0; d < 4; d++) {
      let nt: number;
      if (d === 0) {
        if (cy === 0 || wall[c]! & WALL_N) continue;
        nt = c - W;
      } else if (d === 1) {
        if (cy === H - 1 || wall[c + W]! & WALL_N) continue;
        nt = c + W;
      } else if (d === 2) {
        if (cx === 0 || wall[c]! & WALL_W) continue;
        nt = c - 1;
      } else {
        if (cx === W - 1 || wall[c + 1]! & WALL_W) continue;
        nt = c + 1;
      }
      if (stamp[nt] === id || !mayEnter(ACCESS.staff, acc[nt]!)) continue;
      const ntx = nt % W;
      const nty = (nt - ntx) / W;
      if (ntx >= x && ntx < x + fw && nty >= y && nty < y + fh) continue;
      const o = furn[nt]!;
      if (o !== 0 && o !== ignore) continue;
      stamp[nt] = id;
      queue[tail++] = nt;
      if (keepClear(acc[nt]!) && ++found === ways) return true;
    }
  }
  return found === ways;
}

/** Paint layers (the `paint` builder command). */
export const PAINT_LAYER = { floor: 0, wall: 1 } as const;

/**
 * May tile (x, y) be painted? Floors: inside the player's shop only. Walls: a tile with a wall
 * edge that belongs to the shop (back walls inside it; the front and east sills sit on the tile
 * beyond, so they count when the owned tile is on the other side of that edge). '' or an i18n key.
 */
export function checkPaint(s: WorldState, x: number, y: number, layer: number): string {
  const a = s.area;
  if (!a.inBounds(x, y)) return 'build.err.paintOutside';
  const t = y * a.w + x;
  const owned = (tx: number, ty: number): boolean => a.inBounds(tx, ty) && (a.zone[ty * a.w + tx]! & ZONE.owned) !== 0;
  if (layer === PAINT_LAYER.floor) return owned(x, y) && isShopZone(a.access[t]!) ? '' : 'build.err.paintOutside';
  if (layer !== PAINT_LAYER.wall) return 'build.err.paintOutside';
  const bits = a.wall[t]!;
  if (bits === 0) return 'build.err.noWall';
  if (owned(x, y) || ((bits & WALL_W) !== 0 && owned(x - 1, y)) || ((bits & WALL_N) !== 0 && owned(x, y - 1))) return '';
  return 'build.err.paintOutside';
}
