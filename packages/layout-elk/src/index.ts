import ELK, {
  type ElkEdgeSection,
  type ElkExtendedEdge,
  type ElkNode,
  type ElkPoint,
} from "elkjs/lib/elk.bundled.js";
import {
  applyMatrix,
  objectBounds,
  transformMatrix,
  type DrawableObject,
  type SceneDocument,
} from "@anim8/core";

export type ElkLayoutTarget = SceneDocument | readonly DrawableObject[];
export type ElkDirection = "top-bottom" | "bottom-top" | "left-right" | "right-left";

export interface ElkLayoutOptions {
  /** Directed layout flow. Defaults to top-bottom. */
  direction?: ElkDirection;
  /** Gap between nodes in the same layer. Defaults to 40. */
  nodeGap?: number;
  /** Gap between adjacent directed layers. Defaults to 70. */
  layerGap?: number;
  /** Minimum edge-to-node spacing. Defaults to 18. */
  edgeGap?: number;
  /** Uniform outer graph padding. Defaults to 20. */
  padding?: number;
}

export interface ElkNodePosition {
  /** Center X in ELK graph coordinates. */
  x: number;
  /** Center Y in ELK graph coordinates. */
  y: number;
  /** Axis-aligned visual width supplied to ELK. */
  width: number;
  /** Axis-aligned visual height supplied to ELK. */
  height: number;
}

export interface ElkRouteSection {
  /** Stable section id returned by ELK. */
  id: string;
  /** Start, bend, and end points in ELK graph coordinates. */
  points: readonly ElkPoint[];
}

export interface ElkEdgeRoute {
  /** Original Anim8 connector id. */
  id: string;
  /** Directed source Anim8 object id. */
  from: string;
  /** Directed target Anim8 object id. */
  to: string;
  /** One or more ELK route sections in deterministic order. */
  sections: readonly ElkRouteSection[];
}

export interface ElkLayoutResult {
  /** Node-center positions keyed by original Anim8 object id. */
  positions: Readonly<Record<string, ElkNodePosition>>;
  /** Connector routes keyed by original connector id. */
  routes: Readonly<Record<string, ElkEdgeRoute>>;
  /** Overall graph width including configured padding. */
  width: number;
  /** Overall graph height including configured padding. */
  height: number;
}

export const ELK_LAYOUT_LIMITS = Object.freeze({
  nodes: 2_000,
  edges: 5_000,
  idLength: 128,
  dimension: 100_000,
  gap: 10_000,
  padding: 10_000,
});

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

const DIRECTION: Record<ElkDirection, "DOWN" | "UP" | "RIGHT" | "LEFT"> = {
  "top-bottom": "DOWN",
  "bottom-top": "UP",
  "left-right": "RIGHT",
  "right-left": "LEFT",
};

function compareText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function clean(value: number, label: string): number {
  if (!Number.isFinite(value)) {
    throw new RangeError(label + " returned a non-finite coordinate.");
  }
  return Object.is(value, -0) ? 0 : value;
}

function boundedOption(
  value: number | undefined,
  fallback: number,
  maximum: number,
  label: string,
): number {
  const resolved = value ?? fallback;
  if (!Number.isFinite(resolved) || resolved < 0 || resolved > maximum) {
    throw new RangeError(label + " must be a finite number between 0 and " + maximum + ".");
  }
  return resolved;
}

function assertId(id: string, kind: string): void {
  if (typeof id !== "string" || id.length === 0 || id.length > ELK_LAYOUT_LIMITS.idLength) {
    throw new RangeError(
      kind + " id must be a non-empty string of at most " + ELK_LAYOUT_LIMITS.idLength + " characters.",
    );
  }
}

function objectsOf(target: ElkLayoutTarget): readonly DrawableObject[] {
  return Array.isArray(target) ? target : (target as SceneDocument).objects;
}

/**
 * Measure core geometry with scale/rotation applied. Translation is removed
 * because ELK owns the returned positions.
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
  const width = Math.max(...xs) - Math.min(...xs);
  const height = Math.max(...ys) - Math.min(...ys);

  for (const [label, value] of [["width", width], ["height", height]] as const) {
    if (
      !Number.isFinite(value)
      || value < 0
      || value > ELK_LAYOUT_LIMITS.dimension
    ) {
      throw new RangeError(
        "Object '" + object.id + "' layout " + label
          + " must be finite and between 0 and " + ELK_LAYOUT_LIMITS.dimension + ".",
      );
    }
  }

  return {
    width: Object.is(width, -0) ? 0 : width,
    height: Object.is(height, -0) ? 0 : height,
  };
}

function graphInputs(target: ElkLayoutTarget): {
  nodes: MeasuredNode[];
  edges: DirectedEdge[];
} {
  const objects = objectsOf(target);
  const nodes: MeasuredNode[] = [];
  const connectors: Extract<DrawableObject, { type: "connector" }>[] = [];
  const nodeIds = new Set<string>();
  const edgeIds = new Set<string>();

  for (const object of objects) {
    if (object.type === "connector") {
      assertId(object.id, "Connector");
      if (edgeIds.has(object.id)) {
        throw new Error("Duplicate layout connector id '" + object.id + "'.");
      }
      edgeIds.add(object.id);
      connectors.push(object);
      continue;
    }

    assertId(object.id, "Node");
    if (nodeIds.has(object.id)) {
      throw new Error("Duplicate layout node id '" + object.id + "'.");
    }
    nodeIds.add(object.id);
    nodes.push({ id: object.id, ...visualSize(object) });
  }

  if (nodes.length > ELK_LAYOUT_LIMITS.nodes) {
    throw new RangeError(
      "layoutElk supports at most " + ELK_LAYOUT_LIMITS.nodes + " nodes; received " + nodes.length + ".",
    );
  }
  if (connectors.length > ELK_LAYOUT_LIMITS.edges) {
    throw new RangeError(
      "layoutElk supports at most " + ELK_LAYOUT_LIMITS.edges
        + " connectors; received " + connectors.length + ".",
    );
  }

  nodes.sort((a, b) => compareText(a.id, b.id));

  const edges = connectors.map(connector => {
    const from = connector.from.objectId;
    const to = connector.to.objectId;
    if (!nodeIds.has(from)) {
      throw new Error("Connector '" + connector.id + "' references unknown ELK node '" + from + "'.");
    }
    if (!nodeIds.has(to)) {
      throw new Error("Connector '" + connector.id + "' references unknown ELK node '" + to + "'.");
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

function cleanPoint(value: ElkPoint, label: string): ElkPoint {
  return {
    x: clean(value.x, label + ".x"),
    y: clean(value.y, label + ".y"),
  };
}

function routeSections(edge: ElkExtendedEdge): ElkRouteSection[] {
  const sections = [...(edge.sections ?? [])];
  sections.sort((a, b) => compareText(a.id, b.id));

  return sections.map((section: ElkEdgeSection, index) => ({
    id: section.id || edge.id + ":section:" + index,
    points: [
      cleanPoint(section.startPoint, "Edge '" + edge.id + "' section '" + section.id + "' start"),
      ...(section.bendPoints ?? []).map((bend, bendIndex) =>
        cleanPoint(
          bend,
          "Edge '" + edge.id + "' section '" + section.id + "' bend " + bendIndex,
        )),
      cleanPoint(section.endPoint, "Edge '" + edge.id + "' section '" + section.id + "' end"),
    ],
  }));
}

/**
 * Compute a deterministic layered directed-graph layout using ELK.
 *
 * The adapter is pure with respect to Anim8. It reads geometry and connector
 * topology, then returns positions/routes; it never mutates SceneDocument,
 * DrawableObject, transforms, ids, connector endpoints, or input ordering.
 *
 * Nodes and edges are normalized by code-unit id ordering before ELK sees
 * them. A fixed ELK random seed plus model-order consideration removes
 * process-time randomness while keeping equivalent shuffled inputs stable.
 */
export async function layoutElk(
  target: ElkLayoutTarget,
  options: ElkLayoutOptions = {},
): Promise<ElkLayoutResult> {
  const { nodes, edges } = graphInputs(target);

  const nodeGap = boundedOption(
    options.nodeGap,
    40,
    ELK_LAYOUT_LIMITS.gap,
    "layoutElk.nodeGap",
  );
  const layerGap = boundedOption(
    options.layerGap,
    70,
    ELK_LAYOUT_LIMITS.gap,
    "layoutElk.layerGap",
  );
  const edgeGap = boundedOption(
    options.edgeGap,
    18,
    ELK_LAYOUT_LIMITS.gap,
    "layoutElk.edgeGap",
  );
  const padding = boundedOption(
    options.padding,
    20,
    ELK_LAYOUT_LIMITS.padding,
    "layoutElk.padding",
  );

  const graph: ElkNode = {
    id: "anim8-root",
    layoutOptions: {
      "elk.algorithm": "layered",
      "elk.direction": DIRECTION[options.direction ?? "top-bottom"],
      "elk.spacing.nodeNode": String(nodeGap),
      "elk.layered.spacing.nodeNodeBetweenLayers": String(layerGap),
      "elk.spacing.edgeNode": String(edgeGap),
      "elk.padding": "[top=" + padding + ",left=" + padding
        + ",bottom=" + padding + ",right=" + padding + "]",
      "elk.randomSeed": "1",
      "elk.layered.considerModelOrder.strategy": "NODES_AND_EDGES",
    },
    children: nodes.map(node => ({
      id: node.id,
      width: node.width,
      height: node.height,
    })),
    edges: edges.map(edge => ({
      id: edge.id,
      sources: [edge.from],
      targets: [edge.to],
    })),
  };

  // elk.bundled.js uses an in-process worker shim in Node. In elkjs 0.12
  // that shim exposes the public terminateWorker() method but its underlying
  // object has no terminate() implementation, so there is no real worker to
  // tear down here.
  const elk = new ELK();
  const laidOut = await elk.layout(graph);
  const outputNodes = new Map((laidOut.children ?? []).map(node => [node.id, node]));
  const outputEdges = new Map((laidOut.edges ?? []).map(edge => [edge.id, edge]));

  const positions: Record<string, ElkNodePosition> = {};
  for (const node of nodes) {
    const output = outputNodes.get(node.id);
    if (!output) throw new Error("ELK omitted layout node '" + node.id + "'.");
    const x = clean(output.x ?? 0, "Node '" + node.id + "'.x");
    const y = clean(output.y ?? 0, "Node '" + node.id + "'.y");
    const width = clean(output.width ?? node.width, "Node '" + node.id + "'.width");
    const height = clean(output.height ?? node.height, "Node '" + node.id + "'.height");
    positions[node.id] = {
      x: clean(x + width / 2, "Node '" + node.id + "'.centerX"),
      y: clean(y + height / 2, "Node '" + node.id + "'.centerY"),
      width,
      height,
    };
  }

  const routes: Record<string, ElkEdgeRoute> = {};
  for (const edge of edges) {
    const output = outputEdges.get(edge.id);
    if (!output) throw new Error("ELK omitted connector '" + edge.id + "'.");
    routes[edge.id] = {
      id: edge.id,
      from: edge.from,
      to: edge.to,
      sections: routeSections(output),
    };
  }

  return {
    positions,
    routes,
    width: clean(laidOut.width ?? 0, "ELK graph width"),
    height: clean(laidOut.height ?? 0, "ELK graph height"),
  };
}
