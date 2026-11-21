// One running game: clock, world, economy and build commands. Plain TS (tested headless);
// worker.ts only adds messaging and timing around it.
import { CATALOG } from '../shared/catalog';
import type { FrameWriter } from '../shared/diff';
import type { Action, PlayerState } from '../shared/protocol';
import start from '../data/start.json';
import { createM1Area } from './area';
import { Builder, type Result } from './build/builder';
import { Sim } from './sim';
import { SimWorld } from './world';

export class Game {
  constructor(
    readonly sim: Sim,
    readonly world: SimWorld,
    readonly builder: Builder,
  ) {}

  static create(seed: number): Game {
    const inv = new Uint16Array(CATALOG.defs.length);
    for (const [key, n] of Object.entries(start.inventory as Record<string, number>)) {
      const def = CATALOG.byKey.get(key);
      if (def) inv[def.id] = n;
    }
    const world = new SimWorld(createM1Area());
    return new Game(new Sim(seed), world, new Builder(world, start.money, inv));
  }

  /** Runs a player action. Object ids on the wire are handles; stale handles are refused. */
  act(a: Action): Result {
    const b = this.builder;
    const idx = (h: number): number => this.world.objects.indexOf(h);
    switch (a.k) {
      case 'place':
        return b.place(a.type, a.x, a.y, a.rot, a.colour);
      case 'move':
        return b.move(idx(a.id), a.x, a.y, a.rot);
      case 'rotate':
        return b.rotate(idx(a.id), a.rot);
      case 'recolour':
        return b.recolour(idx(a.id), a.colour);
      case 'pickup':
        return b.pickup(idx(a.id));
      case 'sell':
        return b.sell(idx(a.id));
      case 'undo':
        return b.undo();
      case 'redo':
        return b.redo();
      default:
        return { ok: false, reason: 'error.notYet' };
    }
  }

  playerState(): PlayerState {
    const b = this.builder;
    return { money: b.money, inventory: Array.from(b.inventory), canUndo: b.canUndo, canRedo: b.canRedo };
  }

  step(w: FrameWriter): void {
    this.sim.step(w);
    this.world.writeChanges(w);
  }
}
