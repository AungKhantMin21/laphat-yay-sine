// The neighbourhood's four shops (M3): per front tile a back wall with shelves and a counter with
// goods under a striped awning, a signboard on the first tile, and the keeper standing between wall
// and counter. Static pooled sprites in the objects' sortable container, built once from
// shared/neighbourhood.ts; fronts on a −x edge use the same frames mirrored. Nothing per frame.
import { Sprite, Texture, type Container } from 'pixi.js';
import { HALF_H, HALF_W } from '../shared/iso';
import { NEIGHBOURHOOD, type ShopSite } from '../shared/neighbourhood';
import type { Atlas } from './atlas';

/** World point of tile-space (u, v) (fractional tiles). */
const wx = (u: number, v: number): number => (u - v) * HALF_W;
const wy = (u: number, v: number): number => (u + v) * HALF_H;

export class StreetShops {
  /** Keeper feet in world px, by shop id (tap targets and the visit marker). */
  readonly keeperAt: { x: number; y: number }[] = [];

  constructor(atlas: Atlas, layer: Container) {
    for (const shop of NEIGHBOURHOOD.shops) this.build(shop, atlas, layer);
  }

  private build(s: ShopSite, atlas: Atlas, layer: Container): void {
    const west = s.edge === 'w';
    const tex = (name: string): Texture => atlas.get(`stall/${s.key}_${name}`) ?? Texture.EMPTY;
    // A 1×1 frame at tile (x, y): footprint diamond at the bottom, top vertex at (16, height).
    const add = (t: Texture, x: number, y: number, bias: number): void => {
      const sp = new Sprite(t);
      sp.roundPixels = true;
      sp.scale.x = west ? -1 : 1;
      sp.position.set(wx(x, y) - HALF_W + (west ? t.width : 0), wy(x, y) + 2 * HALF_H - t.height);
      sp.zIndex = (x + y) * 16 + bias;
      layer.addChild(sp);
    };
    for (let p = s.from; p < s.to; p++) {
      // The counter row is one tile behind the pavement.
      const x = west ? s.at - 1 : p;
      const y = west ? p : s.at - 1;
      add(tex('back'), x, y, 1);
      add(tex((p - s.from) % 2 ? 'front_b' : 'front_a'), x, y, 8);
      if (p === s.from) add(tex('sign'), x, y, 9);
    }
    // The keeper stands behind the counter in front of the visit tile, facing the street.
    const kx = west ? s.at - 1 + 0.3 : s.visitX + 0.5;
    const ky = west ? s.visitY + 0.5 : s.at - 1 + 0.3;
    const k = new Sprite(atlas.get(`npc/s${s.id}_f`) ?? Texture.EMPTY);
    k.anchor.set(0.5, 1);
    k.roundPixels = true;
    k.scale.x = west ? -1 : 1;
    k.position.set(Math.round(wx(kx, ky)), Math.round(wy(kx, ky)));
    k.zIndex = (Math.floor(kx) + Math.floor(ky)) * 16 + 4;
    layer.addChild(k);
    this.keeperAt[s.id] = { x: k.x, y: k.y };
  }

  /** The shop whose stall is under world point (x, y) (counter, keeper or awning), or −1. */
  pick(x: number, y: number): number {
    for (const s of NEIGHBOURHOOD.shops) {
      // Inside any counter tile's sprite box (32 wide, from the awning top down to the floor).
      for (let p = s.from; p < s.to; p++) {
        const tx = s.edge === 'w' ? s.at - 1 : p;
        const ty = s.edge === 'w' ? p : s.at - 1;
        const cx = wx(tx, ty);
        const top = wy(tx, ty) - 40;
        if (x >= cx - HALF_W && x < cx + HALF_W && y >= top && y < wy(tx, ty) + 2 * HALF_H) return s.id;
      }
    }
    return -1;
  }
}
