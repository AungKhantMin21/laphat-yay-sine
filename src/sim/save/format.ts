// Save format: compact little-endian binary, versioned by `schema`, with ordered migrations.
// Object types are stored by key (a key table in each save), never by catalog index.
//
// v1 layout:
//   'LYS1' | u16 schema | u16 reserved | u32 seed | f64 savedAt | u32 tick | u32 rng × 4
//   | u32 money | u32 nextUid
//   | u16 keyCount, then keyCount × (u8 len, ASCII key)
//   | u16 invCount, then invCount × (u16 keyIndex, u16 qty)
//   | u16 objCount, then objCount × (u32 uid, u16 keyIndex, u8 x, u8 y, u8 rot, u8 layer, u8 colour, u8 flags, u32 parentUid)
//
// v2 = the v1 layout (schema 2), then the shop day (M2):
//   u32 clock | u8 dayFlags (bit 0 shutters open) | u8 reserved
//   | u16 served | u16 poured | u8 best | u8 reserved | u32 earned | u32 tips
//   | u8 len + ASCII teaser key | u8 len + ASCII teaser arg
//
// v3 = the v2 layout (schema 3), then staff (M2.5):
//   u8 count, then count × (u8 len + ASCII role key | u16 hiredDay | u8 flags (bit 0 day off))
//
// v4 = the v3 layout (schema 4), then the neighbourhood (M3). Strings are u8 len + UTF-8; items are
// (u8 kind: 0 ingredient, 1 object, 2 material | str key):
//   i32 marketDay | u8 shops × (str shop key | u8 rows × u8 sold today)
//   | u8 n × (str ingredient key | u32 portions)                     kitchen stock
//   | u8 n × (str material key | u32 tiles)                          materials
//   | u8 n × (item | u16 qty)                                        carried
//   | u8 n × (item | u16 qty | i32 due minute, −1 = next opening)    deliveries
//   | u16 n × (u8 x | u8 y | u8 layer: 0 floor, 1 wall | str finish) painted tiles

import type { DayStats } from '../../shared/protocol';
import start from '../../data/start.json';

export const SAVE_SCHEMA = 4;
const MAGIC = 0x3153594c; // 'LYS1' little-endian
const OBJ_BYTES = 16;
const DAY_BYTES = 20;

export interface SavedObject {
  uid: number;
  key: string;
  x: number;
  y: number;
  rot: number;
  layer: number;
  colour: number;
  flags: number;
  parentUid: number;
}

/** Schema 1, as plain data. */
interface SaveDataV1 {
  schema: number;
  seed: number;
  savedAt: number;
  tick: number;
  rng: [number, number, number, number];
  money: number;
  nextUid: number;
  inventory: Record<string, number>;
  objects: SavedObject[];
}

/** A hired staff member (M2.5). */
export interface StaffMember {
  /** staff.json role key. */
  role: string;
  hiredDay: number;
  /** Off (unpaid) today: the tin was short at the last Sleep. */
  dayOff: boolean;
}

/** Goods by item kind (shared/market.ts ITEM) and key (M3). */
export interface SavedGoods {
  kind: number;
  key: string;
  qty: number;
}

/** A painted tile (M3): a floor finish (layer 0) or wall colour (layer 1). */
export interface SavedPaint {
  x: number;
  y: number;
  layer: number;
  finish: string;
}

/** The neighbourhood part of a save (v4). */
export interface SaveNeighbourhood {
  /** Day the purchases belong to (−1 = none); a different day restocks everything. */
  marketDay: number;
  /** Units bought today per shop key and row. */
  sold: Record<string, number[]>;
  /** Kitchen stock in portions, by ingredient key. */
  stock: Record<string, number>;
  /** Materials in tiles, by material key. */
  materials: Record<string, number>;
  carry: SavedGoods[];
  deliveries: (SavedGoods & { due: number })[];
  painted: SavedPaint[];
}

/** The current-schema save, as plain data. */
export interface SaveData {
  schema: number;
  seed: number;
  /** Wall-clock ms when saved (Date.now()). */
  savedAt: number;
  /** Sim steps since the save began. */
  tick: number;
  /** Game clock in ticks since the start minute (stands still while the day holds it). */
  clock: number;
  shuttersOpen: boolean;
  today: DayStats;
  /** Tomorrow's teaser ('' key = none). */
  teaser: { key: string; arg: string };
  staff: StaffMember[];
  /** RNG stream states: market, npcDecide, events, cosmetic. */
  rng: [number, number, number, number];
  money: number;
  nextUid: number;
  inventory: Record<string, number>;
  objects: SavedObject[];
  /** M3: stock, materials, market purchases, goods in hand or on the way, paint. */
  hood: SaveNeighbourhood;
}

/** Growable little-endian byte writer (saving is not a hot path). */
class Bytes {
  private buf = new Uint8Array(256);
  private dv = new DataView(this.buf.buffer);
  length = 0;
  private room(n: number): void {
    if (this.length + n <= this.buf.length) return;
    const next = new Uint8Array(Math.max(this.buf.length * 2, this.length + n));
    next.set(this.buf);
    this.buf = next;
    this.dv = new DataView(next.buffer);
  }
  u8(v: number): void {
    this.room(1);
    this.buf[this.length++] = v & 0xff;
  }
  u16(v: number): void {
    this.room(2);
    this.dv.setUint16(this.length, Math.min(0xffff, Math.max(0, Math.floor(v))), true);
    this.length += 2;
  }
  u32(v: number): void {
    this.room(4);
    this.dv.setUint32(this.length, Math.min(0xffffffff, Math.max(0, Math.floor(v))), true);
    this.length += 4;
  }
  i32(v: number): void {
    this.room(4);
    this.dv.setInt32(this.length, v | 0, true);
    this.length += 4;
  }
  str(s: string): void {
    const b = new TextEncoder().encode(s);
    if (b.length > 255) throw new Error('save string too long');
    this.u8(b.length);
    this.room(b.length);
    this.buf.set(b, this.length);
    this.length += b.length;
  }
  bytes(): Uint8Array {
    return this.buf.subarray(0, this.length);
  }
}

function count(n: number, max: number, what: string): number {
  if (n > max) throw new Error(`save: too many ${what}`);
  return n;
}

/** The v4 neighbourhood block. */
function writeHood(h: SaveNeighbourhood): Uint8Array {
  const w = new Bytes();
  w.i32(h.marketDay);
  const shops = Object.entries(h.sold);
  w.u8(count(shops.length, 255, 'shops'));
  for (const [key, rows] of shops) {
    w.str(key);
    w.u8(count(rows.length, 255, 'rows'));
    for (const n of rows) w.u8(Math.min(255, n));
  }
  for (const rec of [h.stock, h.materials]) {
    const e = Object.entries(rec).filter(([, n]) => n > 0);
    w.u8(count(e.length, 255, 'stock lines'));
    for (const [key, n] of e) {
      w.str(key);
      w.u32(n);
    }
  }
  w.u8(count(h.carry.length, 255, 'carried goods'));
  for (const g of h.carry) {
    w.u8(g.kind);
    w.str(g.key);
    w.u16(g.qty);
  }
  w.u8(count(h.deliveries.length, 255, 'deliveries'));
  for (const g of h.deliveries) {
    w.u8(g.kind);
    w.str(g.key);
    w.u16(g.qty);
    w.i32(g.due);
  }
  w.u16(count(h.painted.length, 0xffff, 'painted tiles'));
  for (const p of h.painted) {
    w.u8(p.x);
    w.u8(p.y);
    w.u8(p.layer);
    w.str(p.finish);
  }
  return w.bytes();
}

export function serialize(d: SaveData): ArrayBuffer {
  const keys = new Map<string, number>();
  const keyOf = (k: string): number => {
    let i = keys.get(k);
    if (i === undefined) keys.set(k, (i = keys.size));
    return i;
  };
  const inv = Object.entries(d.inventory).filter(([, n]) => n > 0);
  for (const [k] of inv) keyOf(k);
  for (const o of d.objects) keyOf(o.key);
  const enc = new TextEncoder();
  const keyBytes = [...keys.keys()].map((k) => enc.encode(k));
  const teaserKey = enc.encode(d.teaser.key);
  const teaserArg = enc.encode(d.teaser.arg);
  if (teaserKey.length > 255 || teaserArg.length > 255) throw new Error('teaser too long');
  const staffKeys = d.staff.map((m) => enc.encode(m.role));
  if (staffKeys.length > 255 || staffKeys.some((b) => b.length > 255)) throw new Error('staff too long');
  const hood = writeHood(d.hood);
  const size = 4 + 4 + 4 + 8 + 4 + 16 + 8 + 2 + keyBytes.reduce((s, b) => s + 1 + b.length, 0) + 2 + inv.length * 4 + 2 + d.objects.length * OBJ_BYTES
    + DAY_BYTES + 1 + teaserKey.length + 1 + teaserArg.length
    + 1 + staffKeys.reduce((s, b) => s + 1 + b.length + 3, 0)
    + hood.length;
  const buf = new ArrayBuffer(size);
  const dv = new DataView(buf);
  const u8 = new Uint8Array(buf);
  let o = 0;
  dv.setUint32(o, MAGIC, true);
  dv.setUint16(o + 4, SAVE_SCHEMA, true);
  dv.setUint16(o + 6, 0, true);
  dv.setUint32(o + 8, d.seed >>> 0, true);
  dv.setFloat64(o + 12, d.savedAt, true);
  dv.setUint32(o + 20, d.tick >>> 0, true);
  o = 24;
  for (const s of d.rng) {
    dv.setUint32(o, s >>> 0, true);
    o += 4;
  }
  dv.setUint32(o, Math.max(0, Math.floor(d.money)), true);
  dv.setUint32(o + 4, d.nextUid >>> 0, true);
  o += 8;
  dv.setUint16(o, keyBytes.length, true);
  o += 2;
  for (const b of keyBytes) {
    if (b.length > 255) throw new Error('key too long');
    u8[o++] = b.length;
    u8.set(b, o);
    o += b.length;
  }
  dv.setUint16(o, inv.length, true);
  o += 2;
  for (const [k, n] of inv) {
    dv.setUint16(o, keyOf(k), true);
    dv.setUint16(o + 2, Math.min(0xffff, n), true);
    o += 4;
  }
  dv.setUint16(o, d.objects.length, true);
  o += 2;
  for (const ob of d.objects) {
    dv.setUint32(o, ob.uid, true);
    dv.setUint16(o + 4, keyOf(ob.key), true);
    u8[o + 6] = ob.x;
    u8[o + 7] = ob.y;
    u8[o + 8] = ob.rot;
    u8[o + 9] = ob.layer;
    u8[o + 10] = ob.colour;
    u8[o + 11] = ob.flags;
    dv.setUint32(o + 12, ob.parentUid, true);
    o += OBJ_BYTES;
  }
  const t = d.today;
  const u16 = (n: number): number => Math.min(0xffff, Math.max(0, Math.floor(n)));
  const u32 = (n: number): number => Math.min(0xffffffff, Math.max(0, Math.floor(n)));
  dv.setUint32(o, d.clock >>> 0, true);
  u8[o + 4] = d.shuttersOpen ? 1 : 0;
  u8[o + 5] = 0;
  dv.setUint16(o + 6, u16(t.served), true);
  dv.setUint16(o + 8, u16(t.poured), true);
  u8[o + 10] = Math.min(100, Math.max(0, Math.round(t.best)));
  u8[o + 11] = 0;
  dv.setUint32(o + 12, u32(t.earned), true);
  dv.setUint32(o + 16, u32(t.tips), true);
  o += DAY_BYTES;
  for (const b of [teaserKey, teaserArg]) {
    u8[o++] = b.length;
    u8.set(b, o);
    o += b.length;
  }
  u8[o++] = staffKeys.length;
  d.staff.forEach((m, k) => {
    const b = staffKeys[k]!;
    u8[o++] = b.length;
    u8.set(b, o);
    o += b.length;
    dv.setUint16(o, Math.min(0xffff, Math.max(0, m.hiredDay)), true);
    u8[o + 2] = m.dayOff ? 1 : 0;
    o += 3;
  });
  u8.set(hood, o);
  return buf;
}

/** Any schema's data, before migrating to the current one. */
export interface VersionedSave {
  schema: number;
  [k: string]: unknown;
}

type Parser = (dv: DataView) => VersionedSave;

function parseV1(dv: DataView): SaveDataV1 {
  const dec = new TextDecoder();
  const u8 = new Uint8Array(dv.buffer, dv.byteOffset, dv.byteLength);
  const need = (o: number, n: number): void => {
    if (o + n > dv.byteLength) throw new Error('save truncated');
  };
  need(0, 48);
  const rng: [number, number, number, number] = [dv.getUint32(24, true), dv.getUint32(28, true), dv.getUint32(32, true), dv.getUint32(36, true)];
  const d: SaveDataV1 = {
    schema: 1,
    seed: dv.getUint32(8, true),
    savedAt: dv.getFloat64(12, true),
    tick: dv.getUint32(20, true),
    rng,
    money: dv.getUint32(40, true),
    nextUid: dv.getUint32(44, true),
    inventory: {},
    objects: [],
  };
  let o = 48;
  need(o, 2);
  const keyCount = dv.getUint16(o, true);
  o += 2;
  const keys: string[] = [];
  for (let i = 0; i < keyCount; i++) {
    need(o, 1);
    const len = u8[o++]!;
    need(o, len);
    keys.push(dec.decode(u8.subarray(o, o + len)));
    o += len;
  }
  const key = (i: number): string => {
    const k = keys[i];
    if (k === undefined) throw new Error('bad key index');
    return k;
  };
  need(o, 2);
  const invCount = dv.getUint16(o, true);
  o += 2;
  for (let i = 0; i < invCount; i++) {
    need(o, 4);
    d.inventory[key(dv.getUint16(o, true))] = dv.getUint16(o + 2, true);
    o += 4;
  }
  need(o, 2);
  const objCount = dv.getUint16(o, true);
  o += 2;
  need(o, objCount * OBJ_BYTES);
  for (let i = 0; i < objCount; i++) {
    d.objects.push({
      uid: dv.getUint32(o, true),
      key: key(dv.getUint16(o + 4, true)),
      x: u8[o + 6]!,
      y: u8[o + 7]!,
      rot: u8[o + 8]!,
      layer: u8[o + 9]!,
      colour: u8[o + 10]!,
      flags: u8[o + 11]!,
      parentUid: dv.getUint32(o + 12, true),
    });
    o += OBJ_BYTES;
  }
  return d;
}

/** Byte offset just past the v1 layout's object list (v2 appends the shop day there). */
function endOfV1(dv: DataView): number {
  const need = (o: number, n: number): void => {
    if (o + n > dv.byteLength) throw new Error('save truncated');
  };
  let o = 48;
  need(o, 2);
  const keyCount = dv.getUint16(o, true);
  o += 2;
  for (let i = 0; i < keyCount; i++) {
    need(o, 1);
    o += 1 + dv.getUint8(o);
  }
  need(o, 2);
  o += 2 + dv.getUint16(o, true) * 4;
  need(o, 2);
  o += 2 + dv.getUint16(o, true) * OBJ_BYTES;
  return o;
}

function parseV2(dv: DataView): SaveData {
  const base = parseV1(dv); // same leading layout; it ignores the bytes after the objects
  let o = endOfV1(dv);
  const need = (n: number): void => {
    if (o + n > dv.byteLength) throw new Error('save truncated');
  };
  need(DAY_BYTES);
  const today: DayStats = {
    served: dv.getUint16(o + 6, true),
    poured: dv.getUint16(o + 8, true),
    best: dv.getUint8(o + 10),
    earned: dv.getUint32(o + 12, true),
    tips: dv.getUint32(o + 16, true),
  };
  const clock = dv.getUint32(o, true);
  const shuttersOpen = (dv.getUint8(o + 4) & 1) === 1;
  o += DAY_BYTES;
  const dec = new TextDecoder();
  const str = (): string => {
    need(1);
    const len = dv.getUint8(o++);
    need(len);
    const s = dec.decode(new Uint8Array(dv.buffer, dv.byteOffset + o, len));
    o += len;
    return s;
  };
  const key = str();
  const arg = str();
  return { ...base, schema: 2, clock, shuttersOpen, today, teaser: { key, arg } } as SaveData;
}

/** Byte offset just after the v2 layout (the shop day and teaser). */
function endOfV2(dv: DataView): number {
  let o = endOfV1(dv) + DAY_BYTES;
  for (let k = 0; k < 2; k++) {
    if (o + 1 > dv.byteLength) throw new Error('save truncated');
    o += 1 + dv.getUint8(o);
  }
  return o;
}

function parseV3(dv: DataView): SaveData {
  const base = parseV2(dv);
  let o = endOfV2(dv);
  const need = (n: number): void => {
    if (o + n > dv.byteLength) throw new Error('save truncated');
  };
  const dec = new TextDecoder();
  need(1);
  const n = dv.getUint8(o++);
  const staff: StaffMember[] = [];
  for (let k = 0; k < n; k++) {
    need(1);
    const len = dv.getUint8(o++);
    need(len + 3);
    const role = dec.decode(new Uint8Array(dv.buffer, dv.byteOffset + o, len));
    o += len;
    staff.push({ role, hiredDay: dv.getUint16(o, true), dayOff: (dv.getUint8(o + 2) & 1) === 1 });
    o += 3;
  }
  return { ...base, schema: 3, staff };
}

/** Byte offset just after the v3 layout (the staff roster). */
function endOfV3(dv: DataView): number {
  let o = endOfV2(dv);
  const need = (n: number): void => {
    if (o + n > dv.byteLength) throw new Error('save truncated');
  };
  need(1);
  const n = dv.getUint8(o++);
  for (let k = 0; k < n; k++) {
    need(1);
    o += 1 + dv.getUint8(o) + 3;
  }
  return o;
}

function parseV4(dv: DataView): SaveData {
  const base = parseV3(dv);
  let o = endOfV3(dv);
  const need = (n: number): void => {
    if (o + n > dv.byteLength) throw new Error('save truncated');
  };
  const dec = new TextDecoder();
  const u8 = (): number => {
    need(1);
    return dv.getUint8(o++);
  };
  const u16 = (): number => {
    need(2);
    o += 2;
    return dv.getUint16(o - 2, true);
  };
  const u32 = (): number => {
    need(4);
    o += 4;
    return dv.getUint32(o - 4, true);
  };
  const i32 = (): number => {
    need(4);
    o += 4;
    return dv.getInt32(o - 4, true);
  };
  const str = (): string => {
    const len = u8();
    need(len);
    const s = dec.decode(new Uint8Array(dv.buffer, dv.byteOffset + o, len));
    o += len;
    return s;
  };
  const hood: SaveNeighbourhood = { marketDay: i32(), sold: {}, stock: {}, materials: {}, carry: [], deliveries: [], painted: [] };
  for (let s = u8(); s > 0; s--) {
    const key = str();
    const rows: number[] = [];
    for (let r = u8(); r > 0; r--) rows.push(u8());
    hood.sold[key] = rows;
  }
  for (const rec of [hood.stock, hood.materials]) {
    for (let n = u8(); n > 0; n--) {
      const key = str();
      rec[key] = u32();
    }
  }
  for (let n = u8(); n > 0; n--) {
    const kind = u8();
    const key = str();
    hood.carry.push({ kind, key, qty: u16() });
  }
  for (let n = u8(); n > 0; n--) {
    const kind = u8();
    const key = str();
    const qty = u16();
    hood.deliveries.push({ kind, key, qty, due: i32() });
  }
  for (let n = u16(); n > 0; n--) {
    const x = u8();
    const y = u8();
    const layer = u8();
    hood.painted.push({ x, y, layer, finish: str() });
  }
  return { ...base, schema: 4, hood };
}

/** One parser per schema that ever existed. Never edit an old one. */
export const PARSERS: Record<number, Parser> = {
  1: parseV1 as unknown as Parser,
  2: parseV2 as unknown as Parser,
  3: parseV3 as unknown as Parser,
  4: parseV4 as unknown as Parser,
};

/** Upgrades schema n → n+1. MIGRATIONS[n] upgrades from n. Append only. */
export const MIGRATIONS: Record<number, (s: VersionedSave) => VersionedSave> = {
  // v1 → v2 (M2): the clock ran with every tick, and the shop was always open.
  1: (s) => ({
    ...s,
    schema: 2,
    clock: s.tick,
    shuttersOpen: true,
    today: { served: 0, poured: 0, earned: 0, tips: 0, best: 0 },
    teaser: { key: '', arg: '' },
  }),
  // v2 → v3 (M2.5): no staff yet. (New kitchen fixtures and objects that no longer fit are handled at load.)
  2: (s) => ({ ...s, schema: 3, staff: [] }),
  // v3 → v4 (M3): ingredients became real — the kitchen gets a new game's starting stock; nothing
  // bought, carried or painted yet.
  3: (s) => ({
    ...s,
    schema: 4,
    hood: { marketDay: -1, sold: {}, stock: { ...(start.stock as Record<string, number>) }, materials: {}, carry: [], deliveries: [], painted: [] },
  }),
};

export function migrate(s: VersionedSave, migrations = MIGRATIONS, target = SAVE_SCHEMA): VersionedSave {
  let cur = s;
  while (cur.schema < target) {
    const step = migrations[cur.schema];
    if (!step) throw new Error(`no migration from schema ${cur.schema}`);
    const next = step(cur);
    if (next.schema !== cur.schema + 1) throw new Error(`migration from ${cur.schema} must produce ${cur.schema + 1}`);
    cur = next;
  }
  if (cur.schema > target) throw new Error(`save is from a newer version (schema ${cur.schema})`);
  return cur;
}

/** Parses any supported schema and migrates it to the current one. Throws on bad data. */
export function parse(buf: ArrayBuffer): SaveData {
  const dv = new DataView(buf);
  if (buf.byteLength < 8 || dv.getUint32(0, true) !== MAGIC) throw new Error('not a save');
  const schema = dv.getUint16(4, true);
  const parser = PARSERS[schema];
  if (!parser) throw new Error(`unknown save schema ${schema}`);
  return migrate(parser(dv)) as unknown as SaveData;
}
