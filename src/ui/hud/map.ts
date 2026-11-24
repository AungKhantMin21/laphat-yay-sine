// The neighbourhood map (M3): a small iso picture of the streets drawn once per open from the
// walk-zone grid (2×1 px per tile, scaled up crisp), the four shops as buttons (tap one to walk
// there) and the player as a dot. DOM only; nothing runs while it is closed.
import { t } from '../i18n';
import { NEIGHBOURHOOD } from '../../shared/neighbourhood';
import { WZ } from '../../shared/rules/access';
import './map.css';

export interface MapHooks {
  /** The walk-zone grid (TILE_PATCH access layer) and its size. */
  area(): { access: Uint8Array; w: number; h: number };
  /** The player's tile [x, y], or null. */
  player(): [number, number] | null;
  visit(shop: number): void;
}

/** Colour of a tile by walk zone (palette colours). */
const ZONE_COLOUR: Record<number, string> = {
  [WZ.road]: '#4a4040',
  [WZ.crossing]: '#f6ead0',
  [WZ.pavement]: '#a98258',
  [WZ.front]: '#ecd3a5',
  [WZ.interior]: '#ecd3a5',
  [WZ.kitchen]: '#9aa6ae',
  [WZ.kitchenDoor]: '#9aa6ae',
};

export class NeighbourhoodMap {
  private readonly root: HTMLElement;
  private readonly canvas: HTMLCanvasElement;
  private readonly dot: HTMLElement;
  private readonly box: HTMLElement;
  private timer = 0;

  constructor(
    parent: HTMLElement,
    private readonly hooks: MapHooks,
  ) {
    this.root = document.createElement('div');
    this.root.className = 'nmap hidden';
    this.root.addEventListener('click', (e) => e.target === this.root && this.close());
    const panel = document.createElement('div');
    panel.className = 'nmap-panel';
    const head = document.createElement('div');
    head.className = 'nmap-head';
    const title = document.createElement('span');
    title.textContent = t('map.title');
    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'hud-btn';
    close.textContent = '✕';
    close.setAttribute('aria-label', t('map.close'));
    close.addEventListener('click', () => this.close());
    head.append(title, close);
    this.box = document.createElement('div');
    this.box.className = 'nmap-box';
    this.canvas = document.createElement('canvas');
    this.dot = document.createElement('div');
    this.dot.className = 'nmap-dot';
    this.box.append(this.canvas, this.dot);
    for (const s of NEIGHBOURHOOD.shops) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'nmap-shop';
      b.textContent = t(`shop.${s.key}`);
      const [px, py] = this.pos(s.keeperX + 0.5, s.keeperY + 0.5);
      b.style.left = `${px}%`;
      b.style.top = `${py}%`;
      b.addEventListener('click', () => {
        this.hooks.visit(s.id);
        this.close();
      });
      this.box.append(b);
    }
    panel.append(head, this.box);
    this.root.append(panel);
    parent.append(this.root);
  }

  get isOpen(): boolean {
    return !this.root.classList.contains('hidden');
  }

  open(): void {
    this.draw();
    this.root.classList.remove('hidden');
    this.placeDot();
    this.timer = window.setInterval(() => this.placeDot(), 500);
  }

  close(): void {
    this.root.classList.add('hidden');
    window.clearInterval(this.timer);
  }

  /** Tile-space point → percent of the map box (iso: x right-down, y left-down). */
  private pos(x: number, y: number): [number, number] {
    const N = NEIGHBOURHOOD;
    const W = (N.w + N.h) * 2;
    const H = N.w + N.h;
    return [(((x - y) * 2 + N.h * 2) / W) * 100, ((x + y) / H) * 100];
  }

  private draw(): void {
    const { access, w, h } = this.hooks.area();
    const c = this.canvas;
    c.width = (w + h) * 2;
    c.height = w + h;
    const g = c.getContext('2d');
    if (!g) return;
    g.fillStyle = '#3d2a22';
    g.fillRect(0, 0, c.width, c.height);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const col = ZONE_COLOUR[access[y * w + x]!];
        if (!col) continue;
        g.fillStyle = col;
        // A 4×2 diamond, drawn as two rows.
        const px = (x - y) * 2 + h * 2;
        const py = x + y;
        g.fillRect(px - 1, py, 2, 1);
        g.fillRect(px - 2, py + 1, 4, 1);
      }
    }
  }

  private placeDot(): void {
    const p = this.hooks.player();
    this.dot.classList.toggle('hidden', !p);
    if (!p) return;
    const [px, py] = this.pos(p[0] + 0.5, p[1] + 0.5);
    this.dot.style.left = `${px}%`;
    this.dot.style.top = `${py}%`;
  }
}
