// Music: decode on demand, gapless loops via AudioBufferSourceNode loopStart/loopEnd (from
// music.json), Ogg Opus first with M4A fallback, 4 s equal-power crossfade, ≤ 2 decoded tracks.
// Files are loaded from Vite's hashed URLs; the file names in music.json are labels only.
import manifest from '../../assets/music/music.json';
import { equalPowerCurves, urlsFor, type TrackId, type TrackInfo } from './music-policy';

const URLS = import.meta.glob('../../assets/music/*.{ogg,m4a}', { query: '?url', import: 'default', eager: true }) as Record<string, string>;

const FADE_S = 4;
const CURVES = equalPowerCurves();

interface Voice {
  id: TrackId;
  src: AudioBufferSourceNode;
  gain: GainNode;
}

export interface MusicOptions {
  /** Read when audio unlocks. A lower rate on Low-tier phones halves decoded memory (~20 MB → ~10 MB per track). */
  sampleRate?: () => number | null;
  volume?: number;
}

export class MusicPlayer {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private current: Voice | null = null;
  private fading: Voice | null = null;
  private wanted: TrackId | null = null;
  private loading: TrackId | null = null;
  private oggOk = true;
  private volume: number;

  constructor(private readonly opts: MusicOptions = {}) {
    this.volume = opts.volume ?? 0.7;
    // Autoplay rules: audio may only start from a user gesture. Keep trying on every tap
    // because iOS can drop back to 'interrupted' after calls or backgrounding.
    const unlock = (): void => this.unlock();
    window.addEventListener('pointerdown', unlock, true);
    window.addEventListener('keydown', unlock, true);
    document.addEventListener('visibilitychange', () => {
      if (!this.ctx) return;
      if (document.visibilityState === 'hidden') void this.ctx.suspend().catch(() => undefined);
      else void this.ctx.resume().catch(() => undefined); // may need the next tap on iOS
    });
  }

  get state(): string {
    return this.ctx ? this.ctx.state : 'locked';
  }

  get playing(): TrackId | null {
    return this.current?.id ?? null;
  }

  get sampleRate(): number {
    return this.ctx?.sampleRate ?? 0;
  }

  get format(): 'ogg' | 'm4a' {
    return this.oggOk ? 'ogg' : 'm4a';
  }

  /** Request a track; it starts (or crossfades in) as soon as audio is unlocked and decoded. */
  play(id: TrackId): void {
    this.wanted = id;
    void this.update();
  }

  setVolume(v: number): void {
    this.volume = v;
    if (this.master && this.ctx) this.master.gain.setTargetAtTime(v, this.ctx.currentTime, 0.1);
  }

  private unlock(): void {
    if (!this.ctx) {
      const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) return;
      try {
        const rate = this.opts.sampleRate?.() ?? null;
        this.ctx = rate ? new Ctor({ sampleRate: rate, latencyHint: 'playback' }) : new Ctor({ latencyHint: 'playback' });
      } catch {
        this.ctx = new Ctor();
      }
      this.master = this.ctx.createGain();
      this.master.gain.value = this.volume;
      this.master.connect(this.ctx.destination);
      // iOS: playing a silent buffer inside the gesture fully unlocks output.
      const silent = this.ctx.createBufferSource();
      silent.buffer = this.ctx.createBuffer(1, 1, this.ctx.sampleRate);
      silent.connect(this.ctx.destination);
      silent.start();
      this.oggOk = document.createElement('audio').canPlayType('audio/ogg; codecs="opus"') !== '';
    }
    if (this.ctx.state !== 'running') void this.ctx.resume().catch(() => undefined);
    void this.update();
  }

  private async update(): Promise<void> {
    const id = this.wanted;
    if (!this.ctx || !id || this.loading || this.current?.id === id) return;
    this.loading = id;
    try {
      const buffer = await this.decode(id);
      if (this.wanted === id && this.current?.id !== id) this.start(id, buffer);
    } catch (e) {
      console.warn('music: could not load', id, e);
    } finally {
      this.loading = null;
    }
    // The wish may have changed while decoding.
    if (this.wanted && this.wanted !== this.current?.id) void this.update();
  }

  private async decode(id: TrackId): Promise<AudioBuffer> {
    const urls = urlsFor(id, URLS);
    if (this.oggOk && urls.ogg) {
      try {
        return await this.fetchDecode(urls.ogg);
      } catch {
        this.oggOk = false; // Safari versions without Ogg: use M4A from now on
      }
    }
    if (!urls.m4a) throw new Error(`no m4a for ${id}`);
    return this.fetchDecode(urls.m4a);
  }

  private async fetchDecode(url: string): Promise<AudioBuffer> {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`${res.status} ${url}`);
    const bytes = await res.arrayBuffer();
    const ctx = this.ctx!;
    // Callback form: works on every Safari version we support.
    return new Promise((resolve, reject) => ctx.decodeAudioData(bytes, resolve, (e) => reject(e ?? new Error('decode failed'))));
  }

  private start(id: TrackId, buffer: AudioBuffer): void {
    const ctx = this.ctx!;
    const info = (manifest.tracks as Record<string, TrackInfo>)[id];
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    src.loop = true;
    if (info) {
      src.loopStart = info.loopStart;
      src.loopEnd = Math.min(info.loopEnd, buffer.duration);
    }
    const gain = ctx.createGain();
    src.connect(gain).connect(this.master!);
    const now = ctx.currentTime;

    // A third track while one is still fading out: cut the oldest so ≤ 2 buffers stay decoded.
    if (this.fading) this.stopVoice(this.fading);
    this.fading = null;

    if (this.current) {
      const old = this.current;
      old.gain.gain.cancelScheduledValues(now);
      old.gain.gain.setValueCurveAtTime(scaled(CURVES.fadeOut, old.gain.gain.value), now, FADE_S);
      old.src.stop(now + FADE_S + 0.05);
      old.src.onended = () => {
        if (this.fading === old) this.fading = null;
        this.disconnect(old);
      };
      this.fading = old;
      gain.gain.setValueCurveAtTime(CURVES.fadeIn, now, FADE_S);
    } else {
      // First track: short fade in from silence.
      gain.gain.setValueAtTime(0, now);
      gain.gain.linearRampToValueAtTime(1, now + 1.5);
    }
    src.start(now, info?.loopStart ?? 0);
    this.current = { id, src, gain };
  }

  private stopVoice(v: Voice): void {
    try {
      v.src.stop();
    } catch {
      /* already stopped */
    }
    this.disconnect(v);
  }

  private disconnect(v: Voice): void {
    v.src.disconnect();
    v.gain.disconnect();
    v.src.buffer = null; // let the decoded PCM be collected
  }
}

/** Fade-out curve starting from the voice's current gain (if a fade was interrupted). */
function scaled(curve: Float32Array, from: number): Float32Array {
  if (from >= 0.999) return curve;
  const out = new Float32Array(curve.length);
  for (let i = 0; i < curve.length; i++) out[i] = curve[i]! * from;
  return out;
}
