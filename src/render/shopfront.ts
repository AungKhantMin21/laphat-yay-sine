// The tea shop's own front: roll-up shutters over the opening (closed in the morning and evening),
// a striped awning above them and the signboard. One pooled sprite per front-edge tile in the
// objects' sortable container, so the closed shutters really hide the room behind them and
// people on the pavement draw in front. Updates only when the day phase changes.
import { Sprite, Texture, type Container } from 'pixi.js';
import type { Atlas } from './atlas';
import { isoX, isoY, HALF_W, HALF_H } from '../shared/iso';
import { PHASE } from '../shared/day';
import { OPENING, SHOP, SIGN } from '../shared/street';

/** Depth just in front of everything on the shop's front row, behind anything on the pavement. */
function edgeDepth(x: number): number {
  return (x + SHOP.y1) * 16 - 1;
}

export class ShopFront {
  private readonly shutters: Sprite[] = [];
  private readonly open: Texture;
  private readonly closed: Texture;
  private phase = -1;

  constructor(atlas: Atlas, layer: Container) {
    this.open = atlas.get('shop/shutter_open') ?? Texture.EMPTY;
    this.closed = atlas.get('shop/shutter_closed') ?? Texture.EMPTY;
    const add = (tex: Texture, x: number, depthBias: number): Sprite => {
      const s = new Sprite(tex);
      s.roundPixels = true;
      // Frames are 1×1 iso images: footprint diamond at the bottom, top vertex at (16, height).
      s.position.set(isoX(x, SHOP.y1) - HALF_W, isoY(x, SHOP.y1) + 2 * HALF_H - tex.height);
      s.zIndex = edgeDepth(x) + depthBias;
      layer.addChild(s);
      return s;
    };
    for (let x = OPENING.x0; x < OPENING.x1; x++) {
      this.shutters.push(add(this.closed, x, 0));
      add(atlas.get((x - OPENING.x0) % 2 ? 'shop/awning_b' : 'shop/awning_a') ?? Texture.EMPTY, x, 0.5);
    }
    add(atlas.get('shop/sign') ?? Texture.EMPTY, SIGN.x, 0);
  }

  /** Shutters follow the day: rolled up while the shop is open or closing. */
  update(phase: number): void {
    if (phase === this.phase) return;
    this.phase = phase;
    const up = phase === PHASE.open || phase === PHASE.closing;
    // Both frames are the same size, so only the texture changes.
    for (const s of this.shutters) s.texture = up ? this.open : this.closed;
  }
}
