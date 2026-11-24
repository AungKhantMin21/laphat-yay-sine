// Generates placeholder art into art/sprites/ using only palette colours: floor tiles, back walls,
// every object in src/data/objects.json at each of its rotations, customers and order bubbles.
// Original art for this project (no third-party licence). Replace with hand-made sprites later.
// Usage: node tools/make-placeholders.ts
import sharp from 'sharp';
import { mkdirSync } from 'node:fs';
import { diamondHalf } from './png.ts';
import { drawFacades, drawObjects, drawShopFront, drawStalls, drawWalls } from './placeholder-objects.ts';
import { drawCharacters } from './placeholder-characters.ts';

const hex = (h: string): [number, number, number] => [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];

type Painter = (x: number, y: number, edge: 'tl' | 'br' | 'tr' | 'bl' | null) => string;

function tile(paint: Painter): Buffer {
  const W = 32;
  const H = 16;
  const px = Buffer.alloc(W * H * 4);
  for (let y = 0; y < H; y++) {
    const a = diamondHalf(y);
    const x0 = 16 - a;
    const x1 = 16 + a - 1;
    for (let x = x0; x <= x1; x++) {
      let edge: 'tl' | 'br' | 'tr' | 'bl' | null = null;
      if (x <= x0 + 1) edge = y < 8 ? 'tl' : 'bl';
      else if (x >= x1 - 1) edge = y < 8 ? 'tr' : 'br';
      const [r, g, b] = hex(paint(x, y, edge));
      const i = (y * W + x) * 4;
      px[i] = r;
      px[i + 1] = g;
      px[i + 2] = b;
      px[i + 3] = 255;
    }
  }
  return px;
}

// Deterministic speckle so tiles don't look flat.
const noise = (x: number, y: number, k: number): number => ((x * 73856093) ^ (y * 19349663) ^ (k * 83492791)) >>> 0;

// Light from the top left: top-left edge lighter, bottom-right edge darker.
const lit = (base: string, light: string, shade: string): Painter => (_x, _y, e) => (e === 'tl' ? light : e === 'br' ? shade : base);

const tiles: Record<string, Painter> = {
  road: (x, y, e) => {
    if (e === 'tl') return '5a504e';
    if (e === 'br') return '3a3232';
    return noise(x, y, 1) % 11 === 0 ? '3a3232' : '4a4040';
  },
  pavement: lit('8a6644', 'a98258', '6e4e36'),
  shop: (x, y, e) => {
    // Checkered terrazzo: four sub-diamonds per tile.
    if (e === 'tl') return 'ecd3a5';
    if (e === 'br') return 'a98258';
    const u = x / 16 + y / 8; // 0..4 across the tile in iso-x
    const v = y / 8 - x / 16 + 2; // 0..4 in iso-y
    return (Math.floor(u / 2) + Math.floor(v / 2)) % 2 ? 'c8a46e' : 'dab886';
  },
  crossing: (x, y, e) => {
    // Road with zebra bars parallel to the road (iso-x), repeating along the walking direction (iso-y).
    if (e === 'tl') return '5a504e';
    if (e === 'br') return '3a3232';
    const v = y / 8 - x / 16 + 2; // 0..4 across the tile in iso-y
    return Math.floor(v) % 2 === 0 ? 'f6ead0' : '4a4040';
  },
  kitchen: (x, y, e) => {
    // Plain concrete with a faint grid.
    if (e === 'tl') return '9aa6ae';
    if (e === 'br') return '44505c';
    return noise(x, y, 3) % 17 === 0 ? '44505c' : (x + y * 2) % 16 === 0 ? '9aa6ae' : '6a7884';
  },
  lane: (x, y, e) => {
    // Old cobbles: rounded stones in offset rows.
    if (e === 'tl') return 'a98258';
    if (e === 'br') return '523a2c';
    const row = Math.floor(y / 3);
    const col = Math.floor((x + (row % 2) * 3) / 6);
    const edge = y % 3 === 0 || (x + (row % 2) * 3) % 6 === 0;
    return edge ? '6e4e36' : (row + col) % 3 === 0 ? '8a6644' : 'a98258';
  },
  dirt: (x, y, e) => {
    if (e === 'tl') return '6e4e36';
    if (e === 'br') return '3d2a22';
    const n = noise(x, y, 2) % 13;
    return n === 0 ? '6e4e36' : n === 1 ? '3d2a22' : '523a2c';
  },
};

mkdirSync('art/sprites/floor', { recursive: true });
for (const [name, paint] of Object.entries(tiles)) {
  await sharp(tile(paint), { raw: { width: 32, height: 16, channels: 4 } }).png().toFile(`art/sprites/floor/${name}.png`);
  console.log(`art/sprites/floor/${name}.png`);
}

for (const [name, img] of [...drawWalls(), ...drawFacades(), ...drawShopFront(), ...drawStalls(), ...drawObjects(), ...drawCharacters()]) {
  const file = `art/sprites/${name}.png`;
  mkdirSync(file.slice(0, file.lastIndexOf('/')), { recursive: true });
  await sharp(img.px, { raw: { width: img.w, height: img.h, channels: 4 } }).png().toFile(file);
  console.log(file);
}
