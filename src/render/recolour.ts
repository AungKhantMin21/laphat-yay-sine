// Recoloured object frames, built on demand: key-ramp pixels (ramp 0) are swapped for the chosen
// ramp and packed into one runtime "variant atlas" canvas, so sprites still batch (2 textures).
import { Rectangle, Texture, TextureSource } from 'pixi.js';
import { CATALOG } from '../shared/catalog';
import type { Atlas } from './atlas';

const SIZE = 1024;
const PAD = 1;

export class Recolourer {
  private readonly canvas = document.createElement('canvas');
  private readonly g: CanvasRenderingContext2D;
  private readonly source: TextureSource;
  private readonly cache = new Map<string, Texture>();
  private x = 0;
  private y = 0;
  private shelf = 0;

  constructor(private readonly atlas: Atlas) {
    this.canvas.width = SIZE;
    this.canvas.height = SIZE;
    this.g = this.canvas.getContext('2d', { willReadFrequently: true })!;
    this.source = Texture.from(this.canvas).source;
    this.source.scaleMode = 'nearest';
    this.source.autoGenerateMipmaps = false;
  }

  /** Texture for a frame in a colour ramp; ramp 0 (or a missing frame) uses the main atlas. */
  get(frame: string, colour: number): Texture {
    const base = this.atlas.get(frame) ?? Texture.EMPTY;
    if (colour <= 0 || colour >= CATALOG.ramps.length) return base;
    const key = `${frame}|${colour}`;
    let tex = this.cache.get(key);
    if (tex) return tex;
    const rect = this.atlas.frames.get(frame);
    if (!rect) return base;
    tex = this.build(rect, colour) ?? base;
    this.cache.set(key, tex);
    return tex;
  }

  private build([fx, fy, fw, fh]: [number, number, number, number], colour: number): Texture | null {
    if (this.x + fw + PAD > SIZE) {
      this.x = 0;
      this.y += this.shelf + PAD;
      this.shelf = 0;
    }
    if (this.y + fh > SIZE) {
      console.warn('recolour atlas full'); // M3+: second page or eviction
      return null;
    }
    const src = this.atlas.pixels;
    const out = this.g.createImageData(fw, fh);
    const key = CATALOG.ramps[0]!;
    const ramp = CATALOG.ramps[colour]!;
    for (let y = 0; y < fh; y++) {
      for (let x = 0; x < fw; x++) {
        const s = ((fy + y) * src.width + fx + x) * 4;
        const d = (y * fw + x) * 4;
        const rgb = (src.data[s]! << 16) | (src.data[s + 1]! << 8) | src.data[s + 2]!;
        const k = key.indexOf(rgb);
        const c = k >= 0 && src.data[s + 3]! > 0 ? ramp[k]! : rgb;
        out.data[d] = c >> 16;
        out.data[d + 1] = (c >> 8) & 0xff;
        out.data[d + 2] = c & 0xff;
        out.data[d + 3] = src.data[s + 3]!;
      }
    }
    this.g.putImageData(out, this.x, this.y);
    const tex = new Texture({ source: this.source, frame: new Rectangle(this.x, this.y, fw, fh) });
    this.source.update();
    this.x += fw + PAD;
    this.shelf = Math.max(this.shelf, fh);
    return tex;
  }
}
