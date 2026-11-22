// The player's queued jobs (M2.5): up to three numbered markers over each job's place (the customer,
// the cup, the sink). Tapping a marker cancels that job. A short toast says why a tap did nothing.
// Markers move only when their anchor moves by a whole CSS pixel; nothing is allocated per frame.
import './queue.css';
import { myDigits, t } from '../i18n';

export interface QueueDeps {
  /** The player's queue (task handles, first = in progress). */
  queue: () => readonly number[];
  /** CSS position where job `task`'s marker goes (into `out`); false when off screen. */
  anchor: (task: number, out: { x: number; y: number }) => boolean;
  cancel: (task: number) => void;
}

export interface QueueUi {
  /** Call every frame. */
  update(): void;
  /** A short message (i18n key) at the bottom of the screen. */
  toast(key: string): void;
}

const SLOTS = 3;
const TOAST_MS = 2200;

export function installQueue(deps: QueueDeps): QueueUi {
  const ui = document.getElementById('ui')!;
  const marks: { el: HTMLButtonElement; task: number; x: number; y: number }[] = [];
  for (let k = 0; k < SLOTS; k++) {
    const el = document.createElement('button');
    el.className = 'qmark hidden';
    el.setAttribute('aria-label', t('queue.cancel'));
    const num = document.createElement('span');
    num.textContent = myDigits(String(k + 1));
    el.append(num);
    const m = { el, task: 0, x: -1, y: -1 };
    el.addEventListener('pointerdown', (e) => e.stopPropagation()); // not a world tap
    el.addEventListener('click', (e) => {
      e.stopPropagation();
      if (m.task) deps.cancel(m.task);
    });
    ui.append(el);
    marks.push(m);
  }
  const toastEl = document.createElement('div');
  toastEl.className = 'svc-toast hidden';
  toastEl.setAttribute('role', 'status');
  ui.append(toastEl);
  let toastTimer = 0;
  const at = { x: 0, y: 0 };

  return {
    update() {
      const q = deps.queue();
      for (let k = 0; k < SLOTS; k++) {
        const m = marks[k]!;
        const task = k < q.length ? q[k]! : 0;
        if (task !== m.task) {
          m.task = task;
          m.el.classList.toggle('current', k === 0);
        }
        const show = task !== 0 && deps.anchor(task, at);
        if (!show) {
          if (m.x !== -1) {
            m.el.classList.add('hidden');
            m.x = m.y = -1;
          }
          continue;
        }
        const x = Math.round(at.x);
        const y = Math.round(at.y) - k * 2; // markers on one spot fan out a little
        if (x === m.x && y === m.y) continue;
        if (m.x === -1) m.el.classList.remove('hidden');
        m.x = x;
        m.y = y;
        m.el.style.transform = `translate(${x}px, ${y}px)`;
      }
    },
    toast(key) {
      toastEl.textContent = t(key);
      toastEl.classList.remove('hidden');
      clearTimeout(toastTimer);
      toastTimer = window.setTimeout(() => toastEl.classList.add('hidden'), TOAST_MS);
    },
  };
}
