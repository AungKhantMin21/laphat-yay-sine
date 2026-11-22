// A headless "player" for tests: works the task board through the Service rules directly, one job
// every `period` ticks (standing in for walking and doing it). Greedy: oldest job of the most
// urgent kind first — wash when out of cups, then serve, brew, take orders, clear.
import type { Game } from '../src/sim/game';
import { CUP } from '../src/sim/service/cups';
import { TASK } from '../src/sim/service/task-board';

const ORDER_OF_WORK = [TASK.serve, TASK.brew, TASK.order, TASK.clear, TASK.wash];

export class Bot {
  private wait = 0;
  jobs = 0;

  constructor(
    private readonly g: Game,
    /** Ticks per job (0 = everything at once). */
    private readonly period: number,
    /** Pour score the bot achieves. */
    private readonly score = 0.9,
  ) {}

  /** Call once per sim step. */
  tick(): void {
    if (this.period > 0 && ++this.wait < this.period) return;
    this.wait = 0;
    do {
      if (!this.one()) return;
    } while (this.period === 0);
  }

  /** Does one job; returns false when there was nothing it could do. */
  private one(): boolean {
    const s = this.g.service;
    const b = s.board;
    // Out of clean cups: washing comes first.
    if (!s.canBrew() && s.cups.countIn(CUP.sink) > 0) return this.doJob(TASK.wash, 0);
    for (const kind of ORDER_OF_WORK) {
      let best = 0;
      for (let i = 1; i < b.capacity; i++) {
        if (!b.live[i] || b.kind[i] !== kind) continue;
        if (best === 0 || b.created[i]! < b.created[best]!) best = i;
      }
      if (best && this.doJob(kind, b.target[best]!)) return true;
    }
    return false;
  }

  private doJob(kind: number, target: number): boolean {
    const s = this.g.service;
    let ok = false;
    switch (kind) {
      case TASK.order:
        ok = s.takeOrder(target) === '';
        break;
      case TASK.brew:
        ok = s.brew(target, this.score, true) === '';
        break;
      case TASK.serve:
        // Already carrying it (the customer was moving seats last time): just serve.
        ok = (s.cups.place[target] === CUP.tray || s.pickUp(target, 1) === '') && s.serve(target, 1) === '';
        break;
      case TASK.clear:
        ok = s.pickUpDirty(target, 1) === '' && s.dropAtSink(target, 1) === '';
        break;
      case TASK.wash:
        ok = s.washOne();
        break;
    }
    if (ok) this.jobs++;
    return ok;
  }
}
