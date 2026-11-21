// Object sprites: one per placed object, depth-sorted, synced from the view mirror's change lists.
// Floor-layer objects (rugs) draw in their own layer under everything else.
import { Container, Sprite, type Texture } from 'pixi.js';
import { CATALOG, LAYER, footH, footW, spriteFrame, type ObjectDef } from '../shared/catalog';
import { handleIndex } from '../shared/ids';
import { isoX, isoY } from '../shared/iso';
import type { WorldView } from '../game/view';
import type { Atlas } from './atlas';
import type { Recolourer } from './recolour';

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

export class ObjectLayer {
  readonly floorLayer = new Container();
  readonly layer = new Container();
  private readonly sprites: Array<Sprite | null> = [];
  /** Base atlas frame per sprite slot, for pixel-accurate picking. */
  private readonly frameOf: string[] = [];

  constructor(
    private readonly view: WorldView,
    private readonly atlas: Atlas,
    private readonly recolour: Recolourer,
  ) {
    this.layer.sortableChildren = true;
    this.floorLayer.sortableChildren = true;
  }

  /** Apply the view's object changes since the last frame. Returns true if anything changed. */
  sync(): boolean {
    const v = this.view;
    const changed = v.objResync || v.objRemovedCount > 0 || v.objChanged.length > 0;
    if (!changed) return false;
    if (v.objResync) {
      v.objResync = false;
      for (let i = 0; i < this.sprites.length; i++) this.drop(i);
      const s = v.state.objects;
      for (let i = 1; i < s.capacity; i++) if (s.live[i]) this.update(i);
      v.objRemovedCount = 0;
      v.objChanged.clear();
      return true;
    }
    for (let k = 0; k < v.objRemovedCount; k++) {
      const i = handleIndex(v.objRemoved[k]!);
      if (!v.state.objects.live[i]) this.drop(i);
    }
    v.objRemovedCount = 0;
    const q = v.objChanged;
    for (let k = 0; k < q.length; k++) this.update(q.list[k]!);
    q.clear();
    return true;
  }

  /** Topmost object slot under a world-pixel point (pixel-accurate), or 0. */
  pick(wx: number, wy: number, filter?: (i: number) => boolean): number {
    let best = 0;
    let bestZ = -Infinity;
    const px = this.atlas.pixels;
    for (let i = 1; i < this.sprites.length; i++) {
      const sp = this.sprites[i];
      if (!sp || !sp.visible || (filter && !filter(i))) continue;
      const lx = Math.floor(wx - sp.x);
      const ly = Math.floor(wy - sp.y);
      if (lx < 0 || ly < 0 || lx >= sp.width || ly >= sp.height) continue;
      const rect = this.atlas.frames.get(this.frameOf[i]!);
      if (!rect) continue;
      const a = px.data[((rect[1] + ly) * px.width + rect[0] + lx) * 4 + 3]!;
      const z = sp.zIndex + (sp.parent === this.floorLayer ? -1e6 : 0);
      if (a > 0 && z > bestZ) {
        best = i;
        bestZ = z;
      }
    }
    return best;
  }

  /** Sprite for an object slot (build mode tints the selection). */
  spriteOf(i: number): Sprite | null {
    return this.sprites[i] ?? null;
  }

  /** Texture and placement for a hypothetical object (the build ghost). */
  frameFor(type: number, rot: number, colour: number): Texture {
    const def = CATALOG.defs[type]!;
    return this.recolour.get(spriteFrame(def, rot), colour);
  }

  private update(i: number): void {
    const s = this.view.state.objects;
    if (!s.live[i]) return this.drop(i);
    const def = CATALOG.defs[s.type[i]!];
    if (!def) return;
    const rot = s.rot[i]!;
    const frame = spriteFrame(def, rot);
    let sp = this.sprites[i];
    const target = def.layer === LAYER.floor ? this.floorLayer : this.layer;
    if (!sp) {
      sp = new Sprite();
      sp.roundPixels = true;
      this.sprites[i] = sp;
    }
    if (sp.parent !== target) target.addChild(sp);
    sp.texture = this.recolour.get(frame, s.colour[i]!);
    this.frameOf[i] = frame;
    const p = s.parent[i]!;
    const lift = p ? (CATALOG.defs[s.type[p]!]?.surface ?? 0) : 0;
    const x = s.x[i]!;
    const y = s.y[i]!;
    sp.position.set(objectSpriteX(def, x, y, rot), objectSpriteY(def, x, y, rot, sp.texture.frame.height, lift));
    if (p) {
      // On a surface: just above the surface, front items above back ones.
      const pd = CATALOG.defs[s.type[p]!]!;
      sp.zIndex = objectDepth(pd, s.x[p]!, s.y[p]!, s.rot[p]!, false) + 1 + (x + y - s.x[p]! - s.y[p]!);
    } else {
      sp.zIndex = objectDepth(def, x, y, rot, false);
    }
  }

  private drop(i: number): void {
    const sp = this.sprites[i];
    if (!sp) return;
    sp.destroy();
    this.sprites[i] = null;
  }
}
