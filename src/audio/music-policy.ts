// Pure music helpers (no Web Audio), tested in test/music.test.ts.

export type TrackId = 'morning' | 'afternoon' | 'rain' | 'night';
export const TRACKS: readonly TrackId[] = ['morning', 'afternoon', 'rain', 'night'];

/** Which loop fits the hour (0–23) and weather. Rain wins during the day; night stays night. */
export function trackFor(hour: number, raining: boolean): TrackId {
  const night = hour >= 19 || hour < 5;
  if (night) return 'night';
  if (raining) return 'rain';
  return hour < 12 ? 'morning' : 'afternoon';
}

/**
 * Equal-power fade curves: fadeIn[i]² + fadeOut[i]² = 1, so loudness stays steady through a
 * crossfade instead of dipping in the middle like a linear fade does.
 */
export function equalPowerCurves(points = 64): { fadeIn: Float32Array; fadeOut: Float32Array } {
  const fadeIn = new Float32Array(points);
  const fadeOut = new Float32Array(points);
  for (let i = 0; i < points; i++) {
    const t = i / (points - 1);
    fadeIn[i] = Math.sin((t * Math.PI) / 2);
    fadeOut[i] = Math.cos((t * Math.PI) / 2);
  }
  return { fadeIn, fadeOut };
}

export interface TrackInfo {
  loopStart: number;
  loopEnd: number;
}

/** Finds hashed URLs for a track among Vite glob results (keys end in `/<id>.<ext>`). */
export function urlsFor(id: TrackId, urls: Record<string, string>): { ogg?: string; m4a?: string } {
  const find = (ext: string): string | undefined => {
    const key = Object.keys(urls).find((k) => k.endsWith(`/${id}.${ext}`));
    return key ? urls[key] : undefined;
  };
  return { ogg: find('ogg'), m4a: find('m4a') };
}
