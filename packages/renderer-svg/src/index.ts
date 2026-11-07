import { attributesSvg, gradientSvg, gradients, outlineAttributes, paint, resourceId, textAttributes, textSvg } from "../../../internal/svg-style.js";
import { anchorPoint, routeConnector, connectorGeometry, fitText, worldMatrix, worldOpacity, worldVisible, applyMatrix, evaluate, invertMatrix, multiply, type ConnectorObject, type DrawableObject, type EvaluatedScene, type SceneDocument, type TextRun, type Style } from "@anim8/core";

const esc = (value: string): string => value.replace(/[&<>"']/g, char => ({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;" }[char]!));

const SERIALIZED_DECIMAL_PLACES = 6;
const SVG_PATH_NUMBER = /[-+]?(?:\d*\.\d+|\d+\.?)(?:[eE][-+]?\d+)?/g;

/**
 * Canonical renderer number format: finite values, rounded to at most six
 * decimal places, with trailing zeroes omitted and negative zero collapsed.
 */
function formatNumber(value: number): string {
  if (!Number.isFinite(value)) {
    throw new RangeError("SVG renderer received a non-finite numeric value.");
  }
  const rounded = Number(value.toFixed(SERIALIZED_DECIMAL_PLACES));
  return rounded === 0 ? "0" : String(rounded);
}

function formatPathData(path: string): string {
  return path.replace(SVG_PATH_NUMBER, token => formatNumber(Number(token)));
}

function cameraTransform(frame: EvaluatedScene): string {
  const { x, y, zoom } = frame.camera;
  return `matrix(${formatNumber(zoom)} 0 0 ${formatNumber(zoom)} ${formatNumber(x)} ${formatNumber(y)})`;
}

function transform(object: DrawableObject, objects: ReadonlyMap<string, DrawableObject>): string {
  const m = worldMatrix(object, objects);
  return `matrix(${formatNumber(m.a)} ${formatNumber(m.b)} ${formatNumber(m.c)} ${formatNumber(m.d)} ${formatNumber(m.e)} ${formatNumber(m.f)})`;
}

function style(object: DrawableObject, objects: ReadonlyMap<string, DrawableObject>, fillOverride?: string, opacityOverride?: number): string {
  const s = object.style;
  return [
    `fill="${esc(fillOverride ?? paint(s, "fill", "none", object, objects))}"`,
    `stroke="${esc(paint(s, "stroke", "none", object, objects))}"`,
    `stroke-width="${formatNumber(s.strokeWidth ?? 0)}"`,
    `opacity="${formatNumber(opacityOverride ?? worldOpacity(object, objects))}"`,
    attributesSvg({ ...outlineAttributes(s), ...Object.fromEntries(Object.entries(strokeEffects(object, objects)).filter(([, value]) => value !== null)) } as Record<string, string>),
  ].join(" ");
}

const clampUnit = (value: number): number => Math.max(0, Math.min(1, value));

/** Share of a connector's draw-on time spent on the line before its arrowheads appear. */
const SHAFT_SHARE = 0.8;

/** Attributes managed by stroke effects; null means "remove". */
type StrokeEffects = Record<"pathLength" | "stroke-dasharray" | "stroke-dashoffset" | "stroke-opacity" | "fill-opacity" | "marker-end" | "marker-start", string | null>;

const NO_EFFECTS: StrokeEffects = {
  pathLength: null, "stroke-dasharray": null, "stroke-dashoffset": null, "stroke-opacity": null, "fill-opacity": null, "marker-end": null, "marker-start": null,
};

function dashPattern(style: Style): readonly [number, number] | null {
  const width = style.strokeWidth ?? 2;
  if (style.strokeStyle === "dashed") return [8 + width, 8 + width * 1.5];
  if (style.strokeStyle === "dotted") return [0.01, 4 + width * 2];
  return null;
}

function patternList(pattern: readonly [number, number], length: number, progress: number): string {
  const target = clampUnit(progress) * length;
  const hidden = formatNumber(length + pattern[0] + pattern[1]);
  if (target <= 0) return `0 ${hidden}`;
  const list: string[] = [];
  for (let position = 0; position < target; position += pattern[0] + pattern[1]) {
    const dash = Math.min(pattern[0], target - position);
    list.push(formatNumber(dash), position + pattern[0] + pattern[1] >= target ? hidden : formatNumber(pattern[1]));
  }
  return list.join(" ");
}

/** Analytic stroke length of an object, when it is cheap and exact enough to compute. */
function strokeLength(object: DrawableObject, objects: ReadonlyMap<string, DrawableObject>): number | undefined {
  switch (object.type) {
    case "rect": {
      const r = Math.max(0, Math.min(object.style.radius ?? 10, object.width / 2, object.height / 2));
      return 2 * (object.width + object.height) - 8 * r + 2 * Math.PI * r;
    }
    case "circle":
      return 2 * Math.PI * object.radius;
    case "ellipse": {
      const a = object.rx, b = object.ry;
      return Math.PI * (3 * (a + b) - Math.sqrt((3 * a + b) * (a + 3 * b)));
    }
    case "line":
      return Math.hypot(object.x2, object.y2);
    case "polygon":
    case "polyline": {
      const pts = object.points;
      let total = 0;
      for (let index = 1; index < pts.length; index += 1) total += Math.hypot(pts[index]!.x - pts[index - 1]!.x, pts[index]!.y - pts[index - 1]!.y);
      if (object.type === "polygon" && pts.length > 2) total += Math.hypot(pts[0]!.x - pts.at(-1)!.x, pts[0]!.y - pts.at(-1)!.y);
      return total;
    }
    case "connector": {
      const geometry = connectorGeometry(object, objects);
      if (!geometry) return undefined;
      if (geometry.kind === "polyline") {
        return geometry.points.slice(1).reduce((sum, point, index) => sum + Math.hypot(point.x - geometry.points[index]!.x, point.y - geometry.points[index]!.y), 0);
      }
      let total = 0;
      let previous = geometry.from;
      for (let step = 1; step <= 24; step += 1) {
        const t = step / 24, u = 1 - t;
        const point = {
          x: u * u * u * geometry.from.x + 3 * u * u * t * geometry.cp1.x + 3 * u * t * t * geometry.cp2.x + t * t * t * geometry.to.x,
          y: u * u * u * geometry.from.y + 3 * u * u * t * geometry.cp1.y + 3 * u * t * t * geometry.cp2.y + t * t * t * geometry.to.y,
        };
        total += Math.hypot(point.x - previous.x, point.y - previous.y);
        previous = point;
      }
      return total;
    }
    default:
      return undefined;
  }
}

/**
 * Dash, draw-on, fill-fade and arrow-marker attributes for an object. Shapes
 * trace their outline, then fill and label fade in over the second half;
 * connectors trace their line, then show their arrowheads.
 */
function strokeEffects(object: DrawableObject, objects: ReadonlyMap<string, DrawableObject>): StrokeEffects {
  const effects: StrokeEffects = { ...NO_EFFECTS, "stroke-dasharray": object.style.strokeDasharray?.length ? object.style.strokeDasharray.map(formatNumber).join(" ") : "none", "stroke-dashoffset": formatNumber(object.style.strokeDashoffset ?? 0), "stroke-opacity": formatNumber(object.style.strokeOpacity ?? 1), "fill-opacity": formatNumber(object.style.fillOpacity ?? 1) };
  if (object.type === "text" || object.type === "image" || object.type === "group") return effects;
  const pattern = dashPattern(object.style);
  const raw = "drawProgress" in object ? object.drawProgress : undefined;
  const isConnector = object.type === "connector";
  const progress = raw === undefined ? undefined : isConnector ? clampUnit(raw / SHAFT_SHARE) : clampUnit(raw);
  const drawing = progress !== undefined && progress < 1;
  if (progress === 0) effects["stroke-opacity"] = "0";

  if (object.style.strokeDasharray?.length) {
    // Explicit patterns use a separate reveal mask on paths and point shapes.
  } else if (!drawing) {
    if (pattern) effects["stroke-dasharray"] = `${formatNumber(pattern[0])} ${formatNumber(pattern[1])}`;
  } else {
    const length = strokeLength(object, objects);
    const usesPathLength = object.type === "path" || object.type === "polygon" || object.type === "polyline" || object.type === "connector";
    if (pattern && length !== undefined) {
      effects["stroke-dasharray"] = patternList(pattern, length, progress);
    } else if (usesPathLength || length === undefined) {
      effects.pathLength = "1";
      effects["stroke-dasharray"] = "1";
      effects["stroke-dashoffset"] = formatNumber(1 - progress);
    } else {
      // Basic shapes: absolute lengths, since pathLength support varies on them.
      effects["stroke-dasharray"] = `${formatNumber(progress * length)} ${formatNumber(length + 1)}`;
    }
  }

  if ((object.type === "rect" || object.type === "circle" || object.type === "ellipse") && raw !== undefined && raw < 1) {
    effects["fill-opacity"] = formatNumber((object.style.fillOpacity ?? 1) * clampUnit((raw - 0.5) * 2));
  }

  if (isConnector) {
    const heads = object.arrowheads ?? "end";
    const showHeads = raw === undefined || raw >= SHAFT_SHARE;
    if (showHeads && (heads === "end" || heads === "both")) effects["marker-end"] = "url(#anim8-arrow)";
    if (showHeads && (heads === "start" || heads === "both")) effects["marker-start"] = "url(#anim8-arrow-start)";
  }
  return effects;
}

function effectAttributes(effects: StrokeEffects): string {
  return Object.entries(effects)
    .filter((entry): entry is [string, string] => entry[1] !== null)
    .map(([name, value]) => ` ${name}="${esc(value)}"`)
    .join("");
}

function points(points: readonly { x: number; y: number }[]): string {
  return points.map(point => `${formatNumber(point.x)},${formatNumber(point.y)}`).join(" ");
}

function connectorPath(connector: ConnectorObject, objects: ReadonlyMap<string, DrawableObject>): string {
  const geometry = connectorGeometry(connector, objects);
  if (!geometry) return "";
  if (geometry.kind === "cubic") {
    const { from, cp1, cp2, to } = geometry;
    return `M ${formatNumber(from.x)} ${formatNumber(from.y)} C ${formatNumber(cp1.x)} ${formatNumber(cp1.y)}, ${formatNumber(cp2.x)} ${formatNumber(cp2.y)}, ${formatNumber(to.x)} ${formatNumber(to.y)}`;
  }
  return geometry.points.map((point, index) =>
    `${index === 0 ? "M" : "L"} ${formatNumber(point.x)} ${formatNumber(point.y)}`
  ).join(" ");
}

/** Default UI font stack; scenes can override per object with style.fontFamily. */
export const SVG_FONT_FAMILY = "Inter, ui-sans-serif, system-ui, -apple-system, \"Segoe UI\", Roboto, Helvetica, Arial, sans-serif";
const LABEL_PADDING = 12;

interface LabelLayout { lines: string[]; fontSize: number; lineHeight: number }

/** Wrap and fit a shape's label; standalone text keeps its explicit line breaks. */
function labelLayout(object: DrawableObject, text: string): LabelLayout {
  const fontSize = object.style.fontSize ?? 16;
  const box = object.type === "rect"
    ? { width: object.width, height: object.height }
    : object.type === "circle"
      ? { width: object.radius * Math.SQRT2 + LABEL_PADDING * 2, height: object.radius * Math.SQRT2 + LABEL_PADDING }
      : object.type === "ellipse"
        ? { width: object.rx * Math.SQRT2 + LABEL_PADDING * 2, height: object.ry * Math.SQRT2 + LABEL_PADDING }
        : undefined;
  if (!box) return { lines: text.split(/\r?\n/), fontSize, lineHeight: fontSize * 1.25 };
  return fitText(text, {
    maxWidth: Math.max(1, box.width - LABEL_PADDING * 2),
    maxHeight: Math.max(1, box.height - LABEL_PADDING),
    fontSize,
  });
}

function fontFamily(style: Style): string {
  return style.fontFamily ?? SVG_FONT_FAMILY;
}

function textMarkup(layout: LabelLayout): { y: number; content: string } {
  const y = -((layout.lines.length - 1) * layout.lineHeight) / 2;
  if (layout.lines.length === 1) return { y, content: esc(layout.lines[0]!) };
  return {
    y,
    content: layout.lines.map((line, index) =>
      `<tspan x="0" dy="${index === 0 ? "0" : formatNumber(layout.lineHeight)}">${esc(line)}</tspan>`
    ).join(""),
  };
}

function labelSvg(object: DrawableObject, text: string): string {
  const layout = labelLayout(object, text);
  const runs = "textRuns" in object ? object.textRuns : undefined;
  const { y, content } = textMarkup(layout);
  return `<text x="0" y="${formatNumber(y)}" dominant-baseline="middle" ${attributesSvg(textAttributes({ ...object.style, fontFamily: fontFamily(object.style), fontSize: layout.fontSize }))}>${runs ? textSvg(text, runs) : content}</text>`;
}
function drawAttributes(object: DrawableObject, frame: EvaluatedScene): string {
  return needsRevealMask(object) ? ` mask="url(#${revealId(object, frame)})"` : "";
}

function objectSvg(object: DrawableObject, objects: ReadonlyMap<string, DrawableObject>, frame: EvaluatedScene): string {
  if (!worldVisible(object, objects)) return "";
  if (object.type === "connector") {
    const d = connectorPath(object, objects);
    const p = connectorLabelPosition(object, objects);
    const label = object.label ? `<text data-anim8-connector-label="${esc(object.id)}" x="${formatNumber(p.x)}" y="${formatNumber(p.y - 12)}" dominant-baseline="middle" ${attributesSvg(textAttributes({ ...object.style, fontFamily: fontFamily(object.style) }))} opacity="${formatNumber(worldOpacity(object, objects))}">${textSvg(object.label)}</text>` : "";
    return `<path data-anim8-id="${esc(object.id)}" d="${d}" fill="none" stroke="${esc(paint(object.style, "stroke", "#1f2937", object, objects))}" stroke-width="${formatNumber(object.style.strokeWidth ?? 2)}" opacity="${formatNumber(worldOpacity(object, objects))}" ${attributesSvg({ ...outlineAttributes(object.style), ...Object.fromEntries(Object.entries(strokeEffects(object, objects)).filter(([, value]) => value !== null)) } as Record<string, string>)}/>${label}`;
  }
  if (object.type === "group") return "";
  const t = transform(object, objects);
  const common = `data-anim8-id="${esc(object.id)}" transform="${t}" ${style(object, objects)}`;
  switch (object.type) {
    case "rect": {
      const x = -object.width / 2, y = -object.height / 2;
      const r = object.style.radius ?? 10;
      const text = object.text ? labelSvg(object, object.text) : "";
      return `<g ${common}><rect x="${formatNumber(x)}" y="${formatNumber(y)}" width="${formatNumber(object.width)}" height="${formatNumber(object.height)}" rx="${formatNumber(r)}"/>${text}</g>`;
    }
    case "circle": {
      const text = object.text ? labelSvg(object, object.text) : "";
      return `<g ${common}><circle cx="0" cy="0" r="${formatNumber(object.radius)}"/>${text}</g>`;
    }
    case "ellipse": {
      const text = object.text ? labelSvg(object, object.text) : "";
      return `<g ${common}><ellipse cx="0" cy="0" rx="${formatNumber(object.rx)}" ry="${formatNumber(object.ry)}"/>${text}</g>`;
    }
    case "polygon":
      return revealObjectSvg(object, objects, frame);
    case "polyline":
      return revealObjectSvg(object, objects, frame);
    case "text":
      return labelSvg(object, object.text).replace("<text ", `<text data-anim8-id="${esc(object.id)}" transform="${t}" opacity="${formatNumber(worldOpacity(object, objects))}" `);
    case "line":
      return `<line ${common} x1="0" y1="0" x2="${formatNumber(object.x2)}" y2="${formatNumber(object.y2)}"/>`;
    case "path":
      return revealObjectSvg(object, objects, frame);
    case "image":
      return `<image ${common} x="${formatNumber(-object.width/2)}" y="${formatNumber(-object.height/2)}" width="${formatNumber(object.width)}" height="${formatNumber(object.height)}" href="${esc(object.href)}"/>`;
  }
}

export function renderSvg(frame: EvaluatedScene): string {
  const objects = new Map(frame.objects.map(object => [object.id, object]));
  const ordered = [...frame.objects].sort((a,b) => a.z - b.z);
  const body = ordered.map(object => objectSvg(object, objects, frame)).join("");
  const masks = frame.objects.filter(needsRevealMask).map(object => {
    const { region, tag, shape } = revealMask(object, frame, objects);
    return `<mask ${attributesSvg(region)}><${tag} ${attributesSvg(shape)}/></mask>`;
  }).join("");
  const bg = frame.scene.background ? `<rect width="100%" height="100%" fill="${esc(frame.scene.background)}"/>` : "";
  const world = `<g data-anim8-camera="world" transform="${cameraTransform(frame)}">${body}</g>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${formatNumber(frame.scene.width)} ${formatNumber(frame.scene.height)}" role="img"><defs><marker id="anim8-arrow" markerWidth="10" markerHeight="10" refX="8" refY="3" orient="auto"><path d="M0,0 L0,6 L9,3 z" fill="context-stroke"/></marker><marker id="anim8-arrow-start" markerWidth="10" markerHeight="10" refX="1" refY="3" orient="auto"><path d="M9,0 L9,6 L0,3 z" fill="context-stroke"/></marker>${gradients(frame.objects).map(gradientSvg).join("")}${masks}</defs>${bg}${world}</svg>`;
}

export function renderSceneAt(scene: SceneDocument, time: number): string {
  return renderSvg(evaluate(scene, time));
}

export interface SvgMount { update(frame: EvaluatedScene): void; destroy(): void; }

const SVG_NS = "http://www.w3.org/2000/svg";

type MountedObject = Exclude<DrawableObject, { type: "group" }>;

interface ObjectDomRecord {
  type: MountedObject["type"];
  element: SVGElement;
  shape?: SVGElement;
  label?: SVGTextElement;
  revealGroup?: SVGGElement;
  revealFill?: SVGElement;
}

function createSvgElement<K extends keyof SVGElementTagNameMap>(
  document: Document,
  tag: K,
): SVGElementTagNameMap[K] {
  return document.createElementNS(SVG_NS, tag);
}

function setAttribute(element: Element, name: string, value: string | number): void {
  element.setAttribute(name, typeof value === "number" ? formatNumber(value) : value);
}

function syncCommonAttributes(
  element: SVGElement,
  object: MountedObject,
  objects: ReadonlyMap<string, DrawableObject>,
): void {
  const s = object.style;
  setAttribute(element, "data-anim8-id", object.id);
  setAttribute(element, "transform", transform(object, objects));
  setAttribute(element, "fill", paint(s, "fill", "none", object, objects));
  setAttribute(element, "stroke", paint(s, "stroke", "none", object, objects));
  setAttribute(element, "stroke-width", s.strokeWidth ?? 0);
  setAttribute(element, "opacity", worldOpacity(object, objects));
  syncAttributes(element, outlineAttributes(s));
}

function syncStrokeEffects(element: SVGElement, object: MountedObject, objects: ReadonlyMap<string, DrawableObject>): void {
  for (const [name, value] of Object.entries(strokeEffects(object, objects))) {
    if (value === null) element.removeAttribute(name);
    else setAttribute(element, name, value);
  }
}

function syncEmbeddedLabel(
  document: Document,
  record: ObjectDomRecord,
  text: string | undefined,
  object: MountedObject,
): void {
  if (!text) {
    record.label?.remove();
    delete record.label;
    return;
  }

  let label = record.label;
  if (!label) {
    label = createSvgElement(document, "text");
    setAttribute(label, "x", 0);
    setAttribute(label, "y", 0);
    setAttribute(label, "dominant-baseline", "middle");
    setAttribute(label, "text-anchor", "middle");
    setAttribute(label, "stroke", "none");
    record.element.appendChild(label);
    record.label = label;
  }

  setAttribute(label, "fill", object.style.color ?? "#111827");
  syncTextContent(document, label, object, text);
}

/** Mirror the static renderer's wrapped label markup on a live text element. */
function syncTextContent(document: Document, element: SVGElement, object: MountedObject, text: string): void {
  const layout = labelLayout(object, text);
  syncAttributes(element, textAttributes({ ...object.style, fontFamily: fontFamily(object.style), fontSize: layout.fontSize }));
  const y = -((layout.lines.length - 1) * layout.lineHeight) / 2;
  setAttribute(element, "y", y);
  setAttribute(element, "font-family", fontFamily(object.style));
  setAttribute(element, "font-size", layout.fontSize);
  const runs = "textRuns" in object ? object.textRuns : undefined;
  if (runs) { syncText(document, element, text, runs); return; }
  const signature = JSON.stringify(["wrapped", layout.lines, layout.lineHeight]);
  if (textCache.get(element) === signature) return;
  textCache.set(element, signature);
  if (layout.lines.length === 1) {
    element.replaceChildren();
    element.textContent = layout.lines[0]!;
    return;
  }
  const spans = layout.lines.map((line, index) => {
    const span = createSvgElement(document, "tspan");
    setAttribute(span, "x", 0);
    setAttribute(span, "dy", index === 0 ? 0 : layout.lineHeight);
    span.textContent = line;
    return span;
  });
  element.replaceChildren(...spans);
}

function createObjectRecord(document: Document, object: MountedObject): ObjectDomRecord {
  switch (object.type) {
    case "rect": {
      const element = createSvgElement(document, "g");
      const shape = createSvgElement(document, "rect");
      element.appendChild(shape);
      return { type: object.type, element, shape };
    }
    case "circle": {
      const element = createSvgElement(document, "g");
      const shape = createSvgElement(document, "circle");
      element.appendChild(shape);
      return { type: object.type, element, shape };
    }
    case "ellipse": {
      const element = createSvgElement(document, "g");
      const shape = createSvgElement(document, "ellipse");
      element.appendChild(shape);
      return { type: object.type, element, shape };
    }
    case "connector":
    case "path":
      return { type: object.type, element: createSvgElement(document, "path") };
    case "polygon":
      return { type: object.type, element: createSvgElement(document, "polygon") };
    case "polyline":
      return { type: object.type, element: createSvgElement(document, "polyline") };
    case "text":
      return { type: object.type, element: createSvgElement(document, "text") };
    case "line":
      return { type: object.type, element: createSvgElement(document, "line") };
    case "image":
      return { type: object.type, element: createSvgElement(document, "image") };
  }
}

function syncObjectRecord(
  document: Document,
  record: ObjectDomRecord,
  object: MountedObject,
  objects: ReadonlyMap<string, DrawableObject>,
  frame: EvaluatedScene,
): void {
  if (object.type === "connector") {
    const element = record.element;
    setAttribute(element, "data-anim8-id", object.id);
    setAttribute(element, "d", connectorPath(object, objects));
    setAttribute(element, "fill", "none");
    setAttribute(element, "stroke", paint(object.style, "stroke", "#1f2937", object, objects));
    setAttribute(element, "stroke-width", object.style.strokeWidth ?? 2);
    setAttribute(element, "opacity", worldOpacity(object, objects));
    syncAttributes(element, outlineAttributes(object.style));
    syncStrokeEffects(element, object, objects);
    if (object.label) {
      record.label ??= createSvgElement(document, "text");
      const p = connectorLabelPosition(object, objects);
      syncAttributes(record.label, { "data-anim8-connector-label": object.id, x: formatNumber(p.x), y: formatNumber(p.y - 12), "dominant-baseline": "middle", ...textAttributes({ ...object.style, fontFamily: fontFamily(object.style) }), opacity: formatNumber(worldOpacity(object, objects)) });
      syncText(document, record.label, object.label);
    } else { record.label?.remove(); delete record.label; }
    return;
  }

  syncCommonAttributes(record.element, object, objects);
  syncStrokeEffects(record.element, object, objects);

  switch (object.type) {
    case "rect": {
      const shape = record.shape!;
      setAttribute(shape, "x", -object.width / 2);
      setAttribute(shape, "y", -object.height / 2);
      setAttribute(shape, "width", object.width);
      setAttribute(shape, "height", object.height);
      setAttribute(shape, "rx", object.style.radius ?? 10);
      syncEmbeddedLabel(document, record, object.text, object);
      return;
    }
    case "circle": {
      const shape = record.shape!;
      setAttribute(shape, "cx", 0);
      setAttribute(shape, "cy", 0);
      setAttribute(shape, "r", object.radius);
      syncEmbeddedLabel(document, record, object.text, object);
      return;
    }
    case "ellipse": {
      const shape = record.shape!;
      setAttribute(shape, "cx", 0);
      setAttribute(shape, "cy", 0);
      setAttribute(shape, "rx", object.rx);
      setAttribute(shape, "ry", object.ry);
      syncEmbeddedLabel(document, record, object.text, object);
      return;
    }
    case "polygon":
    case "polyline":
      setAttribute(record.element, "points", points(object.points));
      if (needsRevealMask(object)) setAttribute(record.element, "mask", `url(#${revealId(object, frame)})`);
      else record.element.removeAttribute("mask");
      syncRevealFill(document, record, object, objects);
      return;
    case "text":
      setAttribute(record.element, "x", 0);
      setAttribute(record.element, "y", 0);
      setAttribute(record.element, "dominant-baseline", "middle");
      setAttribute(record.element, "text-anchor", "middle");
      setAttribute(record.element, "fill", object.style.color ?? "#111827");
      setAttribute(record.element, "stroke", "none");
      syncTextContent(document, record.element, object, object.text);
      return;
    case "line":
      setAttribute(record.element, "x1", 0);
      setAttribute(record.element, "y1", 0);
      setAttribute(record.element, "x2", object.x2);
      setAttribute(record.element, "y2", object.y2);
      return;
    case "path":
      setAttribute(record.element, "d", formatPathData(object.d));
      if (needsRevealMask(object)) setAttribute(record.element, "mask", `url(#${revealId(object, frame)})`);
      else record.element.removeAttribute("mask");
      syncRevealFill(document, record, object, objects);
      return;
    case "image":
      setAttribute(record.element, "x", -object.width / 2);
      setAttribute(record.element, "y", -object.height / 2);
      setAttribute(record.element, "width", object.width);
      setAttribute(record.element, "height", object.height);
      setAttribute(record.element, "href", object.href);
      return;
  }
}

function createDefs(document: Document): SVGDefsElement {
  const defs = createSvgElement(document, "defs");
  for (const [id, refX, d] of [["anim8-arrow", 8, "M0,0 L0,6 L9,3 z"], ["anim8-arrow-start", 1, "M9,0 L9,6 L0,3 z"]] as const) {
    const marker = createSvgElement(document, "marker");
    setAttribute(marker, "id", id);
    setAttribute(marker, "markerWidth", 10);
    setAttribute(marker, "markerHeight", 10);
    setAttribute(marker, "refX", refX);
    setAttribute(marker, "refY", 3);
    setAttribute(marker, "orient", "auto");
    const arrow = createSvgElement(document, "path");
    setAttribute(arrow, "d", d);
    setAttribute(arrow, "fill", "context-stroke");
    marker.appendChild(arrow);
    defs.appendChild(marker);
  }
  return defs;
}

function adoptObjectRecord(object: MountedObject, element: Element): ObjectDomRecord | undefined {
  const tag = element.tagName.toLowerCase();
  switch (object.type) {
    case "rect":
    case "circle":
    case "ellipse": {
      if (tag !== "g") return undefined;
      const shapeTag = object.type;
      const shape = Array.from(element.children).find(child => child.tagName.toLowerCase() === shapeTag);
      if (!shape) return undefined;
      const label = Array.from(element.children).find(child => child.tagName.toLowerCase() === "text");
      return {
        type: object.type,
        element: element as SVGElement,
        shape: shape as SVGElement,
        ...(label ? { label: label as SVGTextElement } : {}),
      };
    }
    case "polygon":
    case "polyline":
    case "text":
    case "line":
    case "path":
    case "image":
      if (tag !== object.type) return undefined;
      return { type: object.type, element: element as SVGElement };
    case "connector":
      if (tag !== "path") return undefined;
      return { type: object.type, element: element as SVGElement };
  }
}

function findHydratableSvg(container: Element, frame: EvaluatedScene): {
  svg: SVGSVGElement;
  defs: SVGDefsElement;
  world: SVGGElement;
  background?: SVGRectElement;
  records: Map<string, ObjectDomRecord>;
} | undefined {
  // Non-browser DOM hosts may support replaceChildren but not children.
  if (!container.children || container.children.length !== 1) return undefined;
  const candidate = container.firstElementChild;
  if (!candidate || candidate.namespaceURI !== SVG_NS || candidate.tagName.toLowerCase() !== "svg") return undefined;

  const svg = candidate as SVGSVGElement;
  const world = Array.from(svg.children).find(
    child => child.tagName.toLowerCase() === "g" && child.getAttribute("data-anim8-camera") === "world",
  ) as SVGGElement | undefined;
  if (!world) return undefined;

  let defs = Array.from(svg.children).find(child => child.tagName.toLowerCase() === "defs") as SVGDefsElement | undefined;
  if (!defs) {
    const document = container.ownerDocument;
    if (!document?.createElementNS) return undefined;
    defs = createDefs(document);
    svg.insertBefore(defs, svg.firstChild);
  } else if (!Array.from(defs.children).some(child => child.getAttribute("id") === "anim8-arrow-start")) {
    // Markup from earlier versions has only the end marker.
    const document = container.ownerDocument;
    const fresh = document ? createDefs(document) : undefined;
    const start = fresh && Array.from(fresh.children).find(child => child.getAttribute("id") === "anim8-arrow-start");
    if (start) defs.appendChild(start);
  }

  const objects = new Map(frame.objects.map(object => [object.id, object]));
  const records = new Map<string, ObjectDomRecord>();
  for (const child of Array.from(world.children)) {
    const revealGroup = child.hasAttribute("data-anim8-reveal-group");
    const id = child.getAttribute("data-anim8-id") ?? child.getAttribute("data-anim8-reveal-group");
    if (!id) continue;
    const object = objects.get(id);
    if (!object || object.type === "group") {
      child.remove();
      continue;
    }
    const element = revealGroup ? Array.from(child.children).find(node => node.getAttribute("data-anim8-id") === id) : child;
    const fill = revealGroup ? Array.from(child.children).find(node => node.getAttribute("data-anim8-reveal-fill") === id) : undefined;
    const record = element ? adoptObjectRecord(object, element) : undefined;
    if (record && (!revealGroup || (child.tagName.toLowerCase() === "g" && fill))) {
      if (revealGroup) { record.revealGroup = child as SVGGElement; record.revealFill = fill as SVGElement; }
      records.set(id, record);
    }
    else child.remove();
  }
  for (const child of Array.from(world.children)) {
    const id = child.getAttribute("data-anim8-connector-label");
    if (!id) continue;
    const record = records.get(id);
    if (record?.type === "connector") record.label = child as SVGTextElement;
    else child.remove();
  }

  const background = Array.from(svg.children).find(
    child =>
      child !== defs &&
      child !== world &&
      child.tagName.toLowerCase() === "rect" &&
      !child.hasAttribute("data-anim8-id"),
  ) as SVGRectElement | undefined;

  return { svg, defs, world, ...(background ? { background } : {}), records };
}

export function mountSvg(container: Element, frame: EvaluatedScene): SvgMount {
  const document = container.ownerDocument ?? globalThis.document;

  // Real DOM Elements always have an ownerDocument. A small fallback keeps
  // nonstandard DOM shims/test hosts usable without weakening the normal
  // keyed incremental path.
  if (!document?.createElementNS || typeof container.replaceChildren !== "function") {
    const host = container as Element & { innerHTML: string };
    const update = (next: EvaluatedScene): void => {
      host.innerHTML = renderSvg(next);
    };
    update(frame);
    return {
      update,
      destroy: () => { host.innerHTML = ""; },
    };
  }

  const hydrated = findHydratableSvg(container, frame);
  const svg = hydrated?.svg ?? createSvgElement(document, "svg");
  setAttribute(svg, "xmlns", SVG_NS);
  setAttribute(svg, "role", "img");

  const defs = hydrated?.defs ?? createDefs(document);
  const world = hydrated?.world ?? createSvgElement(document, "g");
  setAttribute(world, "data-anim8-camera", "world");

  if (!hydrated) {
    svg.appendChild(defs);
    svg.appendChild(world);
    container.replaceChildren(svg);
  }

  for (const child of Array.from(defs.childNodes)) if ((child as Element).tagName?.toLowerCase() === "lineargradient" || (child as Element).tagName?.toLowerCase() === "mask") child.remove();
  const maskDefinitions = new Map<string, SVGMaskElement>();
  const paintDefinitions = new Map<string, SVGLinearGradientElement>();
  const records = hydrated?.records ?? new Map<string, ObjectDomRecord>();
  let background: SVGRectElement | undefined = hydrated?.background;

  const update = (next: EvaluatedScene): void => {
    setAttribute(svg, "viewBox", `0 0 ${formatNumber(next.scene.width)} ${formatNumber(next.scene.height)}`);
    setAttribute(world, "transform", cameraTransform(next));

    if (next.scene.background) {
      if (!background) {
        background = createSvgElement(document, "rect");
        setAttribute(background, "width", "100%");
        setAttribute(background, "height", "100%");
        svg.insertBefore(background, defs.nextSibling);
      }
      setAttribute(background, "fill", next.scene.background);
    } else if (background) {
      background.remove();
      background = undefined;
    }

    const activePaints = new Set<string>();
    for (const gradient of gradients(next.objects)) {
      const id = resourceId(gradient);
      activePaints.add(id);
      if (paintDefinitions.has(id)) continue;
      const element = createSvgElement(document, "linearGradient");
      if (gradient.svgUnits) setAttribute(element, "gradientUnits", gradient.svgUnits);
      syncAttributes(element, { id, x1: formatNumber(gradient.from?.x ?? 0), y1: formatNumber(gradient.from?.y ?? 0), x2: formatNumber(gradient.to?.x ?? 1), y2: formatNumber(gradient.to?.y ?? 0) });
      for (const stop of gradient.stops) {
        const child = createSvgElement(document, "stop");
        syncAttributes(child, { offset: formatNumber(stop.offset), "stop-color": stop.color, "stop-opacity": formatNumber(stop.opacity ?? 1) });
        element.appendChild(child);
      }
      defs.appendChild(element); paintDefinitions.set(id, element);
    }
    for (const [id, element] of paintDefinitions) if (!activePaints.has(id)) { element.remove(); paintDefinitions.delete(id); }
    const objects = new Map(next.objects.map(object => [object.id, object]));
    const liveMasks = new Set<string>();
    for (const object of next.objects.filter(needsRevealMask)) {
      const { region, tag, shape } = revealMask(object, next, objects);
      const id = region.id!;
      liveMasks.add(id);
      if (!maskDefinitions.has(id)) {
        const mask = createSvgElement(document, "mask"), path = createSvgElement(document, tag);
        syncAttributes(mask, region); syncAttributes(path, shape); mask.appendChild(path);
        defs.appendChild(mask); maskDefinitions.set(id, mask);
      }
    }
    for (const [id, mask] of maskDefinitions) if (!liveMasks.has(id)) { mask.remove(); maskDefinitions.delete(id); }
    const liveIds = new Set(next.objects.map(object => object.id));

    for (const [id, record] of records) {
      if (!liveIds.has(id)) {
        removeRecord(record);
        records.delete(id);
      }
    }

    for (const object of next.objects) {
      const existing = records.get(object.id);

      if (object.type === "group") {
        if (existing) {
          removeRecord(existing);
          records.delete(object.id);
        }
        continue;
      }

      let record = existing;
      if (!record || record.type !== object.type) {
        if (record) removeRecord(record);
        record = createObjectRecord(document, object);
        records.set(object.id, record);
      }

      syncObjectRecord(document, record, object, objects, next);
      if (!worldVisible(object, objects)) { (record.revealGroup ?? record.element).remove(); record.label?.remove(); }
    }

    const ordered = [...next.objects].sort((a, b) => a.z - b.z);
    for (const object of ordered) {
      if (object.type === "group" || !worldVisible(object, objects)) continue;
      const record = records.get(object.id);
      if (record) {
        world.appendChild(record.revealGroup ?? record.element);
        if (object.type === "connector" && record.label) world.appendChild(record.label);
      }
    }
  };

  update(frame);

  return {
    update,
    destroy: () => {
      records.clear();
      background = undefined;
      container.replaceChildren();
    },
  };
}

function syncAttributes(element: Element, attributes: Record<string, string>): void {
  for (const [name, value] of Object.entries(attributes)) setAttribute(element, name, value);
}
const textCache = new WeakMap<Element, string>();
function syncText(document: Document, element: SVGElement, text: string, runs?: readonly TextRun[]): void {
  const signature = JSON.stringify([text, runs]);
  if (textCache.get(element) === signature) return;
  element.replaceChildren();
  if (!runs) element.textContent = text;
  else for (const run of runs) {
    const span = createSvgElement(document, "tspan");
    if (run.color !== undefined) setAttribute(span, "fill", run.color);
    if (run.fontWeight !== undefined) setAttribute(span, "font-weight", run.fontWeight);
    if (run.fontStyle !== undefined) setAttribute(span, "font-style", run.fontStyle);
    span.textContent = run.text; element.appendChild(span);
  }
  textCache.set(element, signature);
}

type RevealObject = Extract<DrawableObject, { type: "path" | "polygon" | "polyline" }>;
function splitRevealFill(object: DrawableObject, objects: ReadonlyMap<string, DrawableObject>): object is RevealObject {
  return needsRevealMask(object) && paint(object.style, "fill", "none", object, objects) !== "none";
}
function revealGeometry(object: RevealObject): Record<string, string> {
  return object.type === "path" ? { d: formatPathData(object.d) } : { points: points(object.points) };
}
function revealFillAttributes(object: RevealObject, objects: ReadonlyMap<string, DrawableObject>): Record<string, string> {
  return {
    "data-anim8-reveal-fill": object.id, transform: transform(object, objects),
    fill: paint(object.style, "fill", "none", object, objects), stroke: "none", "pointer-events": "none",
    "fill-opacity": formatNumber(object.style.fillOpacity ?? 1), ...revealGeometry(object),
  };
}
function revealObjectSvg(object: RevealObject, objects: ReadonlyMap<string, DrawableObject>, frame: EvaluatedScene): string {
  const split = splitRevealFill(object, objects);
  const outline = `<${object.type} data-anim8-id="${esc(object.id)}" transform="${transform(object, objects)}" ${style(object, objects, split ? "none" : undefined, split ? 1 : undefined)} ${attributesSvg(revealGeometry(object))}${split ? ' pointer-events="visible"' : ""}${drawAttributes(object, frame)}/>`;
  if (!split) return outline;
  // Apply world opacity once to the composed fill and stroke, matching a single
  // SVG shape's compositing even where translucent paints overlap.
  return `<g data-anim8-reveal-group="${esc(object.id)}" opacity="${formatNumber(worldOpacity(object, objects))}"><${object.type} ${attributesSvg(revealFillAttributes(object, objects))}/>${outline}</g>`;
}
function syncRevealFill(document: Document, record: ObjectDomRecord, object: RevealObject, objects: ReadonlyMap<string, DrawableObject>): void {
  if (!splitRevealFill(object, objects)) {
    record.element.removeAttribute("pointer-events");
    if (record.revealGroup) {
      record.element.remove(); record.revealGroup.remove();
      delete record.revealGroup; delete record.revealFill;
    }
    return;
  }
  if (!record.revealGroup) {
    record.revealGroup = createSvgElement(document, "g");
    record.revealFill = createSvgElement(document, object.type);
    record.revealGroup.appendChild(record.revealFill);
    record.revealGroup.appendChild(record.element);
  }
  syncAttributes(record.revealGroup, { "data-anim8-reveal-group": object.id, opacity: formatNumber(worldOpacity(object, objects)) });
  syncAttributes(record.revealFill!, revealFillAttributes(object, objects));
  setAttribute(record.element, "fill", "none");
  setAttribute(record.element, "opacity", 1);
  setAttribute(record.element, "pointer-events", "visible");
}
function removeRecord(record: ObjectDomRecord): void {
  record.revealGroup?.remove(); record.element.remove(); record.label?.remove();
}
function needsRevealMask(object: DrawableObject): object is RevealObject {
  return (object.type === "path" || object.type === "polygon" || object.type === "polyline") &&
    object.drawProgress !== undefined && object.drawProgress < 1 && Boolean(object.style.strokeDasharray?.length);
}
function revealId(object: RevealObject, frame: EvaluatedScene): string {
  return resourceId(["reveal", object, frame.scene, frame.camera, frame.objects.filter(o => o.type === "group")]);
}
function revealMask(object: RevealObject, frame: EvaluatedScene, objects: ReadonlyMap<string, DrawableObject>): {
  region: Record<string, string>; tag: "path" | "polygon" | "polyline"; shape: Record<string, string>;
} {
  // Bound masks to the visible viewport, mapped into object-local coordinates.
  // This supports arbitrary SVG path commands and zero-height horizontal paths.
  const camera = { a: frame.camera.zoom, b: 0, c: 0, d: frame.camera.zoom, e: frame.camera.x, f: frame.camera.y };
  const inverse = invertMatrix(multiply(camera, worldMatrix(object, objects)));
  const corners = [{ x: 0, y: 0 }, { x: frame.scene.width, y: 0 }, { x: 0, y: frame.scene.height }, { x: frame.scene.width, y: frame.scene.height }].map(p => inverse ? applyMatrix(inverse, p) : p);
  const pad = (object.style.strokeWidth ?? 2) * 2 + 2;
  const minX = Math.min(...corners.map(p => p.x)) - pad, minY = Math.min(...corners.map(p => p.y)) - pad;
  return {
    region: { id: revealId(object, frame), maskUnits: "userSpaceOnUse", x: formatNumber(minX), y: formatNumber(minY), width: formatNumber(Math.max(...corners.map(p => p.x)) + pad - minX), height: formatNumber(Math.max(...corners.map(p => p.y)) + pad - minY) },
    tag: object.type,
    shape: { ...(object.type === "path" ? { d: formatPathData(object.d) } : { points: points(object.points) }), fill: "none", stroke: Math.max(0, object.drawProgress ?? 1) > 0 ? "white" : "none", "stroke-width": formatNumber(object.style.strokeWidth ?? 2), "stroke-linecap": object.style.strokeLinecap ?? "butt", "stroke-linejoin": object.style.strokeLinejoin ?? "miter", pathLength: "1", "stroke-dasharray": "1", "stroke-dashoffset": formatNumber(1 - Math.max(0, object.drawProgress ?? 1)) },
  };
}

function connectorLabelPosition(connector: ConnectorObject, objects: ReadonlyMap<string, DrawableObject>): { x: number; y: number } {
  const a = objects.get(connector.from.objectId), b = objects.get(connector.to.objectId);
  if (!a || !b) return { x: 0, y: 0 };
  const from = anchorPoint(a, connector.from.anchor, objects), to = anchorPoint(b, connector.to.anchor, objects);
  const midX = (from.x + to.x) / 2;
  const route = connector.kind === "routed" ? routeConnector(connector, objects) : connector.kind === "orthogonal" ? [from, { x: midX, y: from.y }, { x: midX, y: to.y }, to] : [from, to];
  let best = { x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 }, longest = -1;
  for (let i = 1; i < route.length; i++) {
    const start = route[i - 1]!, end = route[i]!;
    const distance = Math.hypot(end.x - start.x, end.y - start.y);
    if (distance > longest) { longest = distance; best = { x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 }; }
  }
  return best;
}
