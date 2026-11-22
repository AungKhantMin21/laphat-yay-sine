// Reaction bubbles: a short line above a customer who was just served ("great!" + kyat paid).
// Placed once at the customer's head; the float and fade are a CSS animation, so nothing runs per frame.
import './pour.css';
import { REACTION_NAMES } from '../../shared/drinks';
import { t } from '../i18n';

/** Bubbles shown at once; the oldest is reused when more customers are served together. */
const POOL = 6;
const LIFE_MS = 2300;

export interface ReactionDeps {
  /** CSS position of the customer's head, or null when off screen / gone. */
  anchor: (id: number) => { x: number; y: number } | null;
}

export function installReactions(deps: ReactionDeps): { show(id: number, reaction: number, paid: number): void } {
  const ui = document.getElementById('ui')!;
  const items: { box: HTMLDivElement; text: HTMLSpanElement; paid: HTMLSpanElement; timer: number }[] = [];
  for (let i = 0; i < POOL; i++) {
    const box = document.createElement('div');
    box.className = 'react hidden';
    const text = document.createElement('span');
    const paid = document.createElement('span');
    paid.className = 'paid';
    box.append(text, paid);
    ui.append(box);
    items.push({ box, text, paid, timer: 0 });
  }
  let next = 0;

  return {
    show(id, reaction, paid) {
      const at = deps.anchor(id);
      if (!at) return;
      const it = items[next]!;
      next = (next + 1) % POOL;
      it.text.textContent = t(`react.${REACTION_NAMES[reaction] ?? 'ok'}`);
      it.paid.textContent = paid > 0 ? t('pour.paid', { n: paid }) : '';
      it.box.style.left = `${Math.round(at.x)}px`;
      it.box.style.top = `${Math.round(at.y)}px`;
      // Restart the CSS animation.
      it.box.classList.add('hidden');
      void it.box.offsetWidth;
      it.box.classList.remove('hidden');
      clearTimeout(it.timer);
      it.timer = window.setTimeout(() => it.box.classList.add('hidden'), LIFE_MS);
    },
  };
}
