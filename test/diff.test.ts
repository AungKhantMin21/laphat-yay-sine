import { describe, expect, it } from 'vitest';
import { FrameWriter, HEADER_BYTES, readFrame, type FrameHandler } from '../src/shared/diff';

/** Records every callback as a flat list for comparison. */
function recorder(): FrameHandler & { log: unknown[] } {
  const log: unknown[] = [];
  const patch = (tag: string) => (id: number, x: number, y: number, w: number, h: number, bytes: Uint8Array, off: number) =>
    log.push([tag, id, x, y, w, h, Array.from(bytes.subarray(off, off + w * h))]);
  return {
    log,
    header: (...a) => log.push(['header', ...a]),
    npcSpawn: (...a) => log.push(['npcSpawn', ...a]),
    npcDespawn: (...a) => log.push(['npcDespawn', ...a]),
    npcState: (...a) => log.push(['npcState', ...a]),
    objUpsert: (...a) => log.push(['objUpsert', ...a]),
    objRemove: (...a) => log.push(['objRemove', ...a]),
    gridPatch: patch('grid'),
    tilePatch: patch('tile'),
    world: (...a) => log.push(['world', ...a]),
    npcOrder: (...a) => log.push(['npcOrder', ...a]),
  };
}

describe('frame diff', () => {
  it('an empty frame is just the 16-byte header', () => {
    const w = new FrameWriter();
    w.begin(new ArrayBuffer(64), 7, 420);
    const buf = w.finish(123);
    expect(w.length).toBe(HEADER_BYTES);
    const r = recorder();
    expect(readFrame(buf, r)).toBe(true);
    expect(r.log).toEqual([['header', 7, 420, 123, 0]]);
  });

  it('round-trips every section kind, including negatives, max values and odd-sized patches', () => {
    const W = 10;
    const grid = new Uint8Array(W * 6).map((_, i) => (i * 7) & 0xff);
    const w = new FrameWriter();
    w.begin(new ArrayBuffer(32), 99, 1500); // too small on purpose: must grow
    w.npcSpawn(0xffff0001, 12, 2, 3, -320, 32767);
    w.npcSpawn(0x00010002, 1, 0, 0, 0, -1);
    w.npcState(5, 100, -100, 3, 9);
    w.objUpsert(0x00020003, 40, 127, 95, 3, 2, 31, 1, 0x00010001);
    w.objRemove(0x00030004);
    w.gridPatch(2, 3, 1, 3, 3, grid, W); // 9 bytes → padded to 12
    w.tilePatch(1, 0, 0, 1, 1, grid, W);
    w.npcDespawn(0xffff0001);
    w.world(1, 2, 300);
    w.npcOrder(0xfffe0003, 3, 2);
    const buf = w.finish();

    const r = recorder();
    readFrame(buf, r);
    const rect = (x: number, y: number, ww: number, h: number) => {
      const out: number[] = [];
      for (let j = 0; j < h; j++) for (let i = 0; i < ww; i++) out.push(grid[(y + j) * W + x + i]!);
      return out;
    };
    expect(r.log).toEqual([
      ['header', 99, 1500, 0, 0],
      ['npcSpawn', 0xffff0001, 12, 2, 3, -320, 32767],
      ['npcSpawn', 0x00010002, 1, 0, 0, 0, -1],
      ['npcState', 5, 100, -100, 3, 9],
      ['objUpsert', 0x00020003, 40, 127, 95, 3, 2, 31, 1, 0x00010001],
      ['objRemove', 0x00030004],
      ['grid', 2, 3, 1, 3, 3, rect(3, 1, 3, 3)],
      ['tile', 1, 0, 0, 1, 1, rect(0, 0, 1, 1)],
      ['npcDespawn', 0xffff0001],
      ['world', 1, 2, 300],
      ['npcOrder', 0xfffe0003, 3, 2],
    ]);
  });

  it('keeps every section 4-byte aligned', () => {
    const w = new FrameWriter();
    w.begin(new ArrayBuffer(1024), 0, 0);
    w.gridPatch(0, 0, 0, 1, 1, new Uint8Array(1), 1);
    w.objRemove(1);
    expect(w.length % 4).toBe(0);
  });

  it('rejects a frame from another protocol version', () => {
    const buf = new ArrayBuffer(16);
    new DataView(buf).setUint16(0, 999, true);
    expect(readFrame(buf, recorder())).toBe(false);
  });
});
