import { compileJson, type CompileResult } from "@anim8/compiler";
import { evaluate, type EvaluatedScene } from "@anim8/core";
import { renderSvg } from "@anim8/renderer-svg";
import { renderSketchSvg } from "@anim8/renderer-sketch";

export interface RenderResult extends CompileResult {
  svg?: string;
}

export function validateSource(source: string): CompileResult {
  return compileJson(source);
}

export function renderSource(source: string, timeMs = 0): RenderResult {
  const compiled = compileJson(source);
  if (!compiled.ok || !compiled.scene) return compiled;
  return {
    ...compiled,
    svg: renderFrameForTheme(evaluate(compiled.scene, timeMs)),
  };
}

/** Render a frame with the renderer its scene theme asks for ("sketch" or "clean"). */
export function renderFrameForTheme(frame: EvaluatedScene): string {
  return frame.scene.theme === "sketch" ? renderSketchSvg(frame) : renderSvg(frame);
}
