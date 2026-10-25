import { defaultCamera } from "./defaults.js";
import { ease, lerp, lerpColor } from "./easing.js";
import { quadraticPoint } from "./geometry.js";
import { canonicalMorphPathToString, interpolateMorphPath, morphPathCompatibility, parseMorphPathData } from "./path-morph.js";
import { evaluateExpression } from "./expression.js";
import type { Action, Binding, CameraAction, CameraState, DrawableObject, EvaluatedScene, EvaluationContext, PointValue, SceneDocument, ScalarValue } from "./types.js";

const clone = <T>(value: T): T => structuredClone(value);
type ObjectAction = Exclude<Action, CameraAction>;

export function sceneDuration(scene: SceneDocument): number {
  return scene.timeline.reduce((max, action) => Math.max(max, action.start + action.duration), 0);
}

function pointAlongPolyline(points: readonly PointValue[], progress: number): PointValue | null {
  if (points.length < 2) return points[0] ? { ...points[0] } : null;

  const lengths: number[] = [];
  let totalLength = 0;
  for (let index = 1; index < points.length; index += 1) {
    const from = points[index - 1]!;
    const to = points[index]!;
    const length = Math.hypot(to.x - from.x, to.y - from.y);
    lengths.push(length);
    totalLength += length;
  }

  if (!(totalLength > 0) || !Number.isFinite(totalLength)) return { ...points[0]! };

  const distance = Math.max(0, Math.min(1, progress)) * totalLength;
  let traversed = 0;
  for (let index = 0; index < lengths.length; index += 1) {
    const length = lengths[index]!;
    if (length === 0) continue;
    const end = traversed + length;
    if (distance <= end || index === lengths.length - 1) {
      const from = points[index]!;
      const to = points[index + 1]!;
      const segmentProgress = Math.max(0, Math.min(1, (distance - traversed) / length));
      return {
        x: lerp(from.x, to.x, segmentProgress),
        y: lerp(from.y, to.y, segmentProgress),
      };
    }
    traversed = end;
  }

  return { ...points[points.length - 1]! };
}

function applyAction(state: Map<string, DrawableObject>, action: ObjectAction, time: number): void {
  const target = state.get(action.target);
  if (!target) return;

  if (action.type === "visibility") {
    if (time >= action.start) target.visible = action.visible;
    return;
  }

  const progress = action.duration === 0
    ? (time >= action.start ? 1 : 0)
    : ease(action.easing, (time - action.start) / action.duration);

  if (action.type === "followPath") {
    const point = pointAlongPolyline(action.points, progress);
    if (point) {
      target.transform.x = point.x;
      target.transform.y = point.y;
    }
    return;
  }

  if (progress <= 0) return;

  switch (action.type) {
    case "move": {
      const from = { x: target.transform.x, y: target.transform.y };
      if (action.path && action.path !== "linear") {
        const sign = action.path === "arc-down" ? -1 : 1;
        const p = quadraticPoint(from, action.to, progress, sign * (action.arcHeight ?? 60));
        target.transform.x = p.x;
        target.transform.y = p.y;
      } else {
        target.transform.x = lerp(from.x, action.to.x, progress);
        target.transform.y = lerp(from.y, action.to.y, progress);
      }
      break;
    }
    case "rotate":
      target.transform.rotation = lerp(target.transform.rotation, action.to, progress);
      break;
    case "scale":
      target.transform.scaleX = lerp(target.transform.scaleX, action.to.x, progress);
      target.transform.scaleY = lerp(target.transform.scaleY, action.to.y, progress);
      break;
    case "opacity":
      target.transform.opacity = lerp(target.transform.opacity, action.to, progress);
      break;
    case "fill":
      target.style.fill = lerpColor(target.style.fill ?? "#ffffff", action.to, progress);
      break;
    case "stroke":
      target.style.stroke = lerpColor(target.style.stroke ?? "#1f2937", action.to, progress);
      break;
    case "resize":
      switch (target.type) {
        case "rect":
        case "image":
          target.width = lerp(target.width, action.to.width, progress);
          target.height = lerp(target.height, action.to.height, progress);
          break;
        case "ellipse":
          target.rx = lerp(target.rx, action.to.width / 2, progress);
          target.ry = lerp(target.ry, action.to.height / 2, progress);
          break;
        case "circle":
          if (action.to.width === action.to.height) {
            target.radius = lerp(target.radius, action.to.width / 2, progress);
          }
          break;
      }
      break;
    case "draw":
      if (target.type === "path" || target.type === "polygon" || target.type === "polyline") {
        target.drawProgress = lerp(target.drawProgress ?? 1, action.to, progress);
      }
      break;
    case "morph":
      if (target.type === "path") {
        const from = parseMorphPathData(target.d);
        const to = parseMorphPathData(action.to);
        if (from.ok && to.ok && morphPathCompatibility(from.path, to.path).ok) {
          const interpolated = interpolateMorphPath(from.path, to.path, progress);
          if (interpolated) target.d = canonicalMorphPathToString(interpolated);
        }
      }
      break;
  }
}

function applyCameraAction(camera: CameraState, action: CameraAction, time: number): void {
  const progress = action.duration === 0
    ? (time >= action.start ? 1 : 0)
    : ease(action.easing, (time - action.start) / action.duration);
  if (progress <= 0) return;

  if (action.to.x !== undefined) camera.x = lerp(camera.x, action.to.x, progress);
  if (action.to.y !== undefined) camera.y = lerp(camera.y, action.to.y, progress);
  if (action.to.zoom !== undefined) {
    camera.zoom = Math.max(Number.EPSILON, lerp(camera.zoom, action.to.zoom, progress));
  }
}

function applyBinding(state: Map<string, DrawableObject>, binding: Binding, time: number, duration: number, context: EvaluationContext, baseState: Record<string, ScalarValue>): void {
  const target = state.get(binding.target.objectId);
  if (!target) return;
  const result = evaluateExpression(binding.expression, {
    time,
    progress: duration === 0 ? 1 : time / duration,
    ...(context.inputs ? { inputs: context.inputs } : {}),
    state: { ...baseState, ...(context.state ?? {}) },
  });
  if (!result.ok) return;
  const value = result.value;
  const property = binding.target.property;
  if (["x","y","rotation","scaleX","scaleY","opacity"].includes(property) && typeof value === "number") {
    target.transform[property as "x"|"y"|"rotation"|"scaleX"|"scaleY"|"opacity"] = value;
    return;
  }
  if ((property === "fill" || property === "stroke") && typeof value === "string") {
    target.style[property] = value;
    return;
  }
  if (property === "text" && typeof value === "string" && (target.type === "rect" || target.type === "circle" || target.type === "ellipse" || target.type === "text")) {
    target.text = value;
  }
}

export function evaluate(scene: SceneDocument, time: number, context: EvaluationContext = {}): EvaluatedScene {
  const duration = sceneDuration(scene);
  const clamped = Math.max(0, Math.min(time, duration));
  const state = new Map(scene.objects.map(object => [object.id, clone(object)]));
  const camera = clone(scene.scene.camera ?? defaultCamera());
  const actions = [...scene.timeline].sort((a, b) => a.start - b.start || a.id.localeCompare(b.id));

  for (const action of actions) {
    if (clamped < action.start) continue;
    const actionTime = Math.min(clamped, action.start + action.duration);
    if (action.type === "camera") applyCameraAction(camera, action, actionTime);
    else applyAction(state, action, actionTime);
  }

  for (const binding of scene.bindings ?? []) applyBinding(state, binding, clamped, duration, context, scene.state ?? {});

  return {
    version: scene.version,
    scene: clone(scene.scene),
    camera,
    objects: scene.objects.map(object => state.get(object.id) ?? clone(object)),
    time: clamped,
    duration,
  };
}
