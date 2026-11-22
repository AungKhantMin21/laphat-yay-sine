// Debug-only track switcher (?debug=1). Developer-facing, so labels are not translated.
import type { MusicPlayer } from '../audio/music';
import { TRACKS, type TrackId } from '../audio/music-policy';

export function installMusicDebug(music: MusicPlayer, onPick: (id: TrackId) => void, parent: HTMLElement): void {
  const box = document.createElement('div');
  box.className = 'debug-only';
  box.style.cssText = 'display:flex;flex-wrap:wrap;gap:4px;margin-top:4px';
  const status = document.createElement('div');
  status.style.cssText = 'flex-basis:100%';
  box.appendChild(status);
  for (const id of TRACKS) {
    const b = document.createElement('button');
    b.textContent = id;
    b.style.cssText = 'min-width:44px;min-height:44px;padding:0 6px;font:inherit;color:#f3e6cf;background:#3d2a22;border:1px solid #d9a05b;border-radius:4px';
    b.addEventListener('click', () => onPick(id));
    box.appendChild(b);
  }
  parent.appendChild(box);
  setInterval(() => {
    status.textContent = `music ${music.state} · ${music.playing ?? '—'} · ${music.format}${music.sampleRate ? ` · ${music.sampleRate} Hz` : ''}`;
  }, 500);
}
