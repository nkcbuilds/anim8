import { STATE_NUMBER_LIMIT, STATE_STRING_LIMIT } from "./interactions.js";
import { morphPathCompatibility, parseMorphPathData } from "./path-morph.js";
import type { Action, ScalarValue, SceneDocument, StateAction } from "./types.js";

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
    case "morph": return ["d"];
    case "visibility": return ["visible"];
    case "camera": return [
      ...(action.to.x !== undefined ? ["camera.x"] : []),
      ...(action.to.y !== undefined ? ["camera.y"] : []),
      ...(action.to.zoom !== undefined ? ["camera.zoom"] : []),
    ];
  }
};

function validateStateActionAtPath(
  declaredState: Record<string, ScalarValue>,
  action: StateAction,
  actionPath: string,
  diagnostics: Diagnostic[],
): void {
  if (!Object.prototype.hasOwnProperty.call(declaredState, action.key)) {
    diagnostics.push({
      code: "UNKNOWN_STATE_KEY",
      path: `${actionPath}.key`,
      message: `State key '${action.key}' is not declared in scene.state.`,
    });
    return;
  }

  const initial = declaredState[action.key];
  if (action.type === "set") {
    if (typeof action.value === "number" && (!Number.isFinite(action.value) || Math.abs(action.value) > STATE_NUMBER_LIMIT)) {
      diagnostics.push({
        code: "INVALID_STATE_ACTION_VALUE",
        path: `${actionPath}.value`,
        message: `Set number must be finite with absolute value <= ${STATE_NUMBER_LIMIT}.`,
      });
    }
    if (typeof action.value === "string" && action.value.length > STATE_STRING_LIMIT) {
      diagnostics.push({
        code: "INVALID_STATE_ACTION_VALUE",
        path: `${actionPath}.value`,
        message: `Set string must be at most ${STATE_STRING_LIMIT} characters.`,
      });
    }
  } else if (action.type === "toggle") {
    if (typeof initial !== "boolean") {
      diagnostics.push({
        code: "INVALID_STATE_ACTION_TYPE",
        path: `${actionPath}.key`,
        message: `toggle requires boolean state; '${action.key}' is not boolean.`,
      });
    }
  } else if (
    typeof initial !== "number" ||
    !Number.isFinite(action.by) ||
    Math.abs(action.by) > STATE_NUMBER_LIMIT
  ) {
    diagnostics.push({
      code: "INVALID_STATE_ACTION_TYPE",
      path: !Number.isFinite(action.by) || Math.abs(action.by) > STATE_NUMBER_LIMIT
        ? `${actionPath}.by`
        : `${actionPath}.key`,
      message: `increment requires numeric state and a finite delta with absolute value <= ${STATE_NUMBER_LIMIT}.`,
    });
  }
}

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

    if (object.type === "connector") {
      if (object.routing && object.kind !== "routed") {
        diagnostics.push({
          code: "INVALID_CONNECTOR_ROUTING",
          path: `objects[${index}].routing`,
          message: "connector.routing is only valid when kind is routed.",
        });
      }
      if (object.routing?.clearance !== undefined && (
        !Number.isFinite(object.routing.clearance) ||
        object.routing.clearance < 0 ||
        object.routing.clearance > 512
      )) {
        diagnostics.push({
          code: "INVALID_CONNECTOR_ROUTING",
          path: `objects[${index}].routing.clearance`,
          message: "routing.clearance must be a finite number between 0 and 512.",
        });
      }
      if (object.routing?.bendPenalty !== undefined && (
        !Number.isFinite(object.routing.bendPenalty) ||
        object.routing.bendPenalty < 0 ||
        object.routing.bendPenalty > 10_000
      )) {
        diagnostics.push({
          code: "INVALID_CONNECTOR_ROUTING",
          path: `objects[${index}].routing.bendPenalty`,
          message: "routing.bendPenalty must be a finite number between 0 and 10000.",
        });
      }
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

    if (action.type === "morph") {
      if (target && target.type !== "path") {
        diagnostics.push({
          code: "UNSUPPORTED_MORPH_TARGET",
          path: `timeline[${index}].target`,
          message: `Object '${target.id}' of type '${target.type}' is not an SVG path.`,
          suggestion: "Morph actions may target path objects only.",
        });
      } else if (target?.type === "path") {
        const priorMorph = scene.timeline
          .filter((candidate): candidate is Extract<Action, { type: "morph" }> =>
            candidate.type === "morph" &&
            candidate.target === action.target &&
            candidate !== action &&
            candidate.start + candidate.duration <= action.start
          )
          .sort((a, b) => a.start - b.start || a.id.localeCompare(b.id))
          .at(-1);
        const from = parseMorphPathData(priorMorph?.to ?? target.d);
        const to = parseMorphPathData(action.to);
        if (!from.ok) {
          diagnostics.push({
            code: from.code,
            path: `timeline[${index}].target`,
            message: `Morph source path is invalid: ${from.message}`,
          });
        }
        if (!to.ok) {
          diagnostics.push({
            code: to.code,
            path: `timeline[${index}].to`,
            message: `Morph target path is invalid: ${to.message}`,
          });
        }
        if (from.ok && to.ok) {
          const compatibility = morphPathCompatibility(from.path, to.path);
          if (!compatibility.ok) {
            diagnostics.push({
              code: compatibility.code,
              path: `timeline[${index}].to`,
              message: compatibility.message,
            });
          }
        }
      }
    }
  });

  const declaredState = scene.state ?? {};
  const interactionIds = new Set<string>();
  scene.interactions?.forEach((interaction, index) => {
    const path = `interactions[${index}]`;
    if (interactionIds.has(interaction.id)) {
      diagnostics.push({
        code: "DUPLICATE_INTERACTION_ID",
        path: `${path}.id`,
        message: `Interaction '${interaction.id}' is duplicated.`,
      });
    }
    interactionIds.add(interaction.id);

    if (interaction.event.type === "custom") {
      if (!/^[A-Za-z_][A-Za-z0-9_.:-]*$/.test(interaction.event.name)) {
        diagnostics.push({
          code: "INVALID_INTERACTION_EVENT",
          path: `${path}.event.name`,
          message: "Custom event names must be stable identifiers.",
        });
      }
      if (interaction.event.name === "click" || interaction.event.name === "focus" || interaction.event.name === "hover") {
        diagnostics.push({
          code: "RESERVED_INTERACTION_EVENT",
          path: `${path}.event.name`,
          message: "Custom event names must not use the reserved click, focus, or hover names.",
        });
      }
    } else if (!ids.has(interaction.event.target)) {
      diagnostics.push({
        code: "UNKNOWN_INTERACTION_TARGET",
        path: `${path}.event.target`,
        message: `Object '${interaction.event.target}' does not exist.`,
      });
    }

    if (interaction.actions.length === 0) {
      diagnostics.push({
        code: "EMPTY_INTERACTION",
        path: `${path}.actions`,
        message: "Interaction must contain at least one state action.",
      });
    }

    interaction.actions.forEach((action, actionIndex) => {
      const actionPath = `${path}.actions[${actionIndex}]`;
      if (!Object.prototype.hasOwnProperty.call(declaredState, action.key)) {
        diagnostics.push({
          code: "UNKNOWN_STATE_KEY",
          path: `${actionPath}.key`,
          message: `State key '${action.key}' is not declared in scene.state.`,
        });
        return;
      }

      const initial = declaredState[action.key];
      if (action.type === "set") {
        if (typeof action.value === "number" && (!Number.isFinite(action.value) || Math.abs(action.value) > STATE_NUMBER_LIMIT)) {
          diagnostics.push({
            code: "INVALID_STATE_ACTION_VALUE",
            path: `${actionPath}.value`,
            message: `Set number must be finite with absolute value <= ${STATE_NUMBER_LIMIT}.`,
          });
        }
        if (typeof action.value === "string" && action.value.length > STATE_STRING_LIMIT) {
          diagnostics.push({
            code: "INVALID_STATE_ACTION_VALUE",
            path: `${actionPath}.value`,
            message: `Set string must be at most ${STATE_STRING_LIMIT} characters.`,
          });
        }
      } else if (action.type === "toggle") {
        if (typeof initial !== "boolean") {
          diagnostics.push({
            code: "INVALID_STATE_ACTION_TYPE",
            path: `${actionPath}.key`,
            message: `toggle requires boolean state; '${action.key}' is not boolean.`,
          });
        }
      } else if (
        typeof initial !== "number" ||
        !Number.isFinite(action.by) ||
        Math.abs(action.by) > STATE_NUMBER_LIMIT
      ) {
        diagnostics.push({
          code: "INVALID_STATE_ACTION_TYPE",
          path: action.type === "increment" && (!Number.isFinite(action.by) || Math.abs(action.by) > STATE_NUMBER_LIMIT)
            ? `${actionPath}.by`
            : `${actionPath}.key`,
          message: `increment requires numeric state and a finite delta with absolute value <= ${STATE_NUMBER_LIMIT}.`,
        });
      }
    });
  });

  const stateMachineIds = new Set<string>();
  scene.stateMachines?.forEach((machine, machineIndex) => {
    const machinePath = `stateMachines[${machineIndex}]`;
    if (stateMachineIds.has(machine.id)) {
      diagnostics.push({
        code: "DUPLICATE_STATE_MACHINE_ID",
        path: `${machinePath}.id`,
        message: `State machine '${machine.id}' is duplicated.`,
      });
    }
    stateMachineIds.add(machine.id);

    const stateIds = new Set<string>();
    machine.states.forEach((state, stateIndex) => {
      if (stateIds.has(state.id)) {
        diagnostics.push({
          code: "DUPLICATE_STATE_MACHINE_STATE_ID",
          path: `${machinePath}.states[${stateIndex}].id`,
          message: `State '${state.id}' is duplicated in machine '${machine.id}'.`,
        });
      }
      stateIds.add(state.id);
    });

    if (!stateIds.has(machine.initial)) {
      diagnostics.push({
        code: "UNKNOWN_STATE_MACHINE_INITIAL",
        path: `${machinePath}.initial`,
        message: `Initial state '${machine.initial}' does not exist in machine '${machine.id}'.`,
      });
    }

    const transitionIds = new Set<string>();
    machine.states.forEach((state, stateIndex) => {
      state.transitions.forEach((transition, transitionIndex) => {
        const transitionPath = `${machinePath}.states[${stateIndex}].transitions[${transitionIndex}]`;
        if (transitionIds.has(transition.id)) {
          diagnostics.push({
            code: "DUPLICATE_STATE_MACHINE_TRANSITION_ID",
            path: `${transitionPath}.id`,
            message: `Transition '${transition.id}' is duplicated in machine '${machine.id}'.`,
          });
        }
        transitionIds.add(transition.id);

        if (!stateIds.has(transition.target)) {
          diagnostics.push({
            code: "UNKNOWN_STATE_MACHINE_STATE",
            path: `${transitionPath}.target`,
            message: `Target state '${transition.target}' does not exist in machine '${machine.id}'.`,
          });
        }

        if (transition.event.type === "custom") {
          if (!/^[A-Za-z_][A-Za-z0-9_.:-]*$/.test(transition.event.name)) {
            diagnostics.push({
              code: "INVALID_STATE_MACHINE_EVENT",
              path: `${transitionPath}.event.name`,
              message: "Custom event names must be stable identifiers.",
            });
          }
          if (transition.event.name === "click" || transition.event.name === "focus" || transition.event.name === "hover") {
            diagnostics.push({
              code: "RESERVED_STATE_MACHINE_EVENT",
              path: `${transitionPath}.event.name`,
              message: "Custom event names must not use the reserved click, focus, or hover names.",
            });
          }
        } else if (!ids.has(transition.event.target)) {
          diagnostics.push({
            code: "UNKNOWN_STATE_MACHINE_TARGET",
            path: `${transitionPath}.event.target`,
            message: `Object '${transition.event.target}' does not exist.`,
          });
        }

        if (transition.guard && !Object.prototype.hasOwnProperty.call(declaredState, transition.guard.key)) {
          diagnostics.push({
            code: "UNKNOWN_STATE_KEY",
            path: `${transitionPath}.guard.key`,
            message: `State key '${transition.guard.key}' is not declared in scene.state.`,
          });
        }

        transition.actions?.forEach((action, actionIndex) =>
          validateStateActionAtPath(declaredState, action, `${transitionPath}.actions[${actionIndex}]`, diagnostics)
        );
      });
    });
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
