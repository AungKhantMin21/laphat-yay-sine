// The ?debug=1 panel (M2.5): one small box, top centre inside the safe area, collapsed by default.
// It holds the perf readout, the music switcher and the font sample. F3 opens and closes it.
// Developer-facing, so labels are not translated. Nothing here exists without ?debug=1.

export interface DebugPanel {
  /** Where debug widgets go. */
  readonly body: HTMLElement;
}

const KEY = 'lys.debugOpen';

export function installDebugPanel(): DebugPanel {
  const box = document.createElement('div');
  box.id = 'debug-panel';
  box.style.cssText = [
    'position:fixed',
    'top:calc(env(safe-area-inset-top,0px) + 4px)',
    'left:50%',
    'transform:translateX(-50%)',
    'max-width:min(92vw,360px)',
    'z-index:50',
    'font:10px/1.3 ui-monospace,Menlo,monospace',
    'color:#f3e6cf',
    'background:rgba(20,14,12,.82)',
    'border-radius:4px',
  ].join(';');
  const toggle = document.createElement('button');
  toggle.textContent = 'debug';
  toggle.style.cssText = 'display:block;margin:0 auto;min-width:44px;min-height:24px;padding:2px 8px;font:inherit;color:inherit;background:transparent;border:0';
  const body = document.createElement('div');
  body.style.cssText = 'padding:0 6px 6px';
  box.append(toggle, body);
  document.body.appendChild(box);

  let open = false;
  try {
    open = localStorage.getItem(KEY) === '1';
  } catch {
    // storage blocked (private window): stay collapsed
  }
  const apply = (): void => {
    body.style.display = open ? '' : 'none';
    toggle.textContent = open ? 'debug ▴' : 'debug ▾';
    try {
      localStorage.setItem(KEY, open ? '1' : '0');
    } catch {
      // ignore
    }
  };
  toggle.addEventListener('click', () => {
    open = !open;
    apply();
  });
  window.addEventListener('keydown', (e) => {
    if (e.key !== 'F3') return;
    open = !open;
    apply();
    e.preventDefault();
  });
  apply();
  return { body };
}
