// Shop-day HUD (DOM): the clock and the one day button — "open the shutters" in the morning,
// "sleep" in the evening. M2.7/M2.8 replace this with the savings tin, evening panel and sleep screen.
import './day-hud.css';
import type { PlayerState } from '../../shared/protocol';
import { PHASE } from '../../shared/day';
import { myDigits, t } from '../i18n';

export interface DayHudDeps {
  player: () => PlayerState | null;
  gameMinute: () => number;
  open: () => Promise<boolean>;
  sleep: () => Promise<boolean>;
}

export function installDayHud(deps: DayHudDeps): { refresh(): void; tick(): void } {
  const ui = document.getElementById('ui')!;
  const box = document.createElement('div');
  box.className = 'day-hud';
  const clock = document.createElement('div');
  clock.className = 'day-clock';
  const btn = document.createElement('button');
  btn.className = 'hud-btn primary day-btn hidden';
  box.append(clock, btn);
  ui.append(box);

  let busy = false;
  let shownMinute = -1;

  btn.addEventListener('click', async () => {
    const p = deps.player();
    if (busy || !p) return;
    busy = true;
    btn.disabled = true;
    try {
      if (p.phase === PHASE.morning) await deps.open();
      else if (p.phase === PHASE.evening) await deps.sleep();
    } finally {
      busy = false;
      btn.disabled = false;
    }
  });

  function refresh(): void {
    const p = deps.player();
    const phase = p?.phase;
    const label = phase === PHASE.morning ? t('day.open') : phase === PHASE.evening ? t('day.sleep') : '';
    btn.textContent = label;
    btn.classList.toggle('hidden', !label);
    box.dataset.phase = String(phase ?? '');
  }

  /** Call every frame; touches the DOM only when the game minute changes. */
  function tick(): void {
    const m = deps.gameMinute();
    if (m === shownMinute) return;
    shownMinute = m;
    const h = Math.floor(m / 60) % 24;
    const min = m % 60;
    const day = Math.floor(m / 1440) + 1;
    clock.textContent = t('day.clock', { day, time: myDigits(`${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`) });
  }

  return { refresh, tick };
}
