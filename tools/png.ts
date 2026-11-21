// Tiny shared helpers for the art tools (dev-only, run with Node).
import { readFileSync } from 'node:fs';

/** Palette as RGB ints from art/palette.hex. */
export function loadPalette(path = 'art/palette.hex'): number[] {
  return readFileSync(path, 'utf8')
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => /^[0-9a-f]{6}$/i.test(l))
    .map((l) => parseInt(l, 16));
}

/** Half-width of a 32×16 diamond's row y: rows are 2, 6, …, 30, 30, …, 2 px wide so tiles tessellate exactly. */
export function diamondHalf(y: number): number {
  return y < 8 ? 2 * y + 1 : 2 * (15 - y) + 1;
}
