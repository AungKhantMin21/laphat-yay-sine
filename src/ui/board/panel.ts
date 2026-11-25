// The notice board (M4): today's listings (for sale / for rent, days left), with buy and rent
// buttons on the lots that join your shop, and your own spaces (a rented one can be given up in the
// evening). Opens when the player arrives (`atShop` with the board's site id) and closes when they
// walk away. All numbers come from PlayerState; the worker checks every action.
import { formatNumber, t } from '../i18n';
import { PHASE } from '../../shared/day';
import { LISTING, PS } from '../../shared/properties';
import type { Action, PlayerState } from '../../shared/protocol';
import '../shop/panel.css';

export interface BoardPanelHooks {
  player(): PlayerState | null;
  /** The player still stands at the board. */
  atBoard(): boolean;
  act(a: Action): Promise<{ ok: boolean; reason?: string }>;
  toast(key: string): void;
}

export class BoardPanel {
  private readonly root: HTMLElement;
  private readonly list: HTMLElement;
  private timer = 0;
  private open_ = false;
  private busy = false;

  constructor(
    parent: HTMLElement,
    private readonly hooks: BoardPanelHooks,
  ) {
    this.root = document.createElement('div');
    this.root.className = 'shop-panel board-panel hidden';
    const head = document.createElement('div');
    head.className = 'shop-head';
    const title = document.createElement('span');
    title.className = 'shop-title';
    title.textContent = t('board.title');
    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'hud-btn';
    close.textContent = '✕';
    close.setAttribute('aria-label', t('map.close'));
    close.addEventListener('click', () => this.close());
    head.append(title, close);
    this.list = document.createElement('ul');
    this.list.className = 'shop-rows';
    this.root.append(head, this.list);
    parent.append(this.root);
  }

  get isOpen(): boolean {
    return this.open_;
  }

  open(): void {
    this.open_ = true;
    this.root.classList.remove('hidden');
    this.refresh();
    window.clearInterval(this.timer);
    this.timer = window.setInterval(() => {
      if (!this.hooks.atBoard()) this.close();
    }, 300);
  }

  close(): void {
    this.open_ = false;
    this.root.classList.add('hidden');
    window.clearInterval(this.timer);
  }

  refresh(): void {
    const p = this.hooks.player();
    if (!this.open_ || !p) return;
    const rows = p.listings.map((l) => {
      const li = document.createElement('li');
      const info = document.createElement('span');
      info.className = 'info';
      const name = document.createElement('span');
      name.className = 'name';
      name.textContent = t(`property.${l.key}`);
      const sub = document.createElement('span');
      sub.className = 'sub';
      const parts: string[] = [];
      const buttons: HTMLButtonElement[] = [];
      if (l.state === PS.listed) {
        if (l.listing & LISTING.sale) parts.push(t('board.forSale', { n: formatNumber(l.price) }));
        if (l.listing & LISTING.rent) parts.push(l.joins ? t('board.forRent', { n: formatNumber(l.rent) }) : t('board.forRentShop'));
        if (l.urgent) parts.push(t('board.urgent'));
        parts.push(t('board.daysLeft', { n: l.days }));
        if (l.joins) {
          parts.push(t('board.joins'));
          if (l.listing & LISTING.sale) buttons.push(this.button(t('board.buy'), l.price > p.money, { k: 'buyProperty', key: l.key }));
          if (l.listing & LISTING.rent) buttons.push(this.button(t('board.rent'), l.rent > p.money, { k: 'rentProperty', key: l.key }));
        }
      } else if (l.state === PS.owned) parts.push(t('board.yours'));
      else {
        parts.push(t('board.renting', { n: formatNumber(l.rent) }));
        if (p.phase === PHASE.evening) buttons.push(this.button(t('board.giveUp'), false, { k: 'endLease', key: l.key }));
      }
      sub.textContent = parts.join(' · ');
      info.append(name, sub);
      li.append(info, ...buttons);
      return li;
    });
    if (rows.length === 0) {
      const li = document.createElement('li');
      li.className = 'empty';
      li.textContent = t('board.empty');
      rows.push(li);
    }
    this.list.replaceChildren(...rows);
  }

  private button(label: string, disabled: boolean, action: Action): HTMLButtonElement {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'hud-btn';
    b.textContent = label;
    b.disabled = disabled;
    b.addEventListener('click', () => {
      if (this.busy) return;
      this.busy = true;
      void this.hooks.act(action).then((r) => {
        this.busy = false;
        if (!r.ok && r.reason) this.hooks.toast(r.reason);
      });
    });
    return b;
  }
}
