# Device risks

Risks for low-end phones and iOS Safari, with the milestone that handles each. Project-level risks are in DESIGN.md §12.

## Low-end Android (2 GB RAM)

| Risk | Mitigation | When |
| --- | --- | --- |
| Decoded music is large: ~52 s stereo float32 at 48 kHz ≈ 20 MB per track; all four ≈ 80 MB, nearly the whole heap budget | keep ≤ 2 decoded tracks; Low tier creates the AudioContext at 22.05 kHz (halves memory) | M0 |
| WebGL context loss under memory pressure or when backgrounded | handle `webglcontextlost` / `webglcontextrestored`; chunk textures are always rebuildable from tile data | M0 |
| Old GPUs that are WebGL1-only or have weak `highp` | verify Pixi v8 on a WebGL1 device; `mediump` shaders; 1024² atlases | M0 |
| GC hitches from 10 Hz worker messages | binary frames with recycled buffers; pools; no hot-path allocation | M0, M4 |
| Blurry pixel art from browser CSS scaling | canvas backing size = CSS size × DPR exactly; integer scale computed in device pixels | M0 |
| Thermal throttling over a 10-minute session | 30 fps cap on Low; idle drop; render menus only when something changes | M0 |
| `deviceMemory` missing or rounded; benchmark delays startup | start at Low, benchmark after the first frame, upgrade silently | M0 |
| Two JS heaps (main + worker) | keep the worker lean; ~300 KB of grids per area; stream areas | M3, M4 |
| Old WebViews / Samsung Internet shaping Myanmar badly | test the real subset font on device | M0 |

## iOS Safari

| Risk | Mitigation | When |
| --- | --- | --- |
| **IndexedDB is wiped after 7 days without interaction in a Safari tab** (ITP) — exactly the "come back after a week" case | `navigator.storage.persist()`; nudge "Add to Home Screen" (home-screen apps are exempt); save export code | M1, M6 |
| No Fullscreen API or orientation lock on iPhone | rotate screen in portrait; `100dvh` + `visualViewport` resize | M0 |
| Notch / Dynamic Island sits on the left or right in landscape, where the HUD lives | `viewport-fit=cover` + `env(safe-area-inset-left/right)` padding | M0, M2 |
| AudioContext starts suspended and becomes `interrupted` after calls or backgrounding | resume on first tap and on `visibilitychange` / next tap | M0 |
| Ogg support varies on older iOS | `canPlayType` check + fall back to m4a on decode failure | M0 |
| AAC priming/padding could leave a gap in m4a loops (`loopStart` is 0 in music.json) | listen for a click on iPhone; if heard, add per-format loop points to music.json | M0 |
| Ringer switch mutes Web Audio | accept for a calm game; revisit `navigator.audioSession` later | — |
| Tab killed in the background without `beforeunload` | save on `visibilitychange: hidden` and `pagehide`; autosave every game hour | M1 |
| IndexedDB connections that hang after resume (known WebKit bugs) | timeout + reopen wrapper in `sim/save` | M1 |
| Pinch zooms the page; double-tap zoom; rubber-band scroll | `touch-action: none`, block `gesturestart`, `overscroll-behavior: none` | M0 |
| Low Power Mode caps rAF at 30 fps | the fixed-step loop already handles it | M0 |
| No `performance.memory` | overlay shows "n/a"; measure with Web Inspector over a cable | M0 |
| Service-worker cache quota and stale caches | cache only the music format in use; versioned caches; protocol version check | M6 |
| A killed tab loses the last game hour (the `pagehide`/hidden save is an async IndexedDB write in the worker) | hourly + post-build + post-sleep autosaves; check on devices: background mid-day, kill the tab, reopen — money and stats must match | M6 |

## Deploy (all devices)

- GitHub Pages runs Jekyll on the site repo, which drops files starting with `_` → sanitise chunk names in Rollup output.
- `rsync --delete` is scoped to `games/laphat-yay-sine/` only.
- `DEPLOY_TOKEN` must be a token with `contents: write` on the `aungkhantmin21.github.io` repo.
