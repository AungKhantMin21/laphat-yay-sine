// Loads the sprite atlas (lossless WebP, PNG fallback) and cuts it into frame textures.
// Our own tiny JSON format from tools/pack-atlas: { size, frames: { name: [x, y, w, h] } }.
import { Rectangle, Texture } from 'pixi.js';
import atlasJson from '../../assets/atlas/atlas-0.json';
import webpUrl from '../../assets/atlas/atlas-0.webp?url';
import pngUrl from '../../assets/atlas/atlas-0.png?url';

export type Atlas = Map<string, Texture>;

// 1×1 lossless WebP.
const WEBP_PROBE = 'data:image/webp;base64,UklGRhoAAABXRUJQVlA4TA0AAAAvAAAAEAcQERGIiP4HAA==';

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`image failed: ${src}`));
    img.src = src;
  });
}

async function supportsWebp(): Promise<boolean> {
  try {
    const img = await loadImage(WEBP_PROBE);
    return img.width === 1;
  } catch {
    return false;
  }
}

export async function loadAtlas(): Promise<Atlas> {
  let img: HTMLImageElement;
  try {
    img = await loadImage((await supportsWebp()) ? webpUrl : pngUrl);
  } catch {
    img = await loadImage(pngUrl);
  }
  const base = Texture.from(img);
  base.source.scaleMode = 'nearest';
  base.source.autoGenerateMipmaps = false;
  const out: Atlas = new Map();
  for (const [name, f] of Object.entries(atlasJson.frames as Record<string, number[]>)) {
    const [x = 0, y = 0, w = 0, h = 0] = f;
    out.set(name, new Texture({ source: base.source, frame: new Rectangle(x, y, w, h) }));
  }
  return out;
}

/** Floor textures indexed by FLOOR type, from src/data/floors.json. Missing frames → EMPTY. */
export function floorTextures(atlas: Atlas, map: Record<string, string>, count: number): Texture[] {
  const out: Texture[] = [];
  for (let t = 0; t < count; t++) {
    const name = map[String(t)];
    out.push((name && atlas.get(name)) || Texture.EMPTY);
  }
  return out;
}
