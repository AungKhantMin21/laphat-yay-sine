// Placement rules, shared by the worker (authority) and build mode's ghost on the main thread.
// Pure and allocation-free: the caller passes a result object to fill (the ghost checks every move).
import { CATALOG, LAYER, footH, footW } from '../catalog';
import { WALL, ZONE } from '../layout';
import { wallGridFor, type WorldState } from '../world-state';

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
      for (let dy = 0; dy < fh; dy++) for (let dx = 0; dx < fw; dx++) if (!isFree(occ.floor[(y + dy) * W + x + dx]!, ignore)) return fail(out, 'build.err.blocked');
      break;

    case LAYER.furniture: {
      if (def.small) {
        const under = occ.furniture[t]!;
        if (isFree(under, ignore)) break; // stands on the floor
        const surface = CATALOG.defs[world.objects.type[under]!];
        if (!surface || surface.surface === 0) return fail(out, 'build.err.noSurface');
        if (!isFree(occ.stack[t]!, ignore)) return fail(out, 'build.err.blocked');
        out.ok = true;
        out.reason = '';
        out.parent = under;
        return out;
      }
      for (let dy = 0; dy < fh; dy++) for (let dx = 0; dx < fw; dx++) if (!isFree(occ.furniture[(y + dy) * W + x + dx]!, ignore)) return fail(out, 'build.err.blocked');
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
