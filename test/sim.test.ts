import { describe, expect, it } from 'vitest';
import { Sim } from '../src/sim/sim';
import { FrameWriter } from '../src/shared/diff';
import { Rng, createStreams, mixSeed } from '../src/shared/rng';
import { SlotAllocator, handleIndex, NONE } from '../src/shared/ids';
import { catchupDays, DAY_MS, HOUR_MS } from '../src/sim/catchup';
import { START_MINUTE } from '../src/shared/layout';

function runFrames(seed: number, ticks: number): Uint8Array[] {
  const sim = new Sim(seed);
  const w = new FrameWriter();
  const out: Uint8Array[] = [];
  for (let i = 0; i < ticks; i++) {
    w.begin(new ArrayBuffer(256), sim.tick, sim.gameMinute);
    sim.step(w);
    w.setClock(sim.tick, sim.gameMinute);
    out.push(new Uint8Array(w.finish().slice(0, w.length)));
  }
  return out;
}

describe('sim determinism', () => {
  it('the same seed produces byte-identical frames', () => {
    expect(runFrames(42, 2000)).toEqual(runFrames(42, 2000));
  });

  it('10 ticks = 1 game minute; a day rolls over after 24 game hours', () => {
    const sim = new Sim(1);
    const w = new FrameWriter();
    w.begin(new ArrayBuffer(1024), 0, 0);
    for (let i = 0; i < 10; i++) sim.step(w);
    expect(sim.gameMinute).toBe(START_MINUTE + 1);
    for (let i = 0; i < 18 * 60 * 10; i++) sim.step(w);
    expect(sim.day).toBe(1);
  });
});

describe('rng', () => {
  it('mulberry32 is reproducible from its state', () => {
    const a = new Rng(123);
    const seq = [a.nextU32(), a.nextU32(), a.nextU32()];
    const b = new Rng(123);
    expect([b.nextU32(), b.nextU32(), b.nextU32()]).toEqual(seq);
  });

  it('streams are independent: drawing cosmetic numbers never shifts market numbers', () => {
    const s1 = createStreams(7);
    const s2 = createStreams(7);
    for (let i = 0; i < 100; i++) s2.cosmetic.next();
    expect([s1.market.next(), s1.market.next()]).toEqual([s2.market.next(), s2.market.next()]);
    expect(mixSeed(7, 1)).not.toBe(mixSeed(7, 2));
  });

  it('int stays in range', () => {
    const r = new Rng(9);
    for (let i = 0; i < 10000; i++) {
      const v = r.range(3, 5);
      expect(v >= 3 && v <= 5).toBe(true);
    }
  });
});

describe('handles', () => {
  it('stale handles fail after their slot is reused', () => {
    const a = new SlotAllocator(4);
    const h1 = a.alloc();
    expect(a.isLive(h1)).toBe(true);
    expect(a.release(h1)).toBe(true);
    const h2 = a.alloc();
    expect(handleIndex(h2)).toBe(handleIndex(h1));
    expect(a.isLive(h1)).toBe(false);
    expect(a.release(h1)).toBe(false);
    expect(a.isLive(h2)).toBe(true);
  });

  it('never hands out index 0 and returns NONE when full', () => {
    const a = new SlotAllocator(3);
    const hs = [a.alloc(), a.alloc()];
    expect(hs.map(handleIndex)).toEqual([1, 2]);
    expect(a.alloc()).toBe(NONE);
    expect(a.isLive(NONE)).toBe(false);
  });
});

describe('catch-up rule', () => {
  it('under 1 real hour away: no catch-up', () => {
    expect(catchupDays(0)).toBe(0);
    expect(catchupDays(HOUR_MS - 1)).toBe(0);
  });
  it('1 game day per full real day away', () => {
    expect(catchupDays(HOUR_MS)).toBe(0);
    expect(catchupDays(DAY_MS - 1)).toBe(0);
    expect(catchupDays(DAY_MS)).toBe(1);
    expect(catchupDays(3.5 * DAY_MS)).toBe(3);
  });
  it('at most 7 days; bad clocks give none', () => {
    expect(catchupDays(30 * DAY_MS)).toBe(7);
    expect(catchupDays(-DAY_MS)).toBe(0);
    expect(catchupDays(NaN)).toBe(0);
  });
});
