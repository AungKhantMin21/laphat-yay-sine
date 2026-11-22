// Savings tin (DESIGN §8): the tin's fill level is the money display outside build mode.
// The tin grows through the sizes in shop.json as savings rise; a coin drops in on each payment.
// DOM only; it updates on state changes and money events, never per frame.
import './tin.css';
import { SHOP, tinLevel } from '../../shared/shop';
import { t } from '../i18n';

/** Coins that can be falling at once (customers often pay together at peak). */
const COINS = 4;
const COIN_MS = 700;
/** Tin body size in CSS px for size step 0, and the growth per step (whole pixels). */
const BASE_W = 28;
const BASE_H = 32;
const GROW = 4;
/** Lid and wall thickness: the fill area is the body minus these. */
const WALL = 3;

export interface TinHud {
  /** Shows `money` kyat. */
  refresh(money: number): void;
  /** A payment landed: drop a coin and show the new total. */
  paid(delta: number, total: number): void;
}

export function installTin(): TinHud {
  const ui = document.getElementById('ui')!;
  const box = document.createElement('div');
  box.className = 'tin';
  box.setAttribute('role', 'img');
  const can = document.createElement('div');
  can.className = 'tin-can';
  const fill = document.createElement('div');
  fill.className = 'tin-fill';
  can.append(fill);
  const coins: { el: HTMLDivElement; timer: number }[] = [];
  for (let i = 0; i < COINS; i++) {
    const c = document.createElement('div');
    c.className = 'tin-coin hidden';
    can.append(c);
    coins.push({ el: c, timer: 0 });
  }
  const label = document.createElement('div');
  label.className = 'tin-label';
  box.append(can, label);
  ui.append(box);

  const level = { size: 0, fill: 0 };
  let shownMoney = -1;
  let shownSize = -1;
  let shownFill = -1;
  let nextCoin = 0;

  function refresh(money: number): void {
    if (money === shownMoney) return;
    shownMoney = money;
    label.textContent = t('money.kyat', { n: money });
    box.setAttribute('aria-label', t('tin.label', { n: money }));
    tinLevel(money, SHOP, level);
    const w = BASE_W + GROW * level.size;
    const h = BASE_H + GROW * level.size;
    if (level.size !== shownSize) {
      const grew = shownSize >= 0 && level.size > shownSize;
      shownSize = level.size;
      can.style.width = `${w}px`;
      can.style.height = `${h}px`;
      if (grew) {
        can.classList.remove('grow');
        void can.offsetWidth; // restart the animation
        can.classList.add('grow');
      }
    }
    // Whole pixels of coins inside the walls; any savings at all show at least one pixel.
    const inner = h - 2 * WALL;
    let px = Math.round(level.fill * inner);
    if (money > 0 && px === 0) px = 1;
    if (px !== shownFill) {
      shownFill = px;
      fill.style.height = `${px}px`;
    }
  }

  function paid(delta: number, total: number): void {
    if (delta > 0) {
      const c = coins[nextCoin]!;
      nextCoin = (nextCoin + 1) % COINS;
      c.el.classList.add('hidden');
      void c.el.offsetWidth;
      c.el.classList.remove('hidden');
      clearTimeout(c.timer);
      c.timer = window.setTimeout(() => c.el.classList.add('hidden'), COIN_MS);
    }
    refresh(total);
  }

  return { refresh, paid };
}
