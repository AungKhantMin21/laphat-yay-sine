// Neighbourhood navigation buttons (M3) on the right edge above the build button: home re-centres
// the camera on the shop (and stops following the player until they walk again).
import { t } from '../i18n';
import './nav.css';

export interface NavHooks {
  home(): void;
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
    this.root.append(home);
    parent.append(this.root);
  }
}
