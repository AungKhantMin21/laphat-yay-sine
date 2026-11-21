// Main-thread mirror of the simulation, filled from worker frames. render/ and ui/ read it.
// M0 holds only the clock; NPC/object/grid stores arrive with M1–M4 (docs/ARCHITECTURE.md §3).
import type { FrameHandler } from '../shared/diff';

export class WorldView implements FrameHandler {
  tick = 0;
  gameMinute = 0;
  day = 0;
  /** Worker time spent on the last frame's ticks (ms). */
  simWorkMs = 0;
  area = 0;
  areaW = 0;
  areaH = 0;

  header(tick: number, gameMinute: number, workCentiMs: number): void {
    this.tick = tick;
    this.gameMinute = gameMinute;
    this.simWorkMs = workCentiMs / 100;
  }
  world(_weather: number, _season: number, day: number): void {
    this.day = day;
  }
  npcSpawn(): void {}
  npcDespawn(): void {}
  npcState(): void {}
  objUpsert(): void {}
  objRemove(): void {}
  gridPatch(): void {}
  tilePatch(): void {}
}
