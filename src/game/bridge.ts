// The only code that talks to the simulation Worker.
import { readFrame } from '../shared/diff';
import { PROTOCOL_VERSION, TICK_MS, type Action, type AwaySummary, type FromSim, type PlayerState, type SimEvent, type Tier, type ToSim } from '../shared/protocol';
import type { WorldView } from './view';

export interface BridgeHandlers {
  onReady?(): void;
  onEvents?(list: SimEvent[]): void;
  onAway?(summary: AwaySummary): void;
  onCatchup?(done: number, total: number): void;
  onState?(state: PlayerState): void;
}

export interface AckResult {
  ok: boolean;
  /** i18n key when refused. */
  reason?: string;
  /** Handle of the placed/moved object. */
  id?: number;
}

export class SimBridge {
  private readonly worker: Worker;
  private seq = 0;
  private readonly pending = new Map<number, (r: AckResult) => void>();
  /** Latest money / inventory / undo state from the worker. */
  player: PlayerState | null = null;
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

  init(tier: Tier, seed?: number): void {
    this.send({ t: 'init', v: PROTOCOL_VERSION, tier, nowMs: Date.now(), saveSlot: 0, seed });
  }

  /** Pause (menus, hidden tab) or resume. Resuming may trigger offline catch-up. */
  setRunning(running: boolean): void {
    this.send({ t: 'clock', running, nowMs: Date.now() });
  }

  setTier(tier: Tier): void {
    this.send({ t: 'tier', tier });
  }

  /** Sends a player action; resolves when the worker accepts or refuses it. */
  act(a: Action): Promise<AckResult> {
    const seq = ++this.seq;
    this.send({ t: 'act', seq, a });
    return new Promise((resolve) => this.pending.set(seq, resolve));
  }

  /** Debug: add items to the inventory. */
  give(type: number, qty: number): void {
    this.send({ t: 'give', type, qty });
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
      case 'ack': {
        const done = this.pending.get(msg.seq);
        this.pending.delete(msg.seq);
        done?.({ ok: msg.ok, reason: msg.reason, id: msg.id });
        return;
      }
      case 'state':
        this.player = msg.state;
        this.handlers.onState?.(msg.state);
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
