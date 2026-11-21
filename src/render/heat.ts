// Heat overlay: one property grid drawn as tinted tile diamonds under the furniture, on owned tiles.
// Redrawn only when the streamed grid changes or the property is switched.
import { Graphics } from 'pixi.js';
import { isoX, isoY } from '../shared/iso';
import { ZONE } from '../shared/layout';
import type { WorldView } from '../game/view';

/** Tint per property (PROP order: comfort, light, noise, warmth, shade, beauty, smell, cover). */
const COLOURS = [0x94b37a, 0xf0c060, 0xe98a5e, 0xc85a44, 0x6a7884, 0x5e9a8e, 0xd9a05b, 0x9aa6ae];

export class HeatLayer {
  readonly g = new Graphics();
  private prop = -1;

  constructor(private readonly view: WorldView) {
    this.g.visible = false;
  }

  show(prop: number): void {
    this.prop = prop;
    this.g.visible = prop >= 0;
    if (prop >= 0) this.redraw();
    else this.g.clear();
  }

  /** Call every frame; cheap when nothing changed. */
  update(): void {
    const d = this.view.gridsDirty;
    if (d.empty) return;
    d.clear();
    if (this.prop >= 0) this.redraw();
  }

  private redraw(): void {
    const grid = this.view.grids[this.prop];
    const g = this.g;
    g.clear();
    if (!grid) return;
    const a = this.view.area;
    const colour = COLOURS[this.prop] ?? 0xffffff;
    // Four alpha bands keep this to four fills (one batch) instead of one per tile.
    for (let band = 1; band <= 4; band++) {
      let any = false;
      for (let y = 0; y < a.h; y++) {
        for (let x = 0; x < a.w; x++) {
          // Only the player's own space: that's where building decisions happen.
          if (!(a.zone[y * a.w + x]! & ZONE.owned)) continue;
          const v = grid[y * a.w + x]!;
          if (v === 0 || Math.min(4, 1 + (v >> 5)) !== band) continue;
          const vx = isoX(x, y);
          const vy = isoY(x, y);
          g.poly([vx, vy + 1, vx + 15, vy + 8, vx, vy + 15, vx - 15, vy + 8]);
          any = true;
        }
      }
      if (any) g.fill({ color: colour, alpha: 0.18 + band * 0.12 });
    }
  }
}
