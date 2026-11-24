// Neighbourhood navigation buttons (M3) on the right edge above the build button: home re-centres
// the camera on the shop (and stops following the player until they walk again); map opens the
// neighbourhood map (ui/hud/map.ts).
import { t } from '../i18n';
import './nav.css';

export interface NavHooks {
  home(): void;
  map(): void;
}

export class NavButtons {
  readonly root: HTMLElement;

  constructor(parent: HTMLElement, hooks: NavHooks) {
    this.root = document.createElement('div');
    this.root.className = 'nav-btns';
    const home = document.createElement('button');
    home.className = 'hud-btn nav-home';
    home.type = 'button';
    home.innerHTML = `<span class="sym">⌂</span>`;
    home.append(t('nav.home'));
    home.addEventListener('click', () => hooks.home());
    const map = document.createElement('button');
    map.className = 'hud-btn nav-map';
    map.type = 'button';
    map.innerHTML = `<span class="sym">▦</span>`;
    map.append(t('nav.map'));
    map.addEventListener('click', () => hooks.map());
    this.root.append(map, home);
    parent.append(this.root);
  }
}
