// Main-thread frame loop: rAF, fixed-step update, interpolated render, fps cap, idle drop,
// and a full stop while the tab is hidden. No allocation per frame.
import { fixedSteps, paceFrame } from './pacing';

export interface LoopHooks {
  /** Fixed-step main-thread update (camera easing, animation clocks). */
  update(stepMs: number): void;
  /** alpha = fraction of the next fixed step already elapsed, for interpolation. */
  render(alpha: number, now: number): void;
  onHidden?(): void;
  /** awayMs: how long the tab was hidden. */
  onVisible?(awayMs: number): void;
}

export const STATS_SIZE = 120;

/** Ring buffers read by the perf overlay. */
export interface FrameStats {
  /** Time between rendered frames (ms). */
  interval: Float32Array;
  /** Main-thread work per rendered frame: update + render (ms). */
  work: Float32Array;
  index: number;
  count: number;
}

export class FrameLoop {
  readonly stats: FrameStats = {
    interval: new Float32Array(STATS_SIZE),
    work: new Float32Array(STATS_SIZE),
    index: 0,
    count: 0,
  };
  private maxFps = 60;
  private idleFps = 30;
  private idle = false;
  private raf = 0;
  private running = false;
  private lastRender = 0;
  private lastUpdate = 0;
  private hiddenAt = 0;
  private readonly acc = { t: 0 };

  constructor(
    private readonly hooks: LoopHooks,
    private readonly stepMs = 1000 / 60,
  ) {
    document.addEventListener('visibilitychange', this.onVisibility);
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.lastRender = this.lastUpdate = performance.now();
    this.acc.t = 0;
    this.raf = requestAnimationFrame(this.tick);
  }

  stop(): void {
    this.running = false;
    cancelAnimationFrame(this.raf);
  }

  /** 60 normally; 30 on the Low tier. Also caps 90/120 Hz screens. */
  setMaxFps(fps: number): void {
    this.maxFps = fps;
  }

  /** Idle screens (menus, nothing moving) drop to idleFps. */
  setIdle(idle: boolean): void {
    this.idle = idle;
  }

  private readonly tick = (now: number): void => {
    if (!this.running) return;
    this.raf = requestAnimationFrame(this.tick);

    const cap = this.idle ? Math.min(this.idleFps, this.maxFps) : this.maxFps;
    const next = paceFrame(now, this.lastRender, cap);
    if (next < 0) return;
    const interval = now - this.lastRender;
    this.lastRender = next;

    const t0 = performance.now();
    const steps = fixedSteps(this.acc, now - this.lastUpdate, this.stepMs);
    this.lastUpdate = now;
    for (let i = 0; i < steps; i++) this.hooks.update(this.stepMs);
    this.hooks.render(this.acc.t / this.stepMs, now);
    const work = performance.now() - t0;

    const s = this.stats;
    s.interval[s.index] = interval;
    s.work[s.index] = work;
    s.index = (s.index + 1) % STATS_SIZE;
    if (s.count < STATS_SIZE) s.count++;
  };

  private readonly onVisibility = (): void => {
    if (document.visibilityState === 'hidden') {
      this.hiddenAt = Date.now();
      cancelAnimationFrame(this.raf);
      this.hooks.onHidden?.();
    } else if (this.running) {
      const away = this.hiddenAt ? Date.now() - this.hiddenAt : 0;
      this.lastRender = this.lastUpdate = performance.now();
      this.acc.t = 0;
      this.raf = requestAnimationFrame(this.tick);
      this.hooks.onVisible?.(away);
    }
  };
}
