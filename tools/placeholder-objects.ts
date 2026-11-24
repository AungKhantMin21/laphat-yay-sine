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
const CLAY: Ramp = ['c85a44', '9a3a30', '6a2a26'];
const GLASS: Ramp = ['fff8ea', '9aa6ae', '6a7884'];
const SOOT: Ramp = ['3d2a22', '2a1d18', '1b1411'];

/** Height in px above the footprint per object (sprite headroom). */
const HEIGHT: Record<string, number> = {
  stool: 8, chair: 22, bench: 10, table: 10, table_long: 14, counter: 24, shelf: 34, rug: 2,
  radio: 10, book_stack: 9, news_rack: 26, pot_plant: 24, teapot: 9, wall_clock: 56, poster: 56, ceiling_fan: 60, hanging_lamp: 60,
  kettle: 12, sink: 18, stove: 16,
};

/** Four legs at the footprint corners, inset `i`, `t` thick. */
function legs(img: IsoImage, i: number, t: number, z1: number, ramp: Ramp): void {
  const W = img.fw;
  const H = img.fh;
  img.box(i, i, i + t, i + t, 0, z1, ramp);
  img.box(W - i - t, i, W - i, i + t, 0, z1, ramp);
  img.box(i, H - i - t, i + t, H - i, 0, z1, ramp);
  img.box(W - i - t, H - i - t, W - i, H - i, 0, z1, ramp);
}

const WALL_H = 40;

/** Low sill height in px. */
const SILL_H = 8;

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
    // Low sill (front, east side, kitchen partition): same wall, cut down so the room stays visible.
    const low = new IsoImage(1, 1, WALL_H);
    low.wallQuad(side, 0, 1, 0, SILL_H, side === 'n' ? 'c8a46e' : 'a98258');
    low.wallQuad(side, 0, 1, SILL_H - 2, SILL_H, side === 'n' ? 'ecd3a5' : 'dab886');
    out.push([`wall/low_${side}`, low]);
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
    // Low tea-shop stool: four short legs, a round-ish seat at knee height.
    legs(img, 0.28, 0.08, 4, DARK);
    slab(img, 0.24, 4, 6, KEY);
    slab(img, 0.32, 6, 6, KEY);
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
    // Low table: thin legs, wide top with a darker rim.
    legs(img, 0.16, 0.08, 6, WOOD);
    slab(img, 0.08, 6, 7, DARK);
    slab(img, 0.1, 7, 8, KEY);
  },
  table_long: (img) => {
    slab(img, 0.25, 0, 8, WOOD);
    slab(img, 0.1, 8, 10, KEY);
  },
  counter: (img, rot) => {
    // Tea counter: wooden body, coloured front panel, cream top, a small glass case at the back.
    slab(img, 0.05, 0, 12, WOOD);
    strip(img, backSide(rot + 2), 0.08, 0.05, 2, 11, KEY); // front panel
    slab(img, 0.02, 12, 14, CREAM);
    strip(img, backSide(rot), 0.3, 0.12, 14, 21, GLASS);
    strip(img, backSide(rot), 0.3, 0.16, 15, 16, ['f0c060', 'd9a05b', 'a98258']); // snacks inside
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
  book_stack: (img) => {
    // Three books, a little askew, spines in different colours.
    img.box(0.25, 0.3, 0.75, 0.7, 0, 3, ['fff8ea', 'c85a44', '9a3a30']);
    img.box(0.3, 0.25, 0.72, 0.68, 3, 6, ['fff8ea', '3c6e6a', '2c3440']);
    img.box(0.28, 0.32, 0.7, 0.72, 6, 8, ['fff8ea', 'f0c060', 'd9a05b']);
  },
  news_rack: (img, rot) => {
    // A slanted wooden rack with folded newspapers.
    const back = backSide(rot);
    strip(img, back, 0.15, 0.15, 0, 24, KEY);
    for (const z of [4, 12, 20]) strip(img, back, 0.35, 0.18, z, z + 5, ['f6ead0', 'ecd3a5', 'c8a46e']);
    legs(img, 0.15, 0.08, 4, DARK);
  },
  pot_plant: (img) => {
    // Clay pot with a bushy top: overlapping leaf clumps make a clear round silhouette.
    slab(img, 0.32, 0, 7, KEY);
    img.box(0.18, 0.3, 0.6, 0.72, 7, 15, GREEN);
    img.box(0.4, 0.2, 0.82, 0.62, 9, 17, GREEN);
    img.box(0.28, 0.28, 0.7, 0.7, 14, 21, ['94b37a', '6b8f5a', '46573a']);
    img.box(0.42, 0.42, 0.58, 0.58, 20, 23, ['94b37a', '94b37a', '6b8f5a']);
  },
  teapot: (img, rot) => {
    slab(img, 0.36, 0, 5, KEY);
    slab(img, 0.42, 5, 7, KEY);
    const front = backSide(rot + 2);
    strip(img, front, 0.06, 0.44, 3, 5, KEY);
  },
  kettle: (img, rot) => {
    // Aluminium kettle: squat body, lid knob, a spout towards the front.
    img.box(0.28, 0.28, 0.72, 0.72, 0, 6, METAL);
    img.box(0.34, 0.34, 0.66, 0.66, 6, 7, METAL);
    img.box(0.46, 0.46, 0.54, 0.54, 7, 9, SOOT);
    strip(img, backSide(rot + 2), 0.12, 0.44, 3, 6, METAL);
    strip(img, backSide(rot), 0.06, 0.4, 7, 10, SOOT); // handle
  },
  sink: (img, rot) => {
    // Concrete sink: grey cabinet, dark basin, a tap at the back.
    slab(img, 0.05, 0, 12, METAL);
    slab(img, 0.14, 10, 12, SOOT);
    strip(img, backSide(rot), 0.08, 0.45, 12, 17, METAL);
  },
  stove: (img, rot) => {
    // Clay stove: red-brown base, sooty top, a glowing fire hole at the front and a pot on top.
    slab(img, 0.05, 0, 9, CLAY);
    slab(img, 0.08, 9, 10, SOOT);
    strip(img, backSide(rot + 2), 0.04, 0.3, 2, 6, ['f0c060', 'e98a5e', 'c85a44']);
    img.box(img.fw / 2 - 0.3, img.fh / 2 - 0.3, img.fw / 2 + 0.3, img.fh / 2 + 0.3, 10, 15, METAL);
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
      // Drop shadow under everything that stands on the floor (light from the top left: offset right),
      // in a shade of the floor it usually stands on: shop terrazzo, or the grey kitchen concrete.
      if (o.layer === 'furniture') {
        const small = 'small' in o && o.small;
        const kitchen = 'zone' in o && o.zone === 'kitchen';
        img.shadow(fw / 2 + 0.12, fh / 2 + 0.08, fw / 2 - (small ? 0.14 : 0.04), fh / 2 - (small ? 0.14 : 0.04), kitchen ? '44505c' : 'a98258');
      }
      out.push([`obj/${o.key}_r${r}`, img]);
    }
  }
  return out;
}

export { WALL_H };

/** Neighbouring building fronts: one-tile segments on a north edge (see src/shared/street.ts). */
export function drawFacades(): Array<[string, IsoImage]> {
  // [wall, trim, cap] per colourway; lit like a north wall (light from the top left).
  const WAYS: Array<[string, string, string]> = [
    ['ecd3a5', 'c8a46e', '8a6644'],
    ['5e9a8e', '3c6e6a', '2c3440'],
    ['e98a5e', 'c85a44', '6a2a26'],
  ];
  const out: Array<[string, IsoImage]> = [];
  for (const tall of [true, false]) {
    const H = tall ? 48 : 24;
    WAYS.forEach(([wall, trim, cap], v) => {
      for (const kind of ['pillar', 'door', 'window'] as const) {
        const img = new IsoImage(1, 1, H);
        const q = (a0: number, a1: number, z0: number, z1: number, hex: string) => img.wallQuad('n', a0, a1, z0, z1, hex);
        q(0, 1, 0, H, kind === 'pillar' ? trim : wall);
        q(0, 1, 0, 2, '3d2a22'); // skirting
        q(0, 1, H - 3, H, cap); // roof edge
        if (tall) q(0, 1, 22, 24, trim); // floor line between storeys
        if (kind === 'door') {
          // Rolled-down metal shutter of a closed shop, ribbed.
          q(0.1, 0.9, 2, 19, '6a7884');
          for (let z = 4; z < 19; z += 3) q(0.1, 0.9, z, z + 1, '9aa6ae');
          q(0.06, 0.94, 19, 21, trim);
        }
        if (kind === 'window') {
          q(0.2, 0.8, 8, 17, '44505c');
          q(0.25, 0.5, 9, 16, '6a7884');
          q(0.2, 0.8, 7, 8, trim);
        }
        if (tall && kind !== 'pillar') {
          q(0.25, 0.75, 30, 41, '44505c');
          q(0.3, 0.5, 31, 40, '9aa6ae');
          q(0.2, 0.8, 29, 30, trim); // sill
        }
        out.push([`facade/${tall ? 't' : 'l'}${v}_${kind}`, img]);
      }
    });
  }
  return out;
}

/** Shop-front heights (px above the floor); src/render/shopfront.ts uses the same frames. */
const SHUTTER_TOP = 34;

/** The tea shop's own front: roll-up shutter (closed / rolled up), striped awning, signboard. */
export function drawShopFront(): Array<[string, IsoImage]> {
  const out: Array<[string, IsoImage]> = [];
  const closed = new IsoImage(1, 1, 44);
  closed.wallQuad('n', 0, 1, 0, SHUTTER_TOP, '3c6e6a');
  for (let z = 3; z < SHUTTER_TOP; z += 3) closed.wallQuad('n', 0, 1, z, z + 1, '5e9a8e');
  closed.wallQuad('n', 0, 1, SHUTTER_TOP, SHUTTER_TOP + 4, '2c3440'); // shutter box
  closed.wallQuad('n', 0, 1, 0, 1, '2c3440'); // bottom bar
  out.push(['shop/shutter_closed', closed]);
  const open = new IsoImage(1, 1, 44);
  open.wallQuad('n', 0, 1, SHUTTER_TOP, SHUTTER_TOP + 4, '2c3440');
  open.wallQuad('n', 0, 1, SHUTTER_TOP - 2, SHUTTER_TOP, '3c6e6a'); // the rolled-up edge
  out.push(['shop/shutter_open', open]);
  // Awning: slopes out over the pavement (+v) from above the shutter box; red and cream stripes.
  for (const [k, hex] of [['a', 'c85a44'], ['b', 'f6ead0']] as const) {
    const aw = new IsoImage(1, 1, 52);
    const P = (u: number, v: number, z: number) => aw.at(u, v, z);
    aw.poly([P(0, 0, 44), P(1, 0, 44), P(1, 0.7, 36), P(0, 0.7, 36)], hex);
    aw.poly([P(0, 0.7, 36), P(1, 0.7, 36), P(1, 0.7, 33), P(0, 0.7, 33)], k === 'a' ? '9a3a30' : 'ecd3a5'); // valance
    out.push([`shop/awning_${k}`, aw]);
  }
  // Signboard on a post: cream board, red border, a glass of tea.
  const sign = new IsoImage(1, 1, 50);
  sign.wallQuad('n', 0.45, 0.55, 0, 30, '3d2a22'); // post
  sign.wallQuad('n', 0, 1, 30, 46, '9a3a30');
  sign.wallQuad('n', 0.06, 0.94, 31, 45, 'fff8ea');
  sign.wallQuad('n', 0.38, 0.62, 34, 42, 'a98258'); // tea
  sign.wallQuad('n', 0.38, 0.62, 41, 42, 'f6ead0'); // froth
  sign.wallQuad('n', 0.15, 0.3, 37, 38, 'c85a44'); // lettering marks
  sign.wallQuad('n', 0.7, 0.85, 37, 38, 'c85a44');
  out.push(['shop/sign', sign]);
  return out;
}

/**
 * Neighbourhood shop stalls (M3): per front tile a back wall with shelves (`stall/<k>_back`) and
 * a counter with goods under a striped awning (`stall/<k>_front_<a|b>`), plus one signboard per
 * shop (`stall/<k>_sign`). Drawn facing +v (a south-facing front); src/render/street-shops.ts
 * mirrors them for fronts on a −x edge. The keeper stands between the two.
 */
export function drawStalls(): Array<[string, IsoImage]> {
  type Stall = { wall: string; trim: string; awning: [string, string]; goods: (img: IsoImage) => void; shelf: (img: IsoImage) => void; sign: string };
  const STALLS: Record<string, Stall> = {
    market: {
      wall: '5e9a8e',
      trim: '3c6e6a',
      awning: ['94b37a', 'f6ead0'],
      goods: (img) => {
        img.box(0.08, 0.55, 0.45, 0.95, 12, 15, ['94b37a', '6b8f5a', '46573a']); // greens
        img.box(0.55, 0.55, 0.92, 0.95, 12, 15, ['e98a5e', 'c85a44', '9a3a30']); // fruit
        img.box(0.6, 0.6, 0.8, 0.8, 15, 17, ['f0c060', 'd9a05b', 'a98258']);
      },
      shelf: (img) => {
        for (const [a, hex] of [[0.1, 'ecd3a5'], [0.4, 'c8a46e'], [0.7, 'ecd3a5']] as const) img.wallQuad('n', a, a + 0.22, 14, 24, hex); // sacks of tea
        img.wallQuad('n', 0, 1, 13, 14, '2c3440');
      },
      sign: '46573a',
    },
    books: {
      wall: 'ecd3a5',
      trim: 'c8a46e',
      awning: ['4a3a5a', 'f6ead0'],
      goods: (img) => {
        img.box(0.1, 0.6, 0.4, 0.9, 12, 16, ['fff8ea', 'c85a44', '9a3a30']);
        img.box(0.5, 0.6, 0.85, 0.9, 12, 14, ['fff8ea', '3c6e6a', '2c3440']);
      },
      shelf: (img) => {
        const spines = ['c85a44', '3c6e6a', 'f0c060', '4a3a5a', '94b37a', 'e98a5e'];
        for (const z of [12, 24]) {
          img.wallQuad('n', 0, 1, z - 1, z, '6e4e36');
          spines.forEach((hex, k) => img.wallQuad('n', 0.06 + k * 0.15, 0.17 + k * 0.15, z, z + 9, hex));
        }
      },
      sign: '4a3a5a',
    },
    furniture: {
      wall: 'a98258',
      trim: '6e4e36',
      awning: ['c85a44', 'f6ead0'],
      goods: (img) => {
        img.box(0.15, 0.6, 0.45, 0.9, 12, 18, ['d9a05b', 'a98258', '8a6644']); // a stool
        img.box(0.55, 0.55, 0.9, 0.95, 16, 18, ['d9a05b', 'a98258', '8a6644']); // a small table top
        img.box(0.6, 0.6, 0.66, 0.66, 12, 16, ['8a6644', '6e4e36', '523a2c']);
      },
      shelf: (img) => {
        img.wallQuad('n', 0.1, 0.45, 10, 30, '8a6644'); // a cupboard
        img.wallQuad('n', 0.15, 0.4, 12, 28, '6e4e36');
        img.wallQuad('n', 0.55, 0.9, 18, 22, '8a6644'); // a shelf
      },
      sign: '6e4e36',
    },
    hardware: {
      wall: '9aa6ae',
      trim: '6a7884',
      awning: ['5e9a8e', 'f6ead0'],
      goods: (img) => {
        const cans: Array<[string, string, string]> = [
          ['e98a5e', 'c85a44', '9a3a30'],
          ['94b37a', '6b8f5a', '46573a'],
          ['f0c060', 'd9a05b', 'a98258'],
        ];
        cans.forEach((r, k) => img.box(0.1 + k * 0.28, 0.65, 0.3 + k * 0.28, 0.85, 12, 17, r));
      },
      shelf: (img) => {
        for (const [a, hex] of [[0.05, 'c85a44'], [0.3, 'f6ead0'], [0.55, '3c6e6a'], [0.8, 'c8a46e']] as const) img.wallQuad('n', a, a + 0.15, 16, 22, hex); // tiles
        img.wallQuad('n', 0, 1, 15, 16, '44505c');
        img.wallQuad('n', 0.2, 0.25, 26, 34, '44505c'); // hanging tools
        img.wallQuad('n', 0.6, 0.66, 27, 33, '6e4e36');
      },
      sign: '44505c',
    },
  };
  const out: Array<[string, IsoImage]> = [];
  for (const [k, s] of Object.entries(STALLS)) {
    const back = new IsoImage(1, 1, 46);
    back.wallQuad('n', 0, 1, 0, 44, s.wall);
    back.wallQuad('n', 0, 1, 0, 2, '3d2a22');
    back.wallQuad('n', 0, 1, 41, 44, s.trim);
    s.shelf(back);
    back.box(0, 0, 1, 1, 0, 0, ['523a2c', '523a2c', '523a2c']); // stall floor
    out.push([`stall/${k}_back`, back]);
    for (const [ab, hex] of [['a', s.awning[0]], ['b', s.awning[1]]] as const) {
      const front = new IsoImage(1, 1, 48);
      const P = (u: number, v: number, z: number) => front.at(u, v, z);
      front.box(0, 0.5, 1, 1, 0, 12, [s.trim, s.wall, s.trim]); // counter
      front.box(0, 0.5, 1, 1, 11, 12, ['8a6644', '6e4e36', '523a2c']); // counter top
      s.goods(front);
      front.poly([P(0, 0, 44), P(1, 0, 44), P(1, 0.95, 34), P(0, 0.95, 34)], hex);
      front.poly([P(0, 0.95, 34), P(1, 0.95, 34), P(1, 0.95, 31), P(0, 0.95, 31)], ab === 'a' ? s.trim : 'ecd3a5'); // valance
      out.push([`stall/${k}_front_${ab}`, front]);
    }
    const sign = new IsoImage(1, 1, 58);
    sign.wallQuad('n', 0, 1, 44, 56, s.sign);
    sign.wallQuad('n', 0.06, 0.94, 45, 55, 'fff8ea');
    for (let a = 0.15; a < 0.85; a += 0.18) sign.wallQuad('n', a, a + 0.1, 49, 51, s.sign); // lettering marks
    out.push([`stall/${k}_sign`, sign]);
  }
  return out;
}
