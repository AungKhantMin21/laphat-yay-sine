// The neighbourhood's four shops (M3): per front tile a back wall with shelves and a counter with
// goods under a striped awning, a signboard on the first tile, and the keeper standing between wall
// and counter. Static pooled sprites in the objects' sortable container, built once from
// shared/neighbourhood.ts; fronts on a −x edge use the same frames mirrored. Nothing per frame.
import { Sprite, Texture, type Container } from 'pixi.js';
import { HALF_H, HALF_W } from '../shared/iso';
import { NEIGHBOURHOOD, doorOffset, spanTile, type ShopSite } from '../shared/neighbourhood';
import { BUILDING_FLAG } from '../shared/properties';
import type { Atlas } from './atlas';

/** World point of tile-space (u, v) (fractional tiles). */
const wx = (u: number, v: number): number => (u - v) * HALF_W;
const wy = (u: number, v: number): number => (u + v) * HALF_H;

export class StreetShops {
  /** Keeper feet in world px, by shop id (tap targets and the visit marker). */
  readonly keeperAt: { x: number; y: number }[] = [];
  /** Keeper sprites by shop id: shown while the keeper is behind the counter (M4 residents). */
  private readonly keeper: Sprite[] = [];
  private mask = -1;

  /** Per building: a sign and shutter sprites, made the first time they're needed (M4). */
  private readonly fronts: ({ sign: Sprite; shut: Sprite[] } | null)[] = [];
  private flagsShown: readonly number[] = [];

  constructor(
    private readonly atlas: Atlas,
    private readonly layer: Container,
  ) {
    for (const shop of NEIGHBOURHOOD.shops) this.build(shop, atlas, layer);
    // The notice board (M4) stands on its tile beside the junction.
    const b = NEIGHBOURHOOD.board;
    const t = atlas.get('street/board') ?? Texture.EMPTY;
    const sp = new Sprite(t);
    sp.roundPixels = true;
    sp.position.set(wx(b.x, b.y) - HALF_W, wy(b.x, b.y) + 2 * HALF_H - t.height);
    sp.zIndex = (b.x + b.y) * 16 + 8;
    layer.addChild(sp);
  }

  /** The board's feet in world px (tap target). */
  boardAt(): { x: number; y: number } {
    const b = NEIGHBOURHOOD.board;
    return { x: wx(b.x + 0.5, b.y + 0.5), y: wy(b.x + 0.5, b.y + 0.5) };
  }

  /**
   * PlayerState.buildings (M4): a for-sale / for-rent sign beside the door, and shutters down over
   * a closed business's ground floor. Changes only when a flag does.
   */
  setBuildings(flags: readonly number[]): void {
    if (flags === this.flagsShown) return;
    this.flagsShown = flags;
    for (let i = 0; i < NEIGHBOURHOOD.buildings.length; i++) {
      const f = flags[i] ?? 0;
      let fr = this.fronts[i];
      if (!fr && f === 0) continue;
      if (!fr) fr = this.fronts[i] = this.makeFront(i);
      const sale = (f & BUILDING_FLAG.forSale) !== 0;
      const rent = (f & BUILDING_FLAG.forRent) !== 0;
      fr.sign.visible = sale || rent;
      if (fr.sign.visible) fr.sign.texture = this.atlas.get(sale ? 'street/sign_sale' : 'street/sign_rent') ?? Texture.EMPTY;
      for (const s of fr.shut) s.visible = (f & BUILDING_FLAG.shut) !== 0;
    }
  }

  private makeFront(i: number): { sign: Sprite; shut: Sprite[] } {
    const b = NEIGHBOURHOOD.buildings[i]!;
    const west = b.edge === 'w';
    const place = (t: Texture, p: number, bias: number): Sprite => {
      const { x, y } = spanTile(b, p);
      const sp = new Sprite(t);
      sp.roundPixels = true;
      sp.scale.x = west ? -1 : 1;
      sp.position.set(wx(x, y) - HALF_W + (west ? t.width : 0), wy(x, y) + 2 * HALF_H - t.height);
      sp.zIndex = (x + y) * 16 + bias;
      sp.visible = false;
      this.layer.addChild(sp);
      return sp;
    };
    const n = b.to - b.from;
    const door = b.from + doorOffset(n);
    const shutTex = this.atlas.get(b.tall ? 'street/shut_t' : 'street/shut_l') ?? Texture.EMPTY;
    const shut: Sprite[] = [];
    for (let p = b.from + 1; p < b.to - 1; p++) shut.push(place(shutTex, p, 1));
    const sign = place(this.atlas.get('street/sign_sale') ?? Texture.EMPTY, Math.min(b.to - 1, door + 1), 2);
    return { sign, shut };
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
    this.keeper[s.id] = k;
    this.keeperAt[s.id] = { x: k.x, y: k.y };
  }

  /** PlayerState.keepers: which keepers are at their stalls (they walk there from home). */
  setKeepers(mask: number): void {
    if (mask === this.mask) return;
    this.mask = mask;
    this.keeper.forEach((k, id) => (k.visible = (mask & (1 << id)) !== 0));
  }

  /** The shop whose stall is under world point (x, y) (counter, keeper or awning), the board's site id, or −1. */
  pick(x: number, y: number): number {
    const b = NEIGHBOURHOOD.board;
    const bx = wx(b.x, b.y);
    const by = wy(b.x, b.y);
    if (x >= bx - HALF_W && x < bx + HALF_W && y >= by - 26 && y < by + 2 * HALF_H) return b.id;
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
