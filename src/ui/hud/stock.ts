// The kitchen shelf (M3): about how many cups the ingredient stock can still make, under the
// savings tin. Amber when it's time for the wet market. Updates only when the player state changes.
import { t } from '../i18n';
import { INGREDIENTS } from '../../shared/ingredients';
import './stock.css';

export interface StockHud {
  refresh(cupsLeft: number, stock: readonly number[]): void;
}

export function installStock(): StockHud {
  const ui = document.getElementById('ui')!;
  const box = document.createElement('div');
  box.className = 'stock-hud';
  box.setAttribute('role', 'status');
  const label = document.createElement('span');
  label.className = 'stock-cup';
  label.textContent = '☕';
  const n = document.createElement('span');
  box.append(label, n);
  ui.append(box);
  let last = '';
  return {
    refresh(cupsLeft, stock) {
      const text = t('stock.cups', { n: cupsLeft });
      const title = `${t('stock.label')}: ${INGREDIENTS.defs.map((d) => `${t(d.name)} ${stock[d.id] ?? 0}`).join(' · ')}`;
      const key = `${text}|${title}`;
      if (key === last) return;
      last = key;
      n.textContent = text;
      box.title = title;
      box.setAttribute('aria-label', title);
      box.classList.toggle('low', cupsLeft < INGREDIENTS.lowCups);
    },
  };
}
