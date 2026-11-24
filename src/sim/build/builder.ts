// Build commands: place, move, rotate, recolour, pick up, sell, paint — with inventory, materials,
// money and undo/redo.
// Every command is stored as one generic record: objects before, objects after, inventory and money
// deltas. Undo applies the record backwards. Records reference objects by stable uid, never by slot.
import { CATALOG, LAYER, footH, footW, sellValue } from '../../shared/catalog';
import { PAINT_LAYER, checkPaint, checkPlacement, newPlaceResult } from '../../shared/rules/placement';
import { MATERIALS, MATERIAL_KIND } from '../../shared/materials';
import type { SimWorld } from '../world';

export const HISTORY_MAX = 100;

/** An object as stored in history: fields plus uids instead of slot indices. */
export interface Snap {
  uid: number;
  type: number;
  x: number;
  y: number;
  rot: number;
  layer: number;
  colour: number;
  parentUid: number;
}

interface Op {
  before: Snap[];
  after: Snap[];
  /** [type, delta] pairs applied to the inventory going forward. */
  inv: Array<[number, number]>;
  money: number;
  /** Painted tiles (M3): grid value before and after; floor = the floor grid, else the wall colour. */
  paint?: { tile: number; floor: boolean; from: number; to: number }[];
  /** [material, delta] pairs applied going forward (tiles). */
  mat?: Array<[number, number]>;
}

export interface Result {
  ok: boolean;
  reason?: string;
  /** Slot index of the placed or moved object. */
  index?: number;
}

const OK: Result = { ok: true };
const no = (reason: string): Result => ({ ok: false, reason });

export class Builder {
  money: number;
  readonly inventory: Uint16Array;
  /** Building materials in tiles, per material id (M3). */
  readonly materials = new Int32Array(MATERIALS.defs.length);
  private readonly past: Op[] = [];
  private readonly future: Op[] = [];
  private readonly check = newPlaceResult();
  private readonly kids = new Uint16Array(16);
  /** Set whenever money, inventory or objects change (autosave, state event). */
  changed = true;

  constructor(
    private readonly world: SimWorld,
    money: number,
    inventory: Uint16Array,
  ) {
    this.money = money;
    this.inventory = inventory;
  }

  get canUndo(): boolean {
    return this.past.length > 0;
  }
  get canRedo(): boolean {
    return this.future.length > 0;
  }

  /** Forget history (after loading a save). */
  clearHistory(): void {
    this.past.length = 0;
    this.future.length = 0;
  }

  give(type: number, qty: number): void {
    if (!CATALOG.defs[type]) return;
    this.inventory[type] = Math.min(0xffff, this.inventory[type]! + qty);
    this.changed = true;
  }

  place(type: number, x: number, y: number, rot: number, colour: number): Result {
    const def = CATALOG.defs[type];
    if (!def) return no('build.err.unknown');
    if (this.inventory[type]! < 1) return no('build.err.noItem');
    const r = checkPlacement(this.world.state, type, x, y, rot & 3, 0, this.check);
    if (!r.ok) return no(r.reason);
    const parentUid = r.parent ? this.world.objects.uid[r.parent]! : 0;
    const snap: Snap = { uid: this.newUid(), type, x, y, rot: rot & 3, layer: def.layer, colour: this.validColour(def.recolour, colour), parentUid };
    return this.commit({ before: [], after: [snap], inv: [[type, -1]], money: 0 }, snap.uid);
  }

  /** Moves (and/or rotates) an object; a surface carries the items standing on it. */
  move(i: number, x: number, y: number, rot: number): Result {
    const s = this.world.objects;
    if (!s.live[i]) return no('build.err.gone');
    const type = s.type[i]!;
    const def = CATALOG.defs[type]!;
    rot &= 3;
    const r = checkPlacement(this.world.state, type, x, y, rot, i, this.check);
    if (!r.ok) return no(r.reason);
    const before = this.group(i);
    const self = before[0]!;
    const after: Snap[] = [{ ...self, x, y, rot, parentUid: r.parent ? s.uid[r.parent]! : 0 }];
    // Items on a surface keep their spot on it; a quarter turn transposes their offset.
    const turned = (self.rot & 1) !== (rot & 1);
    for (let k = 1; k < before.length; k++) {
      const c = before[k]!;
      let lx = c.x - self.x;
      let ly = c.y - self.y;
      if (turned) [lx, ly] = [ly, lx];
      lx = Math.min(lx, footW(def, rot) - 1);
      ly = Math.min(ly, footH(def, rot) - 1);
      after.push({ ...c, x: x + lx, y: y + ly });
    }
    if (sameSnaps(before, after)) return { ok: true, index: i };
    return this.commit({ before, after, inv: [], money: 0 }, self.uid);
  }

  rotate(i: number, rot: number): Result {
    const s = this.world.objects;
    if (!s.live[i]) return no('build.err.gone');
    return this.move(i, s.x[i]!, s.y[i]!, rot);
  }

  recolour(i: number, colour: number): Result {
    const s = this.world.objects;
    if (!s.live[i]) return no('build.err.gone');
    const def = CATALOG.defs[s.type[i]!]!;
    if (!def.recolour) return no('build.err.noRecolour');
    const before = [this.snap(i)];
    const after = [{ ...before[0]!, colour: this.validColour(true, colour) }];
    if (sameSnaps(before, after)) return { ok: true, index: i };
    return this.commit({ before, after, inv: [], money: 0 }, before[0]!.uid);
  }

  /** Back to the inventory, with anything standing on it. */
  pickup(i: number): Result {
    if (!this.world.objects.live[i]) return no('build.err.gone');
    const before = this.group(i);
    if (before.some((b) => CATALOG.defs[b.type]!.fixed)) return no('build.err.fixed');
    return this.commit({ before, after: [], inv: before.map((b) => [b.type, 1] as [number, number]), money: 0 });
  }

  /** Sell for 70%. Items standing on it go back to the inventory, unsold. */
  sell(i: number): Result {
    if (!this.world.objects.live[i]) return no('build.err.gone');
    const before = this.group(i);
    if (before.some((b) => CATALOG.defs[b.type]!.fixed)) return no('build.err.fixed');
    const self = before[0]!;
    const refund = sellValue(CATALOG.defs[self.type]!);
    const inv = before.slice(1).map((b) => [b.type, 1] as [number, number]);
    return this.commit({ before, after: [], inv, money: refund });
  }

  /**
   * Paints tile (x, y) with material `m` (M3): a floor finish on a shop floor tile, or a colour on
   * the shop's wall there. Uses one tile of the material; undo gives it back.
   */
  paint(x: number, y: number, m: number): Result {
    const def = MATERIALS.defs[m];
    if (!def) return no('build.err.noMaterial');
    const floor = def.kind === MATERIAL_KIND.floor;
    const reason = checkPaint(this.world.state, x, y, floor ? PAINT_LAYER.floor : PAINT_LAYER.wall);
    if (reason) return no(reason);
    const a = this.world.state.area;
    const t = y * a.w + x;
    const from = (floor ? a.floor : a.paint)[t]!;
    if (from === def.value) return no('build.err.samePaint');
    if (this.materials[m]! < 1) return no('build.err.noMaterial');
    return this.commit({ before: [], after: [], inv: [], money: 0, paint: [{ tile: t, floor, from, to: def.value }], mat: [[m, -1]] });
  }

  undo(): Result {
    const op = this.past[this.past.length - 1];
    if (!op) return no('build.err.nothingToUndo');
    const r = this.run(op, -1);
    if (!r.ok) return r;
    this.past.pop();
    this.future.push(op);
    return r;
  }

  redo(): Result {
    const op = this.future[this.future.length - 1];
    if (!op) return no('build.err.nothingToRedo');
    const r = this.run(op, 1);
    if (!r.ok) return r;
    this.future.pop();
    this.past.push(op);
    return r;
  }

  // --- internals -----------------------------------------------------------------------

  private commit(op: Op, focusUid = 0): Result {
    const r = this.run(op, 1, focusUid);
    if (!r.ok) return r;
    this.past.push(op);
    if (this.past.length > HISTORY_MAX) this.past.shift();
    this.future.length = 0;
    return r;
  }

  /** Applies an op forward (dir 1) or backward (dir −1). Checks money and inventory first. */
  private run(op: Op, dir: 1 | -1, focusUid = 0): Result {
    const from = dir === 1 ? op.before : op.after;
    const to = dir === 1 ? op.after : op.before;
    const money = op.money * dir;
    if (this.money + money < 0) return no('build.err.noMoney');
    for (const [type, d] of op.inv) if (this.inventory[type]! + d * dir < 0) return no('build.err.noItem');
    if (op.mat) for (const [m, d] of op.mat) if (this.materials[m]! + d * dir < 0) return no('build.err.noMaterial');

    const w = this.world;
    const s = w.objects;
    // Remove what disappears (children before parents), then add/update (parents first).
    const keep = new Set(to.map((t) => t.uid));
    for (let k = from.length - 1; k >= 0; k--) {
      const f = from[k]!;
      if (!keep.has(f.uid)) w.remove(s.indexOfUid(f.uid));
    }
    for (const t of to) {
      const i = s.indexOfUid(t.uid);
      if (i) w.detach(i);
    }
    for (const t of to) {
      const fields = { type: t.type, x: t.x, y: t.y, rot: t.rot, layer: t.layer, colour: t.colour, parent: t.parentUid ? s.indexOfUid(t.parentUid) : 0 };
      const i = s.indexOfUid(t.uid);
      if (i) w.attach(i, fields);
      else w.add(fields, t.uid);
    }
    this.money += money;
    for (const [type, d] of op.inv) this.inventory[type] = this.inventory[type]! + d * dir;
    if (op.mat) for (const [m, d] of op.mat) this.materials[m] = this.materials[m]! + d * dir;
    if (op.paint) for (const p of op.paint) w.paint(p.tile, p.floor, dir === 1 ? p.to : p.from);
    this.changed = true;
    const focus = focusUid ? s.indexOfUid(focusUid) : 0;
    return focus ? { ok: true, index: focus } : OK;
  }

  /** The object and the items standing on it, parent first. */
  private group(i: number): Snap[] {
    const out = [this.snap(i)];
    if (CATALOG.defs[this.world.objects.type[i]!]!.surface > 0) {
      const n = this.world.state.childrenOf(i, this.kids);
      for (let k = 0; k < n; k++) out.push(this.snap(this.kids[k]!));
    }
    return out;
  }

  private snap(i: number): Snap {
    const s = this.world.objects;
    const p = s.parent[i]!;
    return { uid: s.uid[i]!, type: s.type[i]!, x: s.x[i]!, y: s.y[i]!, rot: s.rot[i]!, layer: s.layer[i]!, colour: s.colour[i]!, parentUid: p ? s.uid[p]! : 0 };
  }

  private newUid(): number {
    return this.world.reserveUid();
  }

  private validColour(recolourable: boolean, c: number): number {
    return recolourable && Number.isInteger(c) && c >= 0 && c < CATALOG.ramps.length ? c : 0;
  }
}

function sameSnaps(a: Snap[], b: Snap[]): boolean {
  if (a.length !== b.length) return false;
  for (let k = 0; k < a.length; k++) {
    const p = a[k]!;
    const q = b[k]!;
    if (p.x !== q.x || p.y !== q.y || p.rot !== q.rot || p.colour !== q.colour || p.parentUid !== q.parentUid) return false;
  }
  return true;
}

export { LAYER };
