import { describe, expect, it } from 'vitest';
import atlasJson from '../assets/atlas/atlas-0.json';
import { Game } from '../src/sim/game';
import { WorldView } from '../src/game/view';
import { CATALOG } from '../src/shared/catalog';
import { CUSTOMERS } from '../src/shared/customers';
import { FrameWriter, readFrame } from '../src/shared/diff';
import { DRINKS } from '../src/shared/drinks';
import { ANIM, DIR, ORDER } from '../src/shared/npc';
import { POSES, VIEWS, poseFlipped, poseFrameName, poseIndex, standingDepth } from '../src/render/npc-pose';
import { objectDepth } from '../src/render/objects-depth';
import { CS } from '../src/sim/npc/customers';

const frames = (atlasJson as { frames: Record<string, unknown> }).frames;

describe('customer art', () => {
  it('the atlas has every look, view and pose customers.json can ask for, and a bubble per drink', () => {
    for (let l = 0; l < CUSTOMERS.looks; l++) {
      for (let v = 0; v < VIEWS.length; v++) for (let p = 0; p < POSES.length; p++) expect(frames[poseFrameName(l, v, p)], poseFrameName(l, v, p)).toBeDefined();
    }
    for (const d of DRINKS.defs) expect(frames[`ui/bubble_${d.key}`]).toBeDefined();
    expect(frames['ui/bubble_pour']).toBeDefined();
  });

  it('pose index: front for south/east, back for north/west, mirrored east/west; walk alternates, sitting has its own frame', () => {
    expect(poseIndex(0, DIR.south, ANIM.stand, 1)).toBe(0);
    expect(poseIndex(0, DIR.east, ANIM.walk, 1)).toBe(1);
    expect(poseIndex(0, DIR.north, ANIM.walk, 0)).toBe(3);
    expect(poseIndex(1, DIR.west, ANIM.sit, 1)).toBe(11);
    expect([DIR.east, DIR.west].every(poseFlipped)).toBe(true);
    expect([DIR.south, DIR.north].some(poseFlipped)).toBe(false);
  });

  it('a standing customer sorts after the furniture on its row and before the next row', () => {
    const stool = CATALOG.byKey.get('stool')!;
    const bench = CATALOG.byKey.get('bench')!;
    expect(standingDepth(5, 5)).toBeGreaterThan(objectDepth(stool, 5, 5, 0, true));
    expect(standingDepth(5, 5)).toBeGreaterThan(objectDepth(bench, 4, 5, 0, false)); // bench front tile is (5,5)
    expect(standingDepth(5, 5)).toBeLessThan(objectDepth(stool, 6, 5, 0, false));
    expect(standingDepth(5, 5)).toBeLessThan(objectDepth(stool, 5, 6, 0, false));
  });
});

describe('NPC mirror', () => {
  function pump(g: Game, v: WorldView, n: number): void {
    const w = new FrameWriter();
    let buf = new ArrayBuffer(1 << 14);
    for (let k = 0; k < n; k++) {
      w.begin(buf, g.sim.tick, g.sim.gameMinute);
      g.step(w);
      buf = w.finish();
      readFrame(buf, v);
    }
  }

  it('follows spawn, movement, order bubbles and despawn from worker frames', () => {
    const g = Game.create(2);
    g.builder.give(CATALOG.byKey.get('stool')!.id, 1);
    expect(g.act({ k: 'place', type: CATALOG.byKey.get('stool')!.id, x: 30, y: 15, rot: 0, colour: 0 }).ok).toBe(true);
    const v = new WorldView();
    v.setArea(0, 64, 48);
    pump(g, v, 1);
    const h = g.npcs.spawn();
    const i = g.npcs.indexOf(h);
    pump(g, v, 1);
    expect(v.npcHandle(i)).toBe(h);
    expect(v.npcLook[i]).toBe(g.npcs.look[i]);
    pump(g, v, 20);
    expect(v.npcX[i]).toBeCloseTo(g.npcs.x[i]!, 1);
    expect(v.npcY[i]).toBeCloseTo(g.npcs.y[i]!, 1);
    expect(v.npcAnim[i]).toBe(ANIM.walk);
    // prev is the position one frame earlier: render interpolates between them.
    const moved = Math.hypot(v.npcX[i]! - v.npcPrevX[i]!, v.npcY[i]! - v.npcPrevY[i]!);
    expect(moved).toBeGreaterThan(0);
    expect(moved).toBeLessThan(0.5);
    for (let k = 0; k < 3000 && g.npcs.state[i] !== CS.waiting; k++) pump(g, v, 1);
    pump(g, v, 1);
    expect(v.npcAnim[i]).toBe(ANIM.sit);
    expect(v.npcOrderState[i]).toBe(ORDER.waiting);
    expect(v.npcDrink[i]).toBe(g.npcs.drink[i]);
    // Standing still: prev catches up with cur, so there is no drift.
    expect(v.npcPrevX[i]).toBe(v.npcX[i]);
    g.act({ k: 'startPour', id: h });
    pump(g, v, 1);
    expect(v.npcOrderState[i]).toBe(ORDER.pouring);
    g.npcs.clear();
    pump(g, v, 1);
    expect(v.npcHandle(i)).toBe(0);
  });

  it('a snapshot rebuilds customers already in the shop', () => {
    const g = Game.create(2);
    g.npcs.spawn();
    const w = new FrameWriter();
    w.begin(new ArrayBuffer(1024), 0, 0);
    g.writeSnapshot(w);
    const v = new WorldView();
    v.setArea(0, 64, 48);
    readFrame(w.finish(), v);
    expect(Array.from(v.npcLive).filter(Boolean)).toHaveLength(1);
  });
});
