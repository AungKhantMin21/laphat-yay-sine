// Settings panel. M1: save code export/import (the iOS storage-eviction fallback).
import { t } from './i18n';

export interface SettingsDeps {
  exportSave(): Promise<string>;
  importSave(code: string): Promise<{ ok: boolean; reason?: string }>;
  /** Hide the gear while another full-height panel (build drawer) is open. */
  hidden(): boolean;
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', text = ''): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text) e.textContent = text;
  return e;
}

export function installSettings(d: SettingsDeps): { refresh(): void } {
  const ui = document.getElementById('ui')!;
  const gear = el('button', 'hud-btn settings-btn');
  gear.append(el('span', 'sym', '⚙'), document.createTextNode(t('settings.open')));
  const panel = el('div', 'settings');
  panel.hidden = true;
  const box = el('section', 'settings-box');
  box.setAttribute('role', 'dialog');
  box.setAttribute('aria-label', t('settings.title'));
  const help = el('p', 'help', t('settings.saveCodeHelp'));
  const code = el('textarea');
  code.rows = 3;
  code.spellcheck = false;
  code.placeholder = t('settings.importPlaceholder');
  code.setAttribute('aria-label', t('settings.saveCode'));
  const status = el('p', 'status');
  const row = el('div', 'row');
  const exportBtn = el('button', 'hud-btn', t('settings.export'));
  const copyBtn = el('button', 'hud-btn', t('settings.copy'));
  const importBtn = el('button', 'hud-btn danger', t('settings.import'));
  const closeBtn = el('button', 'hud-btn', t('settings.close'));
  row.append(exportBtn, copyBtn, importBtn, closeBtn);
  box.append(el('h2', '', t('settings.saveCode')), help, code, status, row);
  panel.appendChild(box);
  ui.append(gear, panel);

  let armed = false;
  const say = (key: string): void => {
    status.textContent = t(key);
  };

  gear.addEventListener('click', () => {
    panel.hidden = false;
    status.textContent = '';
    armed = false;
  });
  closeBtn.addEventListener('click', () => (panel.hidden = true));
  exportBtn.addEventListener('click', async () => {
    code.value = await d.exportSave();
    code.select();
    status.textContent = '';
  });
  copyBtn.addEventListener('click', async () => {
    if (!code.value) code.value = await d.exportSave();
    try {
      await navigator.clipboard.writeText(code.value);
      say('settings.copied');
    } catch {
      code.select(); // clipboard blocked: leave it selected for a manual copy
    }
  });
  importBtn.addEventListener('click', async () => {
    if (!code.value.trim()) return say('settings.importBad');
    if (!armed) {
      armed = true;
      return say('settings.importWarn');
    }
    armed = false;
    const r = await d.importSave(code.value);
    say(r.ok ? 'settings.importOk' : (r.reason ?? 'settings.importBad'));
  });

  const refresh = (): void => {
    gear.style.display = d.hidden() ? 'none' : '';
  };
  refresh();
  return { refresh };
}
