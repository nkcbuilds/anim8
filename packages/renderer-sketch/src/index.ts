import {
  anchorPoint,
  evaluate,
  worldMatrix,
  type ConnectorObject,
  type DrawableObject,
  type EvaluatedScene,
  type SceneDocument,
  type Style,
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

function formatNumber(value: number): string {
  if (!Number.isFinite(value)) {
    throw new RangeError("Sketch renderer received a non-finite numeric value.");
  }
  const rounded = Math.round(value * 1_000_000) / 1_000_000;
  return String(Object.is(rounded, -0) ? 0 : rounded);
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

  const draw = drawAttributes(drawProgress);
  return paths
    .map((path, index) =>
      `<path data-sketch-part="${escapeXml(part)}" data-sketch-pass="${index}" d="${escapeXml(sketchPathToSvg(path))}" fill="none" stroke="${color}" stroke-width="${width}" stroke-linecap="round" stroke-linejoin="round"${draw}/>`,
    )
    .join("");
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
): string {
  const color = escapeXml(style.color ?? DEFAULT_TEXT);
  const size = formatNumber(style.fontSize ?? DEFAULT_FONT_SIZE);
  const family = style.fontFamily ? ` font-family="${escapeXml(style.fontFamily)}"` : "";
  const exact = `<text data-sketch-part="${escapeXml(key)}-fill" x="${formatNumber(x)}" y="${formatNumber(y)}" dominant-baseline="middle" text-anchor="middle" fill="${color}" stroke="none" font-size="${size}"${family}>${escapeXml(text)}</text>`;

  const outlines = Array.from({ length: PASSES }, (_, pass) => {
    const dx = sketchJitter(seed, objectId, `${key}:text:pass:${pass}:x`, ROUGHNESS * 0.28);
    const dy = sketchJitter(seed, objectId, `${key}:text:pass:${pass}:y`, ROUGHNESS * 0.28);
    return `<text data-sketch-part="${escapeXml(key)}-stroke" data-sketch-pass="${pass}" x="${formatNumber(x + dx)}" y="${formatNumber(y + dy)}" dominant-baseline="middle" text-anchor="middle" fill="none" stroke="${color}" stroke-width="0.28" stroke-linecap="round" stroke-linejoin="round" font-size="${size}"${family}>${escapeXml(text)}</text>`;
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
    : `<rect data-sketch-part="fill" x="${formatNumber(x)}" y="${formatNumber(y)}" width="${formatNumber(object.width)}" height="${formatNumber(object.height)}" rx="${formatNumber(radius)}" fill="${escapeXml(fill)}" stroke="none"/>`;
  const outline = renderSketchPaths(
    sketchRectangle(x, y, object.width, object.height, sketchContext(seed, object.id), "outline"),
    object.style,
    "outline",
  );
  const label = object.text
    ? renderSketchText(object.text, object.style, seed, object.id, "label")
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
    : `<circle data-sketch-part="fill" cx="0" cy="0" r="${formatNumber(object.radius)}" fill="${escapeXml(fill)}" stroke="none"/>`;
  const outline = renderSketchPaths(
    sketchEllipse(0, 0, object.radius, object.radius, sketchContext(seed, object.id), "outline"),
    object.style,
    "outline",
  );
  const label = object.text
    ? renderSketchText(object.text, object.style, seed, object.id, "label")
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
    : `<ellipse data-sketch-part="fill" cx="0" cy="0" rx="${formatNumber(object.rx)}" ry="${formatNumber(object.ry)}" fill="${escapeXml(fill)}" stroke="none"/>`;
  const outline = renderSketchPaths(
    sketchEllipse(0, 0, object.rx, object.ry, sketchContext(seed, object.id), "outline"),
    object.style,
    "outline",
  );
  const label = object.text
    ? renderSketchText(object.text, object.style, seed, object.id, "label")
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
    : `<${tag} data-sketch-part="fill" points="${pointsAttribute(object.points)}" fill="${escapeXml(fill)}" stroke="none"/>`;
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
    : `<path data-sketch-part="fill" d="${escapeXml(object.d)}" fill="${escapeXml(fill)}" stroke="none"/>`;
  if (strokeColor(object.style) === "none" || strokeWidth(object.style) <= 0) return base;

  const color = escapeXml(strokeColor(object.style));
  const width = formatNumber(strokeWidth(object.style));
  const draw = drawAttributes(object.drawProgress);
  const outlines = Array.from({ length: PASSES }, (_, pass) => {
    const dx = sketchJitter(seed, object.id, `path:pass:${pass}:x`, ROUGHNESS * 0.35);
    const dy = sketchJitter(seed, object.id, `path:pass:${pass}:y`, ROUGHNESS * 0.35);
    return `<path data-sketch-part="path" data-sketch-pass="${pass}" d="${escapeXml(object.d)}" transform="translate(${formatNumber(dx)} ${formatNumber(dy)})" fill="none" stroke="${color}" stroke-width="${width}" stroke-linecap="round" stroke-linejoin="round"${draw}/>`;
  }).join("");

  return base + outlines;
}

function connectorBasePath(
  connector: ConnectorObject,
  objects: ReadonlyMap<string, DrawableObject>,
): { d: string; from: { x: number; y: number }; to: { x: number; y: number } } | null {
  const fromObject = objects.get(connector.from.objectId);
  const toObject = objects.get(connector.to.objectId);
  if (!fromObject || !toObject) return null;

  const from = anchorPoint(fromObject, connector.from.anchor, objects);
  const to = anchorPoint(toObject, connector.to.anchor, objects);

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
    return `<path data-sketch-part="connector-overdraw" data-sketch-pass="${pass}" d="M ${formatNumber(from.x)} ${formatNumber(from.y)} C ${formatNumber(cp1x)} ${formatNumber(cp1y)} ${formatNumber(cp2x)} ${formatNumber(cp2y)} ${formatNumber(to.x)} ${formatNumber(to.y)}" fill="none" stroke="${color}" stroke-width="${width}" stroke-linecap="round" stroke-linejoin="round"/>`;
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
  const exact = `<path data-sketch-part="connector-base" d="${base.d}" fill="none" stroke="${color}" stroke-width="${width}" stroke-linecap="round" stroke-linejoin="round" marker-end="url(#anim8-sketch-arrow)"/>`;

  let overdraw = "";
  if (strokeColor(connector.style) !== "none" && strokeWidth(connector.style) > 0) {
    if (connector.kind === "curve") {
      overdraw = renderCurveOverdraw(connector, base.from, base.to, seed);
    } else if (connector.kind === "orthogonal") {
      const midX = (base.from.x + base.to.x) / 2;
      overdraw = renderSketchPaths(
        sketchPolyline(
          [
            base.from,
            { x: midX, y: base.from.y },
            { x: midX, y: base.to.y },
            base.to,
          ],
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
      body = renderSketchText(object.text, object.style, seed, object.id, "text");
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
  const objects = new Map(frame.objects.map(object => [object.id, object] as const));
  const seed: SketchSeed = frame.scene.seed ?? 0;
  const ordered = frame.objects
    .map((object, index) => ({ object, index }))
    .sort((left, right) => left.object.z - right.object.z || left.index - right.index)
    .map(entry => entry.object);

  const body = ordered.map(object => renderObject(object, objects, seed)).join("");
  const background = frame.scene.background
    ? `<rect data-sketch-part="background" width="100%" height="100%" fill="${escapeXml(frame.scene.background)}"/>`
    : "";
  const world = `<g data-anim8-camera="world" transform="${cameraTransform(frame)}">${body}</g>`;

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${formatNumber(frame.scene.width)} ${formatNumber(frame.scene.height)}" role="img"><defs><marker id="anim8-sketch-arrow" markerWidth="10" markerHeight="10" refX="8" refY="3" orient="auto"><path d="M0 0 L0 6 L9 3 z" fill="context-stroke"/></marker></defs>${background}${world}</svg>`;
}

/** Evaluate a scene with @anim8/core and render the resulting frame as sketch SVG. */
export function renderSketchSceneAt(scene: SceneDocument, time: number): string {
  return renderSketchSvg(evaluate(scene, time));
}
