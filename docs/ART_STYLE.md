# Art style guide (v0)

Locked in M0 so every asset matches. Change it only on purpose, and repack the atlas after.

## Sizes

| Thing | Size | Anchor |
| --- | --- | --- |
| Floor tile | 32×16 px diamond (rows 2, 6, …, 30, 30, …, 2 px wide) | top-left of the 32×16 box |
| Character | about 16×24 px | bottom centre (feet) |
| Object | footprint 1×1 to 3×2 tiles; height as needed | bottom vertex of its footprint diamond |
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

## Files

- Sources (`.aseprite`, `.png`) live in `art/`. Only the generated atlas ships.
- Export PNGs to `art/sprites/<category>/<name>.png`. The frame name is `<category>/<name>`.
- Animation frames: `<name>_0.png`, `<name>_1.png`, … (10 fps for near NPCs).
- After changing sprites: `npm run atlas` → `assets/atlas/atlas-0.{webp,png,json}`. Commit the outputs.
- Floor types map to frames in `src/data/floors.json`.

## Third-party art

Any CC0 or other pack must be listed in CREDITS.md with its source URL and licence, and recoloured to the palette before use.

## Current state

`art/sprites/floor/*` are generated placeholders (`node tools/make-placeholders.ts`). Replace them with hand-made tiles; keep the names.
