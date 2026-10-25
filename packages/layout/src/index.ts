import { applyMatrix, objectBounds, transformMatrix, type DrawableObject, type SceneDocument } from "@anim8/core";

export type LayoutTarget = SceneDocument | DrawableObject[];
export type LayoutAlignment = "start" | "center" | "end";

export interface RowOptions {
  /** Left edge of the layout, in the objects' local coordinate space. */
  x?: number;
  /** Top edge of the layout, in the objects' local coordinate space. */
  y?: number;
  /** Edge-to-edge spacing between adjacent objects. */
  gap?: number;
  /** Alignment on the vertical (cross) axis. */
  align?: LayoutAlignment;
}

export interface ColumnOptions {
  /** Left edge of the layout, in the objects' local coordinate space. */
  x?: number;
  /** Top edge of the layout, in the objects' local coordinate space. */
  y?: number;
  /** Edge-to-edge spacing between adjacent objects. */
  gap?: number;
  /** Alignment on the horizontal (cross) axis. */
  align?: LayoutAlignment;
}

export interface GridOptions {
  /** Left edge of the grid, in the objects' local coordinate space. */
  x?: number;
  /** Top edge of the grid, in the objects' local coordinate space. */
  y?: number;
  /** Number of columns. Defaults to ceil(sqrt(itemCount)). */
  columns?: number;
  /** Horizontal gap between grid columns. */
  columnGap?: number;
  /** Vertical gap between grid rows. */
  rowGap?: number;
  /** Horizontal alignment within each grid cell. */
  alignX?: LayoutAlignment;
  /** Vertical alignment within each grid cell. */
  alignY?: LayoutAlignment;
}

export interface StackOptions {
  /** Left edge of the stack envelope, in the objects' local coordinate space. */
  x?: number;
  /** Top edge of the stack envelope, in the objects' local coordinate space. */
  y?: number;
  /** Per-item horizontal offset applied in input order. */
  offsetX?: number;
  /** Per-item vertical offset applied in input order. */
  offsetY?: number;
  /** Horizontal alignment within the largest item envelope. */
  alignX?: LayoutAlignment;
  /** Vertical alignment within the largest item envelope. */
  alignY?: LayoutAlignment;
}

export interface RadialOptions {
  /** Ring center. SceneDocument defaults to its scene center; arrays default to 0,0. */
  centerX?: number;
  centerY?: number;
  /** Explicit center-to-item-center radius. Omit to derive a non-overlapping radius. */
  radius?: number;
  /** Minimum adjacent envelope gap used only when radius is derived. */
  gap?: number;
  /** Angle in degrees for the first item. -90 starts at 12 o'clock. */
  startAngle?: number;
  direction?: "clockwise" | "counterclockwise";
}

export type TreeOrientation = "top-bottom" | "bottom-top" | "left-right" | "right-left";

export interface TreeOptions {
  /** Top/left edge of the resulting tree envelope. */
  x?: number;
  y?: number;
  /** Gap between sibling subtrees on the cross axis. */
  siblingGap?: number;
  /** Gap between depth levels. */
  levelGap?: number;
  /** Layout direction. */
  orientation?: TreeOrientation;
  /**
   * Optional root id for a single connected tree. When omitted, all zero-in-
   * degree nodes are laid out as a deterministic forest in object order.
   */
  rootId?: string;
}

interface Size {
  width: number;
  height: number;
}

interface LayoutBounds extends Size {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

interface MeasuredObject {
  object: DrawableObject;
  bounds: LayoutBounds;
  size: Size;
}

const DEFAULT_GAP = 24;

function objectsOf(target: LayoutTarget): DrawableObject[] {
  return Array.isArray(target) ? target : target.objects;
}

function finite(value: number, name: string): number {
  if (!Number.isFinite(value)) {
    throw new RangeError(`${name} must be a finite number.`);
  }
  return value;
}

function option(value: number | undefined, fallback: number, name: string): number {
  return finite(value ?? fallback, name);
}

function clean(value: number): number {
  return Object.is(value, -0) ? 0 : value;
}

/**
 * Axis-aligned visual bounds in the object's local parent space, excluding
 * translation. Core owns intrinsic geometry; layout only applies scale/rotation
 * to those public bounds.
 */
function layoutBounds(object: DrawableObject): LayoutBounds {
  const bounds = objectBounds(object);
  const matrix = transformMatrix({ ...object.transform, x: 0, y: 0 });
  const corners = [
    applyMatrix(matrix, { x: bounds.minX, y: bounds.minY }),
    applyMatrix(matrix, { x: bounds.maxX, y: bounds.minY }),
    applyMatrix(matrix, { x: bounds.maxX, y: bounds.maxY }),
    applyMatrix(matrix, { x: bounds.minX, y: bounds.maxY }),
  ];
  const minX = clean(Math.min(...corners.map(point => point.x)));
  const minY = clean(Math.min(...corners.map(point => point.y)));
  const maxX = clean(Math.max(...corners.map(point => point.x)));
  const maxY = clean(Math.max(...corners.map(point => point.y)));
  return {
    minX,
    minY,
    maxX,
    maxY,
    width: clean(maxX - minX),
    height: clean(maxY - minY),
  };
}

/**
 * Axis-aligned visual size in the object's local parent space.
 *
 * Intrinsic bounds come from @anim8/core, so new core primitives such as
 * ellipse, polygon, and polyline participate without layout-specific shape
 * switches. Translation and opacity do not affect layout size.
 */
export function layoutSize(object: DrawableObject): Size {
  const bounds = layoutBounds(object);
  return { width: bounds.width, height: bounds.height };
}

function measure(objects: DrawableObject[]): MeasuredObject[] {
  return objects.map(object => {
    const bounds = layoutBounds(object);
    return { object, bounds, size: { width: bounds.width, height: bounds.height } };
  });
}

function maxOf(values: readonly number[]): number {
  let max = 0;
  for (const value of values) max = Math.max(max, value);
  return max;
}

function alignedOffset(available: number, occupied: number, alignment: LayoutAlignment): number {
  switch (alignment) {
    case "start":
      return 0;
    case "end":
      return available - occupied;
    case "center":
      return (available - occupied) / 2;
  }
}

function place(item: MeasuredObject, left: number, top: number): void {
  item.object.transform.x = clean(left - item.bounds.minX);
  item.object.transform.y = clean(top - item.bounds.minY);
}

/**
 * Arrange objects left-to-right in their existing array order.
 *
 * This function intentionally mutates only transform.x/transform.y and returns
 * the exact same SceneDocument/array reference. Object references and ids are
 * preserved so existing handles remain valid.
 */
export function row<T extends LayoutTarget>(target: T, options: RowOptions = {}): T {
  const x = option(options.x, 0, "row.x");
  const y = option(options.y, 0, "row.y");
  const gap = option(options.gap, DEFAULT_GAP, "row.gap");
  const alignment = options.align ?? "center";
  const items = measure(objectsOf(target));
  const rowHeight = maxOf(items.map(item => item.size.height));

  let cursor = x;
  for (const item of items) {
    const top = y + alignedOffset(rowHeight, item.size.height, alignment);
    place(item, cursor, top);
    cursor += item.size.width + gap;
  }

  return target;
}

/**
 * Arrange objects top-to-bottom in their existing array order.
 */
export function column<T extends LayoutTarget>(target: T, options: ColumnOptions = {}): T {
  const x = option(options.x, 0, "column.x");
  const y = option(options.y, 0, "column.y");
  const gap = option(options.gap, DEFAULT_GAP, "column.gap");
  const alignment = options.align ?? "center";
  const items = measure(objectsOf(target));
  const columnWidth = maxOf(items.map(item => item.size.width));

  let cursor = y;
  for (const item of items) {
    const left = x + alignedOffset(columnWidth, item.size.width, alignment);
    place(item, left, cursor);
    cursor += item.size.height + gap;
  }

  return target;
}

function resolveColumns(itemCount: number, requested?: number): number {
  if (requested !== undefined) {
    if (!Number.isInteger(requested) || requested <= 0) {
      throw new RangeError("grid.columns must be a positive integer.");
    }
    return requested;
  }
  return itemCount === 0 ? 1 : Math.ceil(Math.sqrt(itemCount));
}

/**
 * Arrange objects in a row-major grid.
 *
 * Each column is as wide as its widest item and each row as tall as its tallest
 * item. That keeps edge gaps exact even when objects have different sizes.
 */
export function grid<T extends LayoutTarget>(target: T, options: GridOptions = {}): T {
  const x = option(options.x, 0, "grid.x");
  const y = option(options.y, 0, "grid.y");
  const columnGap = option(options.columnGap, DEFAULT_GAP, "grid.columnGap");
  const rowGap = option(options.rowGap, DEFAULT_GAP, "grid.rowGap");
  const alignX = options.alignX ?? "center";
  const alignY = options.alignY ?? "center";
  const items = measure(objectsOf(target));
  const columns = resolveColumns(items.length, options.columns);

  if (items.length === 0) return target;

  const rows = Math.ceil(items.length / columns);
  const columnWidths = Array.from({ length: columns }, () => 0);
  const rowHeights = Array.from({ length: rows }, () => 0);

  for (let index = 0; index < items.length; index += 1) {
    const item = items[index]!;
    const columnIndex = index % columns;
    const rowIndex = Math.floor(index / columns);
    columnWidths[columnIndex] = Math.max(columnWidths[columnIndex]!, item.size.width);
    rowHeights[rowIndex] = Math.max(rowHeights[rowIndex]!, item.size.height);
  }

  const columnStarts = Array.from({ length: columns }, () => x);
  for (let columnIndex = 1; columnIndex < columns; columnIndex += 1) {
    columnStarts[columnIndex] = columnStarts[columnIndex - 1]! + columnWidths[columnIndex - 1]! + columnGap;
  }

  const rowStarts = Array.from({ length: rows }, () => y);
  for (let rowIndex = 1; rowIndex < rows; rowIndex += 1) {
    rowStarts[rowIndex] = rowStarts[rowIndex - 1]! + rowHeights[rowIndex - 1]! + rowGap;
  }

  for (let index = 0; index < items.length; index += 1) {
    const item = items[index]!;
    const columnIndex = index % columns;
    const rowIndex = Math.floor(index / columns);
    const cellWidth = columnWidths[columnIndex]!;
    const cellHeight = rowHeights[rowIndex]!;
    const left = columnStarts[columnIndex]! + alignedOffset(cellWidth, item.size.width, alignX);
    const top = rowStarts[rowIndex]! + alignedOffset(cellHeight, item.size.height, alignY);
    place(item, left, top);
  }

  return target;
}

/**
 * Overlay objects inside the largest item envelope.
 *
 * By default every measurable object shares the same visual center. offsetX
 * and offsetY can create deterministic card/deck-style stacks without
 * changing z-order.
 */
export function stack<T extends LayoutTarget>(target: T, options: StackOptions = {}): T {
  const x = option(options.x, 0, "stack.x");
  const y = option(options.y, 0, "stack.y");
  const offsetX = option(options.offsetX, 0, "stack.offsetX");
  const offsetY = option(options.offsetY, 0, "stack.offsetY");
  const alignX = options.alignX ?? "center";
  const alignY = options.alignY ?? "center";
  const items = measure(objectsOf(target));
  const stackWidth = maxOf(items.map(item => item.size.width));
  const stackHeight = maxOf(items.map(item => item.size.height));

  for (let index = 0; index < items.length; index += 1) {
    const item = items[index]!;
    const left = x + alignedOffset(stackWidth, item.size.width, alignX) + index * offsetX;
    const top = y + alignedOffset(stackHeight, item.size.height, alignY) + index * offsetY;
    place(item, left, top);
  }

  return target;
}

function placeCenter(item: MeasuredObject, centerX: number, centerY: number): void {
  const boundsCenterX = (item.bounds.minX + item.bounds.maxX) / 2;
  const boundsCenterY = (item.bounds.minY + item.bounds.maxY) / 2;
  item.object.transform.x = clean(centerX - boundsCenterX);
  item.object.transform.y = clean(centerY - boundsCenterY);
}

function layoutObjects(target: LayoutTarget): DrawableObject[] {
  // Connectors derive their rendered endpoints from referenced objects. Layout
  // algorithms use them as topology where relevant but never reposition them.
  return objectsOf(target).filter(object => object.type !== "connector");
}

function nonNegative(value: number | undefined, fallback: number, name: string): number {
  const result = option(value, fallback, name);
  if (result < 0) throw new RangeError(`${name} must be >= 0.`);
  return result;
}

function radialDefaultRadius(items: readonly MeasuredObject[], gap: number): number {
  if (items.length <= 1) return 0;
  const halfDiagonals = items.map(item => Math.hypot(item.size.width, item.size.height) / 2);
  const sin = Math.sin(Math.PI / items.length);
  let radius = 0;
  for (let index = 0; index < items.length; index += 1) {
    const next = (index + 1) % items.length;
    const requiredChord = halfDiagonals[index]! + halfDiagonals[next]! + gap;
    radius = Math.max(radius, requiredChord / (2 * sin));
  }
  return radius;
}

/**
 * Place non-connector objects at equal angular intervals around a ring.
 *
 * Input order is the angular order and is never rewritten. If radius is
 * omitted, a deterministic radius is derived from adjacent transformed
 * envelope diagonals plus the requested gap.
 */
export function radial<T extends LayoutTarget>(target: T, options: RadialOptions = {}): T {
  const defaultCenterX = Array.isArray(target) ? 0 : target.scene.width / 2;
  const defaultCenterY = Array.isArray(target) ? 0 : target.scene.height / 2;
  const centerX = option(options.centerX, defaultCenterX, "radial.centerX");
  const centerY = option(options.centerY, defaultCenterY, "radial.centerY");
  const gap = nonNegative(options.gap, DEFAULT_GAP, "radial.gap");
  const startAngle = option(options.startAngle, -90, "radial.startAngle");
  const direction = options.direction ?? "clockwise";
  const items = measure(layoutObjects(target));
  const radius = options.radius === undefined
    ? radialDefaultRadius(items, gap)
    : nonNegative(options.radius, 0, "radial.radius");

  if (items.length === 0) return target;

  const step = 360 / items.length * (direction === "clockwise" ? 1 : -1);
  for (let index = 0; index < items.length; index += 1) {
    const angle = (startAngle + step * index) * Math.PI / 180;
    placeCenter(
      items[index]!,
      centerX + radius * Math.cos(angle),
      centerY + radius * Math.sin(angle),
    );
  }
  return target;
}

interface TreeModel {
  items: MeasuredObject[];
  byId: Map<string, MeasuredObject>;
  children: Map<string, string[]>;
  roots: string[];
}

function buildTreeModel(target: LayoutTarget, rootId?: string): TreeModel {
  const source = objectsOf(target);
  const objects = source.filter(object => object.type !== "connector");
  const items = measure(objects);
  const byId = new Map(items.map(item => [item.object.id, item]));
  const order = new Map(objects.map((object, index) => [object.id, index]));
  const parent = new Map<string, string>();
  const childSets = new Map<string, Set<string>>();

  for (const connector of source) {
    if (connector.type !== "connector") continue;
    const from = connector.from.objectId;
    const to = connector.to.objectId;
    if (!byId.has(from) || !byId.has(to)) {
      throw new Error(`tree connector '${connector.id}' references an unknown layout node.`);
    }
    if (from === to) throw new Error(`tree connector '${connector.id}' creates a self-cycle at '${from}'.`);

    const existingParent = parent.get(to);
    if (existingParent !== undefined && existingParent !== from) {
      throw new Error(`tree node '${to}' has multiple parents ('${existingParent}' and '${from}').`);
    }
    parent.set(to, from);
    let children = childSets.get(from);
    if (!children) {
      children = new Set();
      childSets.set(from, children);
    }
    children.add(to);
  }

  const children = new Map<string, string[]>();
  for (const object of objects) {
    const ids = [...(childSets.get(object.id) ?? [])];
    ids.sort((a, b) => order.get(a)! - order.get(b)!);
    children.set(object.id, ids);
  }

  const visitState = new Map<string, 0 | 1 | 2>();
  const visit = (id: string): void => {
    const state = visitState.get(id) ?? 0;
    if (state === 1) throw new Error(`tree contains a cycle involving '${id}'.`);
    if (state === 2) return;
    visitState.set(id, 1);
    for (const child of children.get(id) ?? []) visit(child);
    visitState.set(id, 2);
  };
  for (const object of objects) visit(object.id);

  let roots: string[];
  if (rootId !== undefined) {
    if (!byId.has(rootId)) throw new Error(`tree.rootId '${rootId}' does not exist.`);
    if (parent.has(rootId)) throw new Error(`tree.rootId '${rootId}' has a parent and is not a root.`);
    const included = new Set<string>();
    const collect = (id: string): void => {
      if (included.has(id)) return;
      included.add(id);
      for (const child of children.get(id) ?? []) collect(child);
    };
    collect(rootId);
    if (included.size !== objects.length) {
      throw new Error("tree.rootId requires all layout nodes to belong to that connected tree.");
    }
    roots = [rootId];
  } else {
    roots = objects.filter(object => !parent.has(object.id)).map(object => object.id);
    if (objects.length > 0 && roots.length === 0) throw new Error("tree contains a cycle and has no root.");
  }

  return { items, byId, children, roots };
}

/**
 * Deterministic dependency-free tree/forest layout.
 *
 * Connector objects are read as directed edges (from -> to) but never mutated.
 * Sibling and forest-root order follows the existing object array order.
 *
 * This is intentionally a basic tree algorithm, not a DAG/constraint engine.
 * A future Dagre/ELK adapter should consume/produce node center positions at
 * this same boundary while leaving core objects and connector semantics intact.
 */
export function tree<T extends LayoutTarget>(target: T, options: TreeOptions = {}): T {
  const x = option(options.x, 0, "tree.x");
  const y = option(options.y, 0, "tree.y");
  const siblingGap = nonNegative(options.siblingGap, DEFAULT_GAP, "tree.siblingGap");
  const levelGap = nonNegative(options.levelGap, 48, "tree.levelGap");
  const orientation = options.orientation ?? "top-bottom";
  const horizontal = orientation === "left-right" || orientation === "right-left";
  const model = buildTreeModel(target, options.rootId);

  if (model.items.length === 0) return target;

  const crossSize = (id: string): number => {
    const item = model.byId.get(id)!;
    return horizontal ? item.size.height : item.size.width;
  };
  const depthSize = (id: string): number => {
    const item = model.byId.get(id)!;
    return horizontal ? item.size.width : item.size.height;
  };

  const spanMemo = new Map<string, number>();
  const subtreeSpan = (id: string): number => {
    const cached = spanMemo.get(id);
    if (cached !== undefined) return cached;
    const childIds = model.children.get(id) ?? [];
    const childrenSpan = childIds.length === 0
      ? 0
      : childIds.reduce((sum, child) => sum + subtreeSpan(child), 0) + siblingGap * (childIds.length - 1);
    const span = Math.max(crossSize(id), childrenSpan);
    spanMemo.set(id, span);
    return span;
  };

  const centers = new Map<string, { cross: number; depth: number; level: number }>();
  let maxLevel = 0;
  const assignCross = (id: string, start: number, level: number): void => {
    maxLevel = Math.max(maxLevel, level);
    const span = subtreeSpan(id);
    const childIds = model.children.get(id) ?? [];
    let center = start + span / 2;
    if (childIds.length > 0) {
      const childTotal = childIds.reduce((sum, child) => sum + subtreeSpan(child), 0)
        + siblingGap * (childIds.length - 1);
      let childCursor = start + (span - childTotal) / 2;
      const childCenters: number[] = [];
      for (const child of childIds) {
        const childSpan = subtreeSpan(child);
        assignCross(child, childCursor, level + 1);
        childCenters.push(childCursor + childSpan / 2);
        childCursor += childSpan + siblingGap;
      }
      center = (childCenters[0]! + childCenters[childCenters.length - 1]!) / 2;
    }
    centers.set(id, { cross: center, depth: 0, level });
  };

  let rootCursor = 0;
  for (const root of model.roots) {
    assignCross(root, rootCursor, 0);
    rootCursor += subtreeSpan(root) + siblingGap;
  }

  const levelSizes = Array.from({ length: maxLevel + 1 }, () => 0);
  for (const [id, center] of centers) {
    levelSizes[center.level] = Math.max(levelSizes[center.level]!, depthSize(id));
  }
  const levelStarts = Array.from({ length: maxLevel + 1 }, () => 0);
  for (let level = 1; level <= maxLevel; level += 1) {
    levelStarts[level] = levelStarts[level - 1]! + levelSizes[level - 1]! + levelGap;
  }
  const totalDepth = levelStarts[maxLevel]! + levelSizes[maxLevel]!;

  for (const [id, center] of centers) {
    const item = model.byId.get(id)!;
    const depth = levelStarts[center.level]! + depthSize(id) / 2;
    let centerX: number;
    let centerY: number;
    switch (orientation) {
      case "top-bottom":
        centerX = x + center.cross;
        centerY = y + depth;
        break;
      case "bottom-top":
        centerX = x + center.cross;
        centerY = y + totalDepth - depth;
        break;
      case "left-right":
        centerX = x + depth;
        centerY = y + center.cross;
        break;
      case "right-left":
        centerX = x + totalDepth - depth;
        centerY = y + center.cross;
        break;
    }
    placeCenter(item, centerX, centerY);
  }

  // Keep the input array and connector objects exactly as supplied.
  return target;
}
