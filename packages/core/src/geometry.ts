import type { AnchorName, DrawableObject, PointValue, Transform } from "./types.js";

export type Point = PointValue;
export interface Bounds { minX: number; minY: number; maxX: number; maxY: number }
export interface Matrix { a: number; b: number; c: number; d: number; e: number; f: number }

export const identityMatrix = (): Matrix => ({ a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 });

export function multiply(a: Matrix, b: Matrix): Matrix {
  return {
    a: a.a * b.a + a.c * b.b,
    b: a.b * b.a + a.d * b.b,
    c: a.a * b.c + a.c * b.d,
    d: a.b * b.c + a.d * b.d,
    e: a.a * b.e + a.c * b.f + a.e,
    f: a.b * b.e + a.d * b.f + a.f,
  };
}

export function transformMatrix(t: Transform): Matrix {
  const radians = t.rotation * Math.PI / 180;
  const cos = Math.cos(radians), sin = Math.sin(radians);
  return {
    a: cos * t.scaleX,
    b: sin * t.scaleX,
    c: -sin * t.scaleY,
    d: cos * t.scaleY,
    e: t.x,
    f: t.y,
  };
}

export function applyMatrix(matrix: Matrix, point: Point): Point {
  return { x: matrix.a * point.x + matrix.c * point.y + matrix.e, y: matrix.b * point.x + matrix.d * point.y + matrix.f };
}

export function invertMatrix(matrix: Matrix): Matrix | null {
  const determinant = matrix.a * matrix.d - matrix.b * matrix.c;
  if (!Number.isFinite(determinant) || Math.abs(determinant) < 1e-12) return null;
  const inv = 1 / determinant;
  return {
    a: matrix.d * inv,
    b: -matrix.b * inv,
    c: -matrix.c * inv,
    d: matrix.a * inv,
    e: (matrix.c * matrix.f - matrix.d * matrix.e) * inv,
    f: (matrix.b * matrix.e - matrix.a * matrix.f) * inv,
  };
}

/**
 * Decompose the translation/rotation/scale portion of a 2D affine matrix.
 *
 * Anim8 transforms intentionally have no skew field. Matrices produced by
 * normal Anim8 parent chains with uniform/compatible scaling round-trip
 * exactly; skew introduced by rotated non-uniform parent scales is reduced to
 * the closest representable rotation/scale transform.
 */
export function decomposeMatrix(matrix: Matrix): Transform {
  const scaleX = Math.hypot(matrix.a, matrix.b);
  const safeScaleX = scaleX > 1e-12 ? scaleX : 0;
  const determinant = matrix.a * matrix.d - matrix.b * matrix.c;
  const scaleY = safeScaleX > 0 ? determinant / safeScaleX : Math.hypot(matrix.c, matrix.d);
  const rotation = safeScaleX > 0 ? Math.atan2(matrix.b, matrix.a) * 180 / Math.PI : 0;
  return {
    x: matrix.e,
    y: matrix.f,
    rotation,
    scaleX: safeScaleX,
    scaleY,
    opacity: 1,
  };
}

export function objectBounds(object: DrawableObject): Bounds {
  switch (object.type) {
    case "rect":
    case "image":
      return { minX: -object.width / 2, minY: -object.height / 2, maxX: object.width / 2, maxY: object.height / 2 };
    case "circle":
      return { minX: -object.radius, minY: -object.radius, maxX: object.radius, maxY: object.radius };
    case "ellipse":
      return { minX: -object.rx, minY: -object.ry, maxX: object.rx, maxY: object.ry };
    case "polygon":
    case "polyline": {
      if (object.points.length === 0) return { minX: 0, minY: 0, maxX: 0, maxY: 0 };
      let minX = object.points[0]!.x;
      let minY = object.points[0]!.y;
      let maxX = minX;
      let maxY = minY;
      for (let index = 1; index < object.points.length; index += 1) {
        const point = object.points[index]!;
        minX = Math.min(minX, point.x);
        minY = Math.min(minY, point.y);
        maxX = Math.max(maxX, point.x);
        maxY = Math.max(maxY, point.y);
      }
      return { minX, minY, maxX, maxY };
    }
    default:
      return { minX: 0, minY: 0, maxX: 0, maxY: 0 };
  }
}

export function objectSize(object: DrawableObject): { width: number; height: number } {
  const bounds = objectBounds(object);
  return { width: bounds.maxX - bounds.minX, height: bounds.maxY - bounds.minY };
}

export function localAnchorPoint(object: DrawableObject, anchor: AnchorName = "center"): Point {
  const bounds = objectBounds(object);
  const centerX = (bounds.minX + bounds.maxX) / 2;
  const centerY = (bounds.minY + bounds.maxY) / 2;
  switch (anchor) {
    case "top": return { x: centerX, y: bounds.minY };
    case "bottom": return { x: centerX, y: bounds.maxY };
    case "left": return { x: bounds.minX, y: centerY };
    case "right": return { x: bounds.maxX, y: centerY };
    default: return { x: centerX, y: centerY };
  }
}

export function worldMatrix(object: DrawableObject, objects: ReadonlyMap<string, DrawableObject>): Matrix {
  const seen = new Set<string>();
  let matrix = transformMatrix(object.transform);
  let current: DrawableObject | undefined = object;
  while (current.parentId) {
    if (seen.has(current.parentId)) throw new Error(`Parent cycle detected at '${current.parentId}'.`);
    seen.add(current.parentId);
    const parent = objects.get(current.parentId);
    if (!parent) break;
    matrix = multiply(transformMatrix(parent.transform), matrix);
    current = parent;
  }
  return matrix;
}

export function worldOpacity(object: DrawableObject, objects: ReadonlyMap<string, DrawableObject>): number {
  let opacity = object.transform.opacity;
  const seen = new Set<string>();
  let current: DrawableObject | undefined = object;
  while (current.parentId) {
    if (seen.has(current.parentId)) return opacity;
    seen.add(current.parentId);
    const parent = objects.get(current.parentId);
    if (!parent) break;
    opacity *= parent.transform.opacity;
    current = parent;
  }
  return opacity;
}

export function worldVisible(object: DrawableObject, objects: ReadonlyMap<string, DrawableObject>): boolean {
  if (!object.visible) return false;
  const seen = new Set<string>();
  let current: DrawableObject | undefined = object;
  while (current.parentId) {
    if (seen.has(current.parentId)) return false;
    seen.add(current.parentId);
    const parent = objects.get(current.parentId);
    if (!parent) break;
    if (!parent.visible) return false;
    current = parent;
  }
  return true;
}

export function anchorPoint(object: DrawableObject, anchor: AnchorName = "center", objects?: ReadonlyMap<string, DrawableObject>): Point {
  const local = localAnchorPoint(object, anchor);
  return applyMatrix(objects ? worldMatrix(object, objects) : transformMatrix(object.transform), local);
}

export function quadraticPoint(from: Point, to: Point, t: number, height: number): Point {
  const cx = (from.x + to.x) / 2;
  const cy = (from.y + to.y) / 2 - height;
  const omt = 1 - t;
  return {
    x: omt * omt * from.x + 2 * omt * t * cx + t * t * to.x,
    y: omt * omt * from.y + 2 * omt * t * cy + t * t * to.y,
  };
}
