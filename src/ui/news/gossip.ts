// The gossip line (M4): a resident you served passes on the street's news — their name and one line
// for a few seconds at the top of the screen. Lines wait while the pour minigame is open and queue up
// (at most a few), so nothing covers the pour.
import { t } from '../i18n';
import { newsText, type NewsLike } from './news';
import './gossip.css';

const SHOW_MS = 6000;
const QUEUE_MAX = 3;

export class GossipLine {
  private readonly root: HTMLElement;
  private readonly name: HTMLElement;
  private readonly text: HTMLElement;
  private readonly queue: { who: string; line: string }[] = [];
  private until = 0;
  private timer = 0;

  constructor(
    parent: HTMLElement,
    /** True while something else owns the screen (the pour minigame). */
    private readonly busy: () => boolean,
  ) {
    this.root = document.createElement('div');
    this.root.className = 'gossip hidden';
    this.root.setAttribute('role', 'status');
    this.name = document.createElement('span');
    this.name.className = 'gossip-name';
    this.text = document.createElement('span');
    this.text.className = 'gossip-text';
    this.root.append(this.name, this.text);
    parent.append(this.root);
  }

  /** Resident `who` (key) tells news item `n`. */
  tell(who: string, n: NewsLike): void {
    const line = newsText(n);
    if (!line) return;
    if (this.queue.length >= QUEUE_MAX) this.queue.shift();
    this.queue.push({ who, line });
    this.pump();
  }

  private pump(): void {
    window.clearTimeout(this.timer);
    const now = performance.now();
    if (now < this.until) {
      this.timer = window.setTimeout(() => this.pump(), this.until - now);
      return;
    }
    this.root.classList.add('hidden');
    if (this.queue.length === 0) return;
    if (this.busy()) {
      this.timer = window.setTimeout(() => this.pump(), 500);
      return;
    }
    const g = this.queue.shift()!;
    this.name.textContent = t('gossip.says', { name: t(`resident.${g.who}`) });
    this.text.textContent = g.line;
    this.root.classList.remove('hidden');
    this.until = now + SHOW_MS;
    this.timer = window.setTimeout(() => this.pump(), SHOW_MS);
  }
}
