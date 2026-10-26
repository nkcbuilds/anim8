import { attributesSvg, gradientSvg, gradients, outlineAttributes, paint, resourceId, textAttributes, textSvg } from "../../../internal/svg-style.js";
import {
  anchorPoint,
  evaluate,
  routeConnector,
  worldMatrix,
  type ConnectorObject,
  type DrawableObject,
  type EvaluatedScene,
  type SceneDocument,
  type Style,
  type TextRun,
  parseMorphPathData,
} from "@anim8/core";
import {
  sketchEllipse,
  sketchJitter,
  sketchLine,
  sketchPathToSvg,
  sketchPolyline,
  sketchRectangle,
  type SketchContext,
  type SketchPath,
  type SketchSeed,
} from "@anim8/sketch";

const DEFAULT_STROKE = "#1f2937";
const DEFAULT_TEXT = "#111827";
const DEFAULT_STROKE_WIDTH = 2;
const DEFAULT_FONT_SIZE = 16;
const ROUGHNESS = 1.1;
const BOWING = 0.9;
const PASSES = 2;

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
  return {
    seed,
    objectId,
    roughness: ROUGHNESS,
    bowing: BOWING,
    passes: PASSES,
  };
}

function strokeColor(style: Style): string {
  return style.stroke ?? DEFAULT_STROKE;
}

function strokeWidth(style: Style): number {
  return style.strokeWidth ?? DEFAULT_STROKE_WIDTH;
}

function worldTransform(object: DrawableObject, objects: ReadonlyMap<string, DrawableObject>): string {
  const matrix = worldMatrix(object, objects);
  return `matrix(${formatNumber(matrix.a)} ${formatNumber(matrix.b)} ${formatNumber(matrix.c)} ${formatNumber(matrix.d)} ${formatNumber(matrix.e)} ${formatNumber(matrix.f)})`;
}

function cameraTransform(frame: EvaluatedScene): string {
  const { x, y, zoom } = frame.camera;
  return `matrix(${formatNumber(zoom)} 0 0 ${formatNumber(zoom)} ${formatNumber(x)} ${formatNumber(y)})`;
}

function drawAttributes(drawProgress: number | undefined): string {
  if (drawProgress === undefined) return "";
  const progress = Math.max(0, Math.min(1, drawProgress));
  return ` pathLength="1" stroke-dasharray="1" stroke-dashoffset="${formatNumber(1 - progress)}"`;
}

function renderSketchPaths(
  paths: readonly SketchPath[],
  style: Style,
  part: string,
  drawProgress?: number,
): string {
  const color = escapeXml(strokeColor(style));
  const width = formatNumber(strokeWidth(style));
  if (strokeColor(style) === "none" || strokeWidth(style) <= 0) return "";

  return paths.map((path, index) => {
    const d = formatPathData(sketchPathToSvg(path));
    const reveal = sketchReveal(d, style, drawProgress);
    return reveal.definition + `<path data-sketch-part="${escapeXml(part)}" data-sketch-pass="${index}" d="${escapeXml(d)}" fill="none" stroke="${color}" stroke-width="${width}" ${attributesSvg(outlineAttributes({ ...style, strokeLinecap: style.strokeLinecap ?? "round", strokeLinejoin: style.strokeLinejoin ?? "round" }, drawProgress))}${reveal.attribute}/>`;
  }).join("");
}

function pointsAttribute(points: readonly { x: number; y: number }[]): string {
  return points.map(point => `${formatNumber(point.x)},${formatNumber(point.y)}`).join(" ");
}

function renderSketchText(
  text: string,
  style: Style,
  seed: SketchSeed,
  objectId: string,
  key: string,
  x = 0,
  y = 0,
  runs?: readonly TextRun[],
): string {
  const exact = `<text data-sketch-part="${escapeXml(key)}-fill" x="${formatNumber(x)}" y="${formatNumber(y)}" dominant-baseline="middle" ${attributesSvg(textAttributes(style))}>${textSvg(text, runs)}</text>`;
  if (runs) return exact;

  const outlines = Array.from({ length: PASSES }, (_, pass) => {
    const dx = sketchJitter(seed, objectId, `${key}:text:pass:${pass}:x`, ROUGHNESS * 0.28);
    const dy = sketchJitter(seed, objectId, `${key}:text:pass:${pass}:y`, ROUGHNESS * 0.28);
    return `<text data-sketch-part="${escapeXml(key)}-stroke" data-sketch-pass="${pass}" x="${formatNumber(x + dx)}" y="${formatNumber(y + dy)}" dominant-baseline="middle" ${attributesSvg({ ...textAttributes(style), fill: "none", stroke: style.color ?? DEFAULT_TEXT, "stroke-width": "0.28", "stroke-linecap": "round", "stroke-linejoin": "round" })}>${escapeXml(text)}</text>`;
  }).join("");

  return exact + outlines;
}

function renderRect(
  object: Extract<DrawableObject, { type: "rect" }>,
  seed: SketchSeed,
): string {
  const x = -object.width / 2;
  const y = -object.height / 2;
  const fill = object.style.fill ?? "none";
  const radius = object.style.radius ?? 10;
  const base = fill === "none"
    ? ""
    : `<rect data-sketch-part="fill" x="${formatNumber(x)}" y="${formatNumber(y)}" width="${formatNumber(object.width)}" height="${formatNumber(object.height)}" rx="${formatNumber(radius)}" fill="${escapeXml(fill)}" stroke="none" fill-opacity="${formatNumber(object.style.fillOpacity ?? 1)}"/>`;
  const outline = renderSketchPaths(
    sketchRectangle(x, y, object.width, object.height, sketchContext(seed, object.id), "outline"),
    object.style,
    "outline",
  );
  const label = object.text
    ? renderSketchText(object.text, object.style, seed, object.id, "label", 0, 0, object.textRuns)
    : "";
  return base + outline + label;
}

function renderCircle(
  object: Extract<DrawableObject, { type: "circle" }>,
  seed: SketchSeed,
): string {
  const fill = object.style.fill ?? "none";
  const base = fill === "none"
    ? ""
    : `<circle data-sketch-part="fill" cx="0" cy="0" r="${formatNumber(object.radius)}" fill="${escapeXml(fill)}" stroke="none" fill-opacity="${formatNumber(object.style.fillOpacity ?? 1)}"/>`;
  const outline = renderSketchPaths(
    sketchEllipse(0, 0, object.radius, object.radius, sketchContext(seed, object.id), "outline"),
    object.style,
    "outline",
  );
  const label = object.text
    ? renderSketchText(object.text, object.style, seed, object.id, "label", 0, 0, object.textRuns)
    : "";
  return base + outline + label;
}

function renderEllipse(
  object: Extract<DrawableObject, { type: "ellipse" }>,
  seed: SketchSeed,
): string {
  const fill = object.style.fill ?? "none";
  const base = fill === "none"
    ? ""
    : `<ellipse data-sketch-part="fill" cx="0" cy="0" rx="${formatNumber(object.rx)}" ry="${formatNumber(object.ry)}" fill="${escapeXml(fill)}" stroke="none" fill-opacity="${formatNumber(object.style.fillOpacity ?? 1)}"/>`;
  const outline = renderSketchPaths(
    sketchEllipse(0, 0, object.rx, object.ry, sketchContext(seed, object.id), "outline"),
    object.style,
    "outline",
  );
  const label = object.text
    ? renderSketchText(object.text, object.style, seed, object.id, "label", 0, 0, object.textRuns)
    : "";
  return base + outline + label;
}

function renderPointShape(
  object: Extract<DrawableObject, { type: "polygon" | "polyline" }>,
  seed: SketchSeed,
): string {
  const fill = object.style.fill ?? "none";
  const tag = object.type;
  const base = fill === "none"
    ? ""
    : `<${tag} data-sketch-part="fill" points="${pointsAttribute(object.points)}" fill="${escapeXml(fill)}" stroke="none" fill-opacity="${formatNumber(object.style.fillOpacity ?? 1)}"/>`;
  const outline = renderSketchPaths(
    sketchPolyline(
      object.points,
      sketchContext(seed, object.id),
      { closed: object.type === "polygon", key: "outline" },
    ),
    object.style,
    "outline",
    object.drawProgress,
  );
  return base + outline;
}

function renderLine(
  object: Extract<DrawableObject, { type: "line" }>,
  seed: SketchSeed,
): string {
  return renderSketchPaths(
    sketchLine(
      { x: 0, y: 0 },
      { x: object.x2, y: object.y2 },
      sketchContext(seed, object.id),
      "line",
    ),
    object.style,
    "line",
  );
}

function renderPath(
  object: Extract<DrawableObject, { type: "path" }>,
  seed: SketchSeed,
): string {
  const fill = object.style.fill ?? "none";
  const base = fill === "none"
    ? ""
    : `<path data-sketch-part="fill" d="${escapeXml(formatPathData(object.d))}" fill="${escapeXml(fill)}" stroke="none" fill-opacity="${formatNumber(object.style.fillOpacity ?? 1)}"/>`;
  if (strokeColor(object.style) === "none" || strokeWidth(object.style) <= 0) return base;

  const color = escapeXml(strokeColor(object.style));
  const width = formatNumber(strokeWidth(object.style));
  const reveal = sketchReveal(formatPathData(object.d), object.style, object.drawProgress);
  const outlines = Array.from({ length: PASSES }, (_, pass) => {
    const dx = sketchJitter(seed, object.id, `path:pass:${pass}:x`, ROUGHNESS * 0.35);
    const dy = sketchJitter(seed, object.id, `path:pass:${pass}:y`, ROUGHNESS * 0.35);
    return `<path data-sketch-part="path" data-sketch-pass="${pass}" d="${escapeXml(formatPathData(object.d))}" transform="translate(${formatNumber(dx)} ${formatNumber(dy)})" fill="none" stroke="${color}" stroke-width="${width}" ${attributesSvg(outlineAttributes({ ...object.style, strokeLinecap: object.style.strokeLinecap ?? "round", strokeLinejoin: object.style.strokeLinejoin ?? "round" }, object.drawProgress))}${reveal.attribute}/>`;
  }).join("");

  return base + reveal.definition + outlines;
}

function connectorBasePath(
  connector: ConnectorObject,
  objects: ReadonlyMap<string, DrawableObject>,
): { d: string; from: { x: number; y: number }; to: { x: number; y: number }; points?: { x: number; y: number }[] } | null {
  const fromObject = objects.get(connector.from.objectId);
  const toObject = objects.get(connector.to.objectId);
  if (!fromObject || !toObject) return null;

  const from = anchorPoint(fromObject, connector.from.anchor, objects);
  const to = anchorPoint(toObject, connector.to.anchor, objects);

  if (connector.kind === "routed") {
    const routed = routeConnector(connector, objects);
    if (routed.length < 2) return null;
    return {
      from,
      to,
      points: routed,
      d: routed.map((point, index) =>
        `${index === 0 ? "M" : "L"} ${formatNumber(point.x)} ${formatNumber(point.y)}`
      ).join(" "),
    };
  }

  if (connector.kind === "curve") {
    const midX = (from.x + to.x) / 2;
    return {
      from,
      to,
      d: `M ${formatNumber(from.x)} ${formatNumber(from.y)} C ${formatNumber(midX)} ${formatNumber(from.y)} ${formatNumber(midX)} ${formatNumber(to.y)} ${formatNumber(to.x)} ${formatNumber(to.y)}`,
    };
  }

  if (connector.kind === "orthogonal") {
    const midX = (from.x + to.x) / 2;
    return {
      from,
      to,
      points: [from, { x: midX, y: from.y }, { x: midX, y: to.y }, to],
      d: `M ${formatNumber(from.x)} ${formatNumber(from.y)} L ${formatNumber(midX)} ${formatNumber(from.y)} L ${formatNumber(midX)} ${formatNumber(to.y)} L ${formatNumber(to.x)} ${formatNumber(to.y)}`,
    };
  }

  return {
    from,
    to,
    d: `M ${formatNumber(from.x)} ${formatNumber(from.y)} L ${formatNumber(to.x)} ${formatNumber(to.y)}`,
  };
}

function renderCurveOverdraw(
  connector: ConnectorObject,
  from: { x: number; y: number },
  to: { x: number; y: number },
  seed: SketchSeed,
): string {
  const color = escapeXml(strokeColor(connector.style));
  const width = formatNumber(strokeWidth(connector.style));
  const midX = (from.x + to.x) / 2;
  return Array.from({ length: PASSES }, (_, pass) => {
    const cp1x = midX + sketchJitter(seed, connector.id, `curve:pass:${pass}:cp1:x`, ROUGHNESS);
    const cp1y = from.y + sketchJitter(seed, connector.id, `curve:pass:${pass}:cp1:y`, ROUGHNESS);
    const cp2x = midX + sketchJitter(seed, connector.id, `curve:pass:${pass}:cp2:x`, ROUGHNESS);
    const cp2y = to.y + sketchJitter(seed, connector.id, `curve:pass:${pass}:cp2:y`, ROUGHNESS);
    return `<path data-sketch-part="connector-overdraw" data-sketch-pass="${pass}" d="M ${formatNumber(from.x)} ${formatNumber(from.y)} C ${formatNumber(cp1x)} ${formatNumber(cp1y)} ${formatNumber(cp2x)} ${formatNumber(cp2y)} ${formatNumber(to.x)} ${formatNumber(to.y)}" fill="none" stroke="${color}" stroke-width="${width}" ${attributesSvg(outlineAttributes(connector.style))}/>`;
  }).join("");
}

function renderConnector(
  connector: ConnectorObject,
  objects: ReadonlyMap<string, DrawableObject>,
  seed: SketchSeed,
): string {
  if (!connector.visible) return "";
  const base = connectorBasePath(connector, objects);
  if (!base) return "";

  const color = escapeXml(strokeColor(connector.style));
  const width = formatNumber(strokeWidth(connector.style));
  const exact = `<path data-sketch-part="connector-base" d="${base.d}" fill="none" stroke="${color}" stroke-width="${width}" ${attributesSvg(outlineAttributes(connector.style))} marker-end="url(#anim8-sketch-arrow)"/>`;

  let overdraw = "";
  if (strokeColor(connector.style) !== "none" && strokeWidth(connector.style) > 0) {
    if (connector.kind === "curve") {
      overdraw = renderCurveOverdraw(connector, base.from, base.to, seed);
    } else if (connector.kind === "orthogonal" || connector.kind === "routed") {
      overdraw = renderSketchPaths(
        sketchPolyline(
          base.points ?? [base.from, base.to],
          sketchContext(seed, connector.id),
          { key: "connector" },
        ),
        connector.style,
        "connector-overdraw",
      );
    } else {
      overdraw = renderSketchPaths(
        sketchLine(base.from, base.to, sketchContext(seed, connector.id), "connector"),
        connector.style,
        "connector-overdraw",
      );
    }
  }

  const label = connector.label
    ? renderSketchText(
        connector.label,
        connector.style,
        seed,
        connector.id,
        "connector-label",
        (base.from.x + base.to.x) / 2,
        (base.from.y + base.to.y) / 2,
      )
    : "";

  return `<g data-anim8-id="${escapeXml(connector.id)}" opacity="${formatNumber(connector.transform.opacity)}">${exact}${overdraw}${label}</g>`;
}

function renderObject(
  object: DrawableObject,
  objects: ReadonlyMap<string, DrawableObject>,
  seed: SketchSeed,
): string {
  if (!object.visible) return "";
  if (object.type === "connector") return renderConnector(object, objects, seed);
  if (object.type === "group") return "";

  const transform = worldTransform(object, objects);
  let body = "";

  switch (object.type) {
    case "rect":
      body = renderRect(object, seed);
      break;
    case "circle":
      body = renderCircle(object, seed);
      break;
    case "ellipse":
      body = renderEllipse(object, seed);
      break;
    case "polygon":
    case "polyline":
      body = renderPointShape(object, seed);
      break;
    case "text":
      body = renderSketchText(object.text, object.style, seed, object.id, "text", 0, 0, object.textRuns);
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

  return `<g data-anim8-id="${escapeXml(object.id)}" transform="${transform}" opacity="${formatNumber(object.transform.opacity)}">${body}</g>`;
}

/**
 * Render an already-evaluated frame to deterministic sketch-styled SVG.
 *
 * Sketch geometry for normal objects is generated in object-local coordinates,
 * then the core world transform is applied to the containing group. This keeps
 * a persistent object's rough marks stable while it moves.
 */
export function renderSketchSvg(frame: EvaluatedScene): string {
  const originalObjects = new Map(frame.objects.map(o => [o.id, o]));
  const painted = frame.objects.map(object => ({ ...object, style: { ...object.style, fill: paint(object.style, "fill", "none", object, originalObjects), stroke: paint(object.style, "stroke", DEFAULT_STROKE, object, originalObjects), color: paint(object.style, "color", DEFAULT_TEXT) } }));
  const objects = new Map(painted.map(object => [object.id, object] as const));
  const seed: SketchSeed = frame.scene.seed ?? 0;
  const ordered = painted
    .map((object, index) => ({ object, index }))
    .sort((left, right) => left.object.z - right.object.z || left.index - right.index)
    .map(entry => entry.object);

  const body = ordered.map(object => renderObject(object, objects, seed)).join("");
  const background = frame.scene.background
    ? `<rect data-sketch-part="background" width="100%" height="100%" fill="${escapeXml(frame.scene.background)}"/>`
    : "";
  const world = `<g data-anim8-camera="world" transform="${cameraTransform(frame)}">${body}</g>`;

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${formatNumber(frame.scene.width)} ${formatNumber(frame.scene.height)}" role="img"><defs><marker id="anim8-sketch-arrow" markerWidth="10" markerHeight="10" refX="8" refY="3" orient="auto"><path d="M0 0 L0 6 L9 3 z" fill="context-stroke"/></marker>${gradients(frame.objects).map(gradientSvg).join("")}</defs>${background}${world}</svg>`;
}

/** Evaluate a scene with @anim8/core and render the resulting frame as sketch SVG. */
export function renderSketchSceneAt(scene: SceneDocument, time: number): string {
  return renderSketchSvg(evaluate(scene, time));
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
  const id = resourceId(["sketch-reveal", d, style.strokeWidth, progress]);
  return {
    attribute: ` mask="url(#${id})"`,
    definition: `<mask id="${id}" maskUnits="userSpaceOnUse" x="${formatNumber(minX)}" y="${formatNumber(minY)}" width="${formatNumber(Math.max(...xs) + pad - minX)}" height="${formatNumber(Math.max(...ys) + pad - minY)}"><path d="${escapeXml(d)}" fill="${style.fill === undefined || style.fill === "none" ? "none" : "white"}" stroke="white" stroke-width="${formatNumber((style.strokeWidth ?? 2) + 2)}" pathLength="1" stroke-dasharray="1" stroke-dashoffset="${formatNumber(1 - Math.max(0, progress))}"/></mask>`,
  };
}
