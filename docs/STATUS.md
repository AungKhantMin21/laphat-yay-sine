# Status — start here

Last updated 22 Nov 2026. Read this first in a new session, then CLAUDE.md, then DESIGN.md and docs/ARCHITECTURE.md as needed.

## Where we are

| Milestone | State | Notes |
| --- | --- | --- |
| M0 Foundation | ✅ done, deployed | docs/M0.md |
| M1 Build mode | ✅ done, deployed | docs/M1.md |
| M2 Shop day | ✅ done, deployed | docs/M2.md (steps, progress, gate table) |
| M2.5 Shop, service and street | ✅ done, deployed | docs/M2_5.md (steps, progress, gate table) |
| **M3 Neighbourhood** | **next — not planned yet** | DESIGN.md §11 (lighter after M2.5) |
| M4–M6 | not started | DESIGN.md §11 |

Live: https://aungkhantmin21.github.io/games/laphat-yay-sine/ (add `?debug=1` for the perf overlay, music switcher and font sample; it also exposes `window.__debug.bridge` for the perf gate).

## Decisions made with the user (not all are in DESIGN.md)

- **Real-device checks are batched into the M6 device-matrix pass.** Per-milestone gate = DevTools 6× CPU throttle + perf overlay within Low budgets.
- **Minimum browsers:** iOS/iPadOS Safari 15+, Android Chrome 90+, current desktop Chrome, Firefox, Safari, Edge.
- **Catch-up rule:** away < 1 real hour → none; otherwise 1 game day per full real day away, max 7 (so 1–24 h away = 0 days, implemented literally).
- **Font:** subset by whole Unicode ranges (Myanmar, Ext-A, Ext-B, Basic Latin, punctuation) with all GSUB/GPOS; never by my.json text. The font has no Latin glyphs, so Latin falls back to the system font.
- **Music** loads from Vite-hashed URLs; names in music.json are labels only.
- **M1 scope:** objects come from an **inventory** (start stock in `src/data/start.json`; the M3 furniture shop adds to it). Floor/wall painting is deferred to M3 (paint stall).
- **Menu (22 Nov 2026):** three paid drinks — ပုံမှန်, ချိုဆိမ့်, ကျဆိမ့်. "plain" was dropped; free ရေနွေးကြမ်း on the tables is a BACKLOG idea (atmosphere, not poured or paid). Prices stay as first set (1,000 / 1,200 / 1,200 kyat; tip ≤ 30 %, auto-serve 70 %).
- **Customers pay when served** (not after drinking) — accepted 22 Nov 2026.
- **Shop day (21 Nov 2026):** shutters open 06:00 (clock waits until Open) → shop hours to 17:00 → last customers finish → evening waits for Sleep → next 06:00. The player pours every cup they choose to, with an auto-serve fallback (70 %, no tip). Ingredients unlimited and free until M3.
- **The user tests the app only after all milestones are finished.** Burmese strings Claude writes are accepted for now; list new ones in each milestone's notes so they can be reviewed together at the end.
- Each milestone: plan mode first → approval → build step by step → `npm run check` → commit after each working step → push to `main` (the deploy action publishes). Tell the user when something needs doing on GitHub.

## How to work in this repo

- `npm run dev` (Vite, `__game` debug handle on `window`), `npm run check` (typecheck + lint + Vitest), `npm run build`, `npm run atlas` (repack sprites), `node tools/make-placeholders.ts` (regenerate placeholder art), `node tools/subset-font.ts` (needs Python fonttools + brotli).
- Browser checks use system Chrome via `playwright-core` (no bundled browsers):
  - `node tools/dev/probe.mjs <dev-url> [shot.png] [expr | @file.js]` — evaluate against `window.__game`, screenshot, report page errors.
  - `tools/dev/furnish150.js` — fills the shop with 150 objects and returns a save code.
  - `node tools/dev/gate.mjs <preview-url> code.txt [dir|-] [crowd]` — perf gate on a production build (imports the code through Settings; `crowd` > 0 opens the shop, adds that many customers via debug `crowd` and waits 35 s for them to sit). M2 gate used `40`.
  - `node tools/dev/reload.mjs <dev-url>` — furnishes, opens, waits for 2 payments, reloads, compares money/day/phase/stats.
  - `tools/dev/pour.js` — opens a furnished shop, taps a seated customer's bubble, pours with Space and reports the payment and reaction (leaves a second pour open for the screenshot).
  - `tools/dev/tin.js` — opens a furnished shop and reports the savings tin (size, fill, label) after a few payments, and the tin ↔ readout swap in build mode.
  - `tools/dev/dayend.js` — serves a few cups, jumps to 17:00 (`bridge.jump`, debug), checks the evening panel, sleeps, reads the teaser, wakes. Prefix `window.__shot='evening'|'sleep';` to stop there for a screenshot.
  - `tools/dev/customers.js` — furnishes a small shop, opens it, waits (`window.__wait` ms, default 45 s) and reports customers seen/drawn.
  - `node tools/shot.ts <url> <dir>` — screenshots on phone/desktop viewports.
- Headless Chrome uses SwiftShader, so fps there is meaningless; use headed runs (gate.mjs) for perf numbers.
- Deploy: push to `main` → `.github/workflows/deploy.yml` → `games/laphat-yay-sine/` in `AungKhantMin21/aungkhantmin21.github.io` (branch `master`, secret `DEPLOY_TOKEN`). GitHub Pages takes ~1–2 min after the action.

## Code map (what exists now)

- `src/shared/` — protocol (v8), customers (`customers.ts`, `npc.ts`), shop day (`day.ts`, `shop.ts`, `drinks.ts`, `teasers.ts`), binary frame codec (`diff.ts`), catalog (`objects.json` → defs), world state (area grids, object store with slots/generations/uids, occupancy), placement rules, RNG streams, IndexedDB helper, base64url, iso math.
- `src/sim/` (worker) — `worker.ts` (timing, saving, messages), `game.ts` (Sim + world + builder, toSave/fromSave), `world.ts` (change tracking, grid streaming), `build/builder.ts` (commands + undo), `day/shop-day.ts`, `path/` (walk grid + A*), `npc/customers.ts` (arrivals, seat utility, serve/pay), `grids/property-grids.ts`, `save/` (format v1 + migrations, IDB store, save codes), `area.ts` (M1 street + shop), `catchup.ts`.
- `src/game/` — `bridge.ts` (only Worker contact; promise acks), `view.ts` (mirror), `loop.ts`, `build-mode.ts` (build state machine + ghost logic).
- `src/render/` — pixel stage, chunks (floors + back walls), objects (depth, picking), npcs (customers, order bubbles, `pickOrder`), recolour atlas, ghost, heat overlay, camera, atlas loader, gl-stats.
- `src/ui/` — i18n (Myanmar digits, `{args}`), build HUD, savings tin (`ui/hud/tin.ts`), evening panel + sleep screen (`ui/hud/day-end.ts`), pour minigame + reaction bubbles (`ui/pour/`), settings (save code), perf overlay, title card, music debug.
- `src/platform/` — tiers (benchmark v2, thresholds calibrated), orientation, touch guard, persist.
- `src/audio/` — music player + policy.
- Tests: 193 in `test/` (Vitest, own tsconfig); `test/m2-gate.test.ts` runs three seeded days twice (determinism).

## Open items carried forward

- Burmese wording written by Claude is accepted for now; the user reviews all of `src/ui/i18n/my.json` when testing after the last milestone.
- Light heat-overlay contrast is low on the placeholder floor.
- Share links (M6) need compression; save codes are uncompressed (~24 bytes/object).
- Multi-tile depth sorting may need sprite slicing once characters walk around (M2/M3).
- BACKLOG.md holds deferred ideas.
- Flaky test: `test/builder.test.ts` "any random sequence fully undoes…" failed once in a full parallel run on 22 Nov 2026; it did not recur in 4 full runs during M2.9. Probably a timeout under load; look again if it comes back.
- The mid-day reload check passed, but it can't tell whether the `pagehide` save or the hourly autosave kept the data. Add an M6 device check: background a phone mid-day and kill the tab (RISKS.md).
- Customers are not saved: a mid-day reload reopens the shop empty (money, phase and stats are kept). Fine for M2; revisit when named regulars arrive (M5).
- **Burmese strings to review** (all of `src/ui/i18n/my.json` at the end; the ones added in M2): drink and reaction names (M2.1), `day.*` (M2.2), `pour.holdTea`, `pour.holdMilk`, `pour.tea`, `pour.milk`, `pour.cancel`, `pour.paid`, `tin.label`, `teaser.friends|praise|asked|early`, `evening.title|served|poured|earned|tips|best`, `sleep.title`, `sleep.wake`.

## Next step: M3 Neighbourhood — plan mode first

DESIGN.md §11: 3 streets (reuse the M2.5 walk zones, access classes and `shared/street.ts` pattern; real areas from `src/data`), walking the neighbourhood (the player worker already walks with A*), 4 shops with daily stock (`rng.market` is unused so far), carrying and delivery (the tray/cup carrying in `sim/npc/workers.ts` is a model). Neighbouring building fronts are decor (`BUILDINGS`); M3 turns some into real shops.

M2.5 open items:
- **Re-run the perf gate fps columns on an idle machine** (23 Nov the machine was busy: Spotlight at 100 % CPU; an A/B with the M2 build dropped the same way). Frame time, draws, texture and heap all passed with wide margins.
- New Burmese strings from M2.5 for the end review: `build.err.walkway|seatOutside|blocksWay|fixed|kitchenOnly`, `obj.kettle|sink|stove`, `serve.err.*` (8), `queue.cancel`, `staff.*` (17), changed `evening.poured`; `react.auto` removed.
- Hiring is in the evening panel; only the waiter in M2.5 (helper M4, tea sayar and cook M5).
- The autoplayer's pours score "ok" (Space timing); fine for checks, not a balance signal.

(Older notes below.)

### M2.5 — S2 notes

The M2 review (22 Nov 2026) found that the game doesn't play like a tea shop yet, so M2.5 comes before M3. Read docs/M2_5.md: decisions 1–9 at the top, then steps S2–S9. DESIGN.md and ARCHITECTURE.md already describe the M2.5 target (ARCHITECTURE marks protocol v9 and save v3 as planned).

- CLAUDE.md now has the M2.5 rules (default zoom one step in, `shared/rules/access.ts`, no auto-serve).
- What moves between milestones is in the table at the end of docs/M2_5.md (avatar + tap-to-walk and building fronts from M3, debug UI from M6; helper → M4, tea sayar and cook → M5, vehicles → M4).

Carried over for M3 (after M2.5):
- `rng.market` is unused so far; it's meant for daily stock.
- Multi-tile depth sorting worked without sprite slicing so far; recheck it with the player avatar walking behind the counter.
