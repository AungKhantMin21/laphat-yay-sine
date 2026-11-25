// "While you were away" (M4): after offline catch-up, a card in the middle of the screen with the
// days that passed, what the staff sold, wages and rent, spaces given back, and the street's news.
// While catch-up runs it shows progress. One button closes it.
import { formatNumber, t } from '../i18n';
import type { AwaySummary } from '../../shared/protocol';
import { newsText, newsWorthTelling } from '../news/news';
import './away.css';

const NEWS_MAX = 6;

export class AwayCard {
  private readonly root: HTMLElement;
  private readonly title: HTMLElement;
  private readonly lines: HTMLElement;
  private readonly ok: HTMLButtonElement;

  constructor(parent: HTMLElement) {
    this.root = document.createElement('div');
    this.root.className = 'away hidden';
    this.root.setAttribute('role', 'dialog');
    this.title = document.createElement('div');
    this.title.className = 'away-title';
    this.lines = document.createElement('div');
    this.lines.className = 'away-lines';
    this.ok = document.createElement('button');
    this.ok.type = 'button';
    this.ok.className = 'hud-btn primary';
    this.ok.textContent = t('away.ok');
    this.ok.addEventListener('click', () => this.root.classList.add('hidden'));
    this.root.append(this.title, this.lines, this.ok);
    parent.append(this.root);
  }

  get isOpen(): boolean {
    return !this.root.classList.contains('hidden');
  }

  /** Catch-up progress (day `done` of `total`). */
  progress(done: number, total: number): void {
    this.title.textContent = t('away.title');
    this.lines.replaceChildren(line(t('away.catching', { done, total })));
    this.ok.classList.add('hidden');
    this.root.classList.remove('hidden');
  }

  show(s: AwaySummary): void {
    this.title.textContent = t('away.title');
    const rows: HTMLElement[] = [line(t('away.days', { n: s.days }))];
    if (s.cups > 0) rows.push(line(t('away.sold', { n: s.cups, kyat: formatNumber(s.earned) })));
    else rows.push(line(t('away.closed')));
    if (s.wages > 0) rows.push(line(t('away.wages', { n: formatNumber(s.wages) })));
    if (s.rent > 0) rows.push(line(t('away.rent', { n: formatNumber(s.rent) })));
    if (s.leases > 0) rows.push(line(t('away.leases', { n: s.leases })));
    const news = s.news.filter(newsWorthTelling).map(newsText).filter(Boolean);
    if (news.length) {
      rows.push(line(t('away.news'), 'away-news-title'));
      for (const l of news.slice(-NEWS_MAX)) rows.push(line(l));
    }
    this.lines.replaceChildren(...rows);
    this.ok.classList.remove('hidden');
    this.root.classList.remove('hidden');
  }
}

function line(text: string, cls = 'away-line'): HTMLElement {
  const d = document.createElement('div');
  d.className = cls;
  d.textContent = text;
  return d;
}
