// The simulation core: plain TypeScript, no Worker globals, so Vitest can run it headless.
import type { FrameWriter } from '../shared/diff';
import { TICK_HZ } from '../shared/protocol';
import { createStreams, type Rng, type StreamName } from '../shared/rng';
import { MINUTES_PER_DAY, START_MINUTE } from '../shared/layout';

export class Sim {
  /** Ticks since the save began. 10 ticks = 1 real second = 1 game minute. */
  tick = 0;
  readonly rng: Record<StreamName, Rng>;

  constructor(
    readonly seed: number,
    private readonly startMinute = START_MINUTE,
  ) {
    this.rng = createStreams(seed);
  }

  get gameMinute(): number {
    return this.startMinute + Math.floor(this.tick / TICK_HZ);
  }

  get day(): number {
    return Math.floor(this.gameMinute / MINUTES_PER_DAY);
  }

  /** One 100 ms step. Changes are written into the open frame. */
  step(w: FrameWriter): void {
    const dayBefore = this.day;
    this.tick++;
    if (this.day !== dayBefore) w.world(0, 0, this.day);
  }
}
