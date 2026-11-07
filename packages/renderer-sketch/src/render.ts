import { attributesSvg, gradientSvg, gradients, paint, resourceId, textAttributes, textSvg } from "../../../internal/svg-style.js";
import {
  DIAGRAM_INK,
  parseMorphPathData,
  type TextRun,
  connectorEnd,
  connectorStart,
  connectorGeometry,
  connectorMidpoint,
  fitText,
  worldMatrix,
  worldOpacity,
  worldVisible,
  type ConnectorGeometry,
  type ConnectorObject,
  type DrawableObject,
  type EvaluatedScene,
  type Style,
  type TextMeasure,
} from "@anim8/core";
import {
  sketchArrowhead,
  sketchEllipse,
  sketchJitter,
  sketchLine,
  sketchPathToSvg,
  sketchPolyline,
  sketchRoundedRectangle,
  type SketchContext,
  type SketchPath,
  type SketchSeed,
} from "@anim8/sketch";
import { VIRGIL_ADVANCES, VIRGIL_FALLBACK_ADVANCE } from "./font-metrics.js";

const DEFAULT_STROKE = DIAGRAM_INK;
const DEFAULT_TEXT = DIAGRAM_INK;
const DEFAULT_STROKE_WIDTH = 2;
const DEFAULT_FONT_SIZE = 20;
const LABEL_PADDING = 12;
const ROUGHNESS = 1;
const BOWING = 1;
const PASSES = 2;

import { SKETCH_FONT_NAME } from "./font-name.js";
export { SKETCH_FONT_NAME };

/**
 * Default text font stack. Virgil covers Latin, Greek and Cyrillic; symbols it
 * lacks (arrows, comparison operators, check marks) fall back per glyph.
 */
export const SKETCH_FONT_FAMILY = `${SKETCH_FONT_NAME}, "Segoe UI", "Helvetica Neue", Arial, sans-serif`;

export interface SketchRenderOptions {
  /**
   * How the hand-drawn font reaches the output.
   * - `"embed"` (default): inline the bundled OFL Virgil font, so the SVG looks
   *   identical in any viewer, file export, or image conversion.
   * - `"reference"`: only name the font family. Use this when the page already
   *   loads the font (see `sketchFontFaceCss`) to avoid repeating ~75 KB per frame.
   */
  font?: "embed" | "reference";
}

/** Width of a string in the bundled font, in px. Deterministic; no DOM required. */
export const measureSketchText: TextMeasure = (text, fontSize) => {
  let units = 0;
  for (const char of text) {
    const code = char.codePointAt(0)!;
    units += code >= 32 && code <= 126 ? VIRGIL_ADVANCES[code - 32]! : VIRGIL_FALLBACK_ADVANCE;
  }
  return (units / 1000) * fontSize;
};

const escapeXml = (value: string): string =>
  value.replace(/[&<>"']/g, char => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  }[char]!));

const SERIALIZED_DECIMAL_PLACES = 6;
const SVG_PATH_NUMBER = /[-+]?(?:\d*\.\d+|\d+\.?)(?:[eE][-+]?\d+)?/g;

/**
 * Canonical renderer number format: finite values, rounded to at most six
 * decimal places, with trailing zeroes omitted and negative zero collapsed.
 */
function formatNumber(value: number): string {
  if (!Number.isFinite(value)) {
    throw new RangeError("Sketch renderer received a non-finite numeric value.");
  }
  const rounded = Number(value.toFixed(SERIALIZED_DECIMAL_PLACES));
  return rounded === 0 ? "0" : String(rounded);
}

function formatPathData(path: string): string {
  return path.replace(SVG_PATH_NUMBER, token => formatNumber(Number(token)));
}

function sketchContext(seed: SketchSeed, objectId: string): SketchContext {
  return { seed, objectId, roughness: ROUGHNESS, bowing: BOWING, passes: PASSES };
}

function strokeColor(style: Style): string {
  return style.stroke ?? DEFAULT_STROKE;
}

function strokeWidth(style: Style): number {
  return style.strokeWidth ?? DEFAULT_STROKE_WIDTH;
}

function hasStroke(style: Style): boolean {
  return strokeColor(style) !== "none" && strokeWidth(style) > 0;
}

function worldTransform(object: DrawableObject, objects: ReadonlyMap<string, DrawableObject>): string {
  const matrix = worldMatrix(object, objects);
  return `matrix(${formatNumber(matrix.a)} ${formatNumber(matrix.b)} ${formatNumber(matrix.c)} ${formatNumber(matrix.d)} ${formatNumber(matrix.e)} ${formatNumber(matrix.f)})`;
}

function cameraTransform(frame: EvaluatedScene): string {
  const { x, y, zoom } = frame.camera;
  return `matrix(${formatNumber(zoom)} 0 0 ${formatNumber(zoom)} ${formatNumber(x)} ${formatNumber(y)})`;
}

function clampUnit(value: number): number {
  return Math.max(0, Math.min(1, value));
}

/** Fill and label opacity while a shape draws on: they fade in over the second half. */
function revealOpacity(drawProgress: number | undefined): number {
  return drawProgress === undefined ? 1 : clampUnit((drawProgress - 0.5) * 2);
}

function pathData(path: SketchPath): string {
  return escapeXml(formatPathData(sketchPathToSvg(path)));
}

/** Polyline approximation length of a sketch path (cubics sampled). */
function sketchPathLength(path: SketchPath): number {
  let length = 0;
  let current = { x: 0, y: 0 };
  for (const command of path.commands) {
    if (command.type === "M") {
      current = command.to;
      continue;
    }
    if (command.type === "L") {
      length += Math.hypot(command.to.x - current.x, command.to.y - current.y);
      current = command.to;
      continue;
    }
    let previous = current;
    for (let step = 1; step <= 12; step += 1) {
      const t = step / 12;
      const u = 1 - t;
      const point = {
        x: u * u * u * current.x + 3 * u * u * t * command.cp1.x + 3 * u * t * t * command.cp2.x + t * t * t * command.to.x,
        y: u * u * u * current.y + 3 * u * u * t * command.cp1.y + 3 * u * t * t * command.cp2.y + t * t * t * command.to.y,
      };
      length += Math.hypot(point.x - previous.x, point.y - previous.y);
      previous = point;
    }
    current = command.to;
  }
  return length;
}

/** Dash pattern for a stroke style, scaled by stroke width (Excalidraw proportions). */
function dashPattern(style: Style): readonly [number, number] | null {
  const width = strokeWidth(style);
  if (style.strokeStyle === "dashed") return [8 + width, 8 + width * 1.5];
  if (style.strokeStyle === "dotted") return [0.01, 4 + width * 2];
  return null;
}

/**
 * Dash attributes for one stroke. Solid strokes reveal with a normalized
 * pathLength; patterned strokes being drawn get an explicit dash list up to
 * the revealed length, so the pattern stays visible while it draws on.
 */
function strokeDashAttributes(pattern: readonly [number, number] | null, length: number, progress: number | undefined): string {
  if (progress === undefined || (progress >= 1 && pattern)) {
    return pattern ? ` stroke-dasharray="${formatNumber(pattern[0])} ${formatNumber(pattern[1])}"` : "";
  }
  const reveal = clampUnit(progress);
  // A zero-length round-capped dash can still paint a dot before a reveal starts.
  const hiddenStroke = "";
  if (!pattern) return `${hiddenStroke} pathLength="1" stroke-dasharray="1" stroke-dashoffset="${formatNumber(1 - reveal)}"`;
  const target = reveal * length;
  const hidden = formatNumber(length + pattern[0] + pattern[1]);
  if (target <= 0) return `${hiddenStroke} stroke-dasharray="0 ${hidden}"`;
  const list: string[] = [];
  for (let position = 0; position < target; position += pattern[0] + pattern[1]) {
    const dash = Math.min(pattern[0], target - position);
    const last = position + pattern[0] + pattern[1] >= target;
    list.push(formatNumber(dash), last ? hidden : formatNumber(pattern[1]));
  }
  return ` stroke-dasharray="${list.join(" ")}"`;
}

function penAttributes(style: Style, progress?: number): string {
  return attributesSvg({ "stroke-linecap": style.strokeLinecap ?? "round", "stroke-linejoin": style.strokeLinejoin ?? "round", "stroke-opacity": formatNumber(progress === 0 ? 0 : style.strokeOpacity ?? 1) });
}
function customDashAttributes(style: Style): string {
  return ` stroke-dasharray="${style.strokeDasharray!.map(formatNumber).join(" ")}" stroke-dashoffset="${formatNumber(style.strokeDashoffset ?? 0)}"`;
}

/**
 * Render ordered stroke groups (one group per drawn segment, holding that
 * segment's rough passes). Draw progress advances through the groups in
 * order by length, so outlines trace like a pen rather than all at once.
 */
function renderStrokeGroups(
  groups: readonly (readonly SketchPath[])[],
  style: Style,
  part: string,
  drawProgress?: number,
): string {
  if (!hasStroke(style) || groups.length === 0) return "";
  const color = escapeXml(strokeColor(style));
  const width = formatNumber(strokeWidth(style));
  const pattern = dashPattern(style);
  const lengths = groups.map(group => (group[0] ? sketchPathLength(group[0]) : 0));
  const total = lengths.reduce((sum, value) => sum + value, 0);
  const revealed = drawProgress === undefined ? undefined : clampUnit(drawProgress) * total;

  let offset = 0;
  let index = 0;
  let out = "";
  groups.forEach((group, groupIndex) => {
    const length = lengths[groupIndex]!;
    const local = revealed === undefined
      ? undefined
      : length > 0 ? clampUnit((revealed - offset) / length) : revealed >= offset ? 1 : 0;
    offset += length;
    // Patterned strokes read best as a single pen line.
    const passes = pattern ? group.slice(0, 1) : group;
    for (const path of passes) {
      const custom = Boolean(style.strokeDasharray?.length);
      const reveal = custom ? sketchReveal(formatPathData(sketchPathToSvg(path)), style, local) : { definition: "", attribute: "" };
      out += reveal.definition + `<path data-sketch-part="${escapeXml(part)}" data-sketch-pass="${index}" d="${pathData(path)}" fill="none" stroke="${color}" stroke-width="${width}" ${penAttributes(style, local)}${custom ? customDashAttributes(style) : strokeDashAttributes(pattern, length, local)}${reveal.attribute}/>`;
      index += 1;
    }
  });
  return out;
}

/** Group a pass-interleaved path list (segment-major) into per-segment groups. */
function segmentGroups(paths: readonly SketchPath[], passes = PASSES): SketchPath[][] {
  const groups: SketchPath[][] = [];
  for (let index = 0; index < paths.length; index += passes) groups.push(paths.slice(index, index + passes));
  return groups;
}

function renderSketchPaths(paths: readonly SketchPath[], style: Style, part: string, drawProgress?: number): string {
  return renderStrokeGroups([paths], style, part, drawProgress);
}

/** Solid fill that follows the first rough outline pass, like a marker fill. */
function renderOutlineFill(outline: readonly SketchPath[], fill: string, opacity = 1): string {
  if (fill === "none" || outline.length === 0 || opacity <= 0) return "";
  const fade = opacity < 1 ? ` fill-opacity="${formatNumber(opacity)}"` : "";
  return `<path data-sketch-part="fill" d="${pathData(outline[0]!)} Z" fill="${escapeXml(fill)}" stroke="none"${fade}/>`;
}

/** Wrap a label so it fades in with draw-on progress. */
function fadeLabel(markup: string, opacity: number): string {
  if (!markup || opacity >= 1) return markup;
  if (opacity <= 0) return "";
  return `<g data-sketch-part="label-fade" opacity="${formatNumber(opacity)}">${markup}</g>`;
}

function pointsAttribute(points: readonly { x: number; y: number }[]): string {
  return points.map(point => `${formatNumber(point.x)},${formatNumber(point.y)}`).join(" ");
}

interface TextBox {
  width: number;
  height: number;
}

interface TextUsage {
  /** Set when any rendered text relies on the bundled font. */
  bundledFont: boolean;
}

/**
 * Crisp text in the hand-drawn font. Inside a shape the label is wrapped to
 * the shape and shrunk (down to 70%) until it fits.
 */
function renderSketchText(
  text: string,
  style: Style,
  key: string,
  usage: TextUsage,
  box?: TextBox,
  x = 0,
  y = 0,
  runs?: readonly TextRun[],
): string {
  const color = escapeXml(style.color ?? DEFAULT_TEXT);
  const custom = style.fontFamily !== undefined;
  if (!custom || style.fontFamily!.split(",").some(family => /^(?:Virgil|"Virgil"|'Virgil')$/i.test(family.trim()))) usage.bundledFont = true;
  const family = escapeXml(custom ? style.fontFamily! : SKETCH_FONT_FAMILY);
  const requested = style.fontSize ?? DEFAULT_FONT_SIZE;

  const fit = box
    ? fitText(text, {
        maxWidth: Math.max(1, box.width - LABEL_PADDING * 2),
        maxHeight: Math.max(1, box.height - LABEL_PADDING),
        fontSize: requested,
        ...(custom ? {} : { measure: measureSketchText }),
      })
    : { lines: text.split(/\r?\n/), fontSize: requested, lineHeight: requested * 1.25 };

  const top = y - ((fit.lines.length - 1) * fit.lineHeight) / 2;
  const attributes = `data-sketch-part="${escapeXml(key)}" x="${formatNumber(x)}" y="${formatNumber(top)}" dominant-baseline="central" ${attributesSvg(textAttributes({ ...style, fontFamily: custom ? style.fontFamily! : SKETCH_FONT_FAMILY, fontSize: fit.fontSize, color: style.color ?? DEFAULT_TEXT }))}`;
  if (runs) return `<text ${attributes}>${textSvg(text, runs)}</text>`;
  if (fit.lines.length === 1) return `<text ${attributes}>${escapeXml(fit.lines[0]!)}</text>`;
  const spans = fit.lines
    .map((line, index) =>
      `<tspan x="${formatNumber(x)}" dy="${index === 0 ? "0" : formatNumber(fit.lineHeight)}">${escapeXml(line)}</tspan>`,
    )
    .join("");
  return `<text ${attributes}>${spans}</text>`;
}

/** Excalidraw-style adaptive corner radius: 25% of the short side, capped at 32. */
function adaptiveRadius(width: number, height: number): number {
  return Math.min(32, Math.min(width, height) * 0.25);
}

function renderRect(object: Extract<DrawableObject, { type: "rect" }>, seed: SketchSeed, usage: TextUsage): string {
  const x = -object.width / 2;
  const y = -object.height / 2;
  const radius = object.style.radius ?? adaptiveRadius(object.width, object.height);
  const outline = sketchRoundedRectangle(x, y, object.width, object.height, radius, sketchContext(seed, object.id), "outline");
  const reveal = revealOpacity(object.drawProgress);
  const label = object.text && reveal > 0
    ? renderSketchText(object.text, object.style, "label", usage, { width: object.width, height: object.height }, 0, 0, object.textRuns)
    : "";
  return renderOutlineFill(outline, object.style.fill ?? "none", reveal * (object.style.fillOpacity ?? 1)) +
    renderSketchPaths(outline, object.style, "outline", object.drawProgress) +
    fadeLabel(label, reveal);
}

function renderEllipseLike(
  object: Extract<DrawableObject, { type: "circle" | "ellipse" }>,
  rx: number,
  ry: number,
  seed: SketchSeed,
  usage: TextUsage,
): string {
  const outline = sketchEllipse(0, 0, rx, ry, sketchContext(seed, object.id), "outline");
  // The largest axis-aligned box inside an ellipse is sqrt(2)/2 of each axis.
  const reveal = revealOpacity(object.drawProgress);
  const label = object.text && reveal > 0
    ? renderSketchText(object.text, object.style, "label", usage, { width: rx * Math.SQRT2 + LABEL_PADDING * 2, height: ry * Math.SQRT2 + LABEL_PADDING }, 0, 0, object.textRuns)
    : "";
  return renderOutlineFill(outline, object.style.fill ?? "none", reveal * (object.style.fillOpacity ?? 1)) +
    renderSketchPaths(outline, object.style, "outline", object.drawProgress) +
    fadeLabel(label, reveal);
}

function renderPointShape(object: Extract<DrawableObject, { type: "polygon" | "polyline" }>, seed: SketchSeed): string {
  const fill = object.style.fill ?? "none";
  const tag = object.type;
  const base = fill === "none"
    ? ""
    : `<${tag} data-sketch-part="fill" points="${pointsAttribute(object.points)}" fill="${escapeXml(fill)}" stroke="none" fill-opacity="${formatNumber(object.style.fillOpacity ?? 1)}"/>`;
  const outline = renderStrokeGroups(
    segmentGroups(sketchPolyline(object.points, sketchContext(seed, object.id), { closed: object.type === "polygon", key: "outline" })),
    object.style,
    "outline",
    object.drawProgress,
  );
  return base + outline;
}

function renderLine(object: Extract<DrawableObject, { type: "line" }>, seed: SketchSeed): string {
  return renderSketchPaths(
    sketchLine({ x: 0, y: 0 }, { x: object.x2, y: object.y2 }, sketchContext(seed, object.id), "line"),
    object.style,
    "line",
    object.drawProgress,
  );
}

function renderPath(object: Extract<DrawableObject, { type: "path" }>, seed: SketchSeed): string {
  const fill = object.style.fill ?? "none";
  const base = fill === "none"
    ? ""
    : `<path data-sketch-part="fill" d="${escapeXml(formatPathData(object.d))}" fill="${escapeXml(fill)}" stroke="none" fill-opacity="${formatNumber(object.style.fillOpacity ?? 1)}"/>`;
  if (!hasStroke(object.style)) return base;

  const color = escapeXml(strokeColor(object.style));
  const width = formatNumber(strokeWidth(object.style));
  const pattern = dashPattern(object.style);
  const draw = object.drawProgress !== undefined && object.drawProgress < 1
    ? strokeDashAttributes(null, 0, object.drawProgress)
    : strokeDashAttributes(pattern, 0, undefined);
  const custom = Boolean(object.style.strokeDasharray?.length);
  const reveal = custom ? sketchReveal(formatPathData(object.d), object.style, object.drawProgress) : { definition: "", attribute: "" };
  const outlines = Array.from({ length: pattern ? 1 : PASSES }, (_, pass) => {
    const amount = ROUGHNESS * (pass === 0 ? 0.8 : 0.4);
    const dx = sketchJitter(seed, object.id, `path:pass:${pass}:x`, amount);
    const dy = sketchJitter(seed, object.id, `path:pass:${pass}:y`, amount);
    return `<path data-sketch-part="path" data-sketch-pass="${pass}" d="${escapeXml(formatPathData(object.d))}" transform="translate(${formatNumber(dx)} ${formatNumber(dy)})" fill="none" stroke="${color}" stroke-width="${width}" ${penAttributes(object.style, object.drawProgress)}${custom ? customDashAttributes(object.style) : draw}/>`;
  }).join("");

  return base + reveal.definition + `<g${reveal.attribute}>${outlines}</g>`;
}

function geometryPathData(geometry: ConnectorGeometry): string {
  if (geometry.kind === "cubic") {
    const { from, cp1, cp2, to } = geometry;
    return `M ${formatNumber(from.x)} ${formatNumber(from.y)} C ${formatNumber(cp1.x)} ${formatNumber(cp1.y)} ${formatNumber(cp2.x)} ${formatNumber(cp2.y)} ${formatNumber(to.x)} ${formatNumber(to.y)}`;
  }
  return geometry.points
    .map((point, index) => `${index === 0 ? "M" : "L"} ${formatNumber(point.x)} ${formatNumber(point.y)}`)
    .join(" ");
}

/** Rough passes for a curved connector, as sketch paths. */
function cubicOverdraw(connector: ConnectorObject, geometry: Extract<ConnectorGeometry, { kind: "cubic" }>, seed: SketchSeed): SketchPath[] {
  const { from, cp1, cp2, to } = geometry;
  return Array.from({ length: PASSES }, (_, pass) => {
    const amount = ROUGHNESS * (pass === 0 ? 2 : 1);
    const j = (name: string) => sketchJitter(seed, connector.id, `curve:pass:${pass}:${name}`, amount);
    return {
      commands: [
        { type: "M" as const, to: { x: from.x + j("sx"), y: from.y + j("sy") } },
        {
          type: "C" as const,
          cp1: { x: cp1.x + j("c1x"), y: cp1.y + j("c1y") },
          cp2: { x: cp2.x + j("c2x"), y: cp2.y + j("c2y") },
          to: { x: to.x + j("ex") * 0.25, y: to.y + j("ey") * 0.25 },
        },
      ],
    };
  });
}

/** Share of a connector's draw-on time spent on the line before its heads appear. */
const SHAFT_SHARE = 0.8;

function renderConnector(
  connector: ConnectorObject,
  objects: ReadonlyMap<string, DrawableObject>,
  seed: SketchSeed,
  background: string,
  usage: TextUsage,
): SketchObjectMarkup | null {
  const geometry = connectorGeometry(connector, objects);
  if (!geometry) return null;

  // Canonical, unstyled geometry: useful for hit-testing and tooling.
  const base = `<path data-sketch-part="connector-base" d="${geometryPathData(geometry)}" fill="none" stroke="none"/>`;

  const progress = connector.drawProgress;
  const shaftProgress = progress === undefined ? undefined : clampUnit(progress / SHAFT_SHARE);
  const headProgress = progress === undefined ? undefined : clampUnit((progress - SHAFT_SHARE) / (1 - SHAFT_SHARE));

  let strokes = "";
  if (hasStroke(connector.style)) {
    const context = sketchContext(seed, connector.id);
    const shaft: SketchPath[][] = geometry.kind === "cubic"
      ? [cubicOverdraw(connector, geometry, seed)]
      : geometry.points.length === 2
        ? [[...sketchLine(geometry.points[0]!, geometry.points[1]!, context, "connector")]]
        : segmentGroups(sketchPolyline(geometry.points, context, { key: "connector" }));
    strokes = renderStrokeGroups(shaft, connector.style, "connector-overdraw", shaftProgress);

    const heads = connector.arrowheads ?? "end";
    const size = Math.min(16, Math.max(8, 5 + strokeWidth(connector.style) * 4.5));
    // Arrowheads are always solid, even on dashed or dotted connectors.
    const headStyle: Style = { ...connector.style, strokeStyle: "solid" };
    if (headProgress === undefined || headProgress > 0) {
      if (heads === "end" || heads === "both") {
        const { tip, tail } = connectorEnd(geometry);
        strokes += renderSketchPaths(sketchArrowhead(tail, tip, context, { size, key: "head" }), headStyle, "arrowhead", headProgress);
      }
      if (heads === "start" || heads === "both") {
        const { tip, tail } = connectorStart(geometry);
        strokes += renderSketchPaths(sketchArrowhead(tail, tip, context, { size, key: "tail-head" }), headStyle, "arrowhead", headProgress);
      }
    }
  }

  let label = "";
  if (connector.label) {
    const middle = connectorMidpoint(geometry);
    const size = connector.style.fontSize ?? 16;
    const width = (connector.style.fontFamily ? size * 0.55 * connector.label.length : measureSketchText(connector.label, size)) + 10;
    const height = size * 1.4;
    label = `<rect data-sketch-part="connector-label-bg" x="${formatNumber(middle.x - width / 2)}" y="${formatNumber(middle.y - height / 2)}" width="${formatNumber(width)}" height="${formatNumber(height)}" rx="4" fill="${escapeXml(background)}" stroke="none"/>` +
      renderSketchText(connector.label, { ...connector.style, fontSize: size }, "connector-label", usage, undefined, middle.x, middle.y);
    label = fadeLabel(label, revealOpacity(progress));
  }

  return {
    id: connector.id,
    attributes: { opacity: formatNumber(worldOpacity(connector, objects)) },
    body: `${base}${strokes}${label}`,
  };
}

function renderObject(
  object: DrawableObject,
  objects: ReadonlyMap<string, DrawableObject>,
  seed: SketchSeed,
  background: string,
  usage: TextUsage,
): SketchObjectMarkup | null {
  if (!worldVisible(object, objects) || object.type === "group") return null;
  if (object.type === "connector") return renderConnector(object, objects, seed, background, usage);

  let body = "";
  switch (object.type) {
    case "rect":
      body = renderRect(object, seed, usage);
      break;
    case "circle":
      body = renderEllipseLike(object, object.radius, object.radius, seed, usage);
      break;
    case "ellipse":
      body = renderEllipseLike(object, object.rx, object.ry, seed, usage);
      break;
    case "polygon":
    case "polyline":
      body = renderPointShape(object, seed);
      break;
    case "text":
      body = renderSketchText(object.text, object.style, "text", usage, undefined, 0, 0, object.textRuns);
      break;
    case "line":
      body = renderLine(object, seed);
      break;
    case "path":
      body = renderPath(object, seed);
      break;
    case "image":
      body = `<image data-sketch-part="image" x="${formatNumber(-object.width / 2)}" y="${formatNumber(-object.height / 2)}" width="${formatNumber(object.width)}" height="${formatNumber(object.height)}" href="${escapeXml(object.href)}"/>`;
      break;
  }

  return {
    id: object.id,
    attributes: {
      transform: worldTransform(object, objects),
      opacity: formatNumber(worldOpacity(object, objects)),
    },
    body,
  };
}

/** One object's rendered group: stable id, group attributes, and inner marks. */
export interface SketchObjectMarkup {
  id: string;
  attributes: Readonly<Record<string, string>>;
  body: string;
}

/** A frame split into the parts both the string renderer and the DOM mount use. */
export interface SketchFrameMarkup {
  width: number;
  height: number;
  background?: string;
  camera: string;
  /** In paint order (z, then document order). */
  objects: SketchObjectMarkup[];
  /** True when some text uses the bundled font. */
  usesBundledFont: boolean;
  definitions: string;
}

/** Render an evaluated frame into structured sketch markup (no DOM required). */
export function renderSketchFrame(frame: EvaluatedScene): SketchFrameMarkup {
  return renderFrame(frame);
}

interface CachedBody { key: string; body: string; bundledFont: boolean }

/** Per-mount cache: one current body per object, with no frame history retained. */
export function createSketchFrameRenderer(): { render(frame: EvaluatedScene): SketchFrameMarkup; clear(): void } {
  const bodies = new Map<string, CachedBody>();
  return { render: frame => renderFrame(frame, bodies), clear: () => bodies.clear() };
}

function renderFrame(frame: EvaluatedScene, bodies?: Map<string, CachedBody>): SketchFrameMarkup {
  const originalObjects = new Map(frame.objects.map(object => [object.id, object] as const));
  const painted = frame.objects.map(object => ({ ...object, style: { ...object.style, fill: paint(object.style, "fill", "none", object, originalObjects), stroke: paint(object.style, "stroke", DEFAULT_STROKE, object, originalObjects), color: paint(object.style, "color", DEFAULT_TEXT) } }));
  const objects = new Map(painted.map(object => [object.id, object] as const));
  const seed: SketchSeed = frame.scene.seed ?? 0;
  const labelBackground = frame.scene.background ?? "#ffffff";
  const usage: TextUsage = { bundledFont: false };
  const ordered = painted
    .map((object, index) => ({ object, index }))
    .sort((left, right) => left.object.z - right.object.z || left.index - right.index)
    .map(entry => entry.object);

  const rendered: SketchObjectMarkup[] = [];
  if (bodies) {
    const live = new Set(painted.map(object => object.id));
    for (const id of bodies.keys()) if (!live.has(id)) bodies.delete(id);
  }
  for (const object of ordered) {
    // Connector bodies depend on the entire graph and label background. Other
    // bodies use local geometry/style; world transforms live on their outer group.
    const cacheable = bodies && object.type !== "connector" && object.type !== "group" && worldVisible(object, objects);
    const key = cacheable ? JSON.stringify([seed, { ...object, transform: undefined, parentId: undefined, z: undefined, visible: undefined }], (_key, value: unknown) =>
      typeof value === "number" && !Number.isFinite(value) ? { nonFiniteNumber: String(value) } : value) : undefined;
    const cached = key === undefined ? undefined : bodies?.get(object.id);
    let markup: SketchObjectMarkup | null;
    if (cached && cached.key === key) {
      usage.bundledFont ||= cached.bundledFont;
      markup = { id: object.id, attributes: { transform: worldTransform(object, objects), opacity: formatNumber(worldOpacity(object, objects)) }, body: cached.body };
    } else {
      const objectUsage: TextUsage = { bundledFont: false };
      markup = renderObject(object, objects, seed, labelBackground, objectUsage);
      usage.bundledFont ||= objectUsage.bundledFont;
      if (key !== undefined && markup) bodies!.set(object.id, { key, body: markup.body, bundledFont: objectUsage.bundledFont });
    }
    if (markup) rendered.push(markup);
  }
  return {
    width: frame.scene.width,
    height: frame.scene.height,
    ...(frame.scene.background ? { background: frame.scene.background } : {}),
    camera: cameraTransform(frame),
    objects: rendered,
    usesBundledFont: usage.bundledFont,
    definitions: gradients(frame.objects).map(gradientSvg).join(""),
  };
}

function groupMarkup(object: SketchObjectMarkup): string {
  const attributes = Object.entries(object.attributes)
    .map(([name, value]) => ` ${name}="${escapeXml(value)}"`)
    .join("");
  return `<g data-anim8-id="${escapeXml(object.id)}"${attributes}>${object.body}</g>`;
}

/** Assemble frame markup into an SVG document, optionally embedding a font face. */
export function composeSketchSvg(parts: SketchFrameMarkup, fontFaceCss?: string): string {
  const background = parts.background
    ? `<rect data-sketch-part="background" width="100%" height="100%" fill="${escapeXml(parts.background)}"/>`
    : "";
  const world = `<g data-anim8-camera="world" transform="${parts.camera}">${parts.objects.map(groupMarkup).join("")}</g>`;
  const fontFace = parts.usesBundledFont && fontFaceCss ? `<defs><style>${fontFaceCss}</style></defs>` : "";
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${formatNumber(parts.width)} ${formatNumber(parts.height)}" role="img">${fontFace}<defs data-anim8-sketch-resources="">${parts.definitions}</defs>${background}${world}</svg>`;
}

// Sketch paths use the bounded canonical cubic subset, so control points bound the mask.
function sketchReveal(d: string, style: Style, progress?: number): { definition: string; attribute: string } {
  if (!style.strokeDasharray?.length || progress === undefined || progress >= 1) return { definition: "", attribute: "" };
  const path = parseMorphPathData(d);
  if (!path.ok) throw new Error("Dashed sketch reveal requires an M/L/H/V/C/Q/Z path: " + path.message);
  const points = path.path.subpaths.flatMap(p => [p.start, ...p.segments.flatMap(s => [{ x: s.x, y: s.y }, { x: s.c1x, y: s.c1y }, { x: s.c2x, y: s.c2y }])]);
  const pad = (style.strokeWidth ?? 2) * 2 + 4;
  const xs = points.map(p => p.x), ys = points.map(p => p.y);
  const minX = Math.min(...xs) - pad, minY = Math.min(...ys) - pad;
  // The fill is already painted separately; a reveal mask covers only strokes.
  const maskFill = "none";
  const id = resourceId(["sketch-reveal", d, style.strokeWidth, progress, style.fill ?? "none"]);
  return {
    attribute: ` mask="url(#${id})"`,
    definition: `<mask id="${id}" maskUnits="userSpaceOnUse" x="${formatNumber(minX)}" y="${formatNumber(minY)}" width="${formatNumber(Math.max(...xs) + pad - minX)}" height="${formatNumber(Math.max(...ys) + pad - minY)}"><path d="${escapeXml(d)}" fill="${maskFill}" stroke="${progress > 0 ? "white" : "none"}" stroke-width="${formatNumber((style.strokeWidth ?? 2) + 2)}" pathLength="1" stroke-dasharray="1" stroke-dashoffset="${formatNumber(1 - Math.max(0, progress))}"/></mask>`,
  };
}
