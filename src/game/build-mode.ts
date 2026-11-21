// Build mode: what the player is doing (browsing, placing, a selected object, moving it), the ghost
// validated locally with the shared rules, and the actions sent to the worker.
import { CATALOG, LAYER, footH, footW, sellValue } from '../shared/catalog';
import { tileAtX, tileAtY } from '../shared/iso';
import { WALL } from '../shared/layout';
import { checkPlacement, newPlaceResult } from '../shared/rules/placement';
import type { Action } from '../shared/protocol';
import type { SimBridge } from './bridge';
import type { WorldView } from './view';
import type { ObjectLayer } from '../render/objects';
import type { Ghost } from '../render/ghost';

export type BuildMode = 'off' | 'browse' | 'place' | 'selected' | 'move';

/** How high above the floor wall and ceiling items are drawn: pointer y is shifted down by this. */
const POINTER_LIFT: Record<number, number> = { [LAYER.wall]: 28, [LAYER.ceiling]: 44 };

const SELECT_TINT = 0xfff0b0;

export interface BuildDeps {
  view: WorldView;
  bridge: SimBridge;
  objects: ObjectLayer;
  ghost: Ghost;
  /** CSS point → world pixels. */
  toWorld(xCss: number, yCss: number): [number, number];
  /** Tile at the centre of the screen. */
  centreTile(): [number, number];
  /** Called after the first successful build action (storage persistence request). */
  onFirstBuild?(): void;
}

export class BuildController {
  mode: BuildMode = 'off';
  type = -1;
  rot = 0;
  colour = 0;
  tx = 0;
  ty = 0;
  /** Selected object slot (selected / move modes). */
  sel = 0;
  /** Waiting for a second tap on "sell". */
  sellArmed = false;
  /** Last refusal (i18n key), shown by the UI. */
  message = '';
  messageAt = 0;
  readonly check = newPlaceResult();
  private readonly listeners = new Set<() => void>();
  private built = false;
  private busy = false;

  constructor(private readonly d: BuildDeps) {}

  onChange(fn: () => void): void {
    this.listeners.add(fn);
  }

  get open(): boolean {
    return this.mode !== 'off';
  }

  toggle(): void {
    if (this.open) this.close();
    else this.setMode('browse');
  }

  close(): void {
    this.deselect();
    this.d.ghost.hide();
    this.setMode('off');
  }

  /** Start placing an item from the inventory. */
  choose(type: number): void {
    if (!CATALOG.defs[type]) return;
    this.deselect();
    const same = this.mode === 'place' && this.type === type;
    this.type = type;
    if (!same) {
      this.rot = 0;
      this.colour = 0;
      [this.tx, this.ty] = this.d.centreTile();
    }
    this.mode = 'place';
    this.refresh();
  }

  tap(x: number, y: number, pointerType: string): void {
    if (this.mode === 'place' || this.mode === 'move') {
      this.aim(x, y);
      if (pointerType === 'mouse') void this.confirm();
      return;
    }
    if (this.mode === 'browse' || this.mode === 'selected') {
      const [wx, wy] = this.d.toWorld(x, y);
      const hit = this.d.objects.pick(wx, wy);
      if (hit) this.select(hit);
      else if (this.mode === 'selected') {
        this.deselect();
        this.setMode('browse');
      }
    }
  }

  hover(x: number, y: number): void {
    if (this.mode === 'place' || this.mode === 'move') this.aim(x, y);
  }

  /** A drag that starts on the ghost's footprint moves the ghost instead of the camera. */
  dragStart(x: number, y: number): boolean {
    if (this.mode !== 'place' && this.mode !== 'move') return false;
    const def = CATALOG.defs[this.type]!;
    const [wx, wy] = this.d.toWorld(x, y);
    const lift = POINTER_LIFT[def.layer] ?? 0;
    const tx = tileAtX(wx, wy + lift);
    const ty = tileAtY(wx, wy + lift);
    return tx >= this.tx && ty >= this.ty && tx < this.tx + footW(def, this.rot) && ty < this.ty + footH(def, this.rot);
  }

  dragMove(x: number, y: number): void {
    this.aim(x, y);
  }

  rotate(): void {
    if (this.mode === 'place' || this.mode === 'move') {
      this.rot = (this.rot + 1) & 3;
      this.refresh();
    } else if (this.mode === 'selected') {
      const s = this.d.view.state.objects;
      void this.send({ k: 'rotate', id: s.handle(this.sel), rot: (s.rot[this.sel]! + 1) & 3 });
    }
  }

  setColour(c: number): void {
    if (this.mode === 'place' || this.mode === 'move') {
      this.colour = c;
      this.refresh();
    } else if (this.mode === 'selected') {
      void this.send({ k: 'recolour', id: this.d.view.state.objects.handle(this.sel), colour: c });
    }
  }

  async confirm(): Promise<void> {
    if (this.mode === 'place') {
      if (!this.check.ok) return this.say(this.check.reason);
      const r = await this.send({ k: 'place', type: this.type, x: this.tx, y: this.ty, rot: this.rot, colour: this.colour });
      if (r && (this.d.bridge.player?.inventory[this.type] ?? 0) <= 0) this.setMode('browse');
      this.refresh();
    } else if (this.mode === 'move') {
      if (!this.check.ok) return this.say(this.check.reason);
      const s = this.d.view.state.objects;
      const r = await this.send({ k: 'move', id: s.handle(this.sel), x: this.tx, y: this.ty, rot: this.rot });
      if (r) {
        this.mode = 'selected';
        this.d.ghost.hide();
        this.highlight(true);
        this.emit();
      }
    }
  }

  cancel(): void {
    if (this.mode === 'move') {
      this.d.ghost.hide();
      this.mode = 'selected';
      this.highlight(true);
      this.emit();
    } else if (this.mode === 'place' || this.mode === 'selected') {
      this.deselect();
      this.d.ghost.hide();
      this.setMode('browse');
    }
  }

  startMove(): void {
    if (this.mode !== 'selected') return;
    const s = this.d.view.state.objects;
    const i = this.sel;
    this.type = s.type[i]!;
    this.rot = s.rot[i]!;
    this.colour = s.colour[i]!;
    this.tx = s.x[i]!;
    this.ty = s.y[i]!;
    this.mode = 'move';
    const sp = this.d.objects.spriteOf(i);
    if (sp) sp.alpha = 0.35;
    this.refresh();
  }

  async pickup(): Promise<void> {
    if (this.mode !== 'selected') return;
    const ok = await this.send({ k: 'pickup', id: this.d.view.state.objects.handle(this.sel) });
    if (ok) this.afterRemoved();
  }

  /** First call arms, second call sells. */
  async sell(): Promise<void> {
    if (this.mode !== 'selected') return;
    if (!this.sellArmed) {
      this.sellArmed = true;
      this.emit();
      return;
    }
    const ok = await this.send({ k: 'sell', id: this.d.view.state.objects.handle(this.sel) });
    if (ok) this.afterRemoved();
  }

  get selectedType(): number {
    return this.sel ? this.d.view.state.objects.type[this.sel]! : -1;
  }

  get selectedColour(): number {
    return this.sel ? this.d.view.state.objects.colour[this.sel]! : 0;
  }

  get sellPrice(): number {
    const def = this.sel ? CATALOG.defs[this.d.view.state.objects.type[this.sel]!] : undefined;
    return def ? sellValue(def) : 0;
  }

  async undo(): Promise<void> {
    await this.history('undo');
  }

  async redo(): Promise<void> {
    await this.history('redo');
  }

  /** Re-validate the ghost (also when the world changed under it). */
  refresh(): void {
    if (this.mode !== 'place' && this.mode !== 'move') {
      this.d.ghost.hide();
      this.emit();
      return;
    }
    const ignore = this.mode === 'move' ? this.sel : 0;
    checkPlacement(this.d.view.state, this.type, this.tx, this.ty, this.rot, ignore, this.check);
    const p = this.check.ok ? this.check.parent : 0;
    const lift = p ? (CATALOG.defs[this.d.view.state.objects.type[p]!]?.surface ?? 0) : 0;
    this.d.ghost.show(this.type, this.tx, this.ty, this.rot, this.colour, this.check.ok, lift);
    this.emit();
  }

  // --- internals -----------------------------------------------------------------------

  /** Moves the ghost under a CSS point. */
  private aim(x: number, y: number): void {
    const def = CATALOG.defs[this.type];
    if (!def) return;
    const [wx, wy] = this.d.toWorld(x, y);
    let tx: number;
    let ty: number;
    const surface = def.small ? this.surfaceUnder(wx, wy) : 0;
    if (surface) {
      // On a surface the top is drawn higher: read the tile from the raised top.
      const s = this.d.view.state.objects;
      const sd = CATALOG.defs[s.type[surface]!]!;
      tx = clamp(tileAtX(wx, wy + sd.surface), s.x[surface]!, s.x[surface]! + footW(sd, s.rot[surface]!) - 1);
      ty = clamp(tileAtY(wx, wy + sd.surface), s.y[surface]!, s.y[surface]! + footH(sd, s.rot[surface]!) - 1);
    } else {
      const lift = POINTER_LIFT[def.layer] ?? 0;
      tx = tileAtX(wx, wy + lift) - ((footW(def, this.rot) - 1) >> 1);
      ty = tileAtY(wx, wy + lift) - ((footH(def, this.rot) - 1) >> 1);
    }
    if (def.layer === LAYER.wall) this.rot = this.wallRot(tx, ty);
    if (tx === this.tx && ty === this.ty && !(def.layer === LAYER.wall)) return;
    this.tx = tx;
    this.ty = ty;
    this.refresh();
  }

  /** Wall items face whichever back wall the tile has. */
  private wallRot(tx: number, ty: number): number {
    const a = this.d.view.area;
    if (tx < 0 || ty < 0 || tx >= a.w || ty >= a.h) return this.rot;
    const bits = a.wall[ty * a.w + tx]!;
    if ((bits & WALL.n) && !(bits & WALL.w)) return 1;
    if ((bits & WALL.w) && !(bits & WALL.n)) return 0;
    return this.rot & 1;
  }

  private surfaceUnder(wx: number, wy: number): number {
    const s = this.d.view.state.objects;
    return this.d.objects.pick(wx, wy, (i) => (CATALOG.defs[s.type[i]!]?.surface ?? 0) > 0 && i !== this.sel);
  }

  private select(i: number): void {
    this.deselect();
    this.sel = i;
    this.highlight(true);
    this.setMode('selected');
  }

  private deselect(): void {
    if (!this.sel) return;
    this.highlight(false);
    const sp = this.d.objects.spriteOf(this.sel);
    if (sp) sp.alpha = 1;
    this.sel = 0;
    this.sellArmed = false;
  }

  private highlight(on: boolean): void {
    const sp = this.sel ? this.d.objects.spriteOf(this.sel) : null;
    if (!sp) return;
    sp.tint = on ? SELECT_TINT : 0xffffff;
    sp.alpha = 1;
  }

  private afterRemoved(): void {
    this.sel = 0;
    this.sellArmed = false;
    this.setMode('browse');
  }

  private async history(k: 'undo' | 'redo'): Promise<void> {
    this.deselect();
    if (this.mode === 'selected' || this.mode === 'move') this.mode = 'browse';
    await this.send({ k });
    this.refresh();
  }

  /** Sends an action; shows the refusal reason. Returns true on success. */
  private async send(a: Action): Promise<boolean> {
    if (this.busy) return false;
    this.busy = true;
    try {
      const r = await this.d.bridge.act(a);
      if (!r.ok) {
        this.say(r.reason ?? 'build.err.unknown');
        return false;
      }
      if (!this.built) {
        this.built = true;
        this.d.onFirstBuild?.();
      }
      if (this.sel) this.highlight(true);
      this.sellArmed = false;
      this.emit();
      return true;
    } finally {
      this.busy = false;
    }
  }

  private say(reason: string): void {
    this.message = reason;
    this.messageAt = performance.now();
    this.emit();
  }

  private setMode(m: BuildMode): void {
    this.mode = m;
    if (m !== 'place' && m !== 'move') this.d.ghost.hide();
    this.emit();
  }

  private emit(): void {
    for (const fn of this.listeners) fn();
  }
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}
