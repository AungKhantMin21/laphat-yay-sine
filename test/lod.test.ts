// M4 S3: Near/Far LOD — only customers and residents inside the viewport (plus a margin) are on the
// wire; moving the view spawns and despawns them on the mirror; the simulation never depends on it.
import { describe, expect, it } from 'vitest';
import { Game } from '../src/sim/game';
import { FrameWriter, readFrame } from '../src/shared/diff';
import { MINUTES_PER_DAY, RESIDENT_SLOT0, WORKER_SLOT0 } from '../src/shared/layout';
import { NEIGHBOURHOOD } from '../src/shared/neighbourhood';
import { TICK_HZ } from '../src/shared/protocol';
import { SHOP } from '../src/shared/shop';
import { WorldView } from '../src/game/view';
import { NEAR_MARGIN } from '../src/sim/npc/near';
import { Bot } from './bot';

const buf = new ArrayBuffer(1 << 18);
const w = new FrameWriter();

function mirror(g: Game): WorldView {
  const v = new WorldView();
  v.setArea(0, NEIGHBOURHOOD.w, NEIGHBOURHOOD.h);
  w.begin(buf, g.sim.tick, g.sim.gameMinute);
  g.writeSnapshot(w);
  readFrame(w.finish(), v);
  return v;
}
function step(g: Game, v?: WorldView): void {
  w.begin(buf, g.sim.tick, g.sim.gameMinute);
  g.step(w);
  const f = w.finish();
  if (v) readFrame(f, v);
}
/** Customers and residents alive in the sim at NPC slot i (positions in tiles), or null. */
function simPos(g: Game, i: number): [number, number] | null {
  if (i < RESIDENT_SLOT0) return g.npcs.alive[i] ? [g.npcs.x[i]!, g.npcs.y[i]!] : null;
  const r = i - RESIDENT_SLOT0;
  return g.residents.shown[r] ? [g.residents.x[r]!, g.residents.y[r]!] : null;
}

describe('Near LOD streaming', () => {
  it('a mirror holds exactly the NPCs inside the view (plus margin), as the view moves', () => {
    const g = Game.create(21);
    const bot = new Bot(g, 0);
    g.act({ k: 'openShop' });
    const v = mirror(g);
    // Around the tea shop, then the wet market, then the lane.
    const views: [number, number, number, number][] = [
      [20, 8, 40, 24],
      [58, 30, 76, 46],
      [80, 44, 100, 56],
    ];
    let checked = 0;
    for (const [x0, y0, x1, y1] of views) {
      g.setViewport(x0, y0, x1, y1);
      for (let k = 0; k < 3000; k++) {
        bot.tick();
        step(g, v);
        if (k % 50) continue;
        for (let i = 1; i < WORKER_SLOT0; i++) {
          const p = simPos(g, i);
          const inside = !!p && p[0] >= x0 - NEAR_MARGIN && p[0] < x1 + NEAR_MARGIN && p[1] >= y0 - NEAR_MARGIN && p[1] < y1 + NEAR_MARGIN;
          expect(v.npcLive[i], `slot ${i}`).toBe(inside ? 1 : 0);
          if (inside) checked++;
        }
      }
    }
    expect(checked).toBeGreaterThan(50);
    // The player is always on the wire, wherever the view is.
    expect(v.npcLive[WORKER_SLOT0]).toBe(1);
  });

  it('nothing off the view is streamed: frames carry no states for far NPCs', () => {
    const g = Game.create(22);
    g.act({ k: 'openShop' });
    g.setViewport(100, 60, 110, 70); // the far end of the lane
    const v = mirror(g);
    let states = 0;
    const orig = v.npcState.bind(v);
    v.npcState = (slot, x, y, dir, anim) => {
      if (slot < WORKER_SLOT0) {
        const p = simPos(g, slot);
        expect(!!p && p[0] >= 100 - NEAR_MARGIN && p[1] >= 60 - NEAR_MARGIN).toBe(true);
        states++;
      }
      orig(slot, x, y, dir, anim);
    };
    for (let k = 0; k < 2000; k++) step(g, v);
    // Customers walk to the shop all morning; none of them come near the lane's end.
    expect(g.npcs.count).toBeGreaterThan(0);
    expect(states).toBeLessThan(200);
  });

  it('where the camera looks never changes the simulation', () => {
    const run = (view: [number, number, number, number] | null): number[] => {
      const g = Game.create(23);
      const bot = new Bot(g, 0);
      if (view) g.setViewport(...view);
      g.act({ k: 'openShop' });
      const end = SHOP.close;
      for (let i = 0; i < MINUTES_PER_DAY * TICK_HZ && g.sim.gameMinute < end; i++) {
        bot.tick();
        step(g);
      }
      const out = [g.builder.money, g.day.today.served, g.npcs.count];
      for (let r = 0; r < g.residents.capacity; r++) out.push(g.residents.tile[r]!, g.residents.visits[r]!);
      return out;
    };
    const a = run(null);
    expect(run([20, 8, 40, 24])).toEqual(a);
    expect(run([90, 60, 100, 70])).toEqual(a);
  });
});
