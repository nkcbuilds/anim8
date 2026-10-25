import * as dagre from "@dagrejs/dagre";
import {
  applyMatrix,
  objectBounds,
  transformMatrix,
  type DrawableObject,
  type SceneDocument,
} from "@anim8/core";

export type DagreLayoutTarget = SceneDocument | readonly DrawableObject[];
export type DagreDirection = "top-bottom" | "bottom-top" | "left-right" | "right-left";
export type DagreRanker = "network-simplex" | "tight-tree" | "longest-path";
export type DagreAlign = "UL" | "UR" | "DL" | "DR";

export interface DagreLayoutOptions {
  /** Graph direction. Defaults to top-bottom. */
  direction?: DagreDirection;
  /** Separation between adjacent nodes in the same rank. Defaults to Dagre's default. */
  nodeGap?: number;
  /** Separation between ranks. Defaults to Dagre's default. */
  rankGap?: number;
  /** Separation between edges. Defaults to Dagre's default. */
  edgeGap?: number;
  /** Horizontal graph margin. */
  marginX?: number;
  /** Vertical graph margin. */
  marginY?: number;
  /** Dagre ranking algorithm. */
  ranker?: DagreRanker;
  /** Optional Dagre rank alignment. */
  align?: DagreAlign;
}

export interface DagreNodePosition {
  /** Center X in Dagre layout coordinates. */
  x: number;
  /** Center Y in Dagre layout coordinates. */
  y: number;
  /** Measured axis-aligned visual width supplied to Dagre. */
  width: number;
  /** Measured axis-aligned visual height supplied to Dagre. */
  height: number;
}

export interface DagreLayoutResult {
  /** Positions keyed by original Anim8 object id. */
  positions: Readonly<Record<string, DagreNodePosition>>;
  /** Overall Dagre graph width, including configured margins. */
  width: number;
  /** Overall Dagre graph height, including configured margins. */
  height: number;
}

interface MeasuredNode {
  id: string;
  width: number;
  height: number;
}

interface DirectedEdge {
  id: string;
  from: string;
  to: string;
}

const DIRECTION: Record<DagreDirection, "TB" | "BT" | "LR" | "RL"> = {
  "top-bottom": "TB",
  "bottom-top": "BT",
  "left-right": "LR",
  "right-left": "RL",
};

function compareText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function finiteNonNegative(value: number | undefined, name: string): number | undefined {
  if (value === undefined) return undefined;
  if (!Number.isFinite(value) || value < 0) {
    throw new RangeError(`${name} must be a finite number >= 0.`);
  }
  return value;
}

function clean(value: number): number {
  return Object.is(value, -0) ? 0 : value;
}

function objectsOf(target: DagreLayoutTarget): readonly DrawableObject[] {
  return Array.isArray(target) ? target : (target as SceneDocument).objects;
}

/**
 * Measure the same local geometry exported by @anim8/core while respecting
 * scale/rotation. Translation is deliberately removed because Dagre owns the
 * returned center positions.
 */
function visualSize(object: DrawableObject): { width: number; height: number } {
  const bounds = objectBounds(object);
  const matrix = transformMatrix({ ...object.transform, x: 0, y: 0 });
  const corners = [
    applyMatrix(matrix, { x: bounds.minX, y: bounds.minY }),
    applyMatrix(matrix, { x: bounds.maxX, y: bounds.minY }),
    applyMatrix(matrix, { x: bounds.maxX, y: bounds.maxY }),
    applyMatrix(matrix, { x: bounds.minX, y: bounds.maxY }),
  ];
  const xs = corners.map(point => point.x);
  const ys = corners.map(point => point.y);
  const width = clean(Math.max(...xs) - Math.min(...xs));
  const height = clean(Math.max(...ys) - Math.min(...ys));

  if (!Number.isFinite(width) || !Number.isFinite(height) || width < 0 || height < 0) {
    throw new RangeError(`Object '${object.id}' has non-finite layout geometry.`);
  }
  return { width, height };
}

function graphInputs(target: DagreLayoutTarget): { nodes: MeasuredNode[]; edges: DirectedEdge[] } {
  const objects = objectsOf(target);
  const nodeIds = new Set<string>();
  const nodes: MeasuredNode[] = [];
  const connectors: Extract<DrawableObject, { type: "connector" }>[] = [];

  for (const object of objects) {
    if (object.type === "connector") {
      connectors.push(object);
      continue;
    }

    if (nodeIds.has(object.id)) {
      throw new Error(`Duplicate layout node id '${object.id}'.`);
    }
    nodeIds.add(object.id);
    const size = visualSize(object);
    nodes.push({ id: object.id, ...size });
  }

  nodes.sort((a, b) => compareText(a.id, b.id));

  const edges: DirectedEdge[] = connectors.map(connector => {
    const from = connector.from.objectId;
    const to = connector.to.objectId;
    if (!nodeIds.has(from)) {
      throw new Error(`Connector '${connector.id}' references unknown Dagre node '${from}'.`);
    }
    if (!nodeIds.has(to)) {
      throw new Error(`Connector '${connector.id}' references unknown Dagre node '${to}'.`);
    }
    return { id: connector.id, from, to };
  });

  edges.sort((a, b) =>
    compareText(a.from, b.from)
    || compareText(a.to, b.to)
    || compareText(a.id, b.id),
  );

  return { nodes, edges };
}

/**
 * Compute a deterministic directed-graph layout using Dagre.
 *
 * This adapter is intentionally pure with respect to Anim8: it never mutates
 * SceneDocument, DrawableObject, transforms, connector endpoints, ids, or
 * ordering. Consumers explicitly decide whether/how to apply returned centers.
 *
 * For symmetric/tied graphs, node and edge insertion into Dagre is normalized
 * by code-unit id ordering so equivalent inputs do not depend on array order.
 * Dagre itself remains the authority for rank/crossing decisions.
 */
export function layoutDagre(
  target: DagreLayoutTarget,
  options: DagreLayoutOptions = {},
): DagreLayoutResult {
  const { nodes, edges } = graphInputs(target);

  const graph = new dagre.graphlib.Graph({ multigraph: true });
  graph.setDefaultEdgeLabel(() => ({}));

  const graphOptions: Record<string, string | number> = {
    rankdir: DIRECTION[options.direction ?? "top-bottom"],
  };

  const nodeGap = finiteNonNegative(options.nodeGap, "layoutDagre.nodeGap");
  const rankGap = finiteNonNegative(options.rankGap, "layoutDagre.rankGap");
  const edgeGap = finiteNonNegative(options.edgeGap, "layoutDagre.edgeGap");
  const marginX = finiteNonNegative(options.marginX, "layoutDagre.marginX");
  const marginY = finiteNonNegative(options.marginY, "layoutDagre.marginY");

  if (nodeGap !== undefined) graphOptions.nodesep = nodeGap;
  if (rankGap !== undefined) graphOptions.ranksep = rankGap;
  if (edgeGap !== undefined) graphOptions.edgesep = edgeGap;
  if (marginX !== undefined) graphOptions.marginx = marginX;
  if (marginY !== undefined) graphOptions.marginy = marginY;
  if (options.ranker !== undefined) graphOptions.ranker = options.ranker;
  if (options.align !== undefined) graphOptions.align = options.align;

  graph.setGraph(graphOptions);

  for (const node of nodes) {
    graph.setNode(node.id, { width: node.width, height: node.height });
  }
  for (const edge of edges) {
    graph.setEdge(edge.from, edge.to, {}, edge.id);
  }

  dagre.layout(graph);

  const positions: Record<string, DagreNodePosition> = {};
  for (const node of nodes) {
    const laidOut = graph.node(node.id) as { x: number; y: number; width: number; height: number };
    positions[node.id] = {
      x: clean(laidOut.x),
      y: clean(laidOut.y),
      width: clean(laidOut.width),
      height: clean(laidOut.height),
    };
  }

  const graphLabel = graph.graph() as { width?: number; height?: number };
  return {
    positions,
    width: clean(graphLabel.width ?? 0),
    height: clean(graphLabel.height ?? 0),
  };
}
