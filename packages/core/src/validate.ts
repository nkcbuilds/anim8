import type { Action, SceneDocument } from "./types.js";

export interface Diagnostic {
  code: string;
  path: string;
  message: string;
  suggestion?: string;
}

const props = (action: Action): string[] => {
  switch (action.type) {
    case "move": return ["x", "y"];
    case "followPath": return ["x", "y"];
    case "rotate": return ["rotation"];
    case "scale": return ["scaleX", "scaleY"];
    case "opacity": return ["opacity"];
    case "fill": return ["fill"];
    case "stroke": return ["stroke"];
    case "resize": return ["width", "height"];
    case "draw": return ["drawProgress"];
    case "visibility": return ["visible"];
    case "camera": return [
      ...(action.to.x !== undefined ? ["camera.x"] : []),
      ...(action.to.y !== undefined ? ["camera.y"] : []),
      ...(action.to.zoom !== undefined ? ["camera.zoom"] : []),
    ];
  }
};

export function validateScene(scene: SceneDocument): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];

  if (scene.scene.camera) {
    const { x, y, zoom } = scene.scene.camera;
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(zoom) || zoom <= 0) {
      diagnostics.push({
        code: "INVALID_CAMERA",
        path: "scene.camera",
        message: "camera x/y must be finite numbers and zoom must be a finite number > 0.",
      });
    }
  }

  const ids = new Set<string>();
  const objectById = new Map<string, SceneDocument["objects"][number]>();
  scene.objects.forEach((object, index) => {
    if (ids.has(object.id)) diagnostics.push({ code: "DUPLICATE_ID", path: `objects[${index}].id`, message: `Object '${object.id}' is duplicated.` });
    ids.add(object.id);
    objectById.set(object.id, object);

    if (object.type === "ellipse" && (
      !Number.isFinite(object.rx) || object.rx < 0 ||
      !Number.isFinite(object.ry) || object.ry < 0
    )) diagnostics.push({
      code: "INVALID_GEOMETRY",
      path: `objects[${index}]`,
      message: "Ellipse rx and ry must be finite numbers >= 0.",
    });

    if (object.type === "polygon" || object.type === "polyline") {
      const minimum = object.type === "polygon" ? 3 : 2;
      if (object.points.length < minimum) diagnostics.push({
        code: "INVALID_POINTS",
        path: `objects[${index}].points`,
        message: `${object.type} requires at least ${minimum} points.`,
      });
      object.points.forEach((point, pointIndex) => {
        if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) diagnostics.push({
          code: "INVALID_POINT",
          path: `objects[${index}].points[${pointIndex}]`,
          message: "Point coordinates must be finite numbers.",
        });
      });
    }

    if ((object.type === "path" || object.type === "polygon" || object.type === "polyline") &&
        object.drawProgress !== undefined &&
        (!Number.isFinite(object.drawProgress) || object.drawProgress < 0 || object.drawProgress > 1)) {
      diagnostics.push({
        code: "INVALID_DRAW_PROGRESS",
        path: `objects[${index}].drawProgress`,
        message: "drawProgress must be a finite number between 0 and 1.",
      });
    }
  });

  scene.timeline.forEach((action, index) => {
    if (!Number.isFinite(action.start) || action.start < 0) diagnostics.push({ code: "INVALID_TIME", path: `timeline[${index}].start`, message: "start must be a finite number >= 0." });
    if (!Number.isFinite(action.duration) || action.duration < 0) diagnostics.push({ code: "INVALID_DURATION", path: `timeline[${index}].duration`, message: "duration must be a finite number >= 0." });

    if (action.type === "camera") {
      const keys = [action.to.x, action.to.y, action.to.zoom];
      if (keys.every(value => value === undefined)) {
        diagnostics.push({
          code: "INVALID_CAMERA_ACTION",
          path: `timeline[${index}].to`,
          message: "camera.to must set at least one of x, y, or zoom.",
        });
      }
      if ((action.to.x !== undefined && !Number.isFinite(action.to.x)) ||
          (action.to.y !== undefined && !Number.isFinite(action.to.y)) ||
          (action.to.zoom !== undefined && (!Number.isFinite(action.to.zoom) || action.to.zoom <= 0))) {
        diagnostics.push({
          code: "INVALID_CAMERA_ACTION",
          path: `timeline[${index}].to`,
          message: "camera x/y must be finite numbers and zoom must be a finite number > 0.",
        });
      }
      return;
    }

    if (!ids.has(action.target)) diagnostics.push({
      code: "UNKNOWN_OBJECT",
      path: `timeline[${index}].target`,
      message: `Object '${action.target}' does not exist.`,
      suggestion: ids.size ? `Use one of: ${[...ids].slice(0, 8).join(", ")}` : "Create the object before targeting it.",
    });

    const target = objectById.get(action.target);

    if (action.type === "followPath") {
      if (action.points.length < 2) {
        diagnostics.push({
          code: "INVALID_FOLLOW_PATH",
          path: `timeline[${index}].points`,
          message: "followPath requires at least 2 explicit polyline points.",
        });
      }

      let hasInvalidPoint = false;
      let totalLength = 0;
      action.points.forEach((point, pointIndex) => {
        if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) {
          hasInvalidPoint = true;
          diagnostics.push({
            code: "INVALID_FOLLOW_PATH_POINT",
            path: `timeline[${index}].points[${pointIndex}]`,
            message: "followPath point coordinates must be finite numbers.",
          });
          return;
        }
        if (pointIndex > 0) {
          const previous = action.points[pointIndex - 1]!;
          if (Number.isFinite(previous.x) && Number.isFinite(previous.y)) {
            totalLength += Math.hypot(point.x - previous.x, point.y - previous.y);
          }
        }
      });
      if (!hasInvalidPoint && action.points.length >= 2 && totalLength === 0) {
        diagnostics.push({
          code: "INVALID_FOLLOW_PATH",
          path: `timeline[${index}].points`,
          message: "followPath must contain at least one non-zero-length segment.",
        });
      }
    }

    if (action.type === "resize") {
      if (!Number.isFinite(action.to.width) || action.to.width < 0 || !Number.isFinite(action.to.height) || action.to.height < 0) {
        diagnostics.push({
          code: "INVALID_RESIZE",
          path: `timeline[${index}].to`,
          message: "Resize width and height must be finite numbers >= 0.",
        });
      }
      if (target && target.type !== "rect" && target.type !== "image" && target.type !== "ellipse" && target.type !== "circle") {
        diagnostics.push({
          code: "UNSUPPORTED_RESIZE_TARGET",
          path: `timeline[${index}].target`,
          message: `Object '${target.id}' of type '${target.type}' cannot be resized geometrically.`,
          suggestion: "Use scale for drawable types without intrinsic width/height geometry.",
        });
      }
      if (target?.type === "circle" && action.to.width !== action.to.height) {
        diagnostics.push({
          code: "INVALID_CIRCLE_RESIZE",
          path: `timeline[${index}].to`,
          message: "Circle resize requires equal width and height.",
          suggestion: "Use an ellipse when width and height need to differ.",
        });
      }
    }

    if (action.type === "draw") {
      if (!Number.isFinite(action.to) || action.to < 0 || action.to > 1) {
        diagnostics.push({
          code: "INVALID_DRAW_PROGRESS",
          path: `timeline[${index}].to`,
          message: "Draw target must be a finite number between 0 and 1.",
        });
      }
      if (target && target.type !== "path" && target.type !== "polygon" && target.type !== "polyline") {
        diagnostics.push({
          code: "UNSUPPORTED_DRAW_TARGET",
          path: `timeline[${index}].target`,
          message: `Object '${target.id}' of type '${target.type}' does not expose drawProgress.`,
          suggestion: "Use draw on path, polygon, or polyline objects.",
        });
      }
    }
  });

  const actions = scene.timeline;
  for (let i = 0; i < actions.length; i++) {
    const a = actions[i]!;
    for (let j = i + 1; j < actions.length; j++) {
      const b = actions[j]!;
      const overlap = a.start < b.start + b.duration && b.start < a.start + a.duration;
      if (!overlap) continue;

      if (a.type === "camera" || b.type === "camera") {
        if (a.type !== "camera" || b.type !== "camera") continue;
        const conflicts = props(a).filter(p => props(b).includes(p));
        if (conflicts.length) diagnostics.push({
          code: "OVERLAPPING_PROPERTY_ACTIONS",
          path: `timeline[${j}]`,
          message: `Actions '${a.id}' and '${b.id}' overlap on ${conflicts.join(", ")}.`,
          suggestion: "Sequence the camera actions or animate distinct camera properties.",
        });
        continue;
      }

      if (a.target !== b.target) continue;
      const conflicts = props(a).filter(p => props(b).includes(p));
      if (conflicts.length) diagnostics.push({
        code: "OVERLAPPING_PROPERTY_ACTIONS",
        path: `timeline[${j}]`,
        message: `Actions '${a.id}' and '${b.id}' overlap on ${conflicts.join(", ")} for object '${a.target}'.`,
        suggestion: "Sequence the actions or animate distinct properties.",
      });
    }
  }

  return diagnostics;
}
