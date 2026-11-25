// Vehicles on the road (M4): cars, trishaws and bicycles along the lanes in neighbourhood.json.
// Decoration only — render state, never sim state, so they cannot change anything that happens.
// They keep their distance from the vehicle ahead and stop before a zebra crossing while anyone on
// the mirror stands on it. Pooled sprites in the objects' sortable container; nothing allocated per
// frame. Randomness is a local seeded stream (cosmetic, render-only).
import { Sprite, Texture, type Container } from 'pixi.js';
import { WZ } from '../shared/rules/access';
import { NEIGHBOURHOOD } from '../shared/neighbourhood';
import { Rng } from '../shared/rng';
import { MAX_NPCS } from '../shared/layout';
import type { WorldView } from '../game/view';
import type { Atlas } from './atlas';
import { standingDepth } from './npc-pose';

const MAX = 6;
/** Kinds: sprite name, length along the lane (tiles), cruising speed (tiles/s), pick weight. */
const KINDS = [
  { name: 'car0', len: 2, speed: 4, weight: 2 },
  { name: 'car1', len: 2, speed: 4.2, weight: 2 },
  { name: 'car2', len: 2, speed: 3.8, weight: 1 },
  { name: 'trishaw', len: 1, speed: 2.2, weight: 3 },
  { name: 'bike', len: 1, speed: 3, weight: 3 },
] as const;
/** Gap kept to the vehicle ahead (tiles, bumper to bumper). */
const GAP = 1;
/** Stop this far before a crossing that someone is on. */
const STOP_BEFORE = 0.4;

interface Lane {
  /** Segment starts (tiles), directions (unit along x or y) and cumulative lengths. */
  x: Float64Array;
  y: Float64Array;
  dx: Int8Array;
  dy: Int8Array;
  at: Float64Array;
  length: number;
  /** Crossings on this lane: [start, end) in lane distance, and the crossing's tile rect. */
  cross: { s0: number; s1: number; x0: number; y0: number; x1: number; y1: number }[];
}

export class Vehicles {
  private readonly sprites: Sprite[] = [];
  private readonly lane = new Int8Array(MAX).fill(-1);
  private readonly kind = new Uint8Array(MAX);
  private readonly s = new Float64Array(MAX);
  private readonly speed = new Float64Array(MAX);
  private readonly tex: Texture[][] = [];
  private lanes: Lane[] | null = null;
  private readonly rng = new Rng(0x5eed1e5);
  private nextSpawn = 0;
  /** Lanes take turns. */
  private spawnLane = 0;
  private last = 0;
  /** Crossing occupied this frame, by crossing index (lane-major). */
  private readonly busy: Uint8Array = new Uint8Array(16);
  visible = 0;

  constructor(
    atlas: Atlas,
    layer: Container,
    private readonly view: WorldView,
  ) {
    for (const k of KINDS) tex(this.tex, atlas, k.name);
    for (let i = 0; i < MAX; i++) {
      const sp = new Sprite();
      sp.roundPixels = true;
      sp.visible = false;
      layer.addChild(sp);
      this.sprites.push(sp);
    }
  }

  /** One render frame: `cap` vehicles at most (tier); `x0…y1` the camera view in world px. */
  update(now: number, cap: number, x0: number, y0: number, x1: number, y1: number): void {
    const lanes = (this.lanes ??= this.buildLanes());
    let dt = (now - this.last) / 1000;
    this.last = now;
    if (!(dt > 0) || dt > 0.25) dt = 0.25 * (dt > 0 ? 1 : 0);
    if (lanes.length === 0) return;
    this.markCrossings(lanes);
    // Spawn at a lane start when the start is clear.
    let live = 0;
    for (let i = 0; i < MAX; i++) if (this.lane[i]! >= 0) live++;
    if (now >= this.nextSpawn && live < Math.min(cap, MAX)) {
      const l = (this.spawnLane = (this.spawnLane + 1) % lanes.length);
      const k = this.pickKind();
      let clear = true;
      for (let i = 0; i < MAX; i++) if (this.lane[i] === l && this.s[i]! - KINDS[this.kind[i]!]!.len < KINDS[k]!.len + GAP) clear = false;
      const slot = this.lane.indexOf(-1);
      if (clear && slot >= 0) {
        this.lane[slot] = l;
        this.kind[slot] = k;
        this.s[slot] = 0;
        this.speed[slot] = KINDS[k]!.speed;
      }
      this.nextSpawn = now + 1500 + this.rng.next() * 5000;
    }
    let shown = 0;
    let crossBase = 0;
    for (let li = 0; li < lanes.length; li++) {
      const lane = lanes[li]!;
      for (let i = 0; i < MAX; i++) {
        if (this.lane[i] !== li) continue;
        const k = KINDS[this.kind[i]!]!;
        // Free road ahead: up to the vehicle in front (minus the gap), or a busy crossing.
        let limit = lane.length + 4;
        for (let j = 0; j < MAX; j++) {
          if (j === i || this.lane[j] !== li || this.s[j]! <= this.s[i]!) continue;
          limit = Math.min(limit, this.s[j]! - KINDS[this.kind[j]!]!.len - GAP);
        }
        lane.cross.forEach((c, ci) => {
          if (this.busy[crossBase + ci] && this.s[i]! <= c.s0 - STOP_BEFORE + 0.01) limit = Math.min(limit, c.s0 - STOP_BEFORE);
        });
        this.s[i] = Math.max(this.s[i]!, Math.min(limit, this.s[i]! + this.speed[i]! * dt));
        if (this.s[i]! - k.len > lane.length) {
          this.lane[i] = -1;
          this.sprites[i]!.visible = false;
          continue;
        }
        if (this.place(i, lane, k.len, x0, y0, x1, y1)) shown++;
      }
      crossBase += lane.cross.length;
    }
    for (let i = 0; i < MAX; i++) if (this.lane[i]! < 0) this.sprites[i]!.visible = false;
    this.visible = shown;
  }

  private pickKind(): number {
    let total = 0;
    for (const k of KINDS) total += k.weight;
    let u = this.rng.next() * total;
    for (let k = 0; k < KINDS.length; k++) {
      u -= KINDS[k]!.weight;
      if (u < 0) return k;
    }
    return 0;
  }

  /** Positions vehicle i's sprite (its front at lane distance s); false when off screen. */
  private place(i: number, lane: Lane, len: number, x0: number, y0: number, x1: number, y1: number): boolean {
    const sp = this.sprites[i]!;
    const mid = this.s[i]! - len / 2;
    let seg = 0;
    while (seg < lane.at.length - 1 && lane.at[seg + 1]! <= mid) seg++;
    const d = Math.max(0, mid - lane.at[seg]!);
    const dx = lane.dx[seg]!;
    const dy = lane.dy[seg]!;
    const u = lane.x[seg]! + dx * d;
    const v = lane.y[seg]! + dy * d;
    const alongX = dx !== 0;
    const t = this.tex[this.kind[i]!]![alongX ? 0 : 1]!;
    // Footprint (fw × fh tiles) centred on (u, v); image convention as tools/iso-raster.ts.
    const fw = alongX ? len : 1;
    const fh = alongX ? 1 : len;
    const u0 = u - fw / 2;
    const v0 = v - fh / 2;
    const height = t.height - (fw + fh) * 8;
    const sx = Math.round((u0 - v0) * 16 - fh * 16);
    const sy = Math.round((u0 + v0) * 8 - height);
    if (sx > x1 || sx + t.width < x0 || sy > y1 || sy + t.height < y0) {
      sp.visible = false;
      return false;
    }
    sp.texture = t;
    sp.position.set(sx, sy);
    sp.zIndex = standingDepth(Math.floor(u0 + fw - 0.5), Math.floor(v0 + fh - 0.5));
    sp.visible = true;
    return true;
  }

  /** Which crossings have someone standing on them (mirrored NPCs only: vehicles near the view). */
  private markCrossings(lanes: Lane[]): void {
    const v = this.view;
    let base = 0;
    for (const lane of lanes) {
      lane.cross.forEach((c, ci) => {
        let on = 0;
        for (let i = 1; i < MAX_NPCS && !on; i++) {
          if (!v.npcLive[i]) continue;
          const x = v.npcX[i]!;
          const y = v.npcY[i]!;
          if (x >= c.x0 - 0.2 && x < c.x1 + 0.2 && y >= c.y0 - 0.2 && y < c.y1 + 0.2) on = 1;
        }
        this.busy[base + ci] = on;
      });
      base += lane.cross.length;
    }
  }

  /** Lanes with their crossings, found by walking each lane over the mirrored walk-zone grid. */
  private buildLanes(): Lane[] {
    const a = this.view.area;
    const out: Lane[] = [];
    for (const l of NEIGHBOURHOOD.lanes) {
      const n = l.path.length - 1;
      const lane: Lane = { x: new Float64Array(n), y: new Float64Array(n), dx: new Int8Array(n), dy: new Int8Array(n), at: new Float64Array(n), length: 0, cross: [] };
      for (let k = 0; k < n; k++) {
        const [ax, ay] = l.path[k]!;
        const [bx, by] = l.path[k + 1]!;
        lane.x[k] = ax;
        lane.y[k] = ay;
        lane.dx[k] = Math.sign(bx - ax);
        lane.dy[k] = Math.sign(by - ay);
        lane.at[k] = lane.length;
        lane.length += Math.abs(bx - ax) + Math.abs(by - ay);
      }
      // Walk the lane in quarter tiles and note where it runs over a zebra crossing.
      let inside = -1;
      for (let s = 0; s <= lane.length; s += 0.25) {
        let seg = 0;
        while (seg < n - 1 && lane.at[seg + 1]! <= s) seg++;
        const d = s - lane.at[seg]!;
        const tx = Math.floor(lane.x[seg]! + lane.dx[seg]! * d);
        const ty = Math.floor(lane.y[seg]! + lane.dy[seg]! * d);
        const z = tx >= 0 && ty >= 0 && tx < a.w && ty < a.h ? a.access[ty * a.w + tx]! : 0;
        if (z === WZ.crossing && inside < 0) inside = s;
        else if (z !== WZ.crossing && inside >= 0) {
          lane.cross.push({ s0: inside, s1: s, ...crossingRect(a.access, a.w, a.h, tx - lane.dx[seg]!, ty - lane.dy[seg]!) });
          inside = -1;
        }
      }
      out.push(lane);
    }
    return out;
  }
}

function tex(out: Texture[][], atlas: Atlas, name: string): void {
  out.push([atlas.get(`vehicle/${name}_x`) ?? Texture.EMPTY, atlas.get(`vehicle/${name}_y`) ?? Texture.EMPTY]);
}

/** Bounding rect of the crossing tiles connected to (x, y). */
function crossingRect(access: Uint8Array, w: number, h: number, x: number, y: number): { x0: number; y0: number; x1: number; y1: number } {
  let x0 = x;
  let x1 = x + 1;
  let y0 = y;
  let y1 = y + 1;
  const is = (tx: number, ty: number): boolean => tx >= 0 && ty >= 0 && tx < w && ty < h && access[ty * w + tx] === WZ.crossing;
  while (is(x0 - 1, y)) x0--;
  while (is(x1, y)) x1++;
  while (is(x, y0 - 1)) y0--;
  while (is(x, y1)) y1++;
  return { x0, y0, x1, y1 };
}
