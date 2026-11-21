# Art style guide (v0)

Locked in M0 so every asset matches. Change it only on purpose, and repack the atlas after.

## Sizes

| Thing | Size | Anchor |
| --- | --- | --- |
| Floor tile | 32×16 px diamond (rows 2, 6, …, 30, 30, …, 2 px wide) | top-left of the 32×16 box |
| Character | about 16×24 px | bottom centre (feet) |
| Object | footprint 1×1 to 3×2 tiles; image (w+h)·16 px wide, footprint diamond at the bottom | top vertex of the footprint diamond at x = h·16 |
| Back wall | 32 × (16 + 40) px, one per tile edge (`wall/n`, `wall/w`) | like a floor tile, 40 px headroom |
| World view | 480×270 world pixels (wider screens see a bit more) | — |

One world pixel is always a whole number of screen pixels. Never scale, rotate or sub-pixel-position sprites.

## Palette

- At most **32 colours**, all in `art/palette.hex`. The packer rejects any pixel that isn't in the palette.
- Pixels are fully opaque or fully transparent. No semi-transparency.
- Warm overall: browns, cream, tea-gold, muted greens and dusk blues. Avoid pure black and pure white.

## Light and shading

- Light comes from the **top left**. Top-left edges get the lighter shade; bottom-right edges get the darker one.
- Two or three shades per material. No gradients, no dithering on small sprites.
- No black outlines. Outlines, where needed, are a darker shade of the sprite's own colour.
- Time of day and weather are done by one colour-grade shader over the whole frame. Do not paint night versions.

## Objects

- One frame per distinct orientation: `obj/<key>_r0` … `_r3` (`rots` in objects.json is 1, 2 or 4). Odd rotations swap the footprint.
- Wall items: `_r0` hangs on the west (−x) wall, `_r1` on the north (−y) wall. Ceiling items hang from about 44–58 px up.
- **Recolourable parts are painted in the key ramp** (ramp 0 in `src/data/objects.json`: `e98a5e`, `c85a44`, `9a3a30`, light → dark). The game swaps those three colours for the chosen ramp, so never use them for parts that must not change colour.
- Small items that stand on surfaces are drawn at floor level; the game lifts them by the surface height.

## Files

- Sources (`.aseprite`, `.png`) live in `art/`. Only the generated atlas ships.
- Export PNGs to `art/sprites/<category>/<name>.png`. The frame name is `<category>/<name>`.
- Animation frames: `<name>_0.png`, `<name>_1.png`, … (10 fps for near NPCs).
- After changing sprites: `npm run atlas` → `assets/atlas/atlas-0.{webp,png,json}`. Commit the outputs.
- Floor types map to frames in `src/data/floors.json`.

## Third-party art

Any CC0 or other pack must be listed in CREDITS.md with its source URL and licence, and recoloured to the palette before use.

## Current state

Everything in `art/sprites/` is a generated placeholder (`node tools/make-placeholders.ts`, shapes in `tools/placeholder-objects.ts`). Replace sprites with hand-made art; keep the names and sizes.
