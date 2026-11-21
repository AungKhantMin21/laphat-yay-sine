// The simulation core: plain TypeScript, no Worker globals, so Vitest can run it headless.
import type { FrameWriter } from '../shared/diff';
import { TICK_HZ } from '../shared/protocol';
import { createStreams, type Rng, type StreamName } from '../shared/rng';
import { MINUTES_PER_DAY, START_MINUTE } from '../shared/layout';

export class Sim {
  /** Steps since the save began; always advances (frame headers, timers). */
  tick = 0;
  /**
   * Game time in ticks since `startMinute`. It stands still while the shop day holds the clock
   * (morning before opening, evening before sleep) and jumps forward on sleep.
   * 10 clock ticks = 1 game minute = 1 real second.
   */
  clock = 0;
  readonly rng: Record<StreamName, Rng>;
  /** Last day announced in a frame (−1 = never). */
  private sentDay = -1;

  constructor(
    readonly seed: number,
    private readonly startMinute = START_MINUTE,
  ) {
    this.rng = createStreams(seed);
  }

  get gameMinute(): number {
    return this.startMinute + Math.floor(this.clock / TICK_HZ);
  }

  get day(): number {
    return Math.floor(this.gameMinute / MINUTES_PER_DAY);
  }

  /** Moves the clock to `gameMinute` (never backwards). */
  jumpTo(gameMinute: number): void {
    const target = (gameMinute - this.startMinute) * TICK_HZ;
    if (target > this.clock) this.clock = target;
  }

  /** One 100 ms step; `advance` = false holds the game clock. Changes are written into the open frame. */
  step(w: FrameWriter, advance = true): void {
    this.tick++;
    if (advance) this.clock++;
    const day = this.day;
    if (day !== this.sentDay) {
      if (this.sentDay >= 0) w.world(0, 0, day);
      this.sentDay = day;
    }
  }
}
