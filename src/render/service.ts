// Service props (M2.5): cups where they are — on a table beside the customer's seat, waiting on the
// counter, dirty in the sink, or on a worker's tray — and steam over the kettle while the shop is open.
// Pooled sprites in the objects' sortable container (same atlas: no extra draw calls). Static cups are
// placed only when a cup moves; trays follow their worker every frame (no allocation).
import { Sprite, Texture, type Container } from 'pixi.js';
import { CATALOG, SERVICE } from '../shared/catalog';
import { DRINKS } from '../shared/drinks';
import { HALF_H, HALF_W } from '../shared/iso';
import { MAX_CUPS, MAX_NPCS, MAX_WORKERS, WORKER_SLOT0 } from '../shared/layout';
import { PHASE } from '../shared/day';
import type { WorldView } from '../game/view';
import type { Atlas } from './atlas';
import type { NpcLayer } from './npcs';
import { objectDepth } from './objects-depth';

/** CUP places (sim/service/cups.ts; the numbers travel in the CUP frame section). */
const CUP_COUNTER = 1;
const CUP_TRAY = 2;
const CUP_TABLE = 3;
const CUP_SINK = 4;

const STEAM_MS = 220;
/** Extra world px around a cup that still counts as a tap on it. */
const TAP_SLOP = 5;

export class ServiceLayer {
  private readonly cups: Sprite[] = [];
  private readonly trays: Sprite[] = [];
  private readonly full: Texture[] = [];
  private readonly empty: Texture;
  private readonly steamFrames: Texture[] = [];
  private readonly steam: Sprite;
  /** Shopping in the player's hands (M3). */
  private readonly parcel: Sprite;
  /** Cups per tile index while laying cups out (reset each layout; preallocated). */
  private readonly perTile: Uint8Array;
  private readonly trayCount = new Uint8Array(MAX_WORKERS + 1);
  private kettleSeen = -1;

  constructor(
    private readonly view: WorldView,
    atlas: Atlas,
    private readonly layer: Container,
    private readonly npcs: NpcLayer,
  ) {
    for (const d of DRINKS.defs) this.full.push(atlas.get(`fx/cup_${d.key}`) ?? Texture.EMPTY);
    this.empty = atlas.get('fx/cup_empty') ?? Texture.EMPTY;
    for (let f = 0; f < 3; f++) this.steamFrames.push(atlas.get(`fx/steam${f}`) ?? Texture.EMPTY);
    const tray = atlas.get('fx/tray') ?? Texture.EMPTY;
    const make = (tex: Texture): Sprite => {
      const s = new Sprite(tex);
      s.anchor.set(0.5, 1);
      s.roundPixels = true;
      s.visible = false;
      layer.addChild(s);
      return s;
    };
    for (let c = 0; c <= MAX_CUPS; c++) this.cups.push(make(this.empty));
    for (let w = 0; w <= MAX_WORKERS; w++) this.trays.push(make(tray));
    this.steam = make(this.steamFrames[0]!);
    this.parcel = make(atlas.get('fx/parcel') ?? Texture.EMPTY);
    this.perTile = new Uint8Array(128 * 96);
  }

  update(now: number, phase: number): void {
    const v = this.view;
    if (v.cupsChanged) {
      v.cupsChanged = false;
      this.layout();
    }
    this.followTrays();
    this.updateSteam(now, phase);
  }

  /** The cup on a table under a world-pixel point (dirty or full), or 0. */
  pickCup(wx: number, wy: number): number {
    const v = this.view;
    for (let c = 1; c <= v.cupCount; c++) {
      const s = this.cups[c]!;
      if (!s.visible || v.cupPlace[c] !== CUP_TABLE) continue;
      if (wx >= s.x - 3 - TAP_SLOP && wx <= s.x + 3 + TAP_SLOP && wy >= s.y - 6 - TAP_SLOP && wy <= s.y + TAP_SLOP) return c;
    }
    return 0;
  }

  /** World point just above cup c (where it's drawn), or false if it isn't drawn. */
  cupPoint(c: number, out: { x: number; y: number }): boolean {
    const s = this.cups[c];
    if (!s || !s.visible) return false;
    out.x = s.x;
    out.y = s.y - 7;
    return true;
  }

  /** World point above the first object with this service role (the sink…), or false. */
  fixturePoint(service: number, out: { x: number; y: number }): boolean {
    const i = this.fixture(service);
    if (!i) return false;
    const o = this.view.state.objects;
    const tx = o.x[i]!;
    const ty = o.y[i]!;
    out.x = (tx - ty) * HALF_W;
    out.y = (tx + ty) * HALF_H - 12;
    return true;
  }

  /** Places every cup that isn't on a tray. */
  private layout(): void {
    const v = this.view;
    const W = v.area.w;
    this.perTile.fill(0);
    const counter = this.fixture(SERVICE.counter);
    const sink = this.fixture(SERVICE.sink);
    this.trayCount.fill(0);
    for (let c = 1; c <= MAX_CUPS; c++) {
      const s = this.cups[c]!;
      s.visible = false;
      if (c > v.cupCount) continue;
      const place = v.cupPlace[c]!;
      s.texture = v.cupDirty[c] || place === CUP_SINK ? this.empty : (this.full[v.cupDrink[c]!] ?? this.empty);
      if (place === CUP_TRAY) {
        const h = v.cupHolder[c]!;
        if (h >= 1 && h <= MAX_WORKERS) this.trayCount[h]!++;
        continue;
      }
      let obj = 0;
      if (place === CUP_TABLE) obj = this.surfaceBeside(v.cupTile[c]!);
      else if (place === CUP_COUNTER) obj = counter;
      else if (place === CUP_SINK) obj = sink;
      if (!obj && place !== CUP_TABLE) continue;
      // The object's origin tile (or the seat, if no table is beside it); cups on one tile line up.
      const o = v.state.objects;
      const t = obj ? o.y[obj]! * W + o.x[obj]! : v.cupTile[c]!;
      if (t < 0) continue;
      const k = this.perTile[t]!++;
      const tx = t % W;
      const ty = (t - tx) / W;
      const def = obj ? CATALOG.defs[o.type[obj]!]! : null;
      const lift = def ? (def.surface || 10) : 6;
      s.position.set((tx - ty) * HALF_W + (k - 1) * 5, (tx + ty) * HALF_H + 2 * HALF_H - lift - 1 + (k & 1));
      s.zIndex = def ? objectDepth(def, o.x[obj]!, o.y[obj]!, o.rot[obj]!, true) + 1 : (tx + ty) * 16 + 7;
      s.visible = true;
    }
  }

  /** Trays (with their cups) in front of each worker who carries something; the player's shopping. */
  private followTrays(): void {
    const v = this.view;
    const me = v.playerCarry > 0 && this.trayCount[1] === 0 ? this.npcs.bodyOf(WORKER_SLOT0) : null;
    this.parcel.visible = !!me;
    if (me) {
      this.parcel.position.set(me.x, me.y - 22); // on the head, market style: visible whichever way they face
      this.parcel.zIndex = me.zIndex + 0.5;
    }
    for (let w = 1; w <= MAX_WORKERS; w++) {
      const tray = this.trays[w]!;
      const slot = WORKER_SLOT0 + w - 1;
      const body = slot < MAX_NPCS && this.trayCount[w]! > 0 ? this.npcs.bodyOf(slot) : null;
      if (!body) {
        tray.visible = false;
        continue;
      }
      const x = body.x;
      const y = body.y - 10; // at the hands
      tray.position.set(x, y);
      tray.zIndex = body.zIndex + 0.5;
      tray.visible = true;
      let k = 0;
      for (let c = 1; c <= v.cupCount; c++) {
        if (v.cupPlace[c] !== CUP_TRAY || v.cupHolder[c] !== w) continue;
        const s = this.cups[c]!;
        s.position.set(x - 2 + k * 5, y - 2);
        s.zIndex = tray.zIndex + 0.1;
        s.visible = true;
        k++;
      }
    }
  }

  private updateSteam(now: number, phase: number): void {
    const s = this.steam;
    if (phase !== PHASE.open && phase !== PHASE.closing) {
      s.visible = false;
      return;
    }
    // The kettle rarely moves: look it up once a second.
    if (this.kettleSeen < 0 || now - this.kettleSeen > 1000) {
      this.kettleSeen = now;
      const k = this.fixture(SERVICE.kettle);
      const o = this.view.state.objects;
      if (!k) {
        s.visible = false;
        return;
      }
      const parent = o.parent[k]!;
      const lift = parent ? CATALOG.defs[o.type[parent]!]!.surface : 0;
      const tx = o.x[k]!;
      const ty = o.y[k]!;
      s.position.set((tx - ty) * HALF_W + 2, (tx + ty) * HALF_H + HALF_H - lift - 10);
      s.zIndex = (tx + ty) * 16 + 15;
    }
    s.texture = this.steamFrames[Math.floor(now / STEAM_MS) % 3]!;
    s.visible = true;
  }

  /** First placed object with a service role, or 0. */
  private fixture(service: number): number {
    const o = this.view.state.objects;
    for (let i = 1; i < o.capacity; i++) if (o.live[i] && CATALOG.defs[o.type[i]!]!.service === service) return i;
    return 0;
  }

  /** A table (any surface) beside seat tile t, or 0. */
  private surfaceBeside(t: number): number {
    if (t < 0) return 0;
    const v = this.view;
    const W = v.area.w;
    const occ = v.state.occ.furniture;
    const o = v.state.objects;
    const x = t % W;
    const y = (t - x) / W;
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dy) continue;
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= W || ny >= v.area.h) continue;
        const i = occ[ny * W + nx]!;
        if (i && CATALOG.defs[o.type[i]!]!.surface > 0) return i;
      }
    }
    return 0;
  }
}
