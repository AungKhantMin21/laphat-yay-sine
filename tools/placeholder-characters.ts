// Placeholder customers (16×24) and order bubbles, palette colours only. Original art for this
// project; replace with hand-made sprites later.
//
// Frames: npc/c<look>_<view>_<pose>, view = f (front, faces down-left) | b (back, faces up-right),
// pose = w0 | w1 (walk) | s (sitting). The renderer mirrors them for the other two directions.
// Feet (or the seat, when sitting) are at the bottom-centre: x = 8, y = 23.
import drinks from '../src/data/drinks.json' with { type: 'json' };

export interface Raw {
  w: number;
  h: number;
  px: Buffer;
}

const OUTLINE = '2a1d18';
const SHOE = '3d2a22';

/** A darker palette colour for the shaded (right) side; light comes from the top left. */
const SHADE: Record<string, string> = {
  fff8ea: 'ecd3a5', f6ead0: 'dab886', ecd3a5: 'c8a46e', '5e9a8e': '3c6e6a', '3c6e6a': '2c3440', e98a5e: 'c85a44',
  '9aa6ae': '6a7884', d9a05b: 'a98258', c8a46e: 'a98258', a98258: '8a6644', '4a3a5a': '2a1d18', '6e4e36': '523a2c',
  '2c3440': '1b1411', '2a1d18': '1b1411', '1b1411': '1b1411', '6a7884': '44505c', c85a44: '9a3a30', '94b37a': '6b8f5a',
};

interface Look {
  shirt: string;
  longyi: string;
  check: string;
  skin: string;
  hair: string;
}

const LOOKS: Look[] = [
  { shirt: 'fff8ea', longyi: '3c6e6a', check: '5e9a8e', skin: 'd9a05b', hair: '1b1411' },
  { shirt: '5e9a8e', longyi: '4a3a5a', check: '6a7884', skin: 'c8a46e', hair: '2a1d18' },
  { shirt: 'e98a5e', longyi: '6e4e36', check: 'a98258', skin: 'a98258', hair: '1b1411' },
  { shirt: '94b37a', longyi: '2c3440', check: '44505c', skin: 'd9a05b', hair: '9aa6ae' },
];

class Canvas implements Raw {
  readonly px: Buffer;
  readonly w: number;
  readonly h: number;
  constructor(w: number, h: number) {
    this.w = w;
    this.h = h;
    this.px = Buffer.alloc(w * h * 4);
  }
  set(x: number, y: number, hex: string): void {
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return;
    const i = (y * this.w + x) * 4;
    this.px[i] = parseInt(hex.slice(0, 2), 16);
    this.px[i + 1] = parseInt(hex.slice(2, 4), 16);
    this.px[i + 2] = parseInt(hex.slice(4, 6), 16);
    this.px[i + 3] = 255;
  }
  filled(x: number, y: number): boolean {
    return x >= 0 && y >= 0 && x < this.w && y < this.h && this.px[(y * this.w + x) * 4 + 3] === 255;
  }
  /** Rows y0..y1 (inclusive), columns x0..x1, right-hand columns shaded. */
  rect(x0: number, y0: number, x1: number, y1: number, hex: string, shadeFrom = x1 + 1): void {
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) this.set(x, y, x >= shadeFrom ? (SHADE[hex] ?? hex) : hex);
  }
  /** 1-px dark outline around everything drawn so far. */
  outline(): void {
    const edge: Array<[number, number]> = [];
    for (let y = 0; y < this.h; y++) {
      for (let x = 0; x < this.w; x++) {
        if (this.filled(x, y)) continue;
        if (this.filled(x - 1, y) || this.filled(x + 1, y) || this.filled(x, y - 1) || this.filled(x, y + 1)) edge.push([x, y]);
      }
    }
    for (const [x, y] of edge) this.set(x, y, OUTLINE);
  }
}

/**
 * One customer frame. `back` hides the face; `step` 0/1 swaps the feet and bobs the body;
 * `sit` lowers the body onto a seat with the knees forward.
 */
function person(look: Look, back: boolean, step: number, sit: boolean): Canvas {
  const c = new Canvas(16, 24);
  const bob = sit ? 4 : step; // sitting: whole upper body 4 px lower
  const top = 2 + bob;
  // Head (rows top+1 … top+6), hair on top.
  c.rect(5, top + 1, 10, top + 6, look.skin, 9);
  c.rect(5, top, 10, top + 1, look.hair, 9);
  if (back) {
    c.rect(5, top + 1, 10, top + 5, look.hair, 9);
  } else {
    c.set(5, top + 2, look.hair); // fringe at the side
    c.set(6, top + 3, OUTLINE); // eyes (looking down-left)
    c.set(8, top + 3, OUTLINE);
  }
  // Shirt with arms.
  const s0 = top + 7;
  c.rect(4, s0, 11, s0 + 6, look.shirt, 9);
  c.rect(3, s0 + 1, 3, s0 + 5, look.shirt);
  c.rect(12, s0 + 1, 12, s0 + 5, SHADE[look.shirt] ?? look.shirt);
  c.set(3, s0 + 6, look.skin);
  c.set(12, s0 + 6, SHADE[look.skin] ?? look.skin);
  // Longyi (checked), then feet.
  const l0 = s0 + 7;
  if (sit) {
    // Lap and shins: the longyi folds forward over the seat, feet hang down.
    c.rect(4, l0, 11, l0 + 2, look.longyi, 9);
    c.rect(back ? 7 : 3, l0 + 1, back ? 12 : 8, l0 + 2, look.longyi);
    c.set(back ? 11 : 4, 23, SHOE);
    c.set(back ? 10 : 5, 23, SHOE);
  } else {
    c.rect(5, l0, 10, 22, look.longyi, 9);
    for (let y = l0; y <= 22; y++) for (let x = 5; x <= 10; x++) if ((x + y) % 3 === 0) c.set(x, y, look.check);
    const [a, b] = step ? [5, 9] : [6, 8];
    c.rect(a, 23, a + 1, 23, SHOE);
    c.rect(b, 23, b + 1, 23, SHOE);
  }
  c.outline();
  return c;
}

/** Drink colour in the bubble's cup, by drink key. */
const CUP: Record<string, string> = { pon_man: 'd9a05b', cho_seint: 'ecd3a5', kya_seint: 'a98258', plain: '8a6644' };

function bubble(inner: (c: Canvas) => void): Canvas {
  const c = new Canvas(13, 13);
  c.rect(1, 1, 11, 9, 'fff8ea');
  c.rect(5, 10, 7, 10, 'fff8ea');
  c.set(6, 11, 'fff8ea');
  inner(c);
  c.outline();
  return c;
}

export function drawCharacters(): Array<[string, Raw]> {
  const out: Array<[string, Raw]> = [];
  LOOKS.forEach((look, i) => {
    for (const back of [false, true]) {
      const v = back ? 'b' : 'f';
      out.push([`npc/c${i}_${v}_w0`, person(look, back, 0, false)]);
      out.push([`npc/c${i}_${v}_w1`, person(look, back, 1, false)]);
      out.push([`npc/c${i}_${v}_s`, person(look, back, 0, true)]);
    }
  });
  for (const d of drinks.presets) {
    const tea = CUP[d.key] ?? 'a98258';
    out.push([
      `ui/bubble_${d.key}`,
      bubble((c) => {
        c.rect(4, 4, 8, 7, tea, 7); // glass
        c.rect(4, 3, 8, 3, 'f6ead0'); // froth
        c.rect(9, 5, 9, 6, '9aa6ae'); // handle glint
      }),
    ]);
  }
  out.push(['ui/bubble_pour', bubble((c) => [3, 6, 9].forEach((x) => c.rect(x, 5, x + 1, 6, '6a7884')))]);
  return out;
}

/** Looks drawn here; customers.json `looks` must not exceed it. */
export const LOOK_COUNT = LOOKS.length;
