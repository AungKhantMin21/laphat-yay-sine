// Developer perf overlay (?debug=1, or F3 on desktop). Updates 4× a second, not every frame,
// so the overlay itself doesn't cost much. Developer-facing, so labels are English, not i18n.
import { STATS_SIZE, type FrameStats } from '../game/loop';
import type { Budget } from '../platform/tier-policy';

export interface PerfSource {
  stats: FrameStats;
  drawCalls(): number;
  textureBytes(): number;
  simWorkMs(): number;
  simFramesReceived(): number;
  budget(): Budget;
  /** Extra lines: tier, bench score, scale… */
  info(): string[];
}

const MB = 1024 * 1024;

function avg(a: Float32Array, n: number): number {
  let s = 0;
  for (let i = 0; i < n; i++) s += a[i]!;
  return n ? s / n : 0;
}

function pct(a: Float32Array, n: number, p: number): number {
  if (!n) return 0;
  const sorted = Array.from(a.subarray(0, n)).sort((x, y) => x - y);
  return sorted[Math.min(n - 1, Math.floor(n * p))]!;
}

export function installPerfOverlay(src: PerfSource): void {
  const el = document.createElement('pre');
  el.id = 'perf';
  el.style.cssText = [
    'position:fixed',
    'top:calc(env(safe-area-inset-top,0px) + 4px)',
    'left:calc(env(safe-area-inset-left,0px) + 4px)',
    'margin:0',
    'padding:6px 8px',
    'font:11px/1.35 ui-monospace,Menlo,monospace',
    'color:#f3e6cf',
    'background:rgba(20,14,12,.78)',
    'border-radius:4px',
    'pointer-events:none',
    'z-index:50',
    'white-space:pre',
  ].join(';');
  document.body.appendChild(el);

  let visible = true;
  window.addEventListener('keydown', (e) => {
    if (e.key === 'F3') {
      visible = !visible;
      el.style.display = visible ? '' : 'none';
      e.preventDefault();
    }
  });

  let lastSimFrames = src.simFramesReceived();
  let lastT = performance.now();
  const mark = (ok: boolean, s: string): string => (ok ? s : `${s} ✗`);

  setInterval(() => {
    if (!visible) return;
    const st = src.stats;
    const n = Math.min(st.count, STATS_SIZE);
    const b = src.budget();
    const interval = avg(st.interval, n);
    const fps = interval ? 1000 / interval : 0;
    const workAvg = avg(st.work, n);
    const workP95 = pct(st.work, n, 0.95);
    const p95Interval = pct(st.interval, n, 0.95);
    const dc = src.drawCalls();
    const tex = src.textureBytes() / MB;
    const mem = (performance as Performance & { memory?: { usedJSHeapSize: number } }).memory;
    const heap = mem ? mem.usedJSHeapSize / MB : -1;
    const now = performance.now();
    const simFrames = src.simFramesReceived();
    const simHz = ((simFrames - lastSimFrames) * 1000) / (now - lastT);
    lastSimFrames = simFrames;
    lastT = now;

    el.textContent = [
      mark(fps >= b.fps * 0.95, `fps     ${fps.toFixed(1)} (p95 ${p95Interval.toFixed(1)} ms)`),
      mark(workP95 <= b.frameMs, `frame   ${workAvg.toFixed(2)} ms avg, ${workP95.toFixed(2)} p95 / ${b.frameMs}`),
      mark(dc <= b.drawCalls, `draws   ${dc} / ${b.drawCalls}`),
      mark(tex <= b.textureMB, `texture ~${tex.toFixed(1)} MB / ${b.textureMB}`),
      heap < 0 ? 'heap    n/a' : mark(heap <= b.heapMB, `heap    ${heap.toFixed(1)} MB / ${b.heapMB}`),
      `sim     ${simHz.toFixed(1)} Hz, ${src.simWorkMs().toFixed(2)} ms/tick`,
      ...src.info(),
    ].join('\n');
  }, 250);
}
