// Entity handles: u32 = generation (high 16 bits) | index (low 16 bits). Index 0 = none.
// A handle kept after its entity was removed fails the generation check instead of
// silently pointing at whatever reused the slot.

export const NONE = 0;

export function makeHandle(index: number, gen: number): number {
  return (((gen & 0xffff) << 16) | (index & 0xffff)) >>> 0;
}

export function handleIndex(h: number): number {
  return h & 0xffff;
}

export function handleGen(h: number): number {
  return h >>> 16;
}

/**
 * Fixed-capacity slot allocator with generations. Slot 0 is never handed out.
 * Typed-array stores use the index; everything outside the store holds handles.
 */
export class SlotAllocator {
  readonly gen: Uint16Array;
  private readonly alive: Uint8Array;
  private readonly free: Uint16Array;
  private freeTop = 0;
  private live = 0;

  constructor(readonly capacity: number) {
    if (capacity > 0xffff) throw new Error('capacity too large for 16-bit index');
    this.gen = new Uint16Array(capacity);
    this.alive = new Uint8Array(capacity);
    this.free = new Uint16Array(capacity);
    // Push in reverse so low indices come out first.
    for (let i = capacity - 1; i >= 1; i--) this.free[this.freeTop++] = i;
  }

  get count(): number {
    return this.live;
  }

  /** Returns a handle, or NONE when full. */
  alloc(): number {
    if (this.freeTop === 0) return NONE;
    const index = this.free[--this.freeTop]!;
    this.alive[index] = 1;
    this.live++;
    return makeHandle(index, this.gen[index]!);
  }

  /** Frees a live handle. Returns false for stale or invalid handles. */
  release(h: number): boolean {
    if (!this.isLive(h)) return false;
    const index = handleIndex(h);
    this.gen[index] = (this.gen[index]! + 1) & 0xffff;
    this.alive[index] = 0;
    this.free[this.freeTop++] = index;
    this.live--;
    return true;
  }

  isLive(h: number): boolean {
    const index = handleIndex(h);
    if (index === 0 || index >= this.capacity) return false;
    return this.alive[index] === 1 && this.gen[index] === handleGen(h);
  }
}

/** Set of slot indices without allocation: a flag array plus a list. */
export class IndexQueue {
  private readonly flags: Uint8Array;
  readonly list: Uint16Array;
  length = 0;

  constructor(capacity: number) {
    this.flags = new Uint8Array(capacity);
    this.list = new Uint16Array(capacity);
  }

  push(i: number): void {
    if (this.flags[i]) return;
    this.flags[i] = 1;
    this.list[this.length++] = i;
  }

  clear(): void {
    for (let k = 0; k < this.length; k++) this.flags[this.list[k]!] = 0;
    this.length = 0;
  }
}
