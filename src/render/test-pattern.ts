// Temporary M0 pattern to check crisp pixels and the integer upscale. Replaced by the iso grid (step 8).
import { Graphics, type Container } from 'pixi.js';
import type { StageSize } from './size';

export function drawTestPattern(world: Container, size: StageSize): void {
  world.removeChildren().forEach((c) => c.destroy());
  const g = new Graphics();
  // 1-px checker border and a 2:1 iso diamond (32×16) row.
  for (let x = 0; x < size.w; x += 2) g.rect(x, 0, 1, 1).rect(x + 1, size.h - 1, 1, 1);
  for (let y = 0; y < size.h; y += 2) g.rect(0, y, 1, 1).rect(size.w - 1, y + 1, 1, 1);
  g.fill(0xd9a05b);
  for (let i = 0; i < 8; i++) {
    const cx = 40 + i * 34;
    const cy = 60;
    g.poly([cx, cy - 8, cx + 16, cy, cx, cy + 8, cx - 16, cy]).fill(i % 2 ? 0x6b8f5a : 0x8a5a3c);
  }
  // Size readout bars: 480 marker and 270 marker.
  g.rect(0, 100, Math.min(480, size.w), 1).fill(0xf3e6cf);
  g.rect(240, 0, 1, Math.min(270, size.h)).fill(0xf3e6cf);
  world.addChild(g);
}
