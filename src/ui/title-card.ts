// Game title shown over the street at boot, then faded out.
import { t } from './i18n';

export function showTitleCard(holdMs = 2500): void {
  const ui = document.getElementById('ui');
  if (!ui) return;
  const el = document.createElement('h1');
  el.className = 'title-card';
  el.textContent = t('game.title');
  ui.appendChild(el);
  setTimeout(() => el.classList.add('gone'), holdMs);
  el.addEventListener('transitionend', () => el.remove());
}

/** Debug: a line of hard Myanmar shaping cases to eyeball on each device. */
export function showFontSample(): void {
  const ui = document.getElementById('ui');
  if (!ui) return;
  const el = document.createElement('p');
  el.className = 'font-sample';
  el.textContent = t('debug.fontSample');
  ui.appendChild(el);
}
