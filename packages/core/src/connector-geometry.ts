import { anchorPoint, applyMatrix, invertMatrix, objectBounds, worldMatrix, type Point } from "./geometry.js";
import { routeConnector } from "./routing.js";
import type { AnchorRef, ConnectorObject, DrawableObject } from "./types.js";

/** Space left between a bound connector end and the outline it attaches to. */
export const DEFAULT_CONNECTOR_GAP = 6;

export type ConnectorGeometry =
  | { kind: "polyline"; points: Point[] }
  | { kind: "cubic"; from: Point; cp1: Point; cp2: Point; to: Point };

/**
 * Where a ray from the object's local centre toward `toward` (a world point)
 * leaves the object's outline, pushed out by `gap`. Returns null when the
 * object has no area or `toward` lies inside it (overlapping objects keep the
 * centre point rather than producing an inverted arrow).
 */
export function outlineExitPoint(
  object: DrawableObject,
  objects: ReadonlyMap<string, DrawableObject>,
  toward: Point,
  gap = DEFAULT_CONNECTOR_GAP,
): Point | null {
  const matrix = worldMatrix(object, objects);
  const inverse = invertMatrix(matrix);
  if (!inverse) return null;
  const bounds = objectBounds(object);
  const center = { x: (bounds.minX + bounds.maxX) / 2, y: (bounds.minY + bounds.maxY) / 2 };
  const local = applyMatrix(inverse, toward);
  const dx = local.x - center.x;
  const dy = local.y - center.y;
  if (dx === 0 && dy === 0) return null;

  let t: number;
  switch (object.type) {
    case "rect":
    case "image": {
      const hw = (bounds.maxX - bounds.minX) / 2;
      const hh = (bounds.maxY - bounds.minY) / 2;
      if (hw <= 0 || hh <= 0) return null;
      t = Math.min(dx === 0 ? Infinity : hw / Math.abs(dx), dy === 0 ? Infinity : hh / Math.abs(dy));
      break;
    }
    case "circle":
    case "ellipse": {
      const rx = (bounds.maxX - bounds.minX) / 2;
      const ry = (bounds.maxY - bounds.minY) / 2;
      if (rx <= 0 || ry <= 0) return null;
      t = 1 / Math.sqrt((dx / rx) ** 2 + (dy / ry) ** 2);
      break;
    }
    case "polygon": {
      t = Infinity;
      const pts = object.points;
      for (let index = 0; index < pts.length; index += 1) {
        const a = pts[index]!;
        const b = pts[(index + 1) % pts.length]!;
        const ex = b.x - a.x;
        const ey = b.y - a.y;
        const denom = dx * ey - dy * ex;
        if (Math.abs(denom) < 1e-12) continue;
        const s = ((a.x - center.x) * ey - (a.y - center.y) * ex) / denom;
        const u = ((a.x - center.x) * dy - (a.y - center.y) * dx) / denom;
        if (s > 0 && u >= 0 && u <= 1) t = Math.min(t, s);
      }
      if (!Number.isFinite(t)) return null;
      break;
    }
    default:
      return null;
  }
  if (t >= 1) return null;

  const worldCenter = applyMatrix(matrix, center);
  const exit = applyMatrix(matrix, { x: center.x + dx * t, y: center.y + dy * t });
  const wx = exit.x - worldCenter.x;
  const wy = exit.y - worldCenter.y;
  const length = Math.hypot(wx, wy);
  if (length === 0) return exit;
  return { x: exit.x + (wx / length) * gap, y: exit.y + (wy / length) * gap };
}

function isBinding(ref: AnchorRef): boolean {
  return ref.anchor === undefined || ref.anchor === "center";
}

function bind(
  object: DrawableObject,
  ref: AnchorRef,
  raw: Point,
  toward: Point,
  objects: ReadonlyMap<string, DrawableObject>,
  gap: number,
): Point {
  if (!isBinding(ref)) return raw;
  return outlineExitPoint(object, objects, toward, gap) ?? raw;
}

/**
 * Resolved world-space geometry for a connector.
 *
 * Explicit side anchors (`top`, `right`, ...) are used exactly. A `center` (or
 * omitted) anchor is treated as a binding: the end is moved to where the
 * connector leaves the object's outline, plus `gap`, so arrowheads are never
 * hidden underneath the shapes they point at.
 */
export function connectorGeometry(
  connector: ConnectorObject,
  objects: ReadonlyMap<string, DrawableObject>,
  options: { gap?: number } = {},
): ConnectorGeometry | null {
  const fromObject = objects.get(connector.from.objectId);
  const toObject = objects.get(connector.to.objectId);
  if (!fromObject || !toObject) return null;
  const gap = options.gap ?? DEFAULT_CONNECTOR_GAP;

  const rawFrom = anchorPoint(fromObject, connector.from.anchor, objects);
  const rawTo = anchorPoint(toObject, connector.to.anchor, objects);

  if (connector.kind === "routed") {
    const route = routeConnector(connector, objects);
    if (route.length < 2) return null;
    const points = [...route];
    points[0] = bind(fromObject, connector.from, points[0]!, points[1]!, objects, gap);
    const last = points.length - 1;
    points[last] = bind(toObject, connector.to, points[last]!, points[last - 1]!, objects, gap);
    return { kind: "polyline", points };
  }

  if (connector.kind === "curve" || connector.kind === "orthogonal") {
    // Both leave and arrive horizontally through the vertical midline.
    const midX = (rawFrom.x + rawTo.x) / 2;
    const horizontal = Math.abs(rawTo.x - rawFrom.x) > 1e-9;
    const fromToward = horizontal ? { x: midX, y: rawFrom.y } : rawTo;
    const toToward = horizontal ? { x: midX, y: rawTo.y } : rawFrom;
    const from = bind(fromObject, connector.from, rawFrom, fromToward, objects, gap);
    const to = bind(toObject, connector.to, rawTo, toToward, objects, gap);
    const mx = (from.x + to.x) / 2;
    if (connector.kind === "curve") {
      return { kind: "cubic", from, cp1: { x: mx, y: from.y }, cp2: { x: mx, y: to.y }, to };
    }
    return { kind: "polyline", points: [from, { x: mx, y: from.y }, { x: mx, y: to.y }, to] };
  }

  const from = bind(fromObject, connector.from, rawFrom, rawTo, objects, gap);
  const to = bind(toObject, connector.to, rawTo, rawFrom, objects, gap);
  return { kind: "polyline", points: [from, to] };
}

/** Point and tangent direction at the end of a connector, for arrowheads and labels. */
export function connectorEnd(geometry: ConnectorGeometry): { tip: Point; tail: Point } {
  if (geometry.kind === "cubic") return { tip: geometry.to, tail: geometry.cp2.x === geometry.to.x && geometry.cp2.y === geometry.to.y ? geometry.cp1 : geometry.cp2 };
  const points = geometry.points;
  return { tip: points[points.length - 1]!, tail: points[points.length - 2]! };
}

/** Point and tangent direction at the start of a connector, for start arrowheads. */
export function connectorStart(geometry: ConnectorGeometry): { tip: Point; tail: Point } {
  if (geometry.kind === "cubic") return { tip: geometry.from, tail: geometry.cp1.x === geometry.from.x && geometry.cp1.y === geometry.from.y ? geometry.cp2 : geometry.cp1 };
  return { tip: geometry.points[0]!, tail: geometry.points[1]! };
}

/** Midpoint along a connector, used to place labels. */
export function connectorMidpoint(geometry: ConnectorGeometry): Point {
  if (geometry.kind === "cubic") {
    const { from, cp1, cp2, to } = geometry;
    return {
      x: 0.125 * from.x + 0.375 * cp1.x + 0.375 * cp2.x + 0.125 * to.x,
      y: 0.125 * from.y + 0.375 * cp1.y + 0.375 * cp2.y + 0.125 * to.y,
    };
  }
  const points = geometry.points;
  const lengths = points.slice(1).map((point, index) => Math.hypot(point.x - points[index]!.x, point.y - points[index]!.y));
  let remaining = lengths.reduce((sum, value) => sum + value, 0) / 2;
  for (let index = 0; index < lengths.length; index += 1) {
    const length = lengths[index]!;
    if (remaining <= length && length > 0) {
      const a = points[index]!;
      const b = points[index + 1]!;
      const t = remaining / length;
      return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
    }
    remaining -= length;
  }
  return points[0]!;
}
