// Debug-only GPU stats: draw calls per frame (by wrapping the GL draw functions) and an
// estimate of texture memory. Never installed unless the perf overlay is on.
import type { Renderer, WebGLRenderer } from 'pixi.js';

export class DrawCallCounter {
  private count = 0;
  /** Draw calls in the last completed frame. */
  last = 0;

  constructor(renderer: Renderer) {
    const gl = (renderer as WebGLRenderer).gl as (WebGL2RenderingContext & Record<string, unknown>) | undefined;
    if (!gl) return;
    for (const name of ['drawElements', 'drawArrays', 'drawElementsInstanced', 'drawArraysInstanced'] as const) {
      const orig = gl[name] as ((...a: unknown[]) => void) | undefined;
      if (typeof orig !== 'function') continue;
      const bump = (): void => {
        this.count++;
      };
      (gl as Record<string, unknown>)[name] = function (this: unknown, ...args: unknown[]) {
        bump();
        return orig.apply(this, args);
      };
    }
  }

  beginFrame(): void {
    this.count = 0;
  }

  endFrame(): void {
    this.last = this.count;
  }
}

/** Rough GPU texture bytes: atlas + world render texture + canvas buffers + chunk cache. */
export function estimateTextureBytes(parts: { atlasPx: number; worldW: number; worldH: number; devW: number; devH: number; chunkBytes: number }): number {
  const rgba = 4;
  // Canvas: front + back buffer.
  return (parts.atlasPx + parts.worldW * parts.worldH + parts.devW * parts.devH * 2) * rgba + parts.chunkBytes;
}
