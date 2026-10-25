import { anchorPoint, applyMatrix, objectBounds, worldMatrix, worldVisible, type Bounds } from "./geometry.js";
import type { ConnectorObject, DrawableObject, PointValue } from "./types.js";

export interface ConnectorRouteOptions {
  clearance?: number;
  bendPenalty?: number;
}

export const ROUTING_MAX_OBSTACLES = 48;
export const DEFAULT_CONNECTOR_CLEARANCE = 12;
export const DEFAULT_CONNECTOR_BEND_PENALTY = 8;

interface Obstacle extends Bounds {
  id: string;
}

interface Edge {
  to: string;
  direction: "h" | "v";
  distance: number;
}

interface HeapEntry {
  key: string;
  cost: number;
}

function worldBounds(object: DrawableObject, objects: ReadonlyMap<string, DrawableObject>): Bounds {
  const local = objectBounds(object);
  const matrix = worldMatrix(object, objects);
  const corners = [
    applyMatrix(matrix, { x: local.minX, y: local.minY }),
    applyMatrix(matrix, { x: local.maxX, y: local.minY }),
    applyMatrix(matrix, { x: local.maxX, y: local.maxY }),
    applyMatrix(matrix, { x: local.minX, y: local.maxY }),
  ];
  return {
    minX: Math.min(...corners.map(point => point.x)),
    minY: Math.min(...corners.map(point => point.y)),
    maxX: Math.max(...corners.map(point => point.x)),
    maxY: Math.max(...corners.map(point => point.y)),
  };
}

function inside(bounds: Bounds, point: PointValue): boolean {
  return point.x > bounds.minX && point.x < bounds.maxX && point.y > bounds.minY && point.y < bounds.maxY;
}

function segmentClear(a: PointValue, b: PointValue, obstacles: readonly Obstacle[]): boolean {
  if (a.x !== b.x && a.y !== b.y) return false;
  if (a.x === b.x) {
    const minY = Math.min(a.y, b.y);
    const maxY = Math.max(a.y, b.y);
    return obstacles.every(obstacle =>
      !(a.x > obstacle.minX && a.x < obstacle.maxX && maxY > obstacle.minY && minY < obstacle.maxY)
    );
  }
  const minX = Math.min(a.x, b.x);
  const maxX = Math.max(a.x, b.x);
  return obstacles.every(obstacle =>
    !(a.y > obstacle.minY && a.y < obstacle.maxY && maxX > obstacle.minX && minX < obstacle.maxX)
  );
}

function compact(points: PointValue[]): PointValue[] {
  const deduped = points.filter((point, index) =>
    index === 0 || point.x !== points[index - 1]!.x || point.y !== points[index - 1]!.y
  );
  if (deduped.length <= 2) return deduped;
  const out: PointValue[] = [deduped[0]!];
  for (let index = 1; index < deduped.length - 1; index += 1) {
    const previous = out[out.length - 1]!;
    const current = deduped[index]!;
    const next = deduped[index + 1]!;
    if ((previous.x === current.x && current.x === next.x) || (previous.y === current.y && current.y === next.y)) {
      continue;
    }
    out.push(current);
  }
  out.push(deduped[deduped.length - 1]!);
  return out;
}

function fallbackRoute(start: PointValue, end: PointValue, obstacles: readonly Obstacle[]): PointValue[] {
  const horizontalFirst = compact([start, { x: end.x, y: start.y }, end]);
  const verticalFirst = compact([start, { x: start.x, y: end.y }, end]);
  const score = (route: PointValue[]) => route.slice(1).reduce((total, point, index) =>
    total + (segmentClear(route[index]!, point, obstacles) ? 0 : 1), 0);
  const hScore = score(horizontalFirst);
  const vScore = score(verticalFirst);
  return hScore <= vScore ? horizontalFirst : verticalFirst;
}

function pushHeap(heap: HeapEntry[], entry: HeapEntry): void {
  heap.push(entry);
  let index = heap.length - 1;
  while (index > 0) {
    const parent = (index - 1) >> 1;
    const a = heap[parent]!;
    const b = heap[index]!;
    if (a.cost < b.cost || (a.cost === b.cost && a.key <= b.key)) break;
    heap[parent] = b;
    heap[index] = a;
    index = parent;
  }
}

function popHeap(heap: HeapEntry[]): HeapEntry | undefined {
  const first = heap[0];
  const last = heap.pop();
  if (!first || !last || heap.length === 0) return first;
  heap[0] = last;
  let index = 0;
  while (true) {
    const left = index * 2 + 1;
    const right = left + 1;
    let smallest = index;
    for (const candidate of [left, right]) {
      if (candidate >= heap.length) continue;
      const a = heap[smallest]!;
      const b = heap[candidate]!;
      if (b.cost < a.cost || (b.cost === a.cost && b.key < a.key)) smallest = candidate;
    }
    if (smallest === index) break;
    [heap[index], heap[smallest]] = [heap[smallest]!, heap[index]!];
    index = smallest;
  }
  return first;
}

function nodeKey(point: PointValue): string {
  return `${point.x},${point.y}`;
}

function stateKey(node: string, direction: "n" | "h" | "v"): string {
  return `${node}|${direction}`;
}

/**
 * Computes a deterministic orthogonal route around visible positive-area objects.
 *
 * The search is bounded to the 48 nearest obstacles to the connector midpoint
 * to avoid pathological scene costs. Endpoint objects are excluded because the
 * route intentionally starts/ends on their anchors.
 */
export function routeConnector(
  connector: ConnectorObject,
  objects: ReadonlyMap<string, DrawableObject>,
  options: ConnectorRouteOptions = connector.routing ?? {},
): PointValue[] {
  const fromObject = objects.get(connector.from.objectId);
  const toObject = objects.get(connector.to.objectId);
  if (!fromObject || !toObject) return [];

  const start = anchorPoint(fromObject, connector.from.anchor, objects);
  const end = anchorPoint(toObject, connector.to.anchor, objects);
  const clearance = Number.isFinite(options.clearance)
    ? Math.max(0, options.clearance ?? DEFAULT_CONNECTOR_CLEARANCE)
    : DEFAULT_CONNECTOR_CLEARANCE;
  const bendPenalty = Number.isFinite(options.bendPenalty)
    ? Math.max(0, options.bendPenalty ?? DEFAULT_CONNECTOR_BEND_PENALTY)
    : DEFAULT_CONNECTOR_BEND_PENALTY;

  const midpoint = { x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 };
  const obstacles = [...objects.values()]
    .filter(object =>
      object.id !== connector.id &&
      object.id !== connector.from.objectId &&
      object.id !== connector.to.objectId &&
      object.type !== "connector" &&
      object.type !== "group" &&
      worldVisible(object, objects)
    )
    .map(object => {
      const bounds = worldBounds(object, objects);
      return {
        id: object.id,
        minX: bounds.minX - clearance,
        minY: bounds.minY - clearance,
        maxX: bounds.maxX + clearance,
        maxY: bounds.maxY + clearance,
      };
    })
    .filter(obstacle => obstacle.maxX > obstacle.minX && obstacle.maxY > obstacle.minY)
    .sort((a, b) => {
      const ax = (a.minX + a.maxX) / 2 - midpoint.x;
      const ay = (a.minY + a.maxY) / 2 - midpoint.y;
      const bx = (b.minX + b.maxX) / 2 - midpoint.x;
      const by = (b.minY + b.maxY) / 2 - midpoint.y;
      const da = ax * ax + ay * ay;
      const db = bx * bx + by * by;
      return da - db || a.id.localeCompare(b.id);
    })
    .slice(0, ROUTING_MAX_OBSTACLES);

  if (obstacles.length === 0) return compact([start, { x: end.x, y: start.y }, end]);

  const xs = [...new Set([start.x, end.x, ...obstacles.flatMap(obstacle => [obstacle.minX, obstacle.maxX])])].sort((a, b) => a - b);
  const ys = [...new Set([start.y, end.y, ...obstacles.flatMap(obstacle => [obstacle.minY, obstacle.maxY])])].sort((a, b) => a - b);

  const points = new Map<string, PointValue>();
  for (const y of ys) {
    for (const x of xs) {
      const point = { x, y };
      if (obstacles.some(obstacle => inside(obstacle, point))) continue;
      points.set(nodeKey(point), point);
    }
  }

  const startNode = nodeKey(start);
  const endNode = nodeKey(end);
  points.set(startNode, start);
  points.set(endNode, end);

  const adjacency = new Map<string, Edge[]>();
  const addEdge = (a: PointValue, b: PointValue, direction: "h" | "v") => {
    if (!segmentClear(a, b, obstacles)) return;
    const aKey = nodeKey(a);
    const bKey = nodeKey(b);
    const distance = Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
    if (distance === 0) return;
    const aEdges = adjacency.get(aKey) ?? [];
    const bEdges = adjacency.get(bKey) ?? [];
    aEdges.push({ to: bKey, direction, distance });
    bEdges.push({ to: aKey, direction, distance });
    adjacency.set(aKey, aEdges);
    adjacency.set(bKey, bEdges);
  };

  for (const y of ys) {
    const row = [...points.values()].filter(point => point.y === y).sort((a, b) => a.x - b.x);
    for (let index = 1; index < row.length; index += 1) addEdge(row[index - 1]!, row[index]!, "h");
  }
  for (const x of xs) {
    const column = [...points.values()].filter(point => point.x === x).sort((a, b) => a.y - b.y);
    for (let index = 1; index < column.length; index += 1) addEdge(column[index - 1]!, column[index]!, "v");
  }

  const heap: HeapEntry[] = [];
  const startState = stateKey(startNode, "n");
  const distances = new Map<string, number>([[startState, 0]]);
  const previous = new Map<string, string>();
  pushHeap(heap, { key: startState, cost: 0 });

  let goal: string | undefined;
  while (heap.length > 0) {
    const current = popHeap(heap)!;
    if (current.cost !== distances.get(current.key)) continue;
    const split = current.key.lastIndexOf("|");
    const node = current.key.slice(0, split);
    const incoming = current.key.slice(split + 1) as "n" | "h" | "v";
    if (node === endNode) {
      goal = current.key;
      break;
    }

    const edges = [...(adjacency.get(node) ?? [])].sort((a, b) =>
      a.to.localeCompare(b.to) || a.direction.localeCompare(b.direction)
    );
    for (const edge of edges) {
      const nextState = stateKey(edge.to, edge.direction);
      const nextCost = current.cost + edge.distance + (incoming !== "n" && incoming !== edge.direction ? bendPenalty : 0);
      const known = distances.get(nextState);
      if (known !== undefined && known <= nextCost) continue;
      distances.set(nextState, nextCost);
      previous.set(nextState, current.key);
      pushHeap(heap, { key: nextState, cost: nextCost });
    }
  }

  if (!goal) return fallbackRoute(start, end, obstacles);

  const reversed: PointValue[] = [];
  let cursor: string | undefined = goal;
  while (cursor) {
    const split = cursor.lastIndexOf("|");
    const node = cursor.slice(0, split);
    const point = points.get(node);
    if (point) reversed.push(point);
    cursor = previous.get(cursor);
  }
  reversed.reverse();
  return compact(reversed.length ? reversed : fallbackRoute(start, end, obstacles));
}
