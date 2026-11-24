// Main-thread mirror of the simulation, filled from worker frames. render/ and ui/ read it;
// build mode validates its ghost against the same WorldState the worker uses.
import type { FrameHandler } from '../shared/diff';
import { IndexQueue, handleGen, handleIndex, makeHandle } from '../shared/ids';
import { MAX_CUPS, MAX_NPCS, MAX_OBJECTS, MAX_TASKS, PROP_COUNT, TILE_LAYER } from '../shared/layout';
import { POS_SCALE } from '../shared/diff';
import { AreaGrids, markOccupancy, WorldState } from '../shared/world-state';

/** Inclusive-exclusive tile rect that changed since render last consumed it. */
export class DirtyRect {
  x0 = 0;
  y0 = 0;
  x1 = 0;
  y1 = 0;
  get empty(): boolean {
    return this.x1 <= this.x0 || this.y1 <= this.y0;
  }
  add(x: number, y: number, w: number, h: number): void {
    if (this.empty) {
      this.x0 = x;
      this.y0 = y;
      this.x1 = x + w;
      this.y1 = y + h;
      return;
    }
    this.x0 = Math.min(this.x0, x);
    this.y0 = Math.min(this.y0, y);
    this.x1 = Math.max(this.x1, x + w);
    this.y1 = Math.max(this.y1, y + h);
  }
  clear(): void {
    this.x0 = this.y0 = this.x1 = this.y1 = 0;
  }
}

export class WorldView implements FrameHandler {
  tick = 0;
  gameMinute = 0;
  day = 0;
  /** Worker time spent on the last frame's ticks (ms). */
  simWorkMs = 0;
  state: WorldState = new WorldState(new AreaGrids(0, 1, 1));
  /** Tiles whose floor or walls changed (chunks redraw). */
  readonly tilesDirty = new DirtyRect();
  /** Objects added or changed since render last looked (slot indices). */
  readonly objChanged = new IndexQueue(MAX_OBJECTS);
  /** Handles removed since render last looked. */
  readonly objRemoved = new Uint32Array(MAX_OBJECTS);
  objRemovedCount = 0;
  /** Property grid values streamed for the heat overlay (only subscribed ones are filled). */
  grids: Uint8Array[] = [];
  readonly gridsDirty = new DirtyRect();
  /** Set if more removals arrived than the buffer holds: render rebuilds everything. */
  objResync = false;

  // NPCs by slot index (struct of arrays). Positions in tiles; render interpolates prev → cur.
  readonly npcLive = new Uint8Array(MAX_NPCS);
  readonly npcGen = new Uint16Array(MAX_NPCS);
  readonly npcPrevX = new Float32Array(MAX_NPCS);
  readonly npcPrevY = new Float32Array(MAX_NPCS);
  readonly npcX = new Float32Array(MAX_NPCS);
  readonly npcY = new Float32Array(MAX_NPCS);
  readonly npcDir = new Uint8Array(MAX_NPCS);
  readonly npcAnim = new Uint8Array(MAX_NPCS);
  readonly npcLook = new Uint8Array(MAX_NPCS);
  /** NPC_SPAWN def: customer, player or waiter (shared/npc.ts). */
  readonly npcDef = new Uint8Array(MAX_NPCS);
  readonly npcDrink = new Uint8Array(MAX_NPCS);
  /** shared/npc.ts ORDER */
  readonly npcOrderState = new Uint8Array(MAX_NPCS);
  /** performance.now() when the latest frame arrived (interpolation clock). */
  frameAt = 0;

  // Task board mirror by slot (M2.5): kind 0 = no task in the slot.
  readonly taskGen = new Uint16Array(MAX_TASKS);
  readonly taskKind = new Uint8Array(MAX_TASKS);
  readonly taskQueue = new Uint8Array(MAX_TASKS);
  readonly taskTarget = new Uint32Array(MAX_TASKS);
  /** Set when any task changed; the queue markers clear it. */
  tasksChanged = false;

  // Cups by id (1-based).
  readonly cupPlace = new Uint8Array(MAX_CUPS + 1);
  readonly cupDrink = new Uint8Array(MAX_CUPS + 1);
  readonly cupTile = new Int32Array(MAX_CUPS + 1).fill(-1);
  readonly cupHolder = new Uint8Array(MAX_CUPS + 1);
  readonly cupDirty = new Uint8Array(MAX_CUPS + 1);
  /** Customer handle each cup was brewed for (0 none). */
  readonly cupFor = new Uint32Array(MAX_CUPS + 1);
  /** Highest cup id seen. */
  cupCount = 0;
  /** Set when any cup moved; the cup renderer clears it. */
  cupsChanged = false;
  /** Load of the goods in the player's hands (M3; set from PlayerState). */
  playerCarry = 0;

  get area(): AreaGrids {
    return this.state.area;
  }

  /** Called when an area loads, before its snapshot is read. */
  setArea(id: number, w: number, h: number): void {
    this.state = new WorldState(new AreaGrids(id, w, h));
    this.grids = [];
    for (let p = 0; p < PROP_COUNT; p++) this.grids.push(new Uint8Array(w * h));
    this.tilesDirty.add(0, 0, w, h);
    this.objChanged.clear();
    this.objRemovedCount = 0;
    this.npcLive.fill(0);
    this.taskKind.fill(0);
    this.tasksChanged = true;
    this.cupCount = 0;
    this.cupsChanged = true;
    // A new area or a loaded game: renderers drop everything they had and rebuild.
    this.objResync = true;
    this.gridsDirty.add(0, 0, w, h);
  }

  header(tick: number, gameMinute: number, workCentiMs: number): void {
    // A new frame: everyone's last position becomes the start of this frame's movement.
    this.npcPrevX.set(this.npcX);
    this.npcPrevY.set(this.npcY);
    this.frameAt = performance.now();
    this.tick = tick;
    this.gameMinute = gameMinute;
    this.simWorkMs = workCentiMs / 100;
  }
  world(_weather: number, _season: number, day: number): void {
    this.day = day;
  }
  tilePatch(layer: number, x: number, y: number, w: number, h: number, bytes: Uint8Array, offset: number): void {
    const a = this.state.area;
    const dst =
      layer === TILE_LAYER.floor ? a.floor : layer === TILE_LAYER.wall ? a.wall : layer === TILE_LAYER.zone ? a.zone : layer === TILE_LAYER.access ? a.access : layer === TILE_LAYER.paint ? a.paint : a.facade;
    for (let row = 0; row < h; row++) {
      const s = offset + row * w;
      dst.set(bytes.subarray(s, s + w), (y + row) * a.w + x);
    }
    if (layer === TILE_LAYER.floor || layer === TILE_LAYER.wall || layer === TILE_LAYER.facade || layer === TILE_LAYER.paint) this.tilesDirty.add(x, y, w, h);
  }
  objUpsert(handle: number, type: number, x: number, y: number, rot: number, layer: number, colour: number, flags: number, parent: number): void {
    const { objects: s, occ } = this.state;
    const existing = s.indexOf(handle);
    if (existing) markOccupancy(s, occ, existing, 0);
    const i = existing || s.claimHandle(handle, handle);
    if (!i) return;
    s.type[i] = type;
    s.x[i] = x;
    s.y[i] = y;
    s.rot[i] = rot;
    s.layer[i] = layer;
    s.colour[i] = colour;
    s.flags[i] = flags;
    s.parent[i] = parent ? s.indexOf(parent) : 0;
    markOccupancy(s, occ, i, i);
    this.objChanged.push(i);
  }
  objRemove(handle: number): void {
    const { objects: s, occ } = this.state;
    const i = s.indexOf(handle);
    if (!i) return;
    markOccupancy(s, occ, i, 0);
    s.release(i);
    if (this.objRemovedCount < this.objRemoved.length) this.objRemoved[this.objRemovedCount++] = handle;
    else this.objResync = true;
  }
  /** Live NPC handle for a slot, or 0. */
  npcHandle(i: number): number {
    return this.npcLive[i] ? makeHandle(i, this.npcGen[i]!) : 0;
  }
  npcSpawn(handle: number, def: number, _area: number, look: number, x: number, y: number): void {
    const i = handleIndex(handle);
    if (i === 0 || i >= MAX_NPCS) return;
    this.npcLive[i] = 1;
    this.npcDef[i] = def;
    this.npcGen[i] = handleGen(handle);
    this.npcX[i] = this.npcPrevX[i] = x / POS_SCALE;
    this.npcY[i] = this.npcPrevY[i] = y / POS_SCALE;
    this.npcLook[i] = look;
    this.npcDir[i] = 0;
    this.npcAnim[i] = 0;
    this.npcOrderState[i] = 0;
  }
  npcDespawn(handle: number): void {
    const i = handleIndex(handle);
    if (i > 0 && i < MAX_NPCS && this.npcGen[i] === handleGen(handle)) this.npcLive[i] = 0;
  }
  npcState(slot: number, x: number, y: number, dir: number, anim: number): void {
    if (slot >= MAX_NPCS || !this.npcLive[slot]) return;
    this.npcX[slot] = x / POS_SCALE;
    this.npcY[slot] = y / POS_SCALE;
    this.npcDir[slot] = dir;
    this.npcAnim[slot] = anim;
  }
  task(handle: number, kind: number, queuePos: number, live: boolean, target: number): void {
    const i = handleIndex(handle);
    if (i === 0 || i >= MAX_TASKS) return;
    this.taskGen[i] = handleGen(handle);
    this.taskKind[i] = live ? kind : 0;
    this.taskQueue[i] = live ? queuePos : 0;
    this.taskTarget[i] = target;
    this.tasksChanged = true;
  }
  /** Handle of the live task in slot i (0 if none). */
  taskHandle(i: number): number {
    return this.taskKind[i] ? makeHandle(i, this.taskGen[i]!) : 0;
  }
  cup(id: number, place: number, drink: number, tile: number, holder: number, dirty: boolean, forCustomer: number): void {
    if (id < 1 || id > MAX_CUPS) return;
    this.cupFor[id] = forCustomer;
    this.cupPlace[id] = place;
    this.cupDrink[id] = drink;
    this.cupTile[id] = tile;
    this.cupHolder[id] = holder;
    this.cupDirty[id] = dirty ? 1 : 0;
    if (id > this.cupCount) this.cupCount = id;
    this.cupsChanged = true;
  }
  npcOrder(handle: number, drink: number, state: number): void {
    const i = handleIndex(handle);
    if (i === 0 || i >= MAX_NPCS || !this.npcLive[i] || this.npcGen[i] !== handleGen(handle)) return;
    this.npcDrink[i] = drink;
    this.npcOrderState[i] = state;
  }
  gridPatch(prop: number, x: number, y: number, w: number, h: number, bytes: Uint8Array, offset: number): void {
    const dst = this.grids[prop];
    if (!dst) return;
    const W = this.state.area.w;
    for (let row = 0; row < h; row++) {
      const s = offset + row * w;
      dst.set(bytes.subarray(s, s + w), (y + row) * W + x);
    }
    this.gridsDirty.add(x, y, w, h);
  }
}
