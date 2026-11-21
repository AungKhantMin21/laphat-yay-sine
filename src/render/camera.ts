// Camera: centre in world pixels, clamped to the area, snapped to whole pixels when applied.
import type { Container } from 'pixi.js';
import { areaBounds } from '../shared/iso';
import type { StageSize } from './size';

export class Camera {
  x = 0;
  y = 0;
  private bx0 = 0;
  private by0 = 0;
  private bx1 = 0;
  private by1 = 0;
  /** Current view rect in world pixels (valid after apply). */
  readonly view = { x0: 0, y0: 0, x1: 0, y1: 0 };

  setArea(w: number, h: number): void {
    [this.bx0, this.by0, this.bx1, this.by1] = areaBounds(w, h);
  }

  centreOn(x: number, y: number): void {
    this.x = x;
    this.y = y;
  }

  pan(dx: number, dy: number): void {
    this.x += dx;
    this.y += dy;
  }

  apply(world: Container, size: StageSize): void {
    // Keep the centre inside the area; if the view is bigger than the area, centre it.
    const hw = size.w / 2;
    const hh = size.h / 2;
    this.x = clampCentre(this.x, this.bx0, this.bx1, hw);
    this.y = clampCentre(this.y, this.by0, this.by1, hh);
    const ox = Math.round(hw - this.x);
    const oy = Math.round(hh - this.y);
    world.position.set(ox, oy);
    this.view.x0 = -ox;
    this.view.y0 = -oy;
    this.view.x1 = -ox + size.w;
    this.view.y1 = -oy + size.h;
  }
}

function clampCentre(c: number, lo: number, hi: number, half: number): number {
  if (hi - lo <= half * 2) return (lo + hi) / 2;
  return Math.min(hi - half, Math.max(lo + half, c));
}
