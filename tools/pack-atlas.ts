// Packs art/sprites/**/*.png into one 1024×1024 atlas (PNG + lossless WebP + JSON).
// Fails if any opaque pixel is not in art/palette.hex, or if the sprites don't fit.
// Usage: node tools/pack-atlas.ts
import sharp from 'sharp';
import { readdirSync, statSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import { loadPalette } from './png.ts';

const SRC = 'art/sprites';
const OUT = 'assets/atlas';
const SIZE = 1024;
/** Each sprite is extruded by 1 px (edge pixels repeated) to stop neighbours bleeding at fractional UVs. */
const EXTRUDE = 1;

interface Img {
  name: string;
  w: number;
  h: number;
  data: Buffer;
  x: number;
  y: number;
}

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? walk(p) : n.endsWith('.png') ? [p] : [];
  });
}

const palette = new Set(loadPalette());
if (palette.size > 32) throw new Error(`palette has ${palette.size} colours; the limit is 32`);

const imgs: Img[] = [];
const errors: string[] = [];
for (const file of walk(SRC).sort()) {
  const { data, info } = await sharp(file).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const name = relative(SRC, file).replace(/\\/g, '/').replace(/\.png$/, '');
  let bad = 0;
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3]! === 0) continue;
    if (data[i + 3]! !== 255) bad++;
    else if (!palette.has((data[i]! << 16) | (data[i + 1]! << 8) | data[i + 2]!)) bad++;
  }
  if (bad) errors.push(`${file}: ${bad} pixels off-palette or semi-transparent`);
  imgs.push({ name, w: info.width, h: info.height, data, x: 0, y: 0 });
}
if (errors.length) {
  console.error(errors.join('\n'));
  process.exit(1);
}

// Shelf packing, tallest first. Good enough for one small atlas; revisit if it fills up.
imgs.sort((a, b) => b.h - a.h || b.w - a.w);
let x = 0;
let y = 0;
let shelf = 0;
for (const im of imgs) {
  const w = im.w + EXTRUDE * 2;
  const h = im.h + EXTRUDE * 2;
  if (x + w > SIZE) {
    x = 0;
    y += shelf;
    shelf = 0;
  }
  if (y + h > SIZE) throw new Error('atlas full: add atlas-1 support');
  im.x = x + EXTRUDE;
  im.y = y + EXTRUDE;
  x += w;
  shelf = Math.max(shelf, h);
}
const usedH = y + shelf;

const out = Buffer.alloc(SIZE * SIZE * 4);
for (const im of imgs) {
  for (let yy = -EXTRUDE; yy < im.h + EXTRUDE; yy++) {
    for (let xx = -EXTRUDE; xx < im.w + EXTRUDE; xx++) {
      const sx = Math.min(im.w - 1, Math.max(0, xx));
      const sy = Math.min(im.h - 1, Math.max(0, yy));
      const s = (sy * im.w + sx) * 4;
      const d = ((im.y + yy) * SIZE + im.x + xx) * 4;
      im.data.copy(out, d, s, s + 4);
    }
  }
}

mkdirSync(OUT, { recursive: true });
const raw = { raw: { width: SIZE, height: SIZE, channels: 4 as const } };
await sharp(out, raw).png({ compressionLevel: 9, palette: false }).toFile(`${OUT}/atlas-0.png`);
await sharp(out, raw).webp({ lossless: true, effort: 6 }).toFile(`${OUT}/atlas-0.webp`);
const frames: Record<string, [number, number, number, number]> = {};
for (const im of imgs.sort((a, b) => a.name.localeCompare(b.name))) frames[im.name] = [im.x, im.y, im.w, im.h];
writeFileSync(`${OUT}/atlas-0.json`, JSON.stringify({ size: SIZE, frames }) + '\n');
console.log(`${imgs.length} sprites → ${OUT}/atlas-0.{png,webp,json} (${usedH}/${SIZE} rows used)`);
