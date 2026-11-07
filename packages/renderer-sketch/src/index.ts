import { evaluate, type EvaluatedScene, type SceneDocument } from "@anim8/core";
import { sketchFontFaceCss } from "./font.js";
import { composeSketchSvg, renderSketchFrame, type SketchRenderOptions } from "./render.js";

export * from "./live.js";
export { sketchFontFaceCss };

/**
 * Render an already-evaluated frame to deterministic hand-drawn SVG.
 *
 * Sketch geometry for normal objects is generated in object-local coordinates,
 * then the core world transform is applied to the containing group. This keeps
 * a persistent object's rough marks stable while it moves. By default the
 * bundled font is embedded, so the file is self-contained.
 */
export function renderSketchSvg(frame: EvaluatedScene, options: SketchRenderOptions = {}): string {
  const parts = renderSketchFrame(frame);
  return composeSketchSvg(parts, (options.font ?? "embed") === "embed" ? sketchFontFaceCss() : undefined);
}

/** Evaluate a scene with @anim8/core and render the resulting frame as sketch SVG. */
export function renderSketchSceneAt(scene: SceneDocument, time: number, options: SketchRenderOptions = {}): string {
  return renderSketchSvg(evaluate(scene, time), options);
}
