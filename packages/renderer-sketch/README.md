# @anim8/renderer-sketch

Live playback loads the bundled font with a dynamic import. Use ESM code
splitting to keep the font in its own chunk; single-file bundles include the
font bytes up front. `pnpm bundle:check` measures the standard runtime's entry
and every static dependency against the 35 KiB gzip startup ceiling, and reports
lazy and total bytes separately.

Deterministic hand-drawn SVG renderer for Anim8 scenes.

This package is part of the [Anim8](https://github.com/nkcbuilds/anim8) monorepo. Anim8 is a deterministic, model-first 2D animation library for diagrams and technical explanations.

> Status: pre-1.0. Public APIs may still evolve while the scene format and package boundaries are hardened.

## Usage

```ts
import { renderSketchSceneAt } from "@anim8/renderer-sketch";

const svg = renderSketchSceneAt(scene, 1200);
```

What you get:

- Double-stroked, bowed lines whose wobble is seeded by `scene.seed` and the object id, so marks never "boil" between frames or renders.
- Rounded rectangles (25% of the short side, capped at 32px, or `style.radius`), overshooting ellipses, and fills that follow the rough outline.
- Drawn arrowheads on connectors. Centre-anchored connectors stop 6px short of the shapes they join.
- Labels wrapped to their shape and shrunk (down to 70%) to fit, using the font's real advance widths. No DOM is needed.

## Font

Text uses **Virgil** by Ellinor Rapp, bundled unmodified under the [SIL Open Font License 1.1](assets/Virgil-LICENSE.md) (Reserved Font Name "Virgil"). Virgil covers Latin, Greek and Cyrillic. Symbols it lacks, such as arrows (→), comparison operators (≤ ≥ ≠) and check marks, fall back per glyph to the next font in `SKETCH_FONT_FAMILY`.

| Option | Behaviour |
| --- | --- |
| `font: "embed"` (default) | Inlines the font (~75 KB) once per SVG, so the file renders identically in any viewer, export or image conversion. Omitted when no text uses the bundled font. |
| `font: "reference"` | Only names the font family. Load it once on the page with `sketchFontFaceCss()` to avoid repeating it for every frame. |

Set `style.fontFamily` on an object to use another font. Documents you render are not subject to the font license; redistributing the font file or this package is, so keep `assets/Virgil-LICENSE.md` alongside it. The font is shipped as-is and is not subset or renamed. To regenerate `src/font-data.ts`, run `python -I packages/renderer-sketch/scripts/embed-font.py` (requires `fonttools` and `brotli`).

## Other exports

- `measureSketchText(text, fontSize)`: deterministic width in the bundled font, used by `lintDesign` and layout code.
- `SKETCH_FONT_NAME`, `SKETCH_FONT_FAMILY`, `sketchFontFaceCss()`.

## Development

From the repository root:

```bash
pnpm --filter @anim8/renderer-sketch typecheck
pnpm --filter @anim8/renderer-sketch test
pnpm --filter @anim8/renderer-sketch build
```

See the root README and `docs/guides/visual-style.md` for authoring guidance.
