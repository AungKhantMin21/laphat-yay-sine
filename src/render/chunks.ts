// Static floor layer cached in chunk textures: 8×8 tiles per chunk, redrawn only when tiles change.
// Only chunks near the view hold a render texture; the rest go back to a small pool.
import { Container, RenderTexture, Sprite, type Renderer, type Texture } from 'pixi.js';
import { HALF_H, HALF_W, isoX, isoY } from '../shared/iso';
import { WALL } from '../shared/layout';
import { FACADE_WEST } from '../shared/street';
import { SpatialHash } from './cull';
import type { DirtyRect } from '../game/view';

export const CHUNK = 8;
/** Headroom above the floor diamond for walls and buildings (M1+). */
export const PAD_TOP = 64;
const CHUNK_W = CHUNK * 2 * HALF_W; // 256
const CHUNK_H = CHUNK * 2 * HALF_H + PAD_TOP; // 192
/** Back-wall sprite headroom (art/ART_STYLE.md). */
export const WALL_H = 40;
/** Wall bits in draw order (west, low west, north, low north) and their index in `walls`. */
const WALL_ORDER = [WALL.w, WALL.lowW, WALL.n, WALL.lowN] as const;
const WALL_TEX = [1, 3, 0, 2] as const;

interface Chunk {
  sprite: Sprite;
  rt: RenderTexture | null;
  dirty: boolean;
  lastSeen: number;
}

export class FloorChunks {
  readonly layer = new Container();
  private chunks: Chunk[] = [];
  private cw = 0;
  private ch = 0;
  private hash = new SpatialHash(256, 1);
  private readonly visible = new Int32Array(256);
  private readonly pool: RenderTexture[] = [];
  private live = 0;
  private frame = 0;
  // One scratch container of CHUNK² sprites reused to draw every chunk.
  private readonly scratch = new Container();
  private readonly scratchTiles: Sprite[] = [];
  private readonly scratchWalls: Sprite[] = [];
  private floor: Uint8Array = new Uint8Array(0);
  private wall: Uint8Array = new Uint8Array(0);
  private facade: Uint8Array = new Uint8Array(0);
  private paint: Uint8Array = new Uint8Array(0);
  private areaW = 0;
  private areaH = 0;

  constructor(
    private readonly renderer: Renderer,
    private readonly tiles: Texture[],
    /**
     * Wall textures, 4 per wall colour (shared/layout.ts WALL_COLOURS order, plain first):
     * [north edge, west edge, low north sill, low west sill].
     */
    private readonly walls: readonly Texture[],
    /** Building-front textures by facade grid value (index 0 unused). */
    private readonly facades: readonly Texture[],
    /** Max chunk textures alive at once (each 256×192 RGBA ≈ 192 KB). */
    private maxLive = 48,
  ) {
    for (let i = 0; i < CHUNK * CHUNK; i++) {
      const s = new Sprite();
      s.roundPixels = true;
      this.scratchTiles.push(s);
      this.scratch.addChild(s);
    }
    // Up to two walls and one building front per tile.
    for (let i = 0; i < CHUNK * CHUNK * 3; i++) {
      const s = new Sprite();
      s.roundPixels = true;
      this.scratchWalls.push(s);
      this.scratch.addChild(s);
    }
  }

  /** Call when a new area loads. */
  setArea(floor: Uint8Array, wall: Uint8Array, facade: Uint8Array, paint: Uint8Array, w: number, h: number): void {
    this.wall = wall;
    this.facade = facade;
    this.paint = paint;
    for (const c of this.chunks) this.release(c);
    this.layer.removeChildren().forEach((c) => c.destroy());
    this.floor = floor;
    this.areaW = w;
    this.areaH = h;
    this.cw = Math.ceil(w / CHUNK);
    this.ch = Math.ceil(h / CHUNK);
    this.chunks = [];
    this.hash = new SpatialHash(256, this.cw * this.ch);
    for (let cy = 0; cy < this.ch; cy++) {
      for (let cx = 0; cx < this.cw; cx++) {
        const sprite = new Sprite();
        sprite.roundPixels = true;
        sprite.visible = false;
        const x = isoX(cx * CHUNK, cy * CHUNK) - CHUNK_W / 2;
        const y = isoY(cx * CHUNK, cy * CHUNK) - PAD_TOP;
        sprite.position.set(x, y);
        this.layer.addChild(sprite);
        const id = this.chunks.length;
        this.chunks.push({ sprite, rt: null, dirty: true, lastSeen: -1 });
        this.hash.insert(id, x, y, x + CHUNK_W, y + CHUNK_H);
      }
    }
  }

  /** Marks chunks overlapping a changed tile rect for redraw. */
  markDirty(r: DirtyRect): void {
    if (r.empty) return;
    const cx0 = Math.max(0, Math.floor(r.x0 / CHUNK));
    const cy0 = Math.max(0, Math.floor(r.y0 / CHUNK));
    const cx1 = Math.min(this.cw - 1, Math.floor((r.x1 - 1) / CHUNK));
    const cy1 = Math.min(this.ch - 1, Math.floor((r.y1 - 1) / CHUNK));
    for (let cy = cy0; cy <= cy1; cy++) for (let cx = cx0; cx <= cx1; cx++) this.chunks[cy * this.cw + cx]!.dirty = true;
  }

  /** Context loss wipes render textures: redraw everything visible. */
  invalidateAll(): void {
    for (const c of this.chunks) c.dirty = true;
  }

  /** Shows chunks overlapping the view rect (world px), drawing any that are new or dirty. */
  update(x0: number, y0: number, x1: number, y1: number): void {
    const f = ++this.frame;
    for (const c of this.chunks) c.sprite.visible = false;
    const n = this.hash.query(x0, y0, x1, y1, this.visible);
    for (let i = 0; i < n; i++) {
      const id = this.visible[i]!;
      const c = this.chunks[id]!;
      c.lastSeen = f;
      if (!c.rt) {
        c.rt = this.acquire();
        c.sprite.texture = c.rt;
        c.dirty = true;
      }
      if (c.dirty) this.draw(id, c.rt);
      c.dirty = false;
      c.sprite.visible = true;
    }
  }

  /** Device tier budget. Excess textures are evicted as chunks leave the view. */
  setMaxLive(n: number): void {
    this.maxLive = n;
    while (this.live > n && this.evictOldest()) {
      /* evict until within budget */
    }
  }

  /** Approximate GPU memory held by chunk textures, in bytes. */
  get textureBytes(): number {
    return (this.live + this.pool.length) * CHUNK_W * CHUNK_H * 4;
  }

  get liveTextures(): number {
    return this.live;
  }

  private draw(id: number, rt: RenderTexture): void {
    const cx = id % this.cw;
    const cy = Math.floor(id / this.cw);
    const W = this.areaW;
    let k = 0;
    for (let j = 0; j < CHUNK; j++) {
      for (let i = 0; i < CHUNK; i++) {
        const s = this.scratchTiles[k++]!;
        const tx = cx * CHUNK + i;
        const ty = cy * CHUNK + j;
        const t = tx < W && ty < this.areaH ? this.floor[ty * W + tx]! : 0;
        s.visible = t !== 0;
        if (!s.visible) continue;
        s.texture = this.tiles[t] ?? this.tiles[0]!;
        s.position.set(CHUNK_W / 2 + (i - j) * HALF_W - HALF_W, PAD_TOP + (i + j) * HALF_H);
      }
    }
    // Back walls after all floors: west edges, then north edges, back to front.
    let wk = 0;
    for (let j = 0; j < CHUNK; j++) {
      for (let i = 0; i < CHUNK; i++) {
        const tx = cx * CHUNK + i;
        const ty = cy * CHUNK + j;
        const inside = tx < W && ty < this.areaH;
        const bits = inside ? this.wall[ty * W + tx]! : 0;
        const colour = bits && inside ? this.paint[ty * W + tx]! : 0;
        // A building front stands on the tile's −y edge like a north wall, but taller; with
        // FACADE_WEST it stands on the −x edge (the same sprite, mirrored).
        const fv = inside ? this.facade[ty * W + tx]! : 0;
        const f = fv & ~FACADE_WEST;
        if (f !== 0 && this.facades[f]) {
          const s = this.scratchWalls[wk++]!;
          const tex = this.facades[f]!;
          const west = (fv & FACADE_WEST) !== 0;
          s.texture = tex;
          s.visible = true;
          s.scale.x = west ? -1 : 1;
          s.position.set(CHUNK_W / 2 + (i - j) * HALF_W - HALF_W + (west ? tex.width : 0), PAD_TOP + (i + j) * HALF_H - (tex.height - 2 * HALF_H));
        }
        // West edge first, then north; a tile has at most one wall per edge (full or low).
        for (let side = 0; side < 4; side++) {
          if (!(bits & WALL_ORDER[side]!)) continue;
          const s = this.scratchWalls[wk++]!;
          s.texture = this.walls[colour * 4 + WALL_TEX[side]!] ?? this.walls[WALL_TEX[side]!]!;
          s.visible = true;
          s.scale.x = 1;
          s.position.set(CHUNK_W / 2 + (i - j) * HALF_W - HALF_W, PAD_TOP + (i + j) * HALF_H - WALL_H);
        }
      }
    }
    for (let k = wk; k < this.scratchWalls.length; k++) this.scratchWalls[k]!.visible = false;
    this.renderer.render({ container: this.scratch, target: rt, clear: true, clearColor: [0, 0, 0, 0] });
  }

  private acquire(): RenderTexture {
    if (this.live >= this.maxLive) this.evictOldest();
    this.live++;
    return this.pool.pop() ?? RenderTexture.create({ width: CHUNK_W, height: CHUNK_H, scaleMode: 'nearest', resolution: 1, antialias: false });
  }

  private evictOldest(): boolean {
    let oldest: Chunk | null = null;
    for (const c of this.chunks) if (c.rt && c.lastSeen < this.frame && (!oldest || c.lastSeen < oldest.lastSeen)) oldest = c;
    if (!oldest) return false;
    this.release(oldest);
    return true;
  }

  private release(c: Chunk): void {
    if (!c.rt) return;
    // Keep a few spare textures for reuse; destroy the rest so memory really drops.
    if (this.pool.length < 4) this.pool.push(c.rt);
    else c.rt.destroy(true);
    c.rt = null;
    c.sprite.visible = false;
    c.dirty = true;
    this.live--;
  }
}
