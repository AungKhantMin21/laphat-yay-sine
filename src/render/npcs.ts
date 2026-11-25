// NPC sprites (customers, and the player and staff from M2.5): one pooled body sprite per NPC slot in
// the objects' sortable container, so people and furniture share one depth order, plus an order bubble
// above a customer's head.
// Positions interpolate between the last two sim frames and snap to whole pixels.
// Only the first `maxAnimated` on-screen walkers animate (tier cap); the rest hold a still frame.
import { Container, Sprite, Texture } from 'pixi.js';
import { CATALOG } from '../shared/catalog';
import { DRINKS } from '../shared/drinks';
import { HALF_H, HALF_W } from '../shared/iso';
import { ANIM, NPC_DEF_CUSTOMER, NPC_DEF_RESIDENT, ORDER } from '../shared/npc';
import { MAX_NPCS } from '../shared/layout';
import { handleIndex } from '../shared/ids';
import { TICK_MS } from '../shared/protocol';
import type { WorldView } from '../game/view';
import type { Atlas } from './atlas';
import { objectDepth } from './objects-depth';
import { POSES, VIEWS, poseFlipped, poseFrameName, poseIndex, standingDepth, workerFrameName } from './npc-pose';

/** A seated customer is drawn this many px up, onto the seat. */
const SIT_LIFT = 4;
/** Walk frame length (ms). */
const STEP_MS = 180;
/** Bubble offset above the sprite's top. */
const BUBBLE_GAP = 1;
/** Extra world px around a bubble that still counts as a tap on it (small touch targets). */
const TAP_SLOP = 4;

export class NpcLayer {
  /** Bubbles draw above the world objects. */
  readonly bubbles = new Container();
  private readonly body: Array<Sprite | null> = new Array<Sprite | null>(MAX_NPCS).fill(null);
  private readonly bubble: Array<Sprite | null> = new Array<Sprite | null>(MAX_NPCS).fill(null);
  private readonly poses: Texture[] = [];
  private readonly looks: number;
  private readonly drinkBubble: Texture[] = [];
  private readonly pourBubble: Texture;
  private readonly askBubble: Texture;
  /** Worker poses by role, same layout as customer looks. */
  private readonly workerPoses: Texture[] = [];
  /** Customers drawn last frame (perf overlay). */
  visible = 0;
  animated = 0;

  constructor(
    private readonly view: WorldView,
    atlas: Atlas,
    private readonly layer: Container,
  ) {
    let looks = 0;
    while (atlas.get(poseFrameName(looks, 0, 0))) looks++;
    this.looks = Math.max(1, looks);
    for (let l = 0; l < this.looks; l++) {
      for (let v = 0; v < VIEWS.length; v++) for (let p = 0; p < POSES.length; p++) this.poses.push(atlas.get(poseFrameName(l, v, p)) ?? Texture.EMPTY);
    }
    for (const d of DRINKS.defs) this.drinkBubble.push(atlas.get(`ui/bubble_${d.key}`) ?? Texture.EMPTY);
    this.pourBubble = atlas.get('ui/bubble_pour') ?? Texture.EMPTY;
    this.askBubble = atlas.get('ui/bubble_ask') ?? Texture.EMPTY;
    for (let r = 0; r < 2; r++) {
      for (let v = 0; v < VIEWS.length; v++) for (let p = 0; p < POSES.length; p++) this.workerPoses.push(atlas.get(workerFrameName(r, v, p)) ?? Texture.EMPTY);
    }
  }

  /** The drawn body sprite of NPC slot i (on screen), or null. */
  bodyOf(i: number): Sprite | null {
    const sp = this.body[i];
    return sp && sp.visible ? sp : null;
  }

  /**
   * Places every customer for this render frame. `x0…y1` = camera view in world px (culling).
   */
  update(now: number, maxAnimated: number, x0: number, y0: number, x1: number, y1: number): void {
    const v = this.view;
    let a = (now - v.frameAt) / TICK_MS;
    a = a < 0 ? 0 : a > 1 ? 1 : a;
    const occ = v.state.occ.furniture;
    const objs = v.state.objects;
    const W = v.area.w;
    let shown = 0;
    let animated = 0;
    for (let i = 1; i < MAX_NPCS; i++) {
      let sp = this.body[i];
      const bub = this.bubble[i];
      if (!v.npcLive[i]) {
        if (sp) sp.visible = false;
        if (bub) bub.visible = false;
        continue;
      }
      const x = v.npcPrevX[i]! + (v.npcX[i]! - v.npcPrevX[i]!) * a;
      const y = v.npcPrevY[i]! + (v.npcY[i]! - v.npcPrevY[i]!) * a;
      const anim = v.npcAnim[i]!;
      const lift = anim === ANIM.sit ? SIT_LIFT : 0;
      const sx = Math.round((x - y) * HALF_W);
      const sy = Math.round((x + y) * HALF_H) - lift;
      const onScreen = sx + 16 > x0 && sx - 16 < x1 && sy + 4 > y0 && sy - 40 < y1;
      if (!onScreen) {
        if (sp) sp.visible = false;
        if (bub) bub.visible = false;
        continue;
      }
      if (!sp) {
        sp = new Sprite();
        sp.anchor.set(0.5, 1);
        sp.roundPixels = true;
        this.body[i] = sp;
        this.layer.addChild(sp);
      }
      shown++;
      let step = 0;
      if (anim === ANIM.walk && animated < maxAnimated) {
        animated++;
        step = Math.floor(now / STEP_MS + i * 0.37) & 1; // phase per customer so feet don't sync
      }
      const dir = v.npcDir[i]!;
      sp.texture =
        v.npcDef[i] === NPC_DEF_CUSTOMER || v.npcDef[i] === NPC_DEF_RESIDENT
          ? (this.poses[poseIndex(v.npcLook[i]! % this.looks, dir, anim, step)] ?? Texture.EMPTY)
          : (this.workerPoses[poseIndex(v.npcLook[i]! & 1, dir, anim, step)] ?? Texture.EMPTY);
      sp.scale.x = poseFlipped(dir) ? -1 : 1;
      sp.position.set(sx, sy);
      sp.visible = true;
      const tx = Math.floor(x);
      const ty = Math.floor(y);
      let z = standingDepth(tx, ty);
      if (anim === ANIM.sit && tx >= 0 && ty >= 0 && tx < W) {
        // On a seat: just above the seat (a bench sorts by its front tile, not this one).
        const o = occ[ty * W + tx] ?? 0;
        const def = o ? CATALOG.defs[objs.type[o]!] : undefined;
        if (def) z = objectDepth(def, objs.x[o]!, objs.y[o]!, objs.rot[o]!, false) + 1;
      }
      sp.zIndex = z;

      const order = v.npcOrderState[i]!;
      if (order === ORDER.waiting || order === ORDER.pouring || order === ORDER.ask) {
        let b = bub;
        if (!b) {
          b = new Sprite();
          b.anchor.set(0.5, 1);
          b.roundPixels = true;
          this.bubble[i] = b;
          this.bubbles.addChild(b);
        }
        b.texture = order === ORDER.pouring ? this.pourBubble : order === ORDER.ask ? this.askBubble : (this.drinkBubble[v.npcDrink[i]!] ?? Texture.EMPTY);
        b.position.set(sx, sy - sp.texture.frame.height - BUBBLE_GAP);
        b.visible = true;
      } else if (bub) {
        bub.visible = false;
      }
    }
    this.visible = shown;
    this.animated = animated;
  }

  /**
   * World-pixel point just above a drawn customer's head (into `out`), or false when the handle
   * is stale or the customer is not on screen.
   */
  headOf(handle: number, out: { x: number; y: number }): boolean {
    const i = handleIndex(handle);
    if (i <= 0 || i >= MAX_NPCS || this.view.npcHandle(i) !== handle) return false;
    const sp = this.body[i];
    if (!sp || !sp.visible) return false;
    out.x = sp.x;
    out.y = sp.y - sp.texture.frame.height - BUBBLE_GAP;
    return true;
  }

  /**
   * The customer with an open order (asking, waiting or being poured for) under a world-pixel point
   * (their bubble, with some slop, or their body box), front-most first. Returns the NPC handle or 0.
   */
  pickOrder(wx: number, wy: number): number {
    const v = this.view;
    let best = 0;
    let bestZ = -Infinity;
    for (let i = 1; i < MAX_NPCS; i++) {
      const o = v.npcOrderState[i];
      if (!v.npcLive[i] || v.npcDef[i] !== NPC_DEF_CUSTOMER || (o !== ORDER.waiting && o !== ORDER.pouring && o !== ORDER.ask)) continue;
      const sp = this.body[i];
      if (!sp || !sp.visible) continue;
      const b = this.bubble[i];
      let hit = false;
      if (b && b.visible) {
        const bw = b.texture.frame.width / 2 + TAP_SLOP;
        hit = wx >= b.x - bw && wx <= b.x + bw && wy >= b.y - b.texture.frame.height - TAP_SLOP && wy <= b.y + TAP_SLOP;
      }
      if (!hit) {
        const hw = sp.texture.frame.width / 2;
        hit = wx >= sp.x - hw && wx <= sp.x + hw && wy >= sp.y - sp.texture.frame.height && wy <= sp.y;
      }
      const z = sp.zIndex + (b?.visible ? 1e6 : 0);
      if (hit && z > bestZ) {
        best = v.npcHandle(i);
        bestZ = z;
      }
    }
    return best;
  }
}
