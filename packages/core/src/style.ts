import { clamp01, lerp, lerpColor } from "./easing.js";
import type { LinearGradient, Style, TextRun } from "./types.js";

export const STYLE_LIMITS = { dashEntries: 64, gradientStops: 16, textRuns: 128 } as const;
export const STYLE_KEYS = [
  "fill", "stroke", "color", "fontFamily", "strokeWidth", "fontSize", "radius",
  "fillGradient", "strokeGradient", "colorGradient", "strokeDasharray", "strokeDashoffset",
  "strokeLinecap", "strokeLinejoin", "fillOpacity", "strokeOpacity", "fontWeight", "fontStyle",
  "textAnchor", "textStroke", "textStrokeWidth",
] as const;

const record = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const bounded = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v) && Math.abs(v) <= 1_000_000;
const unit = (v: unknown): v is number => bounded(v) && v >= 0 && v <= 1;
/** No URLs, CSS variables or executable/remote paint references. */
export const isSolidColor = (v: unknown): v is string => typeof v === "string" && v.length <= 512 &&
  /^(?:#[\da-f]{3,4}|#[\da-f]{6}|#[\da-f]{8}|[a-z]+|(?:rgba?|hsla?)\([\d\s.,%+\-/]+\))$/i.test(v);

export function styleIssues(style: Style): { property: string; message: string }[] {
  const issues: { property: string; message: string }[] = [];
  const add = (property: string, message: string) => issues.push({ property, message });
  for (const key of ["strokeDashoffset", "fillOpacity", "strokeOpacity", "fontWeight", "textStrokeWidth"] as const) {
    const v = style[key];
    if (v === undefined) continue;
    if (!bounded(v) || ((key === "fillOpacity" || key === "strokeOpacity") && !unit(v)) ||
      (key === "fontWeight" && (v < 1 || v > 1000)) || (key === "textStrokeWidth" && v < 0)) {
      add(key, key + " is outside its finite numeric range.");
    }
  }
  for (const [key, choices] of [
    ["strokeLinecap", ["butt", "round", "square"]], ["strokeLinejoin", ["miter", "round", "bevel"]],
    ["fontStyle", ["normal", "italic"]], ["textAnchor", ["start", "middle", "end"]],
  ] as const) {
    if (style[key] !== undefined && !(choices as readonly unknown[]).includes(style[key])) add(key, "Unsupported " + key + ".");
  }
  if (style.textStroke !== undefined && !isSolidColor(style.textStroke)) add("textStroke", "textStroke must be a solid color.");
  const dash = style.strokeDasharray;
  if (dash !== undefined && (!Array.isArray(dash) || dash.length > STYLE_LIMITS.dashEntries ||
    dash.some(n => !bounded(n) || n < 0) || (dash.length > 0 && !dash.some(n => n > 0)))) {
    add("strokeDasharray", "Use [] for solid or up to 64 finite nonnegative dash/gap lengths, with at least one positive length.");
  }
  for (const key of ["fillGradient", "strokeGradient", "colorGradient"] as const) {
    const g: unknown = style[key];
    if (g === undefined || g === null) continue;
    if (!record(g) || g.type !== "linear" || !Array.isArray(g.stops) || g.stops.length < 2 || g.stops.length > STYLE_LIMITS.gradientStops) {
      add(key, "A linear gradient requires 2–16 color stops."); continue;
    }
    for (const point of ["from", "to"] as const) {
      const p = g[point];
      if (p !== undefined && (!record(p) || !unit(p.x) || !unit(p.y))) add(key + "." + point, "Gradient coordinates must be fractions in [0,1].");
    }
    let previous = -1;
    g.stops.forEach((s: unknown, i: number) => {
      if (!record(s) || !unit(s.offset) || s.offset < previous || !isSolidColor(s.color) || (s.opacity !== undefined && !unit(s.opacity))) {
        add(key + ".stops[" + i + "]", "Stops require sorted offsets in [0,1], solid colors and opacity in [0,1].");
      }
      if (record(s) && unit(s.offset)) previous = s.offset;
    });
  }
  return issues;
}

export function textRunIssues(runs: TextRun[], text: string): string[] {
  if (!Array.isArray(runs) || runs.length === 0 || runs.length > STYLE_LIMITS.textRuns) return ["textRuns requires 1–128 spans."];
  const issues: string[] = [];
  if (runs.some(r => !record(r) || typeof r.text !== "string" || r.text.length > 32768 ||
    (r.color !== undefined && !isSolidColor(r.color)) ||
    (r.fontWeight !== undefined && (!bounded(r.fontWeight) || r.fontWeight < 1 || r.fontWeight > 1000)) ||
    (r.fontStyle !== undefined && r.fontStyle !== "normal" && r.fontStyle !== "italic"))) issues.push("Invalid text span: use text, solid color, weight 1–1000 and normal/italic style.");
  if (!issues.length && (runs.map(r => r.text).join("") !== text || text.length > 32768)) issues.push("textRuns must concatenate exactly to text (at most 32768 characters).");
  return issues;
}

/** Gradient and solid colors write the same visual property for conflict checks. */
export function styleProperties(style: Style): string[] {
  return Object.keys(style).map(key => key.endsWith("Gradient") ? key.slice(0, -8) : key);
}

function interpolateGradient(a: LinearGradient, b: LinearGradient, t: number): LinearGradient {
  if (a.stops.length !== b.stops.length) return t < 1 ? a : b;
  return {
    type: "linear",
    from: { x: lerp(a.from?.x ?? 0, b.from?.x ?? 0, t), y: lerp(a.from?.y ?? 0, b.from?.y ?? 0, t) },
    to: { x: lerp(a.to?.x ?? 1, b.to?.x ?? 1, t), y: lerp(a.to?.y ?? 0, b.to?.y ?? 0, t) },
    stops: a.stops.map((s, i) => ({ offset: lerp(s.offset, b.stops[i]!.offset, t), color: lerpColor(s.color, b.stops[i]!.color, t), opacity: lerp(s.opacity ?? 1, b.stops[i]!.opacity ?? 1, t) })),
  };
}

export function interpolateStyle(from: Style, to: Style, progress: number): Style {
  const result = { ...from }, t = clamp01(progress);
  const defaults: Style = { strokeDashoffset: 0, fillOpacity: 1, strokeOpacity: 1, fontWeight: 400, textStrokeWidth: 0, radius: 10, strokeWidth: 2, fontSize: 16, fill: "#ffffff", stroke: "#1f2937", color: "#111827", textStroke: "none" };
  for (const key of Object.keys(to) as (keyof Style)[]) {
    const a = from[key] ?? defaults[key], b = to[key];
    let value: unknown = t < 1 ? a : b;
    if (typeof a === "number" && typeof b === "number") value = lerp(a, b, t);
    else if (["fill", "stroke", "color", "textStroke"].includes(key) && typeof a === "string" && typeof b === "string") value = lerpColor(a, b, t);
    else if (key === "strokeDasharray" && Array.isArray(a) && Array.isArray(b) && a.length === b.length) value = a.map((n, i) => lerp(n, b[i]!, t));
    else if (key.endsWith("Gradient") && record(a) && record(b)) value = interpolateGradient(a as unknown as LinearGradient, b as unknown as LinearGradient, t);
    if (value === undefined) delete result[key];
    else (result as Record<string, unknown>)[key] = structuredClone(value);
  }
  if (t === 1) for (const key of ["fill", "stroke", "color"] as const) {
    if (to[key] !== undefined && to[`${key}Gradient`] === undefined) delete result[`${key}Gradient`];
  }
  return result;
}
