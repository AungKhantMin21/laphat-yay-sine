// Debug-only track switcher (?debug=1). Developer-facing, so labels are not translated.
import type { MusicPlayer } from '../audio/music';
import { TRACKS, type TrackId } from '../audio/music-policy';

export function installMusicDebug(music: MusicPlayer, onPick: (id: TrackId) => void): void {
  const ui = document.getElementById('ui');
  if (!ui) return;
  const box = document.createElement('div');
  box.className = 'debug-only';
  box.style.cssText =
    'position:absolute;right:calc(var(--safe-r) + 6px);top:calc(var(--safe-t) + 6px);display:flex;flex-direction:column;gap:4px;font:11px/1 ui-monospace,Menlo,monospace';
  const status = document.createElement('div');
  status.style.cssText = 'color:#f3e6cf;background:rgba(20,14,12,.78);padding:4px 6px;border-radius:4px;text-align:right';
  box.appendChild(status);
  for (const id of TRACKS) {
    const b = document.createElement('button');
    b.textContent = id;
    b.style.cssText = 'min-width:88px;min-height:44px;font:inherit;color:#f3e6cf;background:#3d2a22;border:2px solid #d9a05b;border-radius:4px';
    b.addEventListener('click', () => onPick(id));
    box.appendChild(b);
  }
  ui.appendChild(box);
  setInterval(() => {
    status.textContent = `music ${music.state} · ${music.playing ?? '—'} · ${music.format}${music.sampleRate ? ` · ${music.sampleRate} Hz` : ''}`;
  }, 500);
}
