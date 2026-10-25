import { compileJson, type CompileResult } from "@anim8/compiler";
import { evaluate } from "@anim8/core";
import { renderSvg } from "@anim8/renderer-svg";

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
    svg: renderSvg(evaluate(compiled.scene, timeMs)),
  };
}
