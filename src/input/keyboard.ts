// Desktop keys: build mode, and walking the player (M3). Ignored while typing in a text field.
import type { BuildController } from '../game/build-mode';

export function installBuildKeys(ctl: BuildController): void {
  window.addEventListener('keydown', (e) => {
    const target = e.target as HTMLElement | null;
    if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) return;
    const mod = e.ctrlKey || e.metaKey;
    const k = e.key.toLowerCase();
    if (mod && k === 'z') {
      e.preventDefault();
      void (e.shiftKey ? ctl.redo() : ctl.undo());
    } else if (mod && k === 'y') {
      e.preventDefault();
      void ctl.redo();
    } else if (mod) {
      return;
    } else if (k === 'b') {
      ctl.toggle();
    } else if (!ctl.open) {
      return;
    } else if (k === 'r') {
      ctl.rotate();
    } else if (k === 'escape') {
      if (ctl.mode === 'browse') ctl.close();
      else ctl.cancel();
    } else if (k === 'delete' || k === 'backspace') {
      void ctl.pickup();
    } else if (k === 'enter') {
      void ctl.confirm();
    } else if (k === 'm') {
      ctl.startMove();
    }
  });
}

/** Screen direction → tile step (iso: screen up = −x −y). */
const WALK_KEYS: Record<string, [number, number]> = {
  w: [-1, -1],
  arrowup: [-1, -1],
  s: [1, 1],
  arrowdown: [1, 1],
  a: [-1, 1],
  arrowleft: [-1, 1],
  d: [1, -1],
  arrowright: [1, -1],
};
const WALK_REPEAT_MS = 220;

/** WASD / arrow keys walk the player while held (a step every WALK_REPEAT_MS). */
export function installWalkKeys(hooks: { active(): boolean; step(dx: number, dy: number): void }): void {
  const held = new Set<string>();
  let timer = 0;
  const pulse = (): void => {
    if (!hooks.active() || held.size === 0) return;
    let dx = 0;
    let dy = 0;
    for (const k of held) {
      dx += WALK_KEYS[k]![0];
      dy += WALK_KEYS[k]![1];
    }
    if (dx || dy) hooks.step(Math.sign(dx), Math.sign(dy));
  };
  window.addEventListener('keydown', (e) => {
    const target = e.target as HTMLElement | null;
    if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) return;
    const k = e.key.toLowerCase();
    if (!WALK_KEYS[k] || e.ctrlKey || e.metaKey || !hooks.active()) return;
    e.preventDefault();
    if (held.has(k)) return;
    held.add(k);
    pulse();
    if (!timer) timer = window.setInterval(pulse, WALK_REPEAT_MS);
  });
  window.addEventListener('keyup', (e) => {
    held.delete(e.key.toLowerCase());
    if (held.size === 0 && timer) {
      window.clearInterval(timer);
      timer = 0;
    }
  });
  window.addEventListener('blur', () => {
    held.clear();
    window.clearInterval(timer);
    timer = 0;
  });
}
