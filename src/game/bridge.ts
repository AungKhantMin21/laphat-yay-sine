// The only code that talks to the simulation Worker.
import { readFrame } from '../shared/diff';
import { PROTOCOL_VERSION, TICK_MS, type Action, type AwaySummary, type FromSim, type SimEvent, type Tier, type ToSim } from '../shared/protocol';
import type { WorldView } from './view';

export interface BridgeHandlers {
  onReady?(): void;
  onEvents?(list: SimEvent[]): void;
  onAway?(summary: AwaySummary): void;
  onCatchup?(done: number, total: number): void;
  onAck?(seq: number, ok: boolean, reason?: string, id?: number): void;
}

export class SimBridge {
  private readonly worker: Worker;
  private seq = 0;
  /** performance.now() when the latest frame arrived; drives interpolation. */
  private frameAt = 0;
  private ready = false;
  framesReceived = 0;

  constructor(
    private readonly view: WorldView,
    private readonly handlers: BridgeHandlers = {},
  ) {
    this.worker = new Worker(new URL('../sim/worker.ts', import.meta.url), { type: 'module', name: 'sim' });
    this.worker.onmessage = (e: MessageEvent<FromSim>) => this.onMessage(e.data);
    this.worker.onerror = (e) => console.error('sim worker error', e.message);
  }

  init(seed: number, tier: Tier): void {
    this.send({ t: 'init', v: PROTOCOL_VERSION, seed, tier, nowMs: Date.now(), saveSlot: 0 });
  }

  /** Pause (menus, hidden tab) or resume. Resuming may trigger offline catch-up. */
  setRunning(running: boolean): void {
    this.send({ t: 'clock', running, nowMs: Date.now() });
  }

  setTier(tier: Tier): void {
    this.send({ t: 'tier', tier });
  }

  act(a: Action): number {
    const seq = ++this.seq;
    this.send({ t: 'act', seq, a });
    return seq;
  }

  save(reason: 'auto' | 'hidden' | 'manual'): void {
    this.send({ t: 'save', reason });
  }

  /** 0..1 progress from the last sim frame toward the next, for interpolating NPCs. */
  alpha(now: number): number {
    const a = (now - this.frameAt) / TICK_MS;
    return a < 0 ? 0 : a > 1 ? 1 : a;
  }

  get isReady(): boolean {
    return this.ready;
  }

  private send(msg: ToSim, transfer?: Transferable[]): void {
    if (transfer) this.worker.postMessage(msg, transfer);
    else this.worker.postMessage(msg);
  }

  private onMessage(msg: FromSim): void {
    switch (msg.t) {
      case 'frame':
        this.frameAt = performance.now();
        this.framesReceived++;
        readFrame(msg.buf, this.view);
        this.send({ t: 'recycle', buf: msg.buf }, [msg.buf]);
        return;
      case 'ready':
        this.view.setArea(msg.area, msg.w, msg.h);
        readFrame(msg.snapshot, this.view);
        this.ready = true;
        this.handlers.onReady?.();
        return;
      case 'events':
        this.handlers.onEvents?.(msg.list);
        return;
      case 'catchup':
        this.handlers.onCatchup?.(msg.done, msg.total);
        return;
      case 'away':
        this.handlers.onAway?.(msg.summary);
        return;
      case 'ack':
        this.handlers.onAck?.(msg.seq, msg.ok, msg.reason, msg.id);
        return;
      case 'saved':
        return;
      case 'error':
        console.error('sim:', msg.msg);
        // A version mismatch means a stale cached build: reload to get matching files.
        if (msg.fatal) location.reload();
        return;
    }
  }
}
