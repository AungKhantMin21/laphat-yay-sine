# Status — start here

Last updated 21 Nov 2026. Read this first in a new session, then CLAUDE.md, then DESIGN.md and docs/ARCHITECTURE.md as needed.

## Where we are

| Milestone | State | Notes |
| --- | --- | --- |
| M0 Foundation | ✅ done, deployed | docs/M0.md |
| M1 Build mode | ✅ done, deployed | docs/M1.md |
| **M2 Shop day** | **in progress — M2.1–M2.4 done** | plan approved; docs/M2.md (steps + progress) |
| M3–M6 | not started | DESIGN.md §11 |

Live: https://aungkhantmin21.github.io/games/laphat-yay-sine/ (add `?debug=1` for the perf overlay, music switcher and font sample).

## Decisions made with the user (not all are in DESIGN.md)

- **Real-device checks are batched into the M6 device-matrix pass.** Per-milestone gate = DevTools 6× CPU throttle + perf overlay within Low budgets.
- **Minimum browsers:** iOS/iPadOS Safari 15+, Android Chrome 90+, current desktop Chrome, Firefox, Safari, Edge.
- **Catch-up rule:** away < 1 real hour → none; otherwise 1 game day per full real day away, max 7 (so 1–24 h away = 0 days, implemented literally).
- **Font:** subset by whole Unicode ranges (Myanmar, Ext-A, Ext-B, Basic Latin, punctuation) with all GSUB/GPOS; never by my.json text. The font has no Latin glyphs, so Latin falls back to the system font.
- **Music** loads from Vite-hashed URLs; names in music.json are labels only.
- **M1 scope:** objects come from an **inventory** (start stock in `src/data/start.json`; the M3 furniture shop adds to it). Floor/wall painting is deferred to M3 (paint stall).
- Each milestone: plan mode first → approval → build step by step → `npm run check` → commit after each working step → push to `main` (the deploy action publishes). Tell the user when something needs doing on GitHub.

## How to work in this repo

- `npm run dev` (Vite, `__game` debug handle on `window`), `npm run check` (typecheck + lint + Vitest), `npm run build`, `npm run atlas` (repack sprites), `node tools/make-placeholders.ts` (regenerate placeholder art), `node tools/subset-font.ts` (needs Python fonttools + brotli).
- Browser checks use system Chrome via `playwright-core` (no bundled browsers):
  - `node tools/dev/probe.mjs <dev-url> [shot.png] [expr | @file.js]` — evaluate against `window.__game`, screenshot, report page errors.
  - `tools/dev/furnish150.js` — fills the shop with 150 objects and returns a save code.
  - `node tools/dev/gate.mjs <preview-url> code.txt [dir]` — perf gate on a production build (imports the code through Settings).
  - `node tools/shot.ts <url> <dir>` — screenshots on phone/desktop viewports.
- Headless Chrome uses SwiftShader, so fps there is meaningless; use headed runs (gate.mjs) for perf numbers.
- Deploy: push to `main` → `.github/workflows/deploy.yml` → `games/laphat-yay-sine/` in `AungKhantMin21/aungkhantmin21.github.io` (branch `master`, secret `DEPLOY_TOKEN`). GitHub Pages takes ~1–2 min after the action.

## Code map (what exists now)

- `src/shared/` — protocol (v6), customers (`customers.ts`, `npc.ts`), shop day (`day.ts`, `shop.ts`, `drinks.ts`), binary frame codec (`diff.ts`), catalog (`objects.json` → defs), world state (area grids, object store with slots/generations/uids, occupancy), placement rules, RNG streams, IndexedDB helper, base64url, iso math.
- `src/sim/` (worker) — `worker.ts` (timing, saving, messages), `game.ts` (Sim + world + builder, toSave/fromSave), `world.ts` (change tracking, grid streaming), `build/builder.ts` (commands + undo), `day/shop-day.ts`, `path/` (walk grid + A*), `npc/customers.ts` (arrivals, seat utility, serve/pay), `grids/property-grids.ts`, `save/` (format v1 + migrations, IDB store, save codes), `area.ts` (M1 street + shop), `catchup.ts`.
- `src/game/` — `bridge.ts` (only Worker contact; promise acks), `view.ts` (mirror), `loop.ts`, `build-mode.ts` (build state machine + ghost logic).
- `src/render/` — pixel stage, chunks (floors + back walls), objects (depth, picking), recolour atlas, ghost, heat overlay, camera, atlas loader, gl-stats.
- `src/ui/` — i18n (Myanmar digits, `{args}`), build HUD, settings (save code), perf overlay, title card, music debug.
- `src/platform/` — tiers (benchmark v2, thresholds calibrated), orientation, touch guard, persist.
- `src/audio/` — music player + policy.
- Tests: 165 in `test/` (Vitest, own tsconfig).

## Open items carried forward

- Burmese wording written by Claude needs the user's review (`src/ui/i18n/my.json`), incl. `pour.err.gone` (M2.4).
- M2.5 hooks: `game/view.ts` NPC handlers (`npcSpawn`/`npcDespawn`/`npcState`/`npcOrder`) are empty stubs; NPC_STATE carries the slot index, the others the handle. dir/anim/order values are in `shared/npc.ts`.
- Light heat-overlay contrast is low on the placeholder floor.
- Share links (M6) need compression; save codes are uncompressed (~24 bytes/object).
- Multi-tile depth sorting may need sprite slicing once characters walk around (M2/M3).
- BACKLOG.md holds deferred ideas.

## Next step: M2 Shop day — continue at M2.5 rendering customers (see docs/M2.md)

Decided 21 Nov 2026: day = shutters open 06:00 (clock waits until Open) → shop hours to 17:00 → last customers finish → evening waits for Sleep → next 06:00. Player pours every cup, with an auto-serve fallback (lower price, no tip). A* core built in M2. Ingredients unlimited and free until M3.

### Original M2 brief

Done when: customers arrive, choose seats by utility, pour minigame, savings tin, day end and teaser.
Start in plan mode: read DESIGN §2, §6, §8; reuse property grids (`value` arrays), object `seat` counts in objects.json, RNG streams, the NPC SoA layout in ARCHITECTURE §3, and the NPC_* frame sections already defined in `shared/diff.ts`.
