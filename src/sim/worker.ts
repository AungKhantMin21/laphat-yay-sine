// Worker entry: messaging, timing and saving. The game itself lives in game.ts.
import { FrameWriter } from '../shared/diff';
import { PROTOCOL_VERSION, TICK_MS, type FromSim, type ToSim } from '../shared/protocol';
import { Game } from './game';
import { catchupDays } from './catchup';
import { fromCode, loadSlot, saveSlot, toCode } from './save/store';

const ctx = self as unknown as DedicatedWorkerGlobalScope;

const FRAME_BYTES = 64 * 1024;
const POOL_MAX = 8;
/** If the worker falls behind, run at most this many steps per wake-up, then drop the backlog. */
const MAX_STEPS = 5;
/** Save this long after the last build change. */
const BUILD_SAVE_DELAY_MS = 5000;

const writer = new FrameWriter();
const pool: ArrayBuffer[] = [];
let game: Game | null = null;
let slot = 0;
let running = false;
let timer: ReturnType<typeof setTimeout> | 0 = 0;
let nextAt = 0;
let pausedAtMs = 0;
let lastHour = -1;
/** performance.now() of the first unsaved build change (0 = nothing pending). */
let dirtyAt = 0;
let saving: Promise<void> = Promise.resolve();

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
    postEvents();
    postStateIfChanged();
  }
  // Autosave: every game hour, and a few seconds after building.
  const hour = Math.floor(sim.gameMinute / 60);
  if (lastHour >= 0 && hour !== lastHour) save('auto');
  else if (dirtyAt && t0 - dirtyAt > BUILD_SAVE_DELAY_MS) save('auto');
  lastHour = hour;
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

/** Sends object changes right away (after a build action) instead of waiting for the next tick. */
function flushChanges(): void {
  if (!game) return;
  writer.begin(takeBuffer(), game.sim.tick, game.sim.gameMinute);
  game.world.writeChanges(writer);
  const buf = writer.finish();
  post({ t: 'frame', buf }, [buf]);
}

function postStateIfChanged(): void {
  if (!game || !game.takeChanged()) return;
  post({ t: 'state', state: game.playerState() });
}

/** Sends queued sim events (day end, money…). */
function postEvents(): void {
  if (!game || game.events.length === 0) return;
  post({ t: 'events', list: game.events.splice(0) });
}

/** Saves are queued so two never overlap. Failures are reported, never thrown. */
function save(reason: string): void {
  if (!game) return;
  const data = game.toSave(Date.now());
  dirtyAt = 0;
  saving = saving
    .then(() => saveSlot(slot, data))
    .then(
      () => post({ t: 'saved', reason, ok: true }),
      (e: unknown) => post({ t: 'saved', reason: `${reason}: ${e instanceof Error ? e.message : String(e)}`, ok: false }),
    );
}

/** Sends a full snapshot so the main thread rebuilds its mirror (boot and import). */
function sendSnapshot(): void {
  if (!game) return;
  writer.begin(new ArrayBuffer(FRAME_BYTES), game.sim.tick, game.sim.gameMinute);
  const area = game.world.state.area;
  writer.world(0, 0, game.sim.day);
  game.writeSnapshot(writer);
  const snapshot = writer.finish();
  post({ t: 'ready', v: PROTOCOL_VERSION, area: area.id, w: area.w, h: area.h, snapshot }, [snapshot]);
  game.markChanged();
  postStateIfChanged();
}

function newSeed(): number {
  return crypto.getRandomValues(new Uint32Array(1))[0]!;
}

async function boot(msg: Extract<ToSim, { t: 'init' }>): Promise<void> {
  slot = msg.saveSlot;
  let fresh = true;
  let awayDays = 0;
  let skipped = 0;
  if (msg.seed === undefined) {
    try {
      const r = await loadSlot(slot);
      if (r.kind === 'ok') {
        const loaded = Game.fromSave(r.data);
        game = loaded.game;
        skipped = loaded.skipped;
        fresh = false;
        awayDays = catchupDays(msg.nowMs - r.data.savedAt);
      } else if (r.kind === 'broken') {
        post({ t: 'error', msg: `save could not be read (kept aside): ${r.error}` });
      }
    } catch (e) {
      // Storage unavailable (private mode, blocked): play without saving rather than not at all.
      post({ t: 'error', msg: `storage unavailable: ${e instanceof Error ? e.message : String(e)}` });
    }
  }
  game ??= Game.create(msg.seed ?? newSeed());
  for (let i = pool.length; i < 4; i++) pool.push(new ArrayBuffer(FRAME_BYTES));
  sendSnapshot();
  post({ t: 'loaded', fresh, awayDays, skipped });
  if (awayDays > 0) {
    // M4 runs the abstract simulation here, one game day per slice.
    for (let d = 1; d <= awayDays; d++) post({ t: 'catchup', done: d, total: awayDays });
    post({ t: 'away', summary: { realMs: 0, days: awayDays, events: [] } });
  }
  if (fresh) save('new');
  lastHour = Math.floor(game.sim.gameMinute / 60);
  start();
}

ctx.onmessage = (e: MessageEvent<ToSim>): void => {
  const msg = e.data;
  switch (msg.t) {
    case 'init':
      if (msg.v !== PROTOCOL_VERSION) {
        post({ t: 'error', msg: `protocol ${msg.v} != worker ${PROTOCOL_VERSION}`, fatal: true });
        return;
      }
      void boot(msg);
      return;
    case 'clock': {
      if (!msg.running) {
        if (running) pausedAtMs = msg.nowMs;
        stop();
        return;
      }
      if (running || !game) return;
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
      if (r.ok) {
        flushChanges();
        dirtyAt ||= performance.now();
      }
      post({ t: 'ack', seq: msg.seq, ok: r.ok, reason: r.reason, id: r.index ? game.world.objects.handle(r.index) : undefined });
      postEvents();
      postStateIfChanged();
      // A finished day is a natural stopping point: save it now.
      if (r.ok && msg.a.k === 'sleep') save('sleep');
      return;
    }
    case 'give':
      game?.builder.give(msg.type, msg.qty);
      dirtyAt ||= performance.now();
      postStateIfChanged();
      return;
    case 'jump':
      game?.sim.jumpTo(msg.minute);
      return;
    case 'save':
      save(msg.reason);
      return;
    case 'exportSave':
      if (game) post({ t: 'exported', code: toCode(game.toSave(Date.now())) });
      return;
    case 'importSave': {
      let data;
      try {
        data = fromCode(msg.code);
      } catch {
        post({ t: 'imported', ok: false, reason: 'settings.importBad' });
        return;
      }
      game = Game.fromSave(data).game;
      sendSnapshot();
      save('import');
      post({ t: 'imported', ok: true });
      return;
    }
    case 'subscribe':
      game?.world.subscribe(msg.grids);
      flushChanges();
      return;
    case 'tier':
      return; // M4: LOD caps
    case 'viewport':
      return; // M3/M4
  }
};
