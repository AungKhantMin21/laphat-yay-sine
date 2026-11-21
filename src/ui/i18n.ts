// All player-facing text comes from here. Myanmar first; English later.
import my from './i18n/my.json';

type Key = keyof typeof my;
const table: Record<string, string> = my;

const MY_DIGITS = '၀၁၂၃၄၅၆၇၈၉';

/** Western digits → Myanmar digits. */
export function myDigits(s: string): string {
  return s.replace(/[0-9]/g, (d) => MY_DIGITS[Number(d)]!);
}

/** 20000 → "၂၀,၀၀၀". */
export function formatNumber(n: number): string {
  return myDigits(Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ','));
}

/** Text for a key; `{name}` placeholders are filled from args (numbers get Myanmar digits). */
export function t(key: Key | string, args?: Record<string, string | number>): string {
  let s = table[key] ?? key;
  if (args) s = s.replace(/\{(\w+)\}/g, (_, k: string) => (typeof args[k] === 'number' ? formatNumber(args[k]) : String(args[k] ?? '')));
  return s;
}

/** Fills every element with a data-t attribute under root. */
export function translateDom(root: ParentNode = document): void {
  root.querySelectorAll<HTMLElement>('[data-t]').forEach((el) => {
    el.textContent = t(el.dataset.t ?? '');
  });
}
