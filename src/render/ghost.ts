// The build ghost: a translucent object sprite plus its footprint tiles, green when the spot is
// valid and red when it isn't.
import { Container, Graphics, Sprite } from 'pixi.js';
import { CATALOG, footH, footW } from '../shared/catalog';
import { isoX, isoY } from '../shared/iso';
import { objectDepth, objectSpriteX, objectSpriteY, type ObjectLayer } from './objects';

const OK_TILE = 0x6b8f5a;
const BAD_TILE = 0xc85a44;
const BAD_TINT = 0xff8a70;

export class Ghost {
  /** Footprint marks; add between the floor-object layer and the object layer. */
  readonly marks = new Graphics();
  readonly sprite = new Sprite();

  constructor(
    private readonly objects: ObjectLayer,
    objectLayer: Container,
  ) {
    this.sprite.roundPixels = true;
    this.sprite.alpha = 0.8;
    this.sprite.visible = false;
    objectLayer.addChild(this.sprite);
  }

  show(type: number, x: number, y: number, rot: number, colour: number, ok: boolean, lift: number): void {
    const def = CATALOG.defs[type];
    if (!def) return this.hide();
    const sp = this.sprite;
    sp.texture = this.objects.frameFor(type, rot, colour);
    sp.position.set(objectSpriteX(def, x, y, rot), objectSpriteY(def, x, y, rot, sp.texture.frame.height, lift));
    sp.zIndex = objectDepth(def, x, y, rot, lift > 0) + 3;
    sp.tint = ok ? 0xffffff : BAD_TINT;
    sp.visible = true;

    const g = this.marks;
    g.clear();
    const fw = footW(def, rot);
    const fh = footH(def, rot);
    for (let dy = 0; dy < fh; dy++) {
      for (let dx = 0; dx < fw; dx++) {
        const vx = isoX(x + dx, y + dy);
        const vy = isoY(x + dx, y + dy);
        g.poly([vx, vy, vx + 16, vy + 8, vx, vy + 16, vx - 16, vy + 8]);
      }
    }
    g.fill({ color: ok ? OK_TILE : BAD_TILE, alpha: 0.45 });
    g.visible = true;
  }

  hide(): void {
    this.sprite.visible = false;
    this.marks.visible = false;
  }
}
