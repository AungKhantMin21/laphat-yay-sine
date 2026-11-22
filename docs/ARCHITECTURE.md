# Architecture

How Laphat Yay Sine is built. What we build is in DESIGN.md; working rules are in CLAUDE.md.

## 0. Minimum browsers

iOS/iPadOS Safari 15+, Android Chrome 90+, current desktop Chrome, Firefox, Safari and Edge.

- Vite `build.target`: `['es2020', 'safari15', 'chrome90', 'firefox115', 'edge90']`.
- All of these support module workers, WebGL2, Pointer Events, Web Audio and IndexedDB in workers.
- Feature-check or fall back for: `dvh` units (Safari 15.4), `structuredClone` / `Array.prototype.at` (Safari 15.4), `screen.orientation` (iOS 16.4), Ogg audio on Safari (use m4a).

## 1. Folder structure

```
laphat-yay-sine/
  CLAUDE.md  DESIGN.md  CREDITS.md  BACKLOG.md
  docs/                 ARCHITECTURE.md, M0.md, RISKS.md, ART_STYLE.md
  index.html            viewport-fit=cover, landscape shell, font preload
  vite.config.ts        base '/games/laphat-yay-sine/', worker.format 'es', vitest config
  tsconfig.json         references the per-layer configs
  .github/workflows/deploy.yml
  assets/
    music/              loops + music.json, imported with ?url → hashed filenames
    fonts/              NotoSansMyanmar subset WOFF2 (generated; full Myanmar blocks + Basic Latin)
    atlas/              generated atlas-0.{webp,png,json}
  art/                  source .aseprite/.png, palette.hex — not shipped
  tools/                node scripts: pack-atlas, subset-font, check-size
  src/
    main.ts             boot only: platform checks → start loop → spawn worker
    shared/             pure TS: no DOM, no Pixi, no Worker globals
      protocol.ts       message types, PROTOCOL_VERSION
      diff.ts           binary frame encoder/decoder (one pair, used by both sides)
      layout.ts         capacities, SoA field specs, grid constants
      ids.ts            index+generation handles
      iso.ts            tile ↔ screen math
      rng.ts            mulberry32 + named streams
      rules/            placement validation (worker AND build-mode ghost)
    sim/                the Worker; imports only shared/
      worker.ts         entry, onmessage, tick scheduler
      world.ts          owns all SoA stores
      grids/ npc/ market/ path/ economy/ story/
      catchup.ts        abstract-LOD fast simulation
      save/             IndexedDB, schema version, migrations/
    game/               main-thread orchestration
      loop.ts           rAF, fixed step, interpolation, pacing, stop when hidden
      bridge.ts         the ONLY code that talks to the Worker
      view.ts           main-thread mirror of sim state (typed arrays)
    render/             PixiJS; reads game/view.ts, never writes it
      stage.ts          ~480×270 RenderTexture → integer upscale pass
      camera.ts chunks.ts sprites.ts (pools) cull.ts (spatial hash)
      depth.ts          insertion sort on key x + y + layer
      grade.ts          time-of-day / weather shader (mediump)
    ui/                 DOM overlay, all text; i18n/my.json
      hud/ perf-overlay.ts rotate-screen.ts
    input/              Pointer Events, gestures, keyboard → actions
    audio/              music.ts (M0), ambience/ (M6)
    platform/           tier.ts orientation.ts fullscreen.ts persist.ts sw.ts
    data/               JSON content: objects, prices, npcs, dialogue (Myanmar first)
  test/                 Vitest; sim + shared only (headless)
```

### Module boundaries (enforced)

- `shared/` imports nothing outside `shared/`.
- `sim/` imports only `shared/`. Its tsconfig uses `lib: ["ES2022", "WebWorker"]` (no DOM), so `document`/`window` fail typecheck. ESLint `no-restricted-imports` bans `pixi.js` and `render|ui|audio|game|input|platform`.
- `render/ ui/ audio/ input/ platform/` never import `sim/`. They read `game/view.ts` and send actions through `game/bridge.ts`.
- Burmese strings never cross the worker boundary: the sim emits text **keys + args**, `ui/` resolves them.
- Pixi objects exist only in `render/`. DOM exists only in `ui/`, `input/`, `platform/` (and `main.ts`).

```
            input/ ──actions──▶ game/bridge.ts ══postMessage══▶ sim/worker.ts
                                     ▲                                │
   ui/ ◀── events ───────────────────┤◀═════ frames (binary) ════════┘
   render/ ◀── game/view.ts ◀────────┘   (decoded by shared/diff.ts)
```

## 2. Worker message protocol

Two channels:

- **Commands and events**: small structured-clone objects, low frequency.
- **Frames**: one binary `ArrayBuffer` per sim tick (10 Hz), transferred to main, then **transferred back** with `recycle` for reuse. Pool of 4 buffers, 64 KB each, grown on demand. Zero allocation at steady state.

The source of truth for message shapes is `src/shared/protocol.ts` (protocol **v8** as of M2.9; v5 added the shop day, v6 customers and pouring with frame section NPC_ORDER, v7 the teaser event and debug `jump`, v8 debug `crowd`). Summary:

### Main → Worker

```ts
type ToSim =
  | { t: 'init'; v; tier; nowMs; saveSlot; seed?; shareCode? } // worker loads the slot or starts a new game
  | { t: 'clock'; running; nowMs }       // menus / hidden tab pause; resume checks for catch-up
  | { t: 'tier'; tier }
  | { t: 'viewport'; area; x0; y0; x1; y1 } // Near vs Far LOD (M4)
  | { t: 'subscribe'; grids }            // bitmask of property grids to stream (heat overlay)
  | { t: 'act'; seq; a: Action }
  | { t: 'save'; reason: 'auto' | 'hidden' | 'manual' }
  | { t: 'exportSave' } | { t: 'importSave'; code }
  | { t: 'give'; type; qty }             // debug
  | { t: 'jump'; minute }                // debug: move the game clock forward (never back)
  | { t: 'crowd'; n }                    // debug (perf gate): n customers arrive at once
  | { t: 'recycle'; buf: ArrayBuffer };  // transferred back

type Action =
  | { k: 'place'; type; x; y; rot; colour } // the worker works out the surface (parent) itself
  | { k: 'move'; id; x; y; rot } | { k: 'rotate'; id; rot } | { k: 'recolour'; id; colour }
  | { k: 'pickup'; id } | { k: 'sell'; id } | { k: 'undo' } | { k: 'redo' }
  | { k: 'openShop' } | { k: 'sleep' }                       // shop day (M2)
  | { k: 'startPour'; id } | { k: 'cancelPour'; id }         // pour UI open/closed: holds the auto-serve
  | { k: 'serve'; id; tea; milk }                            // a poured cup (cup fractions)
  | { k: 'walkTo'; x; y } | { k: 'interact'; id } | { k: 'buy'; shop; item; qty }; // M2+
// ids on the wire are object handles (index + generation); pour/serve ids are NPC handles.
```

### Worker → Main

```ts
type FromSim =
  | { t: 'ready'; v; area; w; h; snapshot: ArrayBuffer } // full mirror: boot and after a save code import
  | { t: 'frame'; buf: ArrayBuffer }       // transferred, 10 Hz (plus one right after a build action)
  | { t: 'ack'; seq; ok; reason?; id? }    // reason = i18n key; id = handle of the placed/moved object
  | { t: 'state'; state: PlayerState }     // money, inventory, canUndo, canRedo, day phase, day, today's stats — on change
  | { t: 'loaded'; fresh; awayDays; skipped }
  | { t: 'exported'; code } | { t: 'imported'; ok; reason? }
  | { t: 'events'; list: SimEvent[] }      // money {delta,total}, served {id,drink,poured,price,tip,reaction},
                                          // dayEnd {day,stats} then teaser {key,drink} on sleep
  | { t: 'catchup'; done; total } | { t: 'away'; summary }
  | { t: 'saved'; reason; ok } | { t: 'error'; msg; fatal? };
```

### Frame buffer layout (`shared/diff.ts`, little-endian, 4-byte aligned)

```
Header   16 B: u16 version | u16 flags | u32 tick | u32 gameMinute | u16 sectionCount | u16 workCentiMs (sim time for this frame, 1/100 ms)
Section   8 B: u8 kind | u8 _ | u16 count | u32 payloadBytes, then payload (padded to 4)

kind 1 NPC_SPAWN    12 B each: u32 handle | u16 def | u8 area | u8 look | i16 x | i16 y
kind 2 NPC_DESPAWN   4 B each: u32 handle
kind 3 NPC_STATE     8 B each: u16 slot | i16 x | i16 y | u8 dir | u8 anim   (changed, Near LOD only)
kind 4 OBJ_UPSERT   16 B each: u32 handle | u16 type | u8 x | u8 y | u8 rot | u8 layer | u8 colour | u8 flags | u32 parent
kind 5 OBJ_REMOVE    4 B each: u32 handle
kind 6 GRID_PATCH   8 B head: u8 prop | u8 _ | u8 x | u8 y | u8 w | u8 h | u16 _, then w*h bytes (subscribed grids only)
kind 7 TILE_PATCH   same shape as GRID_PATCH; prop = 0 floor, 1 wall
kind 8 WORLD         4 B: u8 weather | u8 season | u16 day
kind 9 NPC_ORDER     8 B each: u32 handle | u8 drink | u8 order state (shared/npc.ts ORDER) | u16 pad   (changed only)
kind 10 TASK        12 B each: u32 task handle | u8 kind | u8 queuePos (0 none, 1–3 player queue, 4 staff) | u8 state | u8 _ | i16 x | i16 y   (M2.5, changed only; state 0 = gone)
kind 11 CUP          8 B each: u16 cup id | u8 place (shelf, tray, table, sink) | u8 drink | i16 x | i16 y   (M2.5, changed only)
```

Positions are fixed-point **1/32 tile** in `i16` (range ±1023 tiles). A tick with no changes still sends the 16-byte header so the interpolation clock keeps moving.

### Game clock and the shop day (M2)

`Sim.tick` counts every step; `Sim.clock` is game time in ticks and **stands still** while the shop day holds it: in the morning until `openShop`, and in the evening (after closing time, once the shop is empty) until `sleep`, which jumps it to the next opening time (`shared/day.ts`, hours in `src/data/shop.json`). The frame header carries the game minute, so the main thread sees the hold.

On `sleep`, `ShopDay` sends `dayEnd` with today's stats, then picks tomorrow's **teaser** (`shared/teasers.ts`, `src/data/teasers.json`) with two `events` draws every night, among the kinds whose condition the day's stats meet (at least one kind has no condition). The pick is saved and has a real effect the next day, applied in `Game.step`: extra arrivals for a time window, extra appeal, or a promised guest who arrives a set time after opening and orders a named drink. Customers pay when served (poured: full price + tip by pour score; auto-served after `service.autoServe`: 70 %, no tip).

### Service (M2.5, protocol v9 — planned, see docs/M2_5.md)

Every cup is made by a person; there is no auto-serve. The worker keeps a **task board** (`sim/service/task-board.ts`) of open jobs: `order` (take the order), `brew`, `serve`, `clear`, `wash`, `cook` (no producer until M5 snacks). The player avatar and staff are **workers** (`sim/npc/workers.ts`) that take jobs from it.

- Actions: `queueTask {task}` / `cancelTask {task}` (task handles; the player queue holds ≤ 3, in `PlayerState`); `hire {role}` / `dismiss {role}` (evening only). `startPour` / `cancelPour` / `serve` now belong to the player's brew at the counter: the sim sends `brewReady {task, drink}` when the avatar arrives, the UI opens the pour overlay, `serve` puts the filled cup on the tray (2 slots), cancel puts the brew back on the board.
- A job the player queues is theirs; a staff member holding it drops it and re-chooses.
- Customers: toSeat → wantsOrder (`order` task, "?" bubble) → ordered (`brew` task) → served (pays: full price + pour tip × wait factor 1.25…0) → drinking → leaving; the cup stays on the table (`clear` task) → the sink (`wash`). They never leave unserved; after closing time no one new comes, and the evening starts when the shop is empty.
- Cups are a fixed pool (`shop.json`); with no clean cup, `brew` waits for a wash. Cups reset to clean on load.
- Workers and customers use NPC_SPAWN/STATE with def ids `NPC_DEF_CUSTOMER`, `NPC_DEF_PLAYER`, `NPC_DEF_WAITER` (shared/npc.ts); markers and cups come from the TASK and CUP sections.
- Events: `brewReady`, `served` (now with `wait`), `wages {paid, dayOff}` at sleep.

### Protocol rules

- The worker is the only authority on world state; the main thread holds a mirror.
- Build mode is optimistic: main runs `shared/rules` against its mirror to show the placement ghost instantly; on `ack ok:false` it reverts and shows the reason.
- Main renders about one tick behind and interpolates NPC x/y between the last two frames.
- Undo/redo history lives in the worker (stack of inverse operations).
- Hidden tab: main sends `clock running:false` and `save reason:'hidden'`, then stops rAF. On return (or on `init` from a save), the worker compares wall-clock time with the last save:
  - away **< 1 real hour** → no catch-up; the clock simply resumes.
  - otherwise → **1 game day per full real day away, maximum 7** (`days = min(7, floor(awayMs / 86 400 000))`). Catch-up runs at abstract LOD, yields after every game day, posts `catchup` progress, then `away` with the summary. If `days` is 0, no catch-up runs.
- `PROTOCOL_VERSION` mismatch (stale service-worker cache) → main forces a reload.

## 3. Data layout (typed arrays, struct of arrays)

**Rule of thumb:** struct of arrays for anything iterated every tick or frame (NPCs, objects, grids, paths). Plain objects are fine for small, rarely touched tables (< 64 rows: properties, shops, recipes). Strings live in side `Map<handle, string>` tables, never in typed arrays.

### Handles (`shared/ids.ts`)

`u32 = generation (16 bits) << 16 | index (16 bits)`. Index 0 is reserved for "none". A stale handle (for example an object acked after it was removed) fails the generation check instead of hitting a reused slot.

### Tile grids (per area, W×H ≤ 128×96, index = y * W + x)

| Grid | Type | Notes |
| --- | --- | --- |
| `floor` | Uint8 | floor tile type |
| `wall` | Uint8 | `WALL.n` / `WALL.w`: back wall on the tile's −y / −x edge (cutaway view) |
| `zone` | Uint8 | `ZONE.owned`, `ZONE.roof` |
| occupancy × 6 | Uint16 | object slot per tile (0 = free): `floor`, `furniture`, `ceiling`, `stack` (small item on a surface), `wallN`, `wallW` |
| `walkCost` | Uint8 | derived, 255 = blocked (M3) |

Area grids, the object store and occupancy live in `shared/world-state.ts` and are used by both threads: the worker's `sim/world.ts` (authority, change tracking) and the main thread's `game/view.ts` (mirror, filled from frames). Because handles carry the slot index, mirror slots equal worker slots.

### Property grids

Eight properties: comfort, light, noise, warmth, shade, beauty, smell, cover.

- Worker keeps `accum[p]: Int16Array(W*H)` (exact sums, so removing an object subtracts precisely) and `value[p]: Uint8Array(W*H)` = clamp(accum, 0, 255). Rules, NPCs and the main thread read `value`.
- Units: **16 per design level**. DESIGN's "noise < 2" means `value < 32`. Max ≈ 15.9 levels.
- Each object adds `falloff(level·16, radius, d)` per property, where d is the distance to its nearest footprint tile (full on the footprint, linear to 0 just past the radius ≤ 4). Place = add; remove = subtract; then re-clamp only the dirty rect (`sim/grids/property-grids.ts`).
- Area base: roofed tiles get `zoneBase.roof`, open tiles `zoneBase.open` (objects.json).
- Need checks run over the dirty rect + radius only, never the whole grid.
- Memory at 128×96: 8 × (24 KB + 12 KB) ≈ 300 KB per area.

### Objects (capacity 4096)

`live u8 · gen u16 · uid u32 · type u16 · x u8 · y u8 · rot u8 · layer u8 (floor / furniture / wall / ceiling) · colour u8 (recolour ramp) · flags u8 · parent u16 (slot of the surface below)`, plus a free list. Footprint (1×1 to 3×2) comes from `objects.json`, rotated (odd rotations swap w/h).

- **uid** is a stable id that is never reused (saved, and restored by undo/redo). History and saves refer to uids; the wire uses handles; arrays use slots.
- Placement rules: `shared/rules/placement.ts`, one allocation-free function used by the worker (authority) and the build ghost.
- Build commands: `sim/build/builder.ts`. Every command is a record of objects before/after plus inventory and money deltas; undo runs it backwards (100 steps). A surface carries the items standing on it.

### NPCs (capacity 256: ~40 named + passers-by)

- Worker: `x, y Float32` (tiles) · `area u8` · `lod u8` (near / far / abstract) · `state u8` · `stateT u16` · `def u16` · `sched u8` · needs `hunger, social, money, comfort` (4 × Uint8) · taste `sweet, strong, creamy` (3 × Int8) · `friendship u8` · `visits u16` · `seat u16` · `path u16` (pool slot) · `pathStep u16` · `dir u8` · `anim u8` · `gen u16`.
- **M2 customers** (`sim/npc/customers.ts`) use a subset: `x, y Float32` (tiles, centre = +0.5) · `tile, goal, seat, exit Int32` · `seatObj u32` (object handle, checked after build changes) · `path u32` (path handle) · `pathStep, stateT, walkT, pourT u16` · `state, drink, order, look, dir, anim u8` · `milkShift, noiseTaste Float32` · `gen u16`. A `seatRes` Uint16 grid holds which customer reserved each seat tile. States: toSeat → ordering → waiting → drinking → leaving (and straight to leaving when no free reachable seat). Seat choice scans seat tiles of floor-standing `seat > 0` furniture and scores property `value`s with the weights in `shop.json` (`seat`), plus table-adjacent, distance and jitter from `npcDecide`; a flood fill from the street (rebuilt only when the walk grid version changes) rules out walled-in seats. Arrivals: one `npcDecide` roll per game minute during shop hours, chance = hourly rate × shop appeal / 60. Customers are not saved; the customer is paid at serve time.
- Main mirror (`game/view.ts`): `prevX, prevY, curX, curY Float32` · `dir, anim, look Uint8` · `sprite Int16` (pool index, −1 = none). Render caps visible animated NPCs at the tier limit (12 / 25 / 40).

### Walk zones and access classes (M2.5)

- The area `zone` grid carries the walk zone of every tile: `road`, `crossing`, `pavement`, `front` (shop opening and door tiles), `interior`, `kitchen`, `blocked` (filler, building fronts). If the bits don't fit next to `owned`/`roof` in u8, a separate `access` u8 grid holds them.
- `shared/rules/access.ts` is the only place that says which **access class** may enter which zone: `people` (customers: pavement, crossing, front, interior) and `staff` (player and staff: those plus kitchen). Nobody walks on road or filler.
- Shop walls are edge bits (`WALL.n`/`WALL.w`); front and east walls are stored on the tile beyond them, so the same two bits close the shop. The front stays open across the opening; the kitchen partition has one door tile. Rendering is a cutaway: back walls full height, front and side walls as a low sill.
- `WalkGrid` keeps one cost array and one move mask per access class (2 × Uint8 each, dirty-rect updates as before); `PathFinder.request(from, to, cls)` selects them. Customers spawn at the pavement ends and beyond the zebra crossing (`SPAWNS` in `sim/area.ts`).
- Placement (`shared/rules/placement.ts`): seating and furniture in the interior, kitchen fixtures in the kitchen, nothing on entrance tiles, and the entrance must still reach the counter.
- Building fronts, awning, signboard and shutters are area **features** drawn by `render/facades.ts` (not objects, not saved).

### Task board, workers and cups (M2.5)

- `TaskBoard`: SoA, capacity 128, index + generation handles: `kind u8`, `state u8` (open/claimed), `claimedBy u8` (worker index), `target u32` (customer handle, cup id or fixture tile), `x, y i16`, `created u32` (tick). Per-kind open counters; changed slots go into the TASK section.
- `Workers`: SoA for the player (index 1) and staff: `x, y Float32`, `tile, goal Int32`, `path u32`, `state, role, dir, anim u8`, `actT u16`, `tray` (2 × u16 cup ids), `queue` (3 × u32 task handles, player only). They walk with the `staff` access class; action times come from `shop.json`.
- Staff choose jobs by utility when idle (role weight per kind − distance + age + `npcDecide` jitter); no per-tick scan for busy workers.
- `Cups`: fixed pool, `place u8`, `drink u8`, `tile Int32`.

### Paths (`sim/path/`, M2.3)

- `WalkGrid`: `cost: Uint8Array` per tile from the floor type (`src/data/walk.json`, min 10) or 255 when floor-standing furniture covers it, plus `moves: Uint8Array`, an 8-direction mask per tile (no wall on the edge, no corner cutting). `SimWorld` keeps a walk dirty rect from footprints of floor-standing furniture; `Game.syncWalk()` rebuilds only that rect (masks one tile further out) and bumps `version`. Walls change only on area load (the first full update covers them).
- `PathFinder`: A* (octile heuristic, diagonal = 1.4×, binary heap on typed arrays with decrease-key). Requests queue FIFO; one search runs at a time within `nodesPerTick` expansions per tick (a node count, not a timer, so results are deterministic; 700 ≈ 0.3 ms warm on an Apple-silicon desktop, so ≤ 2 ms at 6× throttle; lowered from 1,000 in the M2 gate. It is the same on every tier, because it decides when paths finish). A search restarts if the walk grid changed mid-flight. Results go into a fixed pool (`pathSlots` × `maxPathLen` Uint16 tile indices) addressed by handles; paths exclude the start and end at the goal. A blocked goal (a seat) can be the destination but is never walked through. `canStep(a, b, goal)` re-checks a step against the current grid, so walkers notice furniture placed after their path was found.
- No allocation after construction. Flow fields to common destinations wait for M3/M4.

### RNG

One save seed → independent mulberry32 **streams** per subsystem: `market`, `npcDecide`, `events`, `cosmetic`. Near-LOD cosmetic randomness uses only `cosmetic`, so where the camera is never changes simulation outcomes, and catch-up stays equivalent to live play.

### Save (worker-owned, IndexedDB)

Database `laphat`:

- `saves`: `slot0` → binary save (`sim/save/format.ts`). An unreadable save is moved to `slot0.broken.<time>`, never overwritten.
- `meta`: device tier and settings (main thread).

Binary save v2 = the v1 layout plus a shop-day block (game clock, phase/shutters, today's stats, tomorrow's teaser as `{key, arg}`: a teasers.json key and, for a guest, a drink key); v1 saves migrate with clock = tick and the shutters open. Customers are not saved: a mid-day load reopens with an empty shop and the same money, phase and stats.

Binary save v3 (M2.5, planned) = v2 plus the staff roster (role key, hired day, day-off flag). Migration 2→3 adds missing fixtures (counter, kettle, sink, stove) and moves furniture that now stands on a wall line, in the kitchen or outside the allowed zones into the inventory — never deletes it. Workers, tasks and cups are not saved (cups reset to clean).

Binary save v1: header (magic `LYS1`, schema, seed, savedAt, tick, 4 RNG states, money, next uid), a **key table** (object types are stored by key, so reordering `objects.json` never breaks saves; unknown keys are skipped), inventory as (key index, qty), objects as 16 bytes each (uid, key index, x, y, rot, layer, colour, flags, parent uid). Property grids and occupancy are rebuilt on load.

- To change the format: add `PARSERS[n]` and `MIGRATIONS[n-1]`; never edit old ones.
- Autosave every game hour, 5 s after building, after `sleep`, on `visibilitychange: hidden` and `pagehide`.
- Save code = `LYS1.` + base64url of the binary save (≈ 24 bytes per object). Share links (M6) need compression to meet DESIGN's 2,000-character target.
