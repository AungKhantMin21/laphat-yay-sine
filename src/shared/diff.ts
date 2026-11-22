// Binary frame format, worker → main, one per sim tick. See docs/ARCHITECTURE.md §2.
// Little-endian, 4-byte aligned. One writer and one reader, used by both sides.
import { PROTOCOL_VERSION } from './protocol';

export const HEADER_BYTES = 16;
export const SECTION_BYTES = 8;
export const PATCH_HEAD_BYTES = 8;

export const SEC = {
  NPC_SPAWN: 1,
  NPC_DESPAWN: 2,
  NPC_STATE: 3,
  OBJ_UPSERT: 4,
  OBJ_REMOVE: 5,
  GRID_PATCH: 6,
  TILE_PATCH: 7,
  WORLD: 8,
  NPC_ORDER: 9,
  TASK: 10,
  CUP: 11,
} as const;
type SectionKind = (typeof SEC)[keyof typeof SEC];

/** Fixed item size per section kind (patches are variable). */
const ITEM_BYTES: Record<number, number> = { 1: 12, 2: 4, 3: 8, 4: 16, 5: 4, 8: 4, 9: 8, 10: 12, 11: 12 };

/** Positions travel as 1/32 tile in i16. */
export const POS_SCALE = 32;

const pad4 = (n: number): number => (n + 3) & ~3;

/** Receives decoded frame contents. Implement once and reuse: reading allocates nothing. */
export interface FrameHandler {
  header(tick: number, gameMinute: number, workCentiMs: number, flags: number): void;
  npcSpawn(handle: number, def: number, area: number, look: number, x: number, y: number): void;
  npcDespawn(handle: number): void;
  npcState(slot: number, x: number, y: number, dir: number, anim: number): void;
  objUpsert(handle: number, type: number, x: number, y: number, rot: number, layer: number, colour: number, flags: number, parent: number): void;
  objRemove(handle: number): void;
  /** bytes[offset + row * w + col] for the w×h rect at (x, y). Don't keep a reference to bytes. */
  gridPatch(prop: number, x: number, y: number, w: number, h: number, bytes: Uint8Array, offset: number): void;
  tilePatch(layer: number, x: number, y: number, w: number, h: number, bytes: Uint8Array, offset: number): void;
  world(weather: number, season: number, day: number): void;
  /** A customer's order bubble: drink id and ORDER state (shared/npc.ts). */
  npcOrder(handle: number, drink: number, state: number): void;
  /**
   * A job on the task board changed (M2.5): kind (sim/service TASK), its target (customer handle or
   * cup id), the player's queue position (0 none, 1–3) and whether it still exists.
   */
  task(handle: number, kind: number, queuePos: number, live: boolean, target: number): void;
  /**
   * A cup moved (M2.5): place (CUP), drink, tile (−1 none), worker carrying it (0 none), dirty, and
   * the customer handle it was brewed for (0 none).
   */
  cup(id: number, place: number, drink: number, tile: number, holder: number, dirty: boolean, forCustomer: number): void;
}

export class FrameWriter {
  private buf = new ArrayBuffer(HEADER_BYTES);
  private dv = new DataView(this.buf);
  private u8 = new Uint8Array(this.buf);
  private off = HEADER_BYTES;
  private sections = 0;
  private secKind = 0;
  private secStart = -1;
  private secCount = 0;
  private tick = 0;
  private minute = 0;

  /** Start a frame in `buf` (from the pool). The writer may swap in a bigger buffer if needed. */
  begin(buf: ArrayBuffer, tick: number, gameMinute: number): void {
    this.setBuffer(buf);
    this.off = HEADER_BYTES;
    this.sections = 0;
    this.secKind = 0;
    this.secStart = -1;
    this.secCount = 0;
    this.tick = tick;
    this.minute = gameMinute;
  }

  /** Updates the clock written into the header. */
  setClock(tick: number, gameMinute: number): void {
    this.tick = tick;
    this.minute = gameMinute;
  }

  /** Writes the header and returns the buffer to transfer. */
  finish(workCentiMs = 0, flags = 0): ArrayBuffer {
    this.closeSection();
    const dv = this.dv;
    dv.setUint16(0, PROTOCOL_VERSION, true);
    dv.setUint16(2, flags, true);
    dv.setUint32(4, this.tick, true);
    dv.setUint32(8, this.minute, true);
    dv.setUint16(12, this.sections, true);
    dv.setUint16(14, Math.min(0xffff, Math.round(workCentiMs)), true);
    return this.buf;
  }

  /** Bytes written so far (including header). */
  get length(): number {
    return this.off;
  }

  npcSpawn(handle: number, def: number, area: number, look: number, x: number, y: number): void {
    const o = this.item(SEC.NPC_SPAWN);
    const dv = this.dv;
    dv.setUint32(o, handle, true);
    dv.setUint16(o + 4, def, true);
    dv.setUint8(o + 6, area);
    dv.setUint8(o + 7, look);
    dv.setInt16(o + 8, x, true);
    dv.setInt16(o + 10, y, true);
  }

  npcDespawn(handle: number): void {
    this.dv.setUint32(this.item(SEC.NPC_DESPAWN), handle, true);
  }

  npcState(slot: number, x: number, y: number, dir: number, anim: number): void {
    const o = this.item(SEC.NPC_STATE);
    const dv = this.dv;
    dv.setUint16(o, slot, true);
    dv.setInt16(o + 2, x, true);
    dv.setInt16(o + 4, y, true);
    dv.setUint8(o + 6, dir);
    dv.setUint8(o + 7, anim);
  }

  objUpsert(handle: number, type: number, x: number, y: number, rot: number, layer: number, colour: number, flags: number, parent: number): void {
    const o = this.item(SEC.OBJ_UPSERT);
    const dv = this.dv;
    dv.setUint32(o, handle, true);
    dv.setUint16(o + 4, type, true);
    dv.setUint8(o + 6, x);
    dv.setUint8(o + 7, y);
    dv.setUint8(o + 8, rot);
    dv.setUint8(o + 9, layer);
    dv.setUint8(o + 10, colour);
    dv.setUint8(o + 11, flags);
    dv.setUint32(o + 12, parent, true);
  }

  objRemove(handle: number): void {
    this.dv.setUint32(this.item(SEC.OBJ_REMOVE), handle, true);
  }

  world(weather: number, season: number, day: number): void {
    const o = this.item(SEC.WORLD);
    this.dv.setUint8(o, weather);
    this.dv.setUint8(o + 1, season);
    this.dv.setUint16(o + 2, day, true);
  }

  task(handle: number, kind: number, queuePos: number, live: boolean, target: number): void {
    const o = this.item(SEC.TASK);
    const dv = this.dv;
    dv.setUint32(o, handle, true);
    dv.setUint8(o + 4, kind);
    dv.setUint8(o + 5, queuePos);
    dv.setUint8(o + 6, live ? 1 : 0);
    dv.setUint8(o + 7, 0);
    dv.setUint32(o + 8, target, true);
  }

  cup(id: number, place: number, drink: number, tile: number, holder: number, dirty: boolean, forCustomer: number): void {
    const o = this.item(SEC.CUP);
    const dv = this.dv;
    dv.setUint16(o, id, true);
    dv.setUint8(o + 2, place);
    dv.setUint8(o + 3, drink);
    dv.setUint16(o + 4, tile < 0 ? 0xffff : tile, true);
    dv.setUint8(o + 6, holder);
    dv.setUint8(o + 7, dirty ? 1 : 0);
    dv.setUint32(o + 8, forCustomer, true);
  }

  npcOrder(handle: number, drink: number, state: number): void {
    const o = this.item(SEC.NPC_ORDER);
    const dv = this.dv;
    dv.setUint32(o, handle, true);
    dv.setUint8(o + 4, drink);
    dv.setUint8(o + 5, state);
    dv.setUint16(o + 6, 0, true);
  }

  /** Copies the w×h rect at (x, y) out of a W-wide grid. */
  gridPatch(prop: number, x: number, y: number, w: number, h: number, src: Uint8Array, srcW: number): void {
    this.patch(SEC.GRID_PATCH, prop, x, y, w, h, src, srcW);
  }

  tilePatch(layer: number, x: number, y: number, w: number, h: number, src: Uint8Array, srcW: number): void {
    this.patch(SEC.TILE_PATCH, layer, x, y, w, h, src, srcW);
  }

  private patch(kind: SectionKind, id: number, x: number, y: number, w: number, h: number, src: Uint8Array, srcW: number): void {
    const bytes = PATCH_HEAD_BYTES + pad4(w * h);
    const o = this.item(kind, bytes);
    const dv = this.dv;
    dv.setUint8(o, id);
    dv.setUint8(o + 1, 0);
    dv.setUint8(o + 2, x);
    dv.setUint8(o + 3, y);
    dv.setUint8(o + 4, w);
    dv.setUint8(o + 5, h);
    dv.setUint16(o + 6, 0, true);
    let d = o + PATCH_HEAD_BYTES;
    for (let row = 0; row < h; row++) {
      const s = (y + row) * srcW + x;
      this.u8.set(src.subarray(s, s + w), d);
      d += w;
    }
  }

  /** Reserves one item in a section of `kind`, opening a new section if needed. Returns its offset. */
  private item(kind: SectionKind, bytes = ITEM_BYTES[kind] ?? 0): number {
    if (this.secKind !== kind || this.secCount === 0xffff) {
      this.closeSection();
      this.ensure(SECTION_BYTES + bytes);
      this.secKind = kind;
      this.secStart = this.off;
      this.secCount = 0;
      this.off += SECTION_BYTES;
    } else {
      this.ensure(bytes);
    }
    const o = this.off;
    this.off += bytes;
    this.secCount++;
    return o;
  }

  private closeSection(): void {
    if (this.secStart < 0) return;
    const dv = this.dv;
    dv.setUint8(this.secStart, this.secKind);
    dv.setUint8(this.secStart + 1, 0);
    dv.setUint16(this.secStart + 2, this.secCount, true);
    dv.setUint32(this.secStart + 4, this.off - this.secStart - SECTION_BYTES, true);
    this.sections++;
    this.secStart = -1;
    this.secKind = 0;
    this.secCount = 0;
  }

  private ensure(bytes: number): void {
    const need = this.off + bytes;
    if (need <= this.buf.byteLength) return;
    let size = Math.max(this.buf.byteLength * 2, 1024);
    while (size < need) size *= 2;
    const next = new ArrayBuffer(size);
    new Uint8Array(next).set(this.u8.subarray(0, this.off));
    this.setBuffer(next);
  }

  private setBuffer(buf: ArrayBuffer): void {
    this.buf = buf;
    this.dv = new DataView(buf);
    this.u8 = new Uint8Array(buf);
  }
}

/** Decodes one frame into `h`. Returns false if the version doesn't match. */
export function readFrame(buf: ArrayBuffer, h: FrameHandler): boolean {
  const dv = new DataView(buf);
  if (dv.getUint16(0, true) !== PROTOCOL_VERSION) return false;
  const flags = dv.getUint16(2, true);
  h.header(dv.getUint32(4, true), dv.getUint32(8, true), dv.getUint16(14, true), flags);
  const sections = dv.getUint16(12, true);
  let u8: Uint8Array | null = null;
  let o = HEADER_BYTES;
  for (let s = 0; s < sections; s++) {
    const kind = dv.getUint8(o);
    const count = dv.getUint16(o + 2, true);
    const bytes = dv.getUint32(o + 4, true);
    let p = o + SECTION_BYTES;
    const end = p + bytes;
    switch (kind) {
      case SEC.NPC_SPAWN:
        for (let i = 0; i < count; i++, p += 12) {
          h.npcSpawn(dv.getUint32(p, true), dv.getUint16(p + 4, true), dv.getUint8(p + 6), dv.getUint8(p + 7), dv.getInt16(p + 8, true), dv.getInt16(p + 10, true));
        }
        break;
      case SEC.NPC_DESPAWN:
        for (let i = 0; i < count; i++, p += 4) h.npcDespawn(dv.getUint32(p, true));
        break;
      case SEC.NPC_STATE:
        for (let i = 0; i < count; i++, p += 8) {
          h.npcState(dv.getUint16(p, true), dv.getInt16(p + 2, true), dv.getInt16(p + 4, true), dv.getUint8(p + 6), dv.getUint8(p + 7));
        }
        break;
      case SEC.OBJ_UPSERT:
        for (let i = 0; i < count; i++, p += 16) {
          h.objUpsert(
            dv.getUint32(p, true), dv.getUint16(p + 4, true), dv.getUint8(p + 6), dv.getUint8(p + 7),
            dv.getUint8(p + 8), dv.getUint8(p + 9), dv.getUint8(p + 10), dv.getUint8(p + 11), dv.getUint32(p + 12, true),
          );
        }
        break;
      case SEC.OBJ_REMOVE:
        for (let i = 0; i < count; i++, p += 4) h.objRemove(dv.getUint32(p, true));
        break;
      case SEC.GRID_PATCH:
      case SEC.TILE_PATCH:
        u8 ??= new Uint8Array(buf);
        for (let i = 0; i < count; i++) {
          const w = dv.getUint8(p + 4);
          const ht = dv.getUint8(p + 5);
          const fn = kind === SEC.GRID_PATCH ? h.gridPatch : h.tilePatch;
          fn.call(h, dv.getUint8(p), dv.getUint8(p + 2), dv.getUint8(p + 3), w, ht, u8, p + PATCH_HEAD_BYTES);
          p += PATCH_HEAD_BYTES + pad4(w * ht);
        }
        break;
      case SEC.WORLD:
        for (let i = 0; i < count; i++, p += 4) h.world(dv.getUint8(p), dv.getUint8(p + 1), dv.getUint16(p + 2, true));
        break;
      case SEC.NPC_ORDER:
        for (let i = 0; i < count; i++, p += 8) h.npcOrder(dv.getUint32(p, true), dv.getUint8(p + 4), dv.getUint8(p + 5));
        break;
      case SEC.TASK:
        for (let i = 0; i < count; i++, p += 12) h.task(dv.getUint32(p, true), dv.getUint8(p + 4), dv.getUint8(p + 5), dv.getUint8(p + 6) === 1, dv.getUint32(p + 8, true));
        break;
      case SEC.CUP:
        for (let i = 0; i < count; i++, p += 12) {
          const t = dv.getUint16(p + 4, true);
          h.cup(dv.getUint16(p, true), dv.getUint8(p + 2), dv.getUint8(p + 3), t === 0xffff ? -1 : t, dv.getUint8(p + 6), dv.getUint8(p + 7) === 1, dv.getUint32(p + 8, true));
        }
        break;
      default:
        break; // unknown section: skip by length
    }
    o = end;
  }
  return true;
}
