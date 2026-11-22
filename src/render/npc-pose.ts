// Which atlas frame a customer shows, how it is mirrored, and where it sorts. No Pixi here (tested headless).
//
// Frames are npc/c<look>_<f|b>_<w0|w1|s> (tools/placeholder-characters.ts): the front view faces
// down-left on screen (+y, DIR.south) and the back view faces up-right (−y, DIR.north).
// The other two directions are the same frames mirrored.
import { ANIM, DIR } from '../shared/npc';

export const POSES = ['w0', 'w1', 's'] as const;
export const VIEWS = ['f', 'b'] as const;

/** Index into a look-major texture table: ((look × 2) + view) × 3 + pose. */
export function poseIndex(look: number, dir: number, anim: number, step: number): number {
  const back = dir === DIR.north || dir === DIR.west ? 1 : 0;
  const pose = anim === ANIM.sit ? 2 : anim === ANIM.walk ? step & 1 : 0;
  return (look * 2 + back) * 3 + pose;
}

/** East (down-right) and west (up-left) are the south/north frames flipped. */
export function poseFlipped(dir: number): boolean {
  return dir === DIR.east || dir === DIR.west;
}

export function poseFrameName(look: number, view: number, pose: number): string {
  return `npc/c${look}_${VIEWS[view]}_${POSES[pose]}`;
}

/**
 * Depth for a standing or walking customer on tile (tx, ty): after the furniture of its row
 * (render/objects.ts objectDepth: row·16 + 4…7) and before ceiling items (row·16 + 12) and the next row.
 */
export function standingDepth(tx: number, ty: number): number {
  return (tx + ty) * 16 + 8;
}
