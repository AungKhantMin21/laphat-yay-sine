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

import type { DayStats } from '../../shared/protocol';

export const SAVE_SCHEMA = 2;
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
  /** RNG stream states: market, npcDecide, events, cosmetic. */
  rng: [number, number, number, number];
  money: number;
  nextUid: number;
  inventory: Record<string, number>;
  objects: SavedObject[];
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
  const size = 4 + 4 + 4 + 8 + 4 + 16 + 8 + 2 + keyBytes.reduce((s, b) => s + 1 + b.length, 0) + 2 + inv.length * 4 + 2 + d.objects.length * OBJ_BYTES
    + DAY_BYTES + 1 + teaserKey.length + 1 + teaserArg.length;
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
  return { ...base, schema: 2, clock, shuttersOpen, today, teaser: { key, arg } };
}

/** One parser per schema that ever existed. Never edit an old one. */
export const PARSERS: Record<number, Parser> = {
  1: parseV1 as unknown as Parser,
  2: parseV2 as unknown as Parser,
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
