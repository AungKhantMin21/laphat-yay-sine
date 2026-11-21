import { describe, expect, it } from 'vitest';
import { equalPowerCurves, trackFor, urlsFor } from '../src/audio/music-policy';
import manifest from '../assets/music/music.json';

describe('music policy', () => {
  it('picks a loop by hour and weather', () => {
    expect(trackFor(6, false)).toBe('morning');
    expect(trackFor(14, false)).toBe('afternoon');
    expect(trackFor(14, true)).toBe('rain');
    expect(trackFor(22, true)).toBe('night');
    expect(trackFor(3, false)).toBe('night');
  });

  it('equal-power curves keep total power at 1 throughout', () => {
    const { fadeIn, fadeOut } = equalPowerCurves(32);
    expect(fadeIn[0]).toBeCloseTo(0);
    expect(fadeOut[0]).toBeCloseTo(1);
    for (let i = 0; i < 32; i++) expect(fadeIn[i]! ** 2 + fadeOut[i]! ** 2).toBeCloseTo(1, 5);
  });

  it('maps tracks to hashed URLs by id and extension, not by the names in music.json', () => {
    const urls = {
      '../../assets/music/morning.ogg': '/x/assets/morning-AbC12.ogg',
      '../../assets/music/morning.m4a': '/x/assets/morning-ZZ9.m4a',
      '../../assets/music/night.ogg': '/x/assets/night-Q1.ogg',
    };
    expect(urlsFor('morning', urls)).toEqual({ ogg: '/x/assets/morning-AbC12.ogg', m4a: '/x/assets/morning-ZZ9.m4a' });
    expect(urlsFor('night', urls)).toEqual({ ogg: '/x/assets/night-Q1.ogg', m4a: undefined });
  });

  it('music.json has loop points for every track', () => {
    for (const id of ['morning', 'afternoon', 'rain', 'night']) {
      const t = (manifest.tracks as Record<string, { loopStart: number; loopEnd: number }>)[id]!;
      expect(t.loopEnd).toBeGreaterThan(t.loopStart);
    }
  });
});
