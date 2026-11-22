// Pour minigame (DOM overlay). Opens when the player taps a customer's order bubble.
// Hold the button (or Space) to pour tea, release; hold again to pour condensed milk, release →
// the cup is served. No timer; Cancel (or Escape) is always there.
// The worker scores the cup (shared/drinks.ts) and answers with a `served` event (reaction bubble).
import './pour.css';
import { DRINKS } from '../../shared/drinks';
import type { AckResult } from '../../game/bridge';
import { t } from '../i18n';
import { PourModel, STAGE } from './pour-model';

export interface PourDeps {
  startPour: (id: number) => Promise<AckResult>;
  cancelPour: (id: number) => void;
  serve: (id: number, tea: number, milk: number) => Promise<AckResult>;
  /** Called on open/close (e.g. to hide other HUD). */
  onChange?: (open: boolean) => void;
}

export interface PourUi {
  readonly isOpen: boolean;
  /** Opens for customer `id` (NPC handle) who ordered drink `drink`. */
  open(id: number, drink: number): void;
  /** Closes without serving (the customer keeps waiting). */
  close(): void;
}

/** Cup inside height in art pixels; the liquid moves in whole art pixels. */
const CUP_PX = 24;
/** CSS px per art pixel. */
const PX = 4;
/** Liquid colours from art/palette.hex, dark tea → creamy, by milk share. */
const LIQUID = ['#523a2c', '#6e4e36', '#8a6644', '#a98258', '#c8a46e', '#dab886', '#ecd3a5'];
/** Milk share that reaches the last (creamiest) colour. */
const CREAMIEST = 0.6;
const HEIGHTS = Array.from({ length: CUP_PX + 1 }, (_, n) => `${n * PX}px`);

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls: string): HTMLElementTagNameMap[K] => {
  const e = document.createElement(tag);
  e.className = cls;
  return e;
};

export function installPourUi(deps: PourDeps): PourUi {
  const ui = document.getElementById('ui')!;
  const root = el('div', 'pour hidden');
  const panel = el('div', 'pour-panel');
  const cup = el('div', 'pour-cup');
  cup.style.height = HEIGHTS[CUP_PX]!;
  const liquid = el('div', 'pour-liquid');
  const mark = el('div', 'pour-mark');
  cup.append(liquid, mark);
  const side = el('div', 'pour-side');
  const title = el('div', 'pour-title');
  const hint = el('div', 'pour-hint');
  const holdBtn = el('button', 'hud-btn primary pour-hold');
  const cancelBtn = el('button', 'hud-btn pour-cancel');
  cancelBtn.textContent = t('pour.cancel');
  const msg = el('div', 'pour-msg hidden');
  side.append(title, hint, holdBtn, cancelBtn);
  panel.append(cup, side);
  root.append(panel, msg);
  ui.append(root);

  let id = 0;
  let model: PourModel | null = null;
  let busy = false;
  let raf = 0;
  let last = 0;
  let shownH = -1;
  let shownC = -1;
  let shownMark = -1;
  let msgTimer = 0;

  function say(key: string): void {
    msg.textContent = t(key);
    msg.classList.remove('hidden');
    clearTimeout(msgTimer);
    msgTimer = window.setTimeout(() => msg.classList.add('hidden'), 2200);
  }

  /** Writes the cup to the DOM, only where a whole art pixel or colour step changed. */
  function draw(): void {
    const m = model;
    if (!m) return;
    const h = Math.round(m.fill * CUP_PX);
    if (h !== shownH) {
      shownH = h;
      liquid.style.height = HEIGHTS[h]!;
    }
    const c = Math.min(LIQUID.length - 1, Math.round((m.share / CREAMIEST) * (LIQUID.length - 1)));
    if (c !== shownC) {
      shownC = c;
      liquid.style.background = LIQUID[c]!;
    }
    const mk = m.stage === STAGE.done ? -1 : Math.round(m.target() * CUP_PX);
    if (mk !== shownMark) {
      shownMark = mk;
      mark.classList.toggle('hidden', mk < 0);
      if (mk >= 0) mark.style.bottom = HEIGHTS[mk]!;
    }
  }

  function label(): void {
    const m = model;
    if (!m) return;
    const tea = m.stage === STAGE.tea;
    hint.textContent = t(tea ? 'pour.holdTea' : 'pour.holdMilk');
    holdBtn.textContent = t(tea ? 'pour.tea' : 'pour.milk');
    root.dataset.stage = tea ? 'tea' : 'milk';
  }

  function frame(now: number): void {
    raf = 0;
    const m = model;
    if (!m || !m.holding) return;
    m.advance((now - last) / 1000);
    last = now;
    draw();
    raf = requestAnimationFrame(frame);
  }

  function press(): void {
    if (busy || !model || !model.press()) return;
    root.classList.add('holding');
    last = performance.now();
    if (!raf) raf = requestAnimationFrame(frame);
  }

  function release(): void {
    const m = model;
    if (!m || !m.holding) return;
    // Pour up to the moment of release.
    m.advance((performance.now() - last) / 1000);
    m.release();
    root.classList.remove('holding');
    draw();
    if (m.stage === STAGE.done) void finish();
    else label();
  }

  async function finish(): Promise<void> {
    const m = model;
    if (!m || busy) return;
    busy = true;
    holdBtn.disabled = true;
    const r = await deps.serve(id, m.tea, m.milk);
    busy = false;
    holdBtn.disabled = false;
    hide();
    if (!r.ok) say(r.reason ?? 'pour.err.gone');
  }

  function hide(): void {
    if (!model) return;
    model = null;
    id = 0;
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
    root.classList.add('hidden');
    root.classList.remove('holding');
    deps.onChange?.(false);
  }

  function cancel(): void {
    if (!model || busy) return;
    const was = id;
    hide();
    deps.cancelPour(was);
  }

  // Pointer: hold on the button; capture so sliding off it still ends the pour on release.
  holdBtn.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    holdBtn.setPointerCapture(e.pointerId);
    press();
  });
  holdBtn.addEventListener('pointerup', release);
  holdBtn.addEventListener('pointercancel', release);
  holdBtn.addEventListener('lostpointercapture', release);
  holdBtn.addEventListener('contextmenu', (e) => e.preventDefault());
  cancelBtn.addEventListener('click', cancel);

  // Keys: capture on document so build-mode keys (on window) don't fire under the overlay.
  document.addEventListener(
    'keydown',
    (e) => {
      if (!model) return;
      e.stopPropagation();
      if (e.key === ' ' || e.code === 'Space') {
        e.preventDefault();
        if (!e.repeat) press();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        cancel();
      }
    },
    true,
  );
  document.addEventListener(
    'keyup',
    (e) => {
      if (!model) return;
      e.stopPropagation();
      if (e.key === ' ' || e.code === 'Space') {
        e.preventDefault();
        release();
      }
    },
    true,
  );
  // Losing focus mid-hold (alt-tab, notification) ends the pour instead of pouring forever.
  window.addEventListener('blur', release);

  return {
    get isOpen() {
      return model !== null;
    },
    open(customer: number, drink: number): void {
      const def = DRINKS.defs[drink];
      if (model || busy || !def) return;
      id = customer;
      model = new PourModel(def);
      shownH = shownC = shownMark = -1;
      title.textContent = t(def.name);
      label();
      draw();
      root.classList.remove('hidden');
      deps.onChange?.(true);
      busy = true;
      void deps.startPour(customer).then((r) => {
        busy = false;
        if (!r.ok && id === customer) {
          hide();
          say(r.reason ?? 'pour.err.gone');
        }
      });
    },
    close: cancel,
  };
}
