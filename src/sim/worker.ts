// Worker entry: messaging and timing only. The simulation itself lives in sim.ts.
import { FrameWriter } from '../shared/diff';
import { PROTOCOL_VERSION, TICK_MS, type FromSim, type ToSim } from '../shared/protocol';
import { Game } from './game';
import { catchupDays } from './catchup';

const ctx = self as unknown as DedicatedWorkerGlobalScope;

const FRAME_BYTES = 64 * 1024;
const POOL_MAX = 8;
/** If the worker falls behind, run at most this many steps per wake-up, then drop the backlog. */
const MAX_STEPS = 5;

const writer = new FrameWriter();
const pool: ArrayBuffer[] = [];
let game: Game | null = null;
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
  if (!running || !game) return;
  const sim = game.sim;
  const t0 = performance.now();
  let steps = 0;
  writer.begin(takeBuffer(), sim.tick, sim.gameMinute);
  while (t0 >= nextAt && steps < MAX_STEPS) {
    game.step(writer);
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

/** Sends object changes right away (after a build action) instead of waiting for the next tick. */
function flushChanges(): void {
  if (!game) return;
  writer.begin(takeBuffer(), game.sim.tick, game.sim.gameMinute);
  game.world.writeChanges(writer);
  const buf = writer.finish();
  post({ t: 'frame', buf }, [buf]);
}

function postStateIfChanged(): void {
  if (!game || !game.builder.changed) return;
  game.builder.changed = false;
  post({ t: 'state', state: game.playerState() });
}

function newSeed(): number {
  return crypto.getRandomValues(new Uint32Array(1))[0]!;
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
      game = Game.create(msg.seed ?? newSeed()); // M1.10: load the save in msg.saveSlot first
      for (let i = pool.length; i < 4; i++) pool.push(new ArrayBuffer(FRAME_BYTES));
      writer.begin(new ArrayBuffer(FRAME_BYTES), game.sim.tick, game.sim.gameMinute);
      const area = game.world.state.area;
      writer.world(0, 0, game.sim.day);
      game.world.writeSnapshot(writer);
      const snapshot = writer.finish();
      post({ t: 'ready', v: PROTOCOL_VERSION, area: area.id, w: area.w, h: area.h, snapshot }, [snapshot]);
      postStateIfChanged();
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
    case 'act': {
      if (!game) return;
      const r = game.act(msg.a);
      if (r.ok) flushChanges();
      post({ t: 'ack', seq: msg.seq, ok: r.ok, reason: r.reason, id: r.index ? game.world.objects.handle(r.index) : undefined });
      postStateIfChanged();
      return;
    }
    case 'give':
      game?.builder.give(msg.type, msg.qty);
      postStateIfChanged();
      return;
    case 'save':
      post({ t: 'saved', reason: msg.reason, ok: false }); // M1
      return;
    case 'tier':
      return; // M4: LOD caps
    case 'viewport':
    case 'subscribe':
      return; // M3/M4
  }
};
