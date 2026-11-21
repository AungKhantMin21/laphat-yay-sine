// All player-facing text comes from here. Myanmar first; English later.
import my from './i18n/my.json';

type Key = keyof typeof my;
const table: Record<string, string> = my;

export function t(key: Key | string): string {
  return table[key] ?? key;
}

/** Fills every element with a data-t attribute under root. */
export function translateDom(root: ParentNode = document): void {
  root.querySelectorAll<HTMLElement>('[data-t]').forEach((el) => {
    el.textContent = t(el.dataset.t ?? '');
  });
}
