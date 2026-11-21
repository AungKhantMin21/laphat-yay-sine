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
  /** Device pixels per CSS pixel (devicePixelRatio × render scale). */
  devPerCss: number;
  /** Whole-scale zoom offset applied (0 = default). */
  zoom: number;
}

/** Zoom offsets allowed for a screen: one step out (never below ×1) and two steps in. */
export function zoomRange(devH: number): [number, number] {
  const base = Math.max(1, Math.floor(devH / BASE_H));
  return [Math.max(1, base - 1) - base, 2];
}

/**
 * Picks the integer scale so the world is at least BASE_H rows high (when the screen allows),
 * and fills the screen exactly: wider or taller screens see a little more world, never bars.
 */
export function computeSize(cssW: number, cssH: number, dpr: number, renderScale = 1, zoom = 0): StageSize {
  const devPerCss = dpr * renderScale;
  const devW = Math.max(1, Math.round(cssW * devPerCss));
  const devH = Math.max(1, Math.round(cssH * devPerCss));
  const [zMin, zMax] = zoomRange(devH);
  const z = Math.min(zMax, Math.max(zMin, Math.round(zoom)));
  const scale = Math.max(1, Math.floor(devH / BASE_H) + z);
  return { w: Math.ceil(devW / scale), h: Math.ceil(devH / scale), scale, devW, devH, devPerCss, zoom: z };
}
