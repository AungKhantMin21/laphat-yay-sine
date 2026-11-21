# Laphat Yay Sine — working rules

DESIGN.md is the source of truth for **what** we build. docs/ARCHITECTURE.md is the source of truth for **how**.
Read both before planning a milestone. docs/RISKS.md lists known device pitfalls. New ideas go to BACKLOG.md, not into code.

## Stack (fixed)

TypeScript (strict) · Vite · PixiJS v8 (WebGL) · sim in a module Web Worker at 10 Hz · IndexedDB saves ·
service worker (M6) · Web Audio · Vitest. Do not add runtime dependencies without asking.

## Minimum browsers

iOS/iPadOS Safari 15+, Android Chrome 90+, current desktop Chrome, Firefox, Safari and Edge.
Vite `build.target` is set to match. Anything newer than these (e.g. `dvh` units, `structuredClone`,
`Array.prototype.at`, `screen.orientation` on iOS < 16.4, Ogg on old Safari) needs a fallback or a feature check.

## Module boundaries

- `src/shared/`: pure TS. Imports nothing outside `shared/`.
- `src/sim/`: the Worker. Imports only `shared/`. No DOM, no Pixi (its tsconfig has no DOM lib).
- `src/game/bridge.ts` is the only code that talks to the Worker.
- `render/` reads `game/view.ts`; it never writes sim state. Pixi only in `render/`. DOM only in `ui/`, `input/`, `platform/`.
- `ui/` owns all text. The worker never sends display strings: it sends text keys + args; `ui/` translates.

## Hot-path rules (sim tick, render frame, pointer move)

- No allocation: no object/array literals, closures, spread, string building, or `map`/`filter`.
  Use pools and preallocated typed arrays.
- Struct of arrays for anything iterated per tick or frame. Entity handles are index+generation `u32` (`shared/ids.ts`).
- Property grids update only the dirty rect around a change. Never full-grid passes per tick.
- Worker → main traffic is the binary frame in `shared/diff.ts`; buffers are transferred and recycled.
- Pathfinding ≤ 2 ms per frame; split longer searches across ticks.

## Pixel art

- The world renders into a RenderTexture 270 px high (width follows aspect, ~480), then one integer
  upscale pass (nearest) with the colour-grade shader. Canvas backing size = CSS size × devicePixelRatio, exactly.
- Snap camera and sprites to whole pixels. Zoom only in whole-number scales.
- Iso tiles 32×16, characters ~16×24, ≤ 32-colour palette (`art/palette.hex`), light from the top left. See docs/ART_STYLE.md.
- All art lives in ≤ 2 atlases of 1024×1024 made by `tools/pack-atlas`. Never load loose images.
- Shaders use `mediump`.

## Text and language

- All text is DOM in `ui/`, from `src/ui/i18n/my.json` (Myanmar first). Unicode only; never Zawgyi.
- Player-typed text goes through the Zawgyi detector/converter (myanmar-tools) before storage.
- The font subset keeps whole Unicode ranges (Myanmar U+1000–109F, Extended-A U+AA60–AA7F, Extended-B U+A9E0–A9FF,
  Basic Latin, digits, common punctuation) with GSUB/GPOS shaping. Never subset by the text in my.json: players type their own.
- Touch targets ≥ 44 px. Respect `env(safe-area-inset-*)`; the HUD lives on the left and right edges.

## Audio

- Music: decode on demand, `AudioBufferSourceNode` with `loop = true` and `loopStart`/`loopEnd` from
  `assets/music/music.json`; prefer `.ogg`, fall back to `.m4a`; 4 s crossfade. Keep at most 2 decoded tracks in memory.
- Load music from the Vite-imported hashed URLs. The file names in music.json are labels only.
- Resume the AudioContext on the first tap and after any interruption.
- Ambient sound is generated in code (M6). No recorded ambience, no voices.

## Performance budgets

A milestone is not done until the low tier meets these on a real low-end phone.

| Metric                        | Low-end phone | Mid / high device |
| ----------------------------- | ------------- | ----------------- |
| Frame rate                    | steady 30 fps | 60 fps            |
| Main-thread frame time        | ≤ 25 ms       | ≤ 12 ms           |
| Draw calls per frame          | ≤ 40          | ≤ 80              |
| Texture memory                | ≤ 48 MB       | ≤ 96 MB           |
| JS heap                       | ≤ 100 MB      | ≤ 150 MB          |
| First download (before music) | ≤ 3 MB        | ≤ 3 MB            |
| Time to playable (4G)         | ≤ 6 s         | ≤ 3 s             |

Device tiers Low / Mid / High set render scale, max animated NPCs (12 / 25 / 40), particles, weather and lighting.
Daily check: Chrome DevTools with 6× CPU throttling and the perf overlay (`?debug=1`).

## Data and determinism

- Prices, objects, recipes, NPCs and dialogue live in `src/data/*.json`. No balancing numbers in code.
- All randomness comes from `shared/rng.ts` streams seeded by the save. Never `Math.random()` in `sim/`.
- Calm rules are hard constraints: no failure state, no debt or bankruptcy, nothing lost, no punishing timers or streaks.

## Workflow

- One feature per session; plan mode first; commit after each working step.
- Changes to `sim/` or `shared/` need Vitest tests. Run `npm run typecheck && npm test` before committing.
- Deploy runs on push to `main` (`.github/workflows/deploy.yml`). It may only write inside
  `games/laphat-yay-sine/` of the `aungkhantmin21.github.io` repo.
- Asset licences go in CREDITS.md.
