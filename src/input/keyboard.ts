// Desktop keys for build mode. Ignored while typing in a text field.
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
