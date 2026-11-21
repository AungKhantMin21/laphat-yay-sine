// Seeded randomness. Each subsystem draws from its own stream, so cosmetic randomness
// (what's on screen) never changes simulation outcomes. Never use Math.random() in sim/.

export const STREAM = { market: 1, npcDecide: 2, events: 3, cosmetic: 4 } as const;
export type StreamName = keyof typeof STREAM;

/** splitmix32: turns (seed, stream id) into a well-mixed starting state. */
export function mixSeed(seed: number, stream: number): number {
  let z = (seed + Math.imul(stream, 0x9e3779b9)) | 0;
  z = Math.imul(z ^ (z >>> 16), 0x85ebca6b);
  z = Math.imul(z ^ (z >>> 13), 0xc2b2ae35);
  return (z ^ (z >>> 16)) >>> 0;
}

/** mulberry32. State is a single u32 so it saves and restores trivially. */
export class Rng {
  constructor(public state: number) {}

  /** u32 */
  nextU32(): number {
    let t = (this.state = (this.state + 0x6d2b79f5) | 0);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return (t ^ (t >>> 14)) >>> 0;
  }

  /** [0, 1) */
  next(): number {
    return this.nextU32() / 4294967296;
  }

  /** Integer in [0, n). */
  int(n: number): number {
    return Math.floor(this.next() * n);
  }

  /** Integer in [lo, hi]. */
  range(lo: number, hi: number): number {
    return lo + this.int(hi - lo + 1);
  }

  chance(p: number): boolean {
    return this.next() < p;
  }
}

export function createStreams(seed: number): Record<StreamName, Rng> {
  return {
    market: new Rng(mixSeed(seed, STREAM.market)),
    npcDecide: new Rng(mixSeed(seed, STREAM.npcDecide)),
    events: new Rng(mixSeed(seed, STREAM.events)),
    cosmetic: new Rng(mixSeed(seed, STREAM.cosmetic)),
  };
}
