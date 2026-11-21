// Build mode HUD (DOM): toggle, money, inventory drawer, action column, colour swatches, toasts.
// Reads the controller and the player state; never touches Pixi. Rebuilt only on change.
import './build.css';
import type { BuildController } from '../../game/build-mode';
import type { PlayerState } from '../../shared/protocol';
import { CATALOG } from '../../shared/catalog';
import { formatNumber, t } from '../i18n';

export interface IconInfo {
  url: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

const ICON_BOX = 48;

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', text = ''): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text) e.textContent = text;
  return e;
}

function button(label: string, sym: string, cls = ''): HTMLButtonElement {
  const b = el('button', `hud-btn ${cls}`);
  if (sym) b.appendChild(el('span', 'sym', sym));
  b.appendChild(document.createTextNode(label));
  return b;
}

const hex = (c: number): string => `#${c.toString(16).padStart(6, '0')}`;

export function installBuildUi(ctl: BuildController, getPlayer: () => PlayerState | null, iconFor: (type: number) => IconInfo | null): { refresh(): void } {
  const ui = document.getElementById('ui')!;
  const money = el('div', 'money');
  const toggle = button(t('build.open'), '⚒', 'build-toggle');
  const drawer = el('section', 'drawer');
  const list = el('ul');
  drawer.append(el('h2', '', t('build.inventory')), list);
  const actions = el('div', 'actions');
  const toast = el('div', 'toast hidden');
  ui.append(money, drawer, actions, toggle, toast);

  toggle.addEventListener('click', () => ctl.toggle());
  let lastInv = '';
  let toastTimer = 0;
  let lastMessageAt = 0;

  function renderDrawer(p: PlayerState | null): void {
    const inv = p?.inventory ?? [];
    const key = `${inv.join(',')}|${ctl.mode === 'place' ? ctl.type : -1}`;
    if (key === lastInv) return;
    lastInv = key;
    list.textContent = '';
    let any = false;
    for (const def of CATALOG.defs) {
      const n = inv[def.id] ?? 0;
      if (n <= 0) continue;
      any = true;
      const li = el('li');
      const b = el('button');
      if (ctl.mode === 'place' && ctl.type === def.id) b.classList.add('on');
      const icon = el('span', 'icon');
      const info = iconFor(def.id);
      if (info) {
        const s = Math.max(1, Math.floor(Math.min(ICON_BOX / info.w, ICON_BOX / info.h)));
        const i = el('i');
        i.style.width = `${info.w * s}px`;
        i.style.height = `${info.h * s}px`;
        i.style.backgroundImage = `url(${info.url})`;
        i.style.backgroundSize = `${1024 * s}px ${1024 * s}px`;
        i.style.backgroundPosition = `${-info.x * s}px ${-info.y * s}px`;
        icon.appendChild(i);
      }
      b.append(icon, el('span', '', t(def.name)), el('span', 'count', `×${formatNumber(n)}`));
      b.addEventListener('click', () => ctl.choose(def.id));
      li.appendChild(b);
      list.appendChild(li);
    }
    if (!any) list.appendChild(el('li', 'empty', t('build.empty')));
  }

  function renderActions(p: PlayerState | null): void {
    actions.textContent = '';
    const m = ctl.mode;
    const add = (b: HTMLElement): void => {
      actions.appendChild(b);
    };
    const on = (b: HTMLButtonElement, fn: () => void, enabled = true): HTMLButtonElement => {
      b.disabled = !enabled;
      b.addEventListener('click', fn);
      return b;
    };

    if (m === 'place' || m === 'move') {
      add(on(button(t('build.rotate'), '↻'), () => ctl.rotate()));
      const row = el('div', 'row');
      row.append(
        on(button(t('build.cancel'), '✕'), () => ctl.cancel()),
        on(button(m === 'move' ? t('build.move') : t('build.place'), '✓', 'primary'), () => void ctl.confirm(), ctl.check.ok),
      );
      add(row);
    }
    if (m === 'selected') {
      add(on(button(t('build.rotate'), '↻'), () => ctl.rotate()));
      add(on(button(t('build.move'), '✥'), () => ctl.startMove()));
      add(on(button(t('build.pickup'), '⤓'), () => void ctl.pickup()));
      const sell = ctl.sellArmed ? button(t('build.sellFor', { n: ctl.sellPrice }), '✓', 'danger') : button(t('build.sell'), '₭', 'danger');
      add(on(sell, () => void ctl.sell()));
      add(on(button(t('build.cancel'), '✕'), () => ctl.cancel()));
    }
    // Colour swatches when the current thing can be recoloured.
    const type = m === 'selected' ? ctl.selectedType : m === 'place' || m === 'move' ? ctl.type : -1;
    const def = CATALOG.defs[type];
    if (def?.recolour) {
      const current = m === 'selected' ? ctl.selectedColour : ctl.colour;
      const sw = el('div', 'swatches');
      CATALOG.ramps.forEach((ramp, i) => {
        const b = el('button');
        b.style.background = `linear-gradient(135deg, ${hex(ramp[0]!)} 0 50%, ${hex(ramp[1]!)} 50% 100%)`;
        b.setAttribute('aria-label', `${t('build.colour')} ${i + 1}`);
        if (i === current) b.classList.add('on');
        b.addEventListener('click', () => ctl.setColour(i));
        sw.appendChild(b);
      });
      add(sw);
    }
    if (m !== 'off') {
      const row = el('div', 'row');
      row.append(
        on(button(t('build.undo'), '↶'), () => void ctl.undo(), p?.canUndo ?? false),
        on(button(t('build.redo'), '↷'), () => void ctl.redo(), p?.canRedo ?? false),
      );
      add(row);
    }
  }

  function refresh(): void {
    const p = getPlayer();
    money.textContent = t('money.kyat', { n: p?.money ?? 0 });
    const open = ctl.mode !== 'off';
    toggle.replaceChildren(el('span', 'sym', open ? '✓' : '⚒'), document.createTextNode(open ? t('build.close') : t('build.open')));
    drawer.style.display = open ? '' : 'none';
    actions.style.display = open ? '' : 'none';
    if (open) {
      renderDrawer(p);
      renderActions(p);
    } else lastInv = '';
    if (ctl.messageAt !== lastMessageAt && ctl.message) {
      lastMessageAt = ctl.messageAt;
      toast.textContent = t(ctl.message);
      toast.classList.remove('hidden');
      clearTimeout(toastTimer);
      toastTimer = window.setTimeout(() => toast.classList.add('hidden'), 2200);
    }
  }

  ctl.onChange(refresh);
  refresh();
  return { refresh };
}
