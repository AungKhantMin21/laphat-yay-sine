// Pure sizing math for the pixel stage (tested in test/size.test.ts).

/** World height in pixels the game is designed around. */
export const BASE_H = 270;

export interface StageSize {
  /** Internal (world-pixel) size of the render texture. */
  w: number;
  h: number;
  /** Whole-number upscale from world pixels to device pixels. */
  scale: number;
  /** Canvas backing size in device pixels. */
  devW: number;
  devH: number;
}

/**
 * Picks the integer scale so the world is at least BASE_H rows high (when the screen allows),
 * and fills the screen exactly: wider or taller screens see a little more world, never bars.
 */
export function computeSize(cssW: number, cssH: number, dpr: number, renderScale = 1): StageSize {
  const devW = Math.max(1, Math.round(cssW * dpr * renderScale));
  const devH = Math.max(1, Math.round(cssH * dpr * renderScale));
  const scale = Math.max(1, Math.floor(devH / BASE_H));
  return { w: Math.ceil(devW / scale), h: Math.ceil(devH / scale), scale, devW, devH };
}
