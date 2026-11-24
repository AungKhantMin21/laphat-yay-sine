// A neighbourhood shop's counter (M3): today's rows with price and how many are left, buy one to
// carry home or have it delivered (the fee shows on the button), the load in hand. Opens when the
// player arrives (`atShop`) and closes when they walk away. All numbers come from PlayerState; the
// worker checks every purchase.
import { formatNumber, t } from '../i18n';
import { ITEM, MARKET, deliveryFee, itemName, unitLoad } from '../../shared/market';
import { NEIGHBOURHOOD } from '../../shared/neighbourhood';
import { INGREDIENTS } from '../../shared/ingredients';
import { MATERIALS } from '../../shared/materials';
import type { Action, PlayerState } from '../../shared/protocol';
import type { IconInfo } from '../build/build-ui';
import './panel.css';

export interface ShopPanelHooks {
  player(): PlayerState | null;
  /** The player still stands at shop `shop`'s counter. */
  atCounter(shop: number): boolean;
  act(a: Action): Promise<{ ok: boolean; reason?: string }>;
  toast(key: string): void;
  icon(kind: number, id: number): IconInfo | null;
}

const ICON_BOX = 36;
const hhmm = (m: number): string => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;

export class ShopPanel {
  private readonly root: HTMLElement;
  private readonly title: HTMLElement;
  private readonly hours: HTMLElement;
  private readonly list: HTMLElement;
  private readonly load: HTMLElement;
  private shop = -1;
  private timer = 0;
  private busy = false;

  constructor(
    parent: HTMLElement,
    private readonly hooks: ShopPanelHooks,
  ) {
    this.root = document.createElement('div');
    this.root.className = 'shop-panel hidden';
    const head = document.createElement('div');
    head.className = 'shop-head';
    this.title = document.createElement('span');
    this.title.className = 'shop-title';
    this.hours = document.createElement('span');
    this.hours.className = 'shop-hours';
    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'hud-btn';
    close.textContent = '✕';
    close.setAttribute('aria-label', t('map.close'));
    close.addEventListener('click', () => this.close());
    head.append(this.title, this.hours, close);
    this.list = document.createElement('ul');
    this.list.className = 'shop-rows';
    this.load = document.createElement('div');
    this.load.className = 'shop-load';
    this.root.append(head, this.list, this.load);
    parent.append(this.root);
  }

  get isOpen(): boolean {
    return this.shop >= 0;
  }

  open(shop: number): void {
    const site = NEIGHBOURHOOD.shops[shop];
    if (!site) return;
    this.shop = shop;
    this.title.textContent = t(`shop.${site.key}`);
    this.hours.textContent = `${hhmm(site.open)}–${hhmm(site.close)}`;
    this.root.classList.remove('hidden');
    this.refresh();
    window.clearInterval(this.timer);
    // Walked away (a tap elsewhere): the counter closes.
    this.timer = window.setInterval(() => {
      if (!this.hooks.atCounter(this.shop)) this.close();
    }, 300);
  }

  close(): void {
    this.shop = -1;
    this.root.classList.add('hidden');
    window.clearInterval(this.timer);
  }

  /** New PlayerState (rows, money, load) while open. */
  refresh(): void {
    const p = this.hooks.player();
    if (this.shop < 0 || !p) return;
    const rows = p.market[this.shop] ?? [];
    this.list.replaceChildren(
      ...rows.map((r, k) => {
        const li = document.createElement('li');
        const icon = document.createElement('span');
        icon.className = 'icon';
        const info = this.hooks.icon(r.kind, r.id);
        if (info) {
          const s = Math.max(1, Math.floor(Math.min(ICON_BOX / info.w, ICON_BOX / info.h)));
          const i = document.createElement('i');
          i.style.width = `${info.w * s}px`;
          i.style.height = `${info.h * s}px`;
          i.style.backgroundImage = `url(${info.url})`;
          i.style.backgroundSize = `${1024 * s}px ${1024 * s}px`;
          i.style.backgroundPosition = `${-info.x * s}px ${-info.y * s}px`;
          icon.appendChild(i);
        } else icon.classList.add(r.kind === ITEM.ingredient ? 'pack' : 'tin');
        const name = document.createElement('span');
        name.className = 'name';
        name.textContent = t(itemName(r.kind, r.id));
        const unit = r.kind === ITEM.ingredient ? t('market.packCups', { n: INGREDIENTS.defs[r.id]!.pack }) : r.kind === ITEM.material ? t('market.packTiles', { n: MATERIALS.defs[r.id]!.pack }) : '';
        const sub = document.createElement('span');
        sub.className = 'sub';
        sub.textContent = `${t('money.kyat', { n: formatNumber(r.price) })}${unit ? ` · ${unit}` : ''} · ${t('market.left', { n: r.qty })}`;
        const info2 = document.createElement('span');
        info2.className = 'info';
        info2.append(name, sub);
        const carry = this.button(t('market.carry'), r.qty <= 0 || r.price > p.money || p.carryLoad + unitLoad(r.kind, r.id) > MARKET.carryMax, () => ({ k: 'buy', shop: this.shop, item: k, qty: 1 }));
        const fee = deliveryFee(r.price);
        const deliver = this.button(t('market.deliver', { n: formatNumber(fee) }), r.qty <= 0 || r.price + fee > p.money, () => ({ k: 'buy', shop: this.shop, item: k, qty: 1, deliver: true }));
        li.append(icon, info2, carry, deliver);
        return li;
      }),
    );
    const pending = p.deliveries.reduce((n, g) => n + g.qty, 0);
    this.load.textContent = `${t('market.load', { n: p.carryLoad, max: MARKET.carryMax })}${pending ? ` · ${t('market.onTheWay', { n: pending })}` : ''}`;
  }

  private button(label: string, disabled: boolean, action: () => Action): HTMLButtonElement {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'hud-btn';
    b.textContent = label;
    b.disabled = disabled;
    b.addEventListener('click', () => {
      if (this.busy) return;
      this.busy = true;
      void this.hooks.act(action()).then((r) => {
        this.busy = false;
        if (!r.ok && r.reason) this.hooks.toast(r.reason);
      });
    });
    return b;
  }
}
