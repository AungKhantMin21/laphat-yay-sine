// Placeholder object and wall sprites, drawn as simple shaded iso boxes.
// Recolourable parts use ramp 0 of objects.json (the key ramp); render/recolour.ts swaps it.
import objects from '../src/data/objects.json' with { type: 'json' };
import { IsoImage } from './iso-raster.ts';

type Ramp = [string, string, string];
const KEY: Ramp = objects.ramps[0] as Ramp; // recolourable
const WOOD: Ramp = ['a98258', '8a6644', '6e4e36'];
const DARK: Ramp = ['6e4e36', '523a2c', '3d2a22'];
const CREAM: Ramp = ['f6ead0', 'ecd3a5', 'c8a46e'];
const GREEN: Ramp = ['94b37a', '6b8f5a', '46573a'];
const METAL: Ramp = ['9aa6ae', '6a7884', '44505c'];

/** Height in px above the footprint per object (sprite headroom). */
const HEIGHT: Record<string, number> = {
  stool: 10, chair: 22, bench: 10, table: 12, table_long: 14, counter: 18, shelf: 34, rug: 2,
  radio: 10, pot_plant: 18, teapot: 9, wall_clock: 56, poster: 56, ceiling_fan: 60, hanging_lamp: 60,
};

const WALL_H = 40;

export function drawWalls(): Array<[string, IsoImage]> {
  const out: Array<[string, IsoImage]> = [];
  for (const side of ['n', 'w'] as const) {
    const img = new IsoImage(1, 1, WALL_H);
    // Light from the top left: the north wall (facing +v) is lit, the west wall (facing +u) shaded.
    const [face, edge] = side === 'n' ? ['ecd3a5', 'f6ead0'] : ['c8a46e', 'dab886'];
    img.wallQuad(side, 0, 1, 0, WALL_H, face);
    img.wallQuad(side, 0, 1, WALL_H - 2, WALL_H, edge); // top cap
    img.wallQuad(side, 0, 1, 0, 3, side === 'n' ? 'a98258' : '8a6644'); // skirting
    out.push([`wall/${side}`, img]);
  }
  return out;
}

/** Inset box helper over the whole footprint. */
function slab(img: IsoImage, inset: number, z0: number, z1: number, ramp: Ramp): void {
  img.box(inset, inset, img.fw - inset, img.fh - inset, z0, z1, ramp);
}

/** Which footprint side faces "back" for an oriented object at a rotation. */
function backSide(rot: number): 'v0' | 'u0' | 'v1' | 'u1' {
  return (['v0', 'u0', 'v1', 'u1'] as const)[rot & 3]!;
}

function strip(img: IsoImage, side: 'v0' | 'u0' | 'v1' | 'u1', t: number, inset: number, z0: number, z1: number, ramp: Ramp): void {
  const W = img.fw;
  const H = img.fh;
  const i = inset;
  if (side === 'v0') img.box(i, i, W - i, i + t, z0, z1, ramp);
  if (side === 'v1') img.box(i, H - i - t, W - i, H - i, z0, z1, ramp);
  if (side === 'u0') img.box(i, i, i + t, H - i, z0, z1, ramp);
  if (side === 'u1') img.box(W - i - t, i, W - i, H - i, z0, z1, ramp);
}

type Draw = (img: IsoImage, rot: number) => void;

const DRAW: Record<string, Draw> = {
  stool: (img) => {
    slab(img, 0.3, 0, 6, DARK);
    slab(img, 0.25, 6, 8, KEY);
  },
  chair: (img, rot) => {
    const back = backSide(rot);
    if (back === 'v0' || back === 'u0') strip(img, back, 0.12, 0.22, 8, 20, KEY);
    slab(img, 0.25, 0, 6, DARK);
    slab(img, 0.22, 6, 8, KEY);
    if (back === 'v1' || back === 'u1') strip(img, back, 0.12, 0.22, 8, 20, KEY);
  },
  bench: (img) => {
    slab(img, 0.2, 0, 6, DARK);
    slab(img, 0.15, 6, 8, KEY);
  },
  table: (img) => {
    slab(img, 0.3, 0, 6, WOOD);
    slab(img, 0.12, 6, 8, KEY);
  },
  table_long: (img) => {
    slab(img, 0.25, 0, 8, WOOD);
    slab(img, 0.1, 8, 10, KEY);
  },
  counter: (img, rot) => {
    slab(img, 0.05, 0, 12, WOOD);
    strip(img, backSide(rot + 2), 0.08, 0.05, 2, 11, KEY); // front panel
    slab(img, 0.02, 12, 14, CREAM);
  },
  shelf: (img, rot) => {
    const back = backSide(rot);
    strip(img, back, 0.15, 0.1, 0, 32, DARK);
    for (const z of [0, 10, 20, 30]) slab(img, 0.1, z, z + 2, KEY);
  },
  rug: (img) => {
    slab(img, 0.05, 0, 1, KEY);
    slab(img, 0.3, 1, 1, ['f0c060', 'd9a05b', 'a98258']);
  },
  radio: (img, rot) => {
    slab(img, 0.3, 0, 7, DARK);
    strip(img, backSide(rot + 2), 0.04, 0.3, 2, 6, METAL);
  },
  pot_plant: (img) => {
    slab(img, 0.32, 0, 6, KEY);
    img.box(0.25, 0.25, 0.75, 0.75, 6, 14, GREEN);
    img.box(0.35, 0.35, 0.65, 0.65, 14, 17, ['94b37a', '94b37a', '6b8f5a']);
  },
  teapot: (img, rot) => {
    slab(img, 0.36, 0, 5, KEY);
    slab(img, 0.42, 5, 7, KEY);
    const front = backSide(rot + 2);
    strip(img, front, 0.06, 0.44, 3, 5, KEY);
  },
  wall_clock: (img, rot) => {
    const side = rot & 1 ? 'n' : 'w';
    img.wallQuad(side, 0.3, 0.7, 26, 36, '3d2a22');
    img.wallQuad(side, 0.35, 0.65, 27, 35, 'fff8ea');
    img.wallQuad(side, 0.48, 0.52, 30, 34, '2a1d18');
  },
  poster: (img, rot) => {
    const side = rot & 1 ? 'n' : 'w';
    img.wallQuad(side, 0.25, 0.75, 16, 36, KEY[1]);
    img.wallQuad(side, 0.3, 0.7, 26, 34, KEY[0]);
    img.wallQuad(side, 0.3, 0.7, 18, 22, 'fff8ea');
  },
  ceiling_fan: (img) => {
    img.box(0.47, 0.47, 0.53, 0.53, 44, 58, METAL);
    img.box(0.1, 0.44, 0.9, 0.56, 43, 44, METAL);
    img.box(0.44, 0.1, 0.56, 0.9, 43, 44, METAL);
    img.box(0.4, 0.4, 0.6, 0.6, 41, 45, DARK);
  },
  hanging_lamp: (img) => {
    img.box(0.48, 0.48, 0.52, 0.52, 44, 58, ['2a1d18', '2a1d18', '2a1d18']);
    img.box(0.32, 0.32, 0.68, 0.68, 36, 44, KEY);
    img.box(0.42, 0.42, 0.58, 0.58, 34, 36, ['fff8ea', 'f0c060', 'f0c060']);
  },
};

export function drawObjects(): Array<[string, IsoImage]> {
  const out: Array<[string, IsoImage]> = [];
  for (const o of objects.objects) {
    const draw = DRAW[o.key];
    if (!draw) throw new Error(`no placeholder drawing for ${o.key}`);
    for (let r = 0; r < o.rots; r++) {
      const fw = r & 1 ? o.h : o.w;
      const fh = r & 1 ? o.w : o.h;
      const img = new IsoImage(fw, fh, HEIGHT[o.key] ?? 16);
      draw(img, r);
      out.push([`obj/${o.key}_r${r}`, img]);
    }
  }
  return out;
}

export { WALL_H };
