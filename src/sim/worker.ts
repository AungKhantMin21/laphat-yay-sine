// Worker entry: messaging and timing only. The simulation itself lives in sim.ts.
import { FrameWriter } from '../shared/diff';
import { PROTOCOL_VERSION, TICK_MS, type FromSim, type ToSim } from '../shared/protocol';
import { M0_AREA_H, M0_AREA_W } from '../shared/layout';
import { Sim } from './sim';
import { catchupDays } from './catchup';

const ctx = self as unknown as DedicatedWorkerGlobalScope;

const FRAME_BYTES = 64 * 1024;
const POOL_MAX = 8;
/** If the worker falls behind, run at most this many steps per wake-up, then drop the backlog. */
const MAX_STEPS = 5;

const writer = new FrameWriter();
const pool: ArrayBuffer[] = [];
let sim: Sim | null = null;
let running = false;
let timer: ReturnType<typeof setTimeout> | 0 = 0;
let nextAt = 0;
let pausedAtMs = 0;

function post(msg: FromSim, transfer?: Transferable[]): void {
  if (transfer) ctx.postMessage(msg, transfer);
  else ctx.postMessage(msg);
}

function takeBuffer(): ArrayBuffer {
  // Main normally returns every buffer within a frame; allocate only if it is stalled.
  return pool.pop() ?? new ArrayBuffer(FRAME_BYTES);
}

function wake(): void {
  timer = 0;
  if (!running || !sim) return;
  const t0 = performance.now();
  let steps = 0;
  writer.begin(takeBuffer(), sim.tick, sim.gameMinute);
  while (t0 >= nextAt && steps < MAX_STEPS) {
    sim.step(writer);
    nextAt += TICK_MS;
    steps++;
  }
  if (steps === MAX_STEPS && t0 >= nextAt) nextAt = t0 + TICK_MS; // drop backlog
  if (steps > 0) {
    writer.setClock(sim.tick, sim.gameMinute); // header carries the clock after stepping
    const buf = writer.finish((performance.now() - t0) * 100);
    post({ t: 'frame', buf }, [buf]);
  }
  schedule();
}

function schedule(): void {
  if (!running || timer) return;
  timer = setTimeout(wake, Math.max(0, nextAt - performance.now()));
}

function start(): void {
  if (running) return;
  running = true;
  nextAt = performance.now() + TICK_MS;
  schedule();
}

function stop(): void {
  running = false;
  if (timer) clearTimeout(timer);
  timer = 0;
}

ctx.onmessage = (e: MessageEvent<ToSim>): void => {
  const msg = e.data;
  switch (msg.t) {
    case 'init': {
      if (msg.v !== PROTOCOL_VERSION) {
        post({ t: 'error', msg: `protocol ${msg.v} != worker ${PROTOCOL_VERSION}`, fatal: true });
        return;
      }
      sim = new Sim(msg.seed);
      for (let i = pool.length; i < 4; i++) pool.push(new ArrayBuffer(FRAME_BYTES));
      writer.begin(new ArrayBuffer(FRAME_BYTES), sim.tick, sim.gameMinute);
      writer.world(0, 0, sim.day);
      const snapshot = writer.finish();
      post({ t: 'ready', v: PROTOCOL_VERSION, area: 0, w: M0_AREA_W, h: M0_AREA_H, snapshot }, [snapshot]);
      start();
      return;
    }
    case 'clock': {
      if (!msg.running) {
        if (running) pausedAtMs = msg.nowMs;
        stop();
        return;
      }
      if (running) return;
      const away = pausedAtMs ? msg.nowMs - pausedAtMs : 0;
      pausedAtMs = 0;
      const days = catchupDays(away);
      if (days > 0) {
        // M4 runs the abstract simulation here, one game day per slice.
        for (let d = 1; d <= days; d++) post({ t: 'catchup', done: d, total: days });
        post({ t: 'away', summary: { realMs: away, days, events: [] } });
      }
      start();
      return;
    }
    case 'recycle':
      if (pool.length < POOL_MAX && msg.buf.byteLength >= FRAME_BYTES) pool.push(msg.buf);
      return;
    case 'act':
      post({ t: 'ack', seq: msg.seq, ok: false, reason: 'error.notYet' });
      return;
    case 'save':
      post({ t: 'saved', reason: msg.reason, ok: false }); // M1
      return;
    case 'viewport':
    case 'subscribe':
      return; // M3/M4
  }
};
