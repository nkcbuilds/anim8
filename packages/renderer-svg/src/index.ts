import { anchorPoint, worldMatrix, worldOpacity, worldVisible, type ConnectorObject, type DrawableObject, type EvaluatedScene, type SceneDocument } from "@anim8/core";
import { evaluate } from "@anim8/core";

const esc = (value: string): string => value.replace(/[&<>"']/g, char => ({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;" }[char]!));

function cameraTransform(frame: EvaluatedScene): string {
  const { x, y, zoom } = frame.camera;
  return `matrix(${zoom} 0 0 ${zoom} ${x} ${y})`;
}

function transform(object: DrawableObject, objects: ReadonlyMap<string, DrawableObject>): string {
  const m = worldMatrix(object, objects);
  return `matrix(${m.a} ${m.b} ${m.c} ${m.d} ${m.e} ${m.f})`;
}

function style(object: DrawableObject, objects: ReadonlyMap<string, DrawableObject>): string {
  const s = object.style;
  return [
    `fill="${esc(s.fill ?? "none")}"`,
    `stroke="${esc(s.stroke ?? "none")}"`,
    `stroke-width="${s.strokeWidth ?? 0}"`,
    `opacity="${worldOpacity(object, objects)}"`,
  ].join(" ");
}

function drawAttributes(object: DrawableObject): string {
  if ((object.type !== "path" && object.type !== "polygon" && object.type !== "polyline") || object.drawProgress === undefined) return "";
  const progress = Math.max(0, Math.min(1, object.drawProgress));
  return ` pathLength="1" stroke-dasharray="1" stroke-dashoffset="${1 - progress}"`;
}

function points(points: readonly { x: number; y: number }[]): string {
  return points.map(point => `${point.x},${point.y}`).join(" ");
}

function connectorPath(connector: ConnectorObject, objects: ReadonlyMap<string, DrawableObject>): string {
  const fromObject = objects.get(connector.from.objectId);
  const toObject = objects.get(connector.to.objectId);
  if (!fromObject || !toObject) return "";
  const from = anchorPoint(fromObject, connector.from.anchor, objects);
  const to = anchorPoint(toObject, connector.to.anchor, objects);
  if (connector.kind === "curve") {
    const mx = (from.x + to.x) / 2;
    return `M ${from.x} ${from.y} C ${mx} ${from.y}, ${mx} ${to.y}, ${to.x} ${to.y}`;
  }
  if (connector.kind === "orthogonal") {
    const mx = (from.x + to.x) / 2;
    return `M ${from.x} ${from.y} L ${mx} ${from.y} L ${mx} ${to.y} L ${to.x} ${to.y}`;
  }
  return `M ${from.x} ${from.y} L ${to.x} ${to.y}`;
}

function objectSvg(object: DrawableObject, objects: ReadonlyMap<string, DrawableObject>): string {
  if (!worldVisible(object, objects)) return "";
  if (object.type === "connector") {
    const d = connectorPath(object, objects);
    return `<path data-anim8-id="${esc(object.id)}" d="${d}" fill="none" stroke="${esc(object.style.stroke ?? "#1f2937")}" stroke-width="${object.style.strokeWidth ?? 2}" opacity="${worldOpacity(object, objects)}" marker-end="url(#anim8-arrow)"/>`;
  }
  if (object.type === "group") return "";
  const t = transform(object, objects);
  const common = `data-anim8-id="${esc(object.id)}" transform="${t}" ${style(object, objects)}`;
  switch (object.type) {
    case "rect": {
      const x = -object.width / 2, y = -object.height / 2;
      const r = object.style.radius ?? 10;
      const text = object.text ? `<text x="0" y="0" dominant-baseline="middle" text-anchor="middle" fill="${esc(object.style.color ?? "#111827")}" stroke="none" font-size="${object.style.fontSize ?? 16}">${esc(object.text)}</text>` : "";
      return `<g ${common}><rect x="${x}" y="${y}" width="${object.width}" height="${object.height}" rx="${r}"/>${text}</g>`;
    }
    case "circle": {
      const text = object.text ? `<text x="0" y="0" dominant-baseline="middle" text-anchor="middle" fill="${esc(object.style.color ?? "#111827")}" stroke="none" font-size="${object.style.fontSize ?? 16}">${esc(object.text)}</text>` : "";
      return `<g ${common}><circle cx="0" cy="0" r="${object.radius}"/>${text}</g>`;
    }
    case "ellipse": {
      const text = object.text ? `<text x="0" y="0" dominant-baseline="middle" text-anchor="middle" fill="${esc(object.style.color ?? "#111827")}" stroke="none" font-size="${object.style.fontSize ?? 16}">${esc(object.text)}</text>` : "";
      return `<g ${common}><ellipse cx="0" cy="0" rx="${object.rx}" ry="${object.ry}"/>${text}</g>`;
    }
    case "polygon":
      return `<polygon ${common} points="${points(object.points)}"${drawAttributes(object)}/>`;
    case "polyline":
      return `<polyline ${common} points="${points(object.points)}"${drawAttributes(object)}/>`;
    case "text":
      return `<text data-anim8-id="${esc(object.id)}" transform="${t}" x="0" y="0" dominant-baseline="middle" text-anchor="middle" fill="${esc(object.style.color ?? "#111827")}" stroke="none" opacity="${worldOpacity(object, objects)}" font-size="${object.style.fontSize ?? 16}">${esc(object.text)}</text>`;
    case "line":
      return `<line ${common} x1="0" y1="0" x2="${object.x2}" y2="${object.y2}"/>`;
    case "path":
      return `<path ${common} d="${esc(object.d)}"${drawAttributes(object)}/>`;
    case "image":
      return `<image ${common} x="${-object.width/2}" y="${-object.height/2}" width="${object.width}" height="${object.height}" href="${esc(object.href)}"/>`;
  }
}

export function renderSvg(frame: EvaluatedScene): string {
  const objects = new Map(frame.objects.map(object => [object.id, object]));
  const ordered = [...frame.objects].sort((a,b) => a.z - b.z);
  const body = ordered.map(object => objectSvg(object, objects)).join("");
  const bg = frame.scene.background ? `<rect width="100%" height="100%" fill="${esc(frame.scene.background)}"/>` : "";
  const world = `<g data-anim8-camera="world" transform="${cameraTransform(frame)}">${body}</g>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${frame.scene.width} ${frame.scene.height}" role="img"><defs><marker id="anim8-arrow" markerWidth="10" markerHeight="10" refX="8" refY="3" orient="auto"><path d="M0,0 L0,6 L9,3 z" fill="#1f2937"/></marker></defs>${bg}${world}</svg>`;
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
}

function createSvgElement<K extends keyof SVGElementTagNameMap>(
  document: Document,
  tag: K,
): SVGElementTagNameMap[K] {
  return document.createElementNS(SVG_NS, tag);
}

function setAttribute(element: Element, name: string, value: string | number): void {
  element.setAttribute(name, String(value));
}

function syncCommonAttributes(
  element: SVGElement,
  object: MountedObject,
  objects: ReadonlyMap<string, DrawableObject>,
): void {
  const s = object.style;
  setAttribute(element, "data-anim8-id", object.id);
  setAttribute(element, "transform", transform(object, objects));
  setAttribute(element, "fill", s.fill ?? "none");
  setAttribute(element, "stroke", s.stroke ?? "none");
  setAttribute(element, "stroke-width", s.strokeWidth ?? 0);
  setAttribute(element, "opacity", worldOpacity(object, objects));
}

function syncDrawAttributes(element: SVGElement, object: MountedObject): void {
  const drawable = object.type === "path" || object.type === "polygon" || object.type === "polyline";
  if (!drawable || object.drawProgress === undefined) {
    element.removeAttribute("pathLength");
    element.removeAttribute("stroke-dasharray");
    element.removeAttribute("stroke-dashoffset");
    return;
  }

  const progress = Math.max(0, Math.min(1, object.drawProgress));
  setAttribute(element, "pathLength", 1);
  setAttribute(element, "stroke-dasharray", 1);
  setAttribute(element, "stroke-dashoffset", 1 - progress);
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
  setAttribute(label, "font-size", object.style.fontSize ?? 16);
  label.textContent = text;
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
): void {
  if (object.type === "connector") {
    const element = record.element;
    setAttribute(element, "data-anim8-id", object.id);
    setAttribute(element, "d", connectorPath(object, objects));
    setAttribute(element, "fill", "none");
    setAttribute(element, "stroke", object.style.stroke ?? "#1f2937");
    setAttribute(element, "stroke-width", object.style.strokeWidth ?? 2);
    setAttribute(element, "opacity", worldOpacity(object, objects));
    setAttribute(element, "marker-end", "url(#anim8-arrow)");
    return;
  }

  syncCommonAttributes(record.element, object, objects);

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
      syncDrawAttributes(record.element, object);
      return;
    case "text":
      setAttribute(record.element, "x", 0);
      setAttribute(record.element, "y", 0);
      setAttribute(record.element, "dominant-baseline", "middle");
      setAttribute(record.element, "text-anchor", "middle");
      setAttribute(record.element, "fill", object.style.color ?? "#111827");
      setAttribute(record.element, "stroke", "none");
      setAttribute(record.element, "font-size", object.style.fontSize ?? 16);
      record.element.textContent = object.text;
      return;
    case "line":
      setAttribute(record.element, "x1", 0);
      setAttribute(record.element, "y1", 0);
      setAttribute(record.element, "x2", object.x2);
      setAttribute(record.element, "y2", object.y2);
      return;
    case "path":
      setAttribute(record.element, "d", object.d);
      syncDrawAttributes(record.element, object);
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
  const marker = createSvgElement(document, "marker");
  setAttribute(marker, "id", "anim8-arrow");
  setAttribute(marker, "markerWidth", 10);
  setAttribute(marker, "markerHeight", 10);
  setAttribute(marker, "refX", 8);
  setAttribute(marker, "refY", 3);
  setAttribute(marker, "orient", "auto");

  const arrow = createSvgElement(document, "path");
  setAttribute(arrow, "d", "M0,0 L0,6 L9,3 z");
  setAttribute(arrow, "fill", "#1f2937");
  marker.appendChild(arrow);
  defs.appendChild(marker);
  return defs;
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

  const svg = createSvgElement(document, "svg");
  setAttribute(svg, "xmlns", SVG_NS);
  setAttribute(svg, "role", "img");

  const defs = createDefs(document);
  svg.appendChild(defs);
  const world = createSvgElement(document, "g");
  setAttribute(world, "data-anim8-camera", "world");
  svg.appendChild(world);
  container.replaceChildren(svg);

  const records = new Map<string, ObjectDomRecord>();
  let background: SVGRectElement | undefined;

  const update = (next: EvaluatedScene): void => {
    setAttribute(svg, "viewBox", `0 0 ${next.scene.width} ${next.scene.height}`);
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

    const objects = new Map(next.objects.map(object => [object.id, object]));
    const liveIds = new Set(next.objects.map(object => object.id));

    for (const [id, record] of records) {
      if (!liveIds.has(id)) {
        record.element.remove();
        records.delete(id);
      }
    }

    for (const object of next.objects) {
      const existing = records.get(object.id);

      if (object.type === "group") {
        if (existing) {
          existing.element.remove();
          records.delete(object.id);
        }
        continue;
      }

      let record = existing;
      if (!record || record.type !== object.type) {
        record?.element.remove();
        record = createObjectRecord(document, object);
        records.set(object.id, record);
      }

      syncObjectRecord(document, record, object, objects);
      if (!worldVisible(object, objects)) record.element.remove();
    }

    const ordered = [...next.objects].sort((a, b) => a.z - b.z);
    for (const object of ordered) {
      if (object.type === "group" || !worldVisible(object, objects)) continue;
      const record = records.get(object.id);
      if (record) world.appendChild(record.element);
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
