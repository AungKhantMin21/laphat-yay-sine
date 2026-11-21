// Save storage in IndexedDB (worker side), plus save codes. A save that can't be read is never
// overwritten: it is moved aside first, because nothing a player made should ever be lost.
import { fromBase64Url, toBase64Url } from '../../shared/base64';
import { STORE, dbGet, dbPut } from '../../shared/db';
import { parse, serialize, type SaveData } from './format';

const CODE_PREFIX = 'LYS1.';

export function slotKey(slot: number): string {
  return `slot${slot}`;
}

export type LoadResult = { kind: 'none' } | { kind: 'ok'; data: SaveData } | { kind: 'broken'; error: string };

export async function loadSlot(slot: number): Promise<LoadResult> {
  const raw = await dbGet<ArrayBuffer>(STORE.saves, slotKey(slot));
  if (!raw) return { kind: 'none' };
  try {
    return { kind: 'ok', data: parse(raw) };
  } catch (e) {
    // Keep the unreadable bytes for a future fix; the slot is then free for a new game.
    await dbPut(STORE.saves, `${slotKey(slot)}.broken.${Date.now()}`, raw);
    return { kind: 'broken', error: e instanceof Error ? e.message : String(e) };
  }
}

export async function saveSlot(slot: number, data: SaveData): Promise<void> {
  await dbPut(STORE.saves, slotKey(slot), serialize(data));
}

export function toCode(data: SaveData): string {
  return CODE_PREFIX + toBase64Url(new Uint8Array(serialize(data)));
}

/** Throws if the code isn't a valid save. */
export function fromCode(code: string): SaveData {
  const c = code.trim();
  if (!c.startsWith(CODE_PREFIX)) throw new Error('not a save code');
  return parse(fromBase64Url(c.slice(CODE_PREFIX.length)).buffer as ArrayBuffer);
}
