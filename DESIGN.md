# Laphat Yay Sine — Game Design Doc & Build Plan

Author: Aung Khant Min · Updated 21 Nov 2026

## 1. Vision

Laphat Yay Sine is a calm sandbox life sim in a small, fictional Yangon-style neighbourhood. You inherit a run-down tea shop and grow it into anything you can imagine. It runs in any browser, from a cheap Android phone to a laptop, hosted at `aungkhantmin21.github.io/games/laphat-yay-sine/`.

- **Tagline:** Your tea shop. Your street. The only limit is your mind.
- **Look and feel:** pixel art, landscape only on phones, Myanmar language first, fictional neighbourhood.
- **Audience:** young adults (18–30) who want a quiet place to unwind after work or study, on the phone they already own.

### Pillars

1. **Freedom** — the story asks for needs, never blueprints. Any layout that meets a need is valid.
2. **A living place** — a small neighbourhood with shops you walk to, NPCs with schedules, and a property market that moves on its own.
3. **Calm** — no failure state, no punishment for being away, soft sound, natural stopping points.
4. **Runs everywhere** — 60 fps on modern phones, a steady 30 fps on low-end devices, playable offline.

### Calm-but-addictive rules

- Hook with anticipation, never anxiety: no punishing timers, no breakable streaks, no FOMO.
- Nothing is ever lost. Bad days only slow progress.
- The world grows while you are away, so returning feels like a gift.
- Every in-game day ends with a clean stopping point and one small reason to come back tomorrow.
- Money is calm: no bankruptcy, no forced rent on the starting shop, missed deals always come around again.

## 2. Core loop

One in-game day takes 8–12 real minutes and ends with sleep, a save and a teaser for tomorrow.

1. **Morning** — open the shutters, check the ingredient shelf, hear overnight news from the first regulars.
2. **Serve** — a calm Diner Dash. The player is a character in the shop, and every cup is made by a person: take the order at the table → brew at the tea counter (a tactile pour minigame: milk-to-tea ratio by holding) → carry it on the tray (2 cups at first) → later clear the cups → wash them at the sink. Tap to queue up to 3 tasks (small numbered markers; tap a marker to cancel). Customers never leave angry and there is no failure state: waiting longer only lowers the tip, fast and good service raises it. Cups are a fixed set, so washing keeps the service going. Staff can be hired to share the work (§6).
3. **Errands** — walk the neighbourhood: ingredients at the wet market, furniture at the furniture shop, paint and floor tiles at the hardware stall, decor at the bookstall. Stock changes daily. The clock waits before opening and after closing, so errands fit there without leaving customers waiting; going out during the day is fine too (customers only wait longer).
4. **Build** — rearrange, place and paint in build mode at any time. The shop keeps running while you build.
5. **Evening** — close up, count the day in the savings tin, read the notice board, sleep.
6. **Tomorrow teaser** — one line on the sleep screen: a customer's promise, a rumour of a sale, a seed about to sprout.

**Time model:** about 1 game hour = 1 real minute while active, paused in menus. After real time away, the world simulates up to 7 missed days in a fast catch-up, then shows a "while you were away" summary.

## 3. Sandbox build system

The game checks qualities of a space, never specific objects, so every need has many valid solutions.

### Needs, not blueprints

| Need | Rule the game checks | Some valid solutions |
| --- | --- | --- |
| Quiet study spot | seat with noise < 2 and light ≥ 3 within 2 tiles | corner booth, rooftop table, back-room library |
| Shelter from rain | covered seats ≥ 6 during monsoon | awning, indoor expansion, glass roof |
| Radio corner | radio + ≥ 4 seats within 3 tiles | porch benches, music corner, small stage |
| Breezy spot | fan or open window + plant within 2 tiles | window bar, courtyard tree, rooftop |

### Object properties

Every object carries a property vector: **comfort, light, noise, warmth, shade, beauty, smell, cover**. Each spreads to nearby tiles with distance falloff. One small grid per property; only tiles near a changed object are updated.

### Placement

- Isometric grid, 1 tile = 1 m, objects 1×1 to 3×2 tiles, rotation in 90° steps.
- Layers: floor → furniture → wall items → ceiling (lights, fans, hanging plants).
- Stacking on surfaces (a radio on a counter, a pot on a ledge).
- Recolour any object from a curated palette; custom signboard text.
- Undo/redo, move, sell back at 70% of price.

### Expansion

Spaces are bought, never unlocked by chapter (see Economy). Candidates: pavement frontage, back kitchen, upstairs room, rooftop, back alley, the empty lot next door, a second branch on another street.

### Crafting

Materials (wood, bamboo, cloth, paint, tiles) come from shops and trades. A workbench combines parts into furniture variants; later, free combination of base, top and decoration parts.

## 4. The neighbourhood world

One small walkable neighbourhood, not an open world. Buying happens in person, at real shops.

| Place | What it offers | Notes |
| --- | --- | --- |
| Tea shop street | your shop, neighbours, pavement | start location |
| Wet market | tea leaves, milk, flour, oil, vegetables | morning only; prices vary by day |
| Furniture shop | tables, stools, shelves, decor | stock rotates daily; owner remembers you |
| Hardware & paint stall | paint, tiles, wood, tools | crafting materials |
| Bookstall | books, newspapers, posters | feeds study and reading needs |
| Residential lane | NPC homes, properties for sale | where owners live |
| Notice board corner | for-rent and for-sale papers | updates each morning |
| Bus stop / trishaw stand | edge of the map | reserved for future districts |

**The tea shop street (M2.5)**

Walkable zones are explicit; everything else is blocked:

| Zone | Who may walk there |
| --- | --- |
| Road | vehicles only (people cross only at the zebra crossing) |
| Pavement, zebra crossing | everyone |
| Shop front opening and door tiles | everyone; the only ways into the shop |
| Shop interior (seating) | customers, staff, player |
| Back kitchen (stove, sink) | staff and player only |
| Outside filler, walls | nobody |

Customers come along the pavement (or across the crossing), enter through the shop front, sit, and leave the same way. No one ever crosses a wall or the filler. The empty land around the shop is replaced by neighbouring building fronts so the street feels lived in.

The shop: an open front with roll-up shutters facing the pavement, a signboard with the shop name, an awning, the tea counter at the front, and the back kitchen with stove and sink behind it. A new game starts small and deliberate: counter, kettle, sink, stove, 3 low tables, 8 low stools, 2 plants.

**Walking rules**

- Any errand is 20–40 seconds of walking at most.
- Tap-to-walk with pathfinding; on desktop, also WASD.
- The walk is part of the calm: street sounds, weather, light changing through the day.
- Purchases are carried home, or delivered later the same day for a small fee.

**The neighbourhood (M3)** is one map (112×72 tiles): the tea shop street, a market street and a quiet lane, joined at a junction. The shop keeps its place and keeps running while you walk.

| Shop | Street | Sells | Hours |
| --- | --- | --- | --- |
| Wet market | market street | tea leaves, condensed milk, evaporated milk | 05:00–11:00 |
| Furniture shop | the lane | stools, chairs, benches, tables, shelves, rugs, plants | 08:00–20:00 |
| Hardware & paint stall | the lane | floor tiles and wall paint, by the tile | 08:00–20:00 |
| Bookstall | market street | decor: book stack, newspaper rack, poster stand, radio | 07:00–19:00 |

- Shops are fronts with a counter and a keeper. Tap the keeper (or a shop on the map) to walk there; the shop panel opens on arrival.
- Daily stock: each morning every shop picks its items, quantities and a price factor (0.85–1.15) from the save's seed and the day, so it is the same after a reload. Sold-out items come back another day.
- Carrying: up to 4 load (an ingredient pack is 1, furniture is its footprint). Goods are put away as soon as you step into your shop. Delivery costs 10 % (min 500 kyat) and arrives 2 game hours later, or at the next opening if bought in the evening.
- At closing time, customers still on their way to a seat turn home (they haven't ordered); seated ones are served as usual.
- Ingredients never stall service: they are reserved when an order is taken. If a customer's drink can't be made they pick one that can; if nothing can be made they get free ရေနွေးကြမ်း and leave content without paying.
- A small map (button in the HUD) shows the streets, the shops and you; tap a shop to walk there.

**Convenience is earned:** bicycle (faster walking), a delivery helper hired at the shop, phone orders from a shop where you are a regular (10+ visits).

## 5. Economy and property market

Currency is kyat. Space is bought only when an owner is selling or renting.

### Money

- Income: drinks and snacks; tips from happy regulars; occasional catering orders.
- Spending: ingredients (about a quarter of a cup's price), furniture, materials, delivery fees, property, staff wages.
- **Staff wages** are paid daily from the savings tin at Sleep. If the tin is too low, that staff member takes an unpaid day off tomorrow; nothing is taken and there is never debt.
- Savings live in a tin box under the counter; its fill level is the money display.
- All prices live in data tables, so balancing never needs code changes.

### Property states

Every building and lot has an owner NPC and a state:
**Not selling → Considering → Listed (sale or rent) → Sold** (to the player or another NPC). An untaken listing returns to Not selling.

| Trigger | Effect |
| --- | --- |
| Owner's life event (moving to family, child abroad) | Considering → Listed after 1–3 weeks |
| Business revenue low for 14+ days | 30% weekly chance to close and list for rent |
| Urgent money need | listed 15–25% below value, short expiry |
| Street popularity rises | asking prices nearby go up |

- Listings expire after 7–21 days; another NPC may buy first.
- Rent is optional, only on spaces you chose to rent; the inherited shop is rent-free.
- The player learns about listings through customer gossip, the notice board and later a broker (pwèza) for a small fee.

### Calm-money rules

- No bankruptcy, no debt, no losing what you own.
- A missed listing is a soft loss: the same space returns to the market later.
- A bad day still earns something; regulars always come back.

## 6. NPC simulation

Coded rules, not an LLM: schedules, utility scoring and state machines with seeded randomness. Cheaper, faster, offline and fully testable.

| Technique | Used for |
| --- | --- |
| Daily schedules | where each NPC is each hour: home, work, tea shop, market |
| Needs + utility scoring | needs (hunger, social, money, comfort) score each action; best wins, with small random jitter |
| Seat choice | a customer scores every free seat by the property grids against personal tastes |
| State machines | NPC life states, shop states, property states |
| Rule events with probability | life events, closures, festivals, gossip |
| Seeded RNG (mulberry32) | each save has a seed: varied playthroughs, reproducible bugs |
| Offline catch-up | missed days run as a fast, render-free simulation on a 1-hour tick |

**Staff and the task board (M2.5)**

The sim keeps a **task board** of all open jobs: take order, brew, serve, clear, wash, cook. The player and staff take jobs from the same board. A job the player queues is theirs; staff working on it pick another.

| Role | Jobs | Arrives |
| --- | --- | --- |
| Waiter | take orders, serve, clear | M2.5 |
| Helper | wash cups | M4 (with staff schedules) |
| Tea sayar | brew, at a better quality than an average pour | M5 (with drink mixing) |
| Cook | snacks | M5 (with snacks) |

- Staff are NPCs that choose jobs by utility scoring (role weight per job, distance, how long the job has waited, small jitter).
- Hiring unlocks by savings and number of seats (data in `src/data/staff.json`). The player can still do any job.
- Wages: see §5. Hiring and letting go happen in the evening.

**Levels of detail**

- **Near** (on screen): full movement, pathfinding, animation, every tick.
- **Far** (off screen): position jumps along the schedule, decisions only on the hour.
- **Abstract** (catch-up): no positions, only state changes and money.

**Scale target:** about 40 named NPCs plus generic passers-by; at most 25 visible and animated at once.

## 7. Story layer

The story gives reasons to build, never instructions on how.

- **Regulars:** each has a 10–15 beat arc unlocked by visits and friendship. Beats are short (2–4 lines) and touch young-adult life: career pressure, family expectations, loneliness, small joys.
- **Needs from stories:** beats create needs ("the student needs somewhere quiet before exams") that any valid space can satisfy.
- **Gossip:** customers pass on world news from the simulation — listings, closures, new stalls, festivals.
- **Seasons:** hot, monsoon, cool. Weather changes customer counts, tastes and which needs matter.
- **Festivals:** Thingyan, Thadingyut lights, Tazaungdaing.
- **Customers notice changes:** short reactions to moved seats, new lights, a repainted wall.
- **"Just sit" mode:** sit in your own shop and watch the street, no tasks.

All dialogue lives in JSON, written in Myanmar first (Unicode), English added later, loaded per area.

## 8. Kitchen and menu

- **Drink model:** tea strength, condensed milk, evaporated milk, sugar, temperature, toppings. Each recipe maps to taste axes: sweet, strong, creamy.
- **Taste matching:** each customer has a preferred point on those axes; satisfaction falls off with distance.
- **Classic presets** (pon man, cho seint, kya seint) unlocked from the start.
- **Ingredients (M3):** each preset uses tea leaves plus condensed and/or evaporated milk from the kitchen stock, bought at the wet market. A new game starts with about 2 days of stock; one morning trip (packs of 40–50 portions, a load of 4) covers a day. The HUD shelf shows how many cups are left.
- **Snacks:** paratha, samosa, e kya kwe, mohinga (later), each with a simple prep minigame.
- **Tea sayar** (M5): brews for you at a steady, better-than-average quality; the pour minigame stays for the player's own cups.
- **Cook** (M5): needs the snack recipes; the stove in the back kitchen is placed from the start and waits for them.
- **Naming:** players name creations; they appear on the chalkboard menu and in share codes.

## 9. Sharing

- Shop layout (tiles, objects, colours, signboard, menu names) serialised to compact binary, compressed, encoded as URL-safe Base64.
- Share link: `aungkhantmin21.github.io/games/laphat-yay-sine/#v=<code>` opens a read-only visit.
- Visitors can walk around and sit; nothing is saved to the owner's game.
- Target: a typical shop under 2,000 characters. Later: a "Street of Friends".

## 10. Technical architecture and performance

Static, frontend-only build: TypeScript + Vite + PixiJS (WebGL), simulation in a Web Worker, saves in IndexedDB, service worker for offline play. Deploys to GitHub Pages with no server.

```
Main thread (60 fps)                       Simulation worker (10 Hz tick)
  Input (Pointer Events)    -- player actions -->   NPC simulation (schedules, utility)
  Renderer (PixiJS, atlases, culling)               Property market
  UI overlay (DOM, Myanmar text)  <-- diffs 10 Hz --  Pathfinding (A*, flow fields)
  Audio (Web Audio)                                 Offline catch-up
            \                                             /
             Storage: IndexedDB saves · service worker cache · JSON data + atlases
```

### Stack

| Layer | Choice | Why |
| --- | --- | --- |
| Language & build | TypeScript, Vite | type safety; tree-shaking, hashed filenames, code splitting |
| Rendering | PixiJS (WebGL), 2D isometric pixel sprites | automatic batching; WebGL runs on almost every phone |
| UI | plain DOM overlay + small reactive layer (Preact or none) | crisp Myanmar text, accessible, cheap |
| Simulation | Web Worker, fixed 10 Hz tick | keeps the main thread free |
| Save | IndexedDB, versioned schema with migrations | async, large, survives reloads |
| Offline | service worker + web app manifest (PWA) | installable, works offline |
| Audio | Web Audio API | gapless loops, generated ambience |

### Performance budgets

| Metric | Low-end phone | Mid / high device |
| --- | --- | --- |
| Frame rate | steady 30 fps | 60 fps |
| Main-thread frame time | ≤ 25 ms | ≤ 12 ms |
| Draw calls per frame | ≤ 40 | ≤ 80 |
| Texture memory | ≤ 48 MB | ≤ 96 MB |
| JS heap | ≤ 100 MB | ≤ 150 MB |
| First download (before music) | ≤ 3 MB | ≤ 3 MB |
| Time to playable (4G) | ≤ 6 s | ≤ 3 s |

### Pixel-art rendering

- **Internal resolution 480×270**, integer-scaled ×2/×3/×4. Wider phones see a little more street instead of black bars.
- **Crisp pixels:** nearest-neighbour scaling; sprites and camera snapped to whole pixels.
- **Tiles and sprites:** iso tiles 32×16 px, characters about 16×24 px, warm palette of at most 32 colours, light from the top left.
- **Small atlases:** all art in one or two 1024×1024 atlases.
- **Time of day and weather:** one colour-grade shader on the final upscale pass, not per-sprite lighting.
- **Myanmar text:** bitmap pixel fonts can't shape Myanmar script well, so all text is DOM with a subset Noto Sans Myanmar WOFF2 at native resolution; pixel feel comes from UI frames. Unicode only; player-typed text passes through a Zawgyi detector/converter (Google's myanmar-tools).
- **Landscape only:** Android locks landscape via the Screen Orientation API after entering fullscreen; iOS Safari shows a "please rotate your phone" screen in portrait.

### Rendering techniques

- Texture atlases so PixiJS batches into very few draw calls.
- Static layer caching: floors, walls and buildings rendered once into chunk textures, redrawn only on build.
- Viewport culling with a spatial hash.
- Isometric depth sort key = tile x + y + layer; only moving sprites re-sorted, insertion sort on a nearly sorted list.
- Animation LOD: far NPCs animate at 10 fps; off-screen NPCs not at all.
- Frame pacing: rAF with fixed-step simulation and interpolation; idle screens drop to 30 fps; rendering stops when the tab is hidden.

### Simulation and memory techniques

- Data-oriented storage: NPCs, objects and property grids in typed arrays (struct of arrays).
- Zero allocation in hot loops: pools for sprites, particles, paths, events.
- Incremental property grids: one Uint8Array per property, updated only around changes.
- Pathfinding: A* with a binary-heap open list, cached paths, flow fields to common destinations, ~2 ms per-frame budget.
- Worker sends compact diffs (transferable ArrayBuffers) at 10 Hz, never the whole world.
- Seeded RNG (mulberry32) per save.

### Loading and assets

- Code split by area: shop street first; market and residential lanes stream in.
- Images as WebP with PNG fallback.
- Hashed filenames + service worker cache for instant repeat visits (GitHub Pages has no custom cache headers).

### Audio

- **Music:** four seamless loops already in `assets/music/` (morning, afternoon, rain, night), each as `.ogg` (Opus) and `.m4a` (AAC), normalised to −20 LUFS. `music.json` lists each track's `loopStart`/`loopEnd` in seconds.
- Play with Web Audio: decode once, `AudioBufferSourceNode` with `loop = true` and `loopStart`/`loopEnd` from `music.json` (this skips encoder padding, so loops are gapless everywhere). Prefer `.ogg`, fall back to `.m4a`. Crossfade between tracks over 4 seconds. Lazy-load music after the first frame; unlock audio on the first tap.
- **Ambient sound:** generated in code with Web Audio, no recordings, no voices: rain (filtered noise + random drop transients), kettle hiss and frying sizzle (band-passed noise with envelopes), cup and spoon clinks (short synthesised tones), distant traffic hum (low-passed noise with slow wobble), occasional bicycle bell and horn, dawn birds, fan hum. Each layer is a JSON parameter set, mixed by time of day, weather and location.

### Device tiers

A 2-second benchmark plus `hardwareConcurrency` and `deviceMemory` picks Low / Mid / High on first launch. The tier sets render scale, max animated NPCs (12 / 25 / 40), particles, weather effects and lighting. Overridable in settings.

### Input and layout

- Pointer Events for mouse, touch and pen; tap-to-walk, drag to pan, pinch or wheel to zoom (zoom snaps to whole-number pixel scales).
- Outside the shop, a tap on walkable ground walks the player there (WASD on desktop); walks and shop visits share the 3-slot queue. The camera follows the player outside the shop; a home button re-centres on the shop.
- Build mode has a paint tool (M3) for floor tiles and wall colour inside the owned shop, using materials bought at the hardware stall.
- In the shop, a tap on a customer, a table, the counter or the sink queues that task for the player (up to 3, numbered markers; tap a marker to cancel).
- Default zoom shows characters clearly on a landscape phone (about 40 CSS px tall: a world view about 200 px high); one step out shows the full 270 px view.
- Debug UI (perf overlay, music switcher) appears only with `?debug=1`, in one small box inside the safe area.
- Touch targets ≥ 44 px; UI scales with screen size.
- Landscape only; HUD along the left and right edges for thumbs.

### Quality checks

- In-game perf overlay (fps, frame time, draw calls, heap) in a debug menu.
- Chrome DevTools with 6× CPU throttling as the daily low-end test.
- Real device matrix before each milestone: 2 GB RAM Android, mid-range Android, older iPhone, tablet, desktop Chrome/Firefox/Safari.
- Vitest tests for the simulation (the worker is plain TypeScript, runs headless).

## 11. Build plan

Build in Claude Code, one milestone at a time: plan mode first, performance check on a real low-end phone at the end. v0.1 = M0–M6.

### Models

| Model | Use it for |
| --- | --- |
| Claude Fable 5.2 | architecture, simulation core, worker protocol, performance deep-dives, hard bugs |
| Claude Opus 5.5 | day-to-day feature building |
| Claude Sonnet 5.5 | dialogue and data files, balancing, tests, small fixes |

### Methods

- **CLAUDE.md first:** architecture rules, performance budgets and conventions from this doc.
- **Plan, then build:** each milestone starts with an approved written plan.
- **One feature per session;** commit after each working step.
- **Data-driven content:** prices, objects, recipes, NPCs, dialogue in JSON.
- **Simulation tests** with Vitest.
- **Performance gate:** a milestone isn't done until budgets are met on the low-tier phone.
- **Deploy:** source in its own repo (`laphat-yay-sine`); a GitHub Action builds with Vite (`base: '/games/laphat-yay-sine/'`) and pushes the output to the `games/laphat-yay-sine` folder of `aungkhantmin21.github.io`.

### Assets

- **Art:** pixel art to the style guide. Prototype with CC0 pixel packs, then a custom set (Aseprite or LibreSprite). Licences in CREDITS.md.
- **Music:** done (Gemini), see Audio. Note Gemini's terms in CREDITS.md.
- **Ambience:** generated in code, see Audio.

### Milestones

| # | Milestone | Done when | Estimate |
| --- | --- | --- | --- |
| M0 | Foundation | repo, CLAUDE.md, perf overlay, device tiers, atlas pipeline, music player, deploy action; empty pixel iso grid at 60 fps on a mid phone, landscape | 1 week |
| M1 | Build mode | place, rotate, stack, recolour, undo/redo, property grids, IndexedDB save/load | 2 weeks |
| M2 | Shop day | customers arrive, choose seats by utility, pour minigame, savings tin, day end and teaser | 2 weeks |
| M2.5 | Shop, service and street | walkable zones and a walled shop with front, counter and back kitchen; player character with tap-to-queue service (order → brew → tray → serve → clear → wash); task board; the waiter; starting layout, readable sprites with shadows, default zoom; building fronts; debug UI only with `?debug=1` | 2 weeks |
| M3 | Neighbourhood | 3 streets on one map (reusing M2.5 zones), walking the neighbourhood with a map, 4 shops with daily stock, real ingredients, carrying and delivery, floor and wall painting | 2 weeks |
| M4 | Living world | sim worker, schedules (incl. staff), LOD, property market, gossip, offline catch-up (incl. staff and wages), vehicles on the road, helper role | 3 weeks |
| M5 | Story and kitchen | 3 regulars with full arcs, story-driven needs, seasons, drink mixing, tea sayar and cook roles, snacks | 2 weeks |
| M6 | Ship v0.1 | generated ambience, PWA install, share codes, device-matrix pass, published | 2 weeks |

M2.5 was added on 22 Nov 2026 after the M2 review: the player avatar and tap-to-walk moved from M3, building fronts from M3 (decor only; M3 makes them real shops), the debug-UI cleanup from M6.

Estimates assume hobby pace (evenings and weekends).

## 12. Risks

| Risk | Mitigation |
| --- | --- |
| Scope grows faster than you can build | v0.1 = M0–M6 only; new ideas go to BACKLOG.md |
| Too heavy for low-end phones | budgets in CLAUDE.md, performance gate, device tiers, simulation LOD |
| Inconsistent art | lock the pixel-art style guide in M0 before making assets |
| Economy feels stressful or grindy | calm-money rules; numbers in data tables; playtest each milestone |
| Walking feels tedious | 40-second cap; earned convenience |
| Safari / iOS quirks (audio unlock, storage eviction) | test on iPhone each milestone; request persistent storage; save export as a code |

## 13. Decisions (21 Nov 2026)

- Game title: Laphat Yay Sine (Burmese for "Tea Shop"). Repo: laphat-yay-sine. URL: aungkhantmin21.github.io/games/laphat-yay-sine/.
- Phones play in landscape only.
- Art style is pixel art.
- Myanmar language first; English later.
- The neighbourhood is fictional, inspired by Yangon.
- Ambient sound is generated in code with no voices.
- Music: four Gemini loops, already processed into `assets/music/`.
- 22 Nov 2026 (M2 review): service is done by people only (no auto-serve); customers never leave angry, waiting only lowers the tip; the road is for vehicles, people cross at one zebra crossing; the waiter unlocks at 60,000 kyat savings and 6 seats, wage 3,000 kyat/day (data, tunable).
- 24 Nov 2026 (M3 plan): one bigger map, not separate scenes; errands fit the held clock before opening and after closing; ingredients reserved at order time with a free-tea fallback so service never stalls; delivery 10 % (min 500 kyat), 2 game hours; painting by the tile from hardware-stall materials. Details in docs/M3.md.
