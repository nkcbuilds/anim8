/**
 * Lightweight entry for live playback: rendering, the incremental DOM mount and
 * font metrics, without the font file itself. The mount loads the font with a
 * dynamic import, which bundlers split into its own chunk.
 */
import type { EvaluatedScene } from "@anim8/core";
import { composeSketchSvg, renderSketchFrame } from "./render.js";

export {
  SKETCH_FONT_FAMILY,
  SKETCH_FONT_NAME,
  composeSketchSvg,
  measureSketchText,
  renderSketchFrame,
  type SketchFrameMarkup,
  type SketchObjectMarkup,
  type SketchRenderOptions,
} from "./render.js";
export { mountSketchSvg, type SketchMount, type SketchMountOptions } from "./mount.js";

/**
 * Sketch SVG that names the font family without embedding it. Matches what
 * `mountSketchSvg` adopts, so it suits SSR markup that a player hydrates.
 */
export function renderSketchMarkup(frame: EvaluatedScene): string {
  return composeSketchSvg(renderSketchFrame(frame));
}
