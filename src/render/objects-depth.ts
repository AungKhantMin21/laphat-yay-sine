// Where object sprites go and how they sort. No Pixi here (shared with npcs and tested headless).
import { LAYER, footH, footW, type ObjectDef } from '../shared/catalog';
import { isoX, isoY } from '../shared/iso';

/** Sprite position for an object frame: top vertex of its footprint at the tile's top vertex. */
export function objectSpriteX(def: ObjectDef, x: number, y: number, rot: number): number {
  return isoX(x, y) - footH(def, rot) * 16;
}
export function objectSpriteY(def: ObjectDef, x: number, y: number, rot: number, frameH: number, lift: number): number {
  return isoY(x, y) + (footW(def, rot) + footH(def, rot)) * 8 - frameH - lift;
}

/** Later draws on top: by the footprint's front tile, then layer, then stacked. */
export function objectDepth(def: ObjectDef, x: number, y: number, rot: number, stacked: boolean): number {
  const fx = x + footW(def, rot) - 1;
  const fy = y + footH(def, rot) - 1;
  const layerOrder = def.layer === LAYER.wall ? 0 : def.layer === LAYER.ceiling ? 3 : 1;
  return (fx + fy) * 16 + layerOrder * 4 + (stacked ? 2 : 0) + (fx & 1);
}
