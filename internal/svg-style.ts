import { anchorPoint, parseMorphPathData, type DrawableObject, type LinearGradient, type Style, type TextRun } from "@anim8/core";
interface PaintGradient extends LinearGradient { svgUnits?: "userSpaceOnUse" }

export const xml = (s: string): string => s.replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
export function number(value: number): string {
  if (!Number.isFinite(value)) throw new RangeError("Non-finite SVG style value");
  return String(Number(value.toFixed(6)) || 0);
}
export function resourceId(value: unknown): string {
  const source = JSON.stringify(value);
  let a = 2166136261, b = 5381;
  for (let i = 0; i < source.length; i++) { a = Math.imul(a ^ source.charCodeAt(i), 16777619); b = Math.imul(b, 33) ^ source.charCodeAt(i); }
  return "anim8-paint-" + (a >>> 0).toString(16) + "-" + (b >>> 0).toString(16);
}
export function paint(style: Style, key: "fill" | "stroke" | "color", fallback: string, object?: DrawableObject, objects?: ReadonlyMap<string, DrawableObject>): string {
  const source = style[`${key}Gradient`];
  const gradient = source && key !== "color" ? resolvedGradient(source, object, objects) : source;
  return gradient ? `url(#${resourceId(gradient)})` : style[key] ?? fallback;
}
export function gradientSvg(gradient: PaintGradient): string {
  const stops = gradient.stops.map(s => `<stop offset="${number(s.offset)}" stop-color="${xml(s.color)}" stop-opacity="${number(s.opacity ?? 1)}"/>`).join("");
  return `<linearGradient id="${resourceId(gradient)}"${gradient.svgUnits ? ` gradientUnits="${gradient.svgUnits}"` : ""} x1="${number(gradient.from?.x ?? 0)}" y1="${number(gradient.from?.y ?? 0)}" x2="${number(gradient.to?.x ?? 1)}" y2="${number(gradient.to?.y ?? 0)}">${stops}</linearGradient>`;
}
export function gradients(objects: readonly DrawableObject[]): PaintGradient[] {
  const result = new Map<string, PaintGradient>(), index = new Map(objects.map(o => [o.id, o]));
  for (const object of objects) for (const key of ["fill", "stroke", "color"] as const) {
    const source = object.style[`${key}Gradient`];
    if (source) { const g = key === "color" ? source : resolvedGradient(source, object, index); result.set(resourceId(g), g); }
  }
  return [...result.values()];
}
function resolvedGradient(g: LinearGradient, object?: DrawableObject, objects?: ReadonlyMap<string, DrawableObject>): PaintGradient {
  let points: { x: number; y: number }[] = [];
  if (object?.type === "line") points = [{ x: 0, y: 0 }, { x: object.x2, y: object.y2 }];
  else if (object?.type === "connector" && objects) {
    const a = objects.get(object.from.objectId), b = objects.get(object.to.objectId);
    if (a && b) points = [anchorPoint(a, object.from.anchor, objects), anchorPoint(b, object.to.anchor, objects)];
  } else if (object?.type === "path") {
    const parsed = parseMorphPathData(object.d);
    if (parsed.ok) points = parsed.path.subpaths.flatMap(p => [p.start, ...p.segments.flatMap(s => [{ x: s.x, y: s.y }, { x: s.c1x, y: s.c1y }, { x: s.c2x, y: s.c2y }])]);
  } else if (object?.type === "polyline" || object?.type === "polygon") points = object.points;
  if (!points.length) return g;
  let x = Infinity, y = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of points) { x = Math.min(x, p.x); y = Math.min(y, p.y); maxX = Math.max(maxX, p.x); maxY = Math.max(maxY, p.y); }
  if (maxX > x && maxY > y) return g;
  // SVG objectBoundingBox gradients disappear on horizontal/vertical geometry.
  // Give degenerate axes a stroke-sized user-space extent instead.
  const padding = Math.max(1, object?.style.strokeWidth ?? 2);
  if (maxX === x) { x -= padding / 2; maxX += padding / 2; }
  if (maxY === y) { y -= padding / 2; maxY += padding / 2; }
  return { ...g, svgUnits: "userSpaceOnUse", from: { x: x + (g.from?.x ?? 0) * (maxX - x), y: y + (g.from?.y ?? 0) * (maxY - y) }, to: { x: x + (g.to?.x ?? 1) * (maxX - x), y: y + (g.to?.y ?? 0) * (maxY - y) } };
}

export function outlineAttributes(s: Style, drawProgress?: number): Record<string, string> {
  return {
    "stroke-dasharray": s.strokeDasharray?.length ? s.strokeDasharray.map(number).join(" ") : drawProgress !== undefined ? "1" : "none",
    "stroke-dashoffset": number(!s.strokeDasharray?.length && drawProgress !== undefined ? 1 - Math.max(0, Math.min(1, drawProgress)) : s.strokeDashoffset ?? 0),
    ...(!s.strokeDasharray?.length && drawProgress !== undefined ? { pathLength: "1" } : {}),
    "stroke-linecap": s.strokeLinecap ?? "butt", "stroke-linejoin": s.strokeLinejoin ?? "miter",
    "fill-opacity": number(s.fillOpacity ?? 1), "stroke-opacity": number(s.strokeOpacity ?? 1),
  };
}
export function textAttributes(s: Style): Record<string, string> {
  return {
    fill: paint(s, "color", "#111827"), stroke: s.textStroke ?? "none", "stroke-width": number(s.textStrokeWidth ?? 0),
    "font-size": number(s.fontSize ?? 16), "font-family": s.fontFamily ?? "sans-serif",
    "font-weight": number(s.fontWeight ?? 400), "font-style": s.fontStyle ?? "normal", "text-anchor": s.textAnchor ?? "middle",
    "stroke-dasharray": "none", "stroke-dashoffset": "0", "fill-opacity": "1", "stroke-opacity": "1", "paint-order": "stroke fill",
  };
}
export const attributesSvg = (attributes: Record<string, string>): string => Object.entries(attributes).map(([k, v]) => `${k}="${xml(v)}"`).join(" ");
export function textSvg(text: string, runs?: readonly TextRun[]): string {
  if (!runs) return xml(text);
  return runs.map(run => `<tspan${run.color !== undefined ? ` fill="${xml(run.color)}"` : ""}${run.fontWeight !== undefined ? ` font-weight="${number(run.fontWeight)}"` : ""}${run.fontStyle !== undefined ? ` font-style="${xml(run.fontStyle)}"` : ""}>${xml(run.text)}</tspan>`).join("");
}
