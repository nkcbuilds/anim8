import type { InteractionTrigger, ScalarValue, SceneDocument, StateAction } from "./types.js";

export const STATE_NUMBER_LIMIT = 1_000_000;
export const STATE_STRING_LIMIT = 32 * 1024;

const own = (value: Record<string, ScalarValue>, key: string): boolean =>
  Object.prototype.hasOwnProperty.call(value, key);

function boundedScalar(value: ScalarValue): ScalarValue | undefined {
  if (typeof value === "number") {
    if (!Number.isFinite(value)) return undefined;
    return Math.max(-STATE_NUMBER_LIMIT, Math.min(STATE_NUMBER_LIMIT, value));
  }
  if (typeof value === "string") return value.slice(0, STATE_STRING_LIMIT);
  return value;
}

function applyStateAction(
  declaredState: Record<string, ScalarValue>,
  state: Record<string, ScalarValue>,
  action: StateAction,
): void {
  if (!own(declaredState, action.key)) return;

  switch (action.type) {
    case "set": {
      const value = boundedScalar(action.value);
      if (value !== undefined) state[action.key] = value;
      return;
    }
    case "toggle":
      if (typeof state[action.key] === "boolean") state[action.key] = !state[action.key];
      return;
    case "increment": {
      const current = state[action.key];
      if (typeof current !== "number" || !Number.isFinite(current) || !Number.isFinite(action.by)) return;
      state[action.key] = Math.max(
        -STATE_NUMBER_LIMIT,
        Math.min(STATE_NUMBER_LIMIT, current + action.by),
      );
      return;
    }
  }
}

function matches(trigger: InteractionTrigger, event: InteractionTrigger): boolean {
  if (trigger.type !== event.type) return false;
  if (trigger.type === "custom") return event.type === "custom" && trigger.name === event.name;
  return event.type !== "custom" && trigger.target === event.target;
}

/**
 * Pure deterministic state transition for one declarative interaction event.
 *
 * Only keys declared in scene.state may be mutated. Multiple matching
 * interactions run in document order and their actions run in array order.
 */
export function applyInteractions(
  scene: SceneDocument,
  currentState: Readonly<Record<string, ScalarValue>>,
  event: InteractionTrigger,
): Record<string, ScalarValue> {
  const declaredState = scene.state ?? {};
  const nextState: Record<string, ScalarValue> = {
    ...declaredState,
    ...currentState,
  };

  for (const interaction of scene.interactions ?? []) {
    if (!matches(interaction.event, event)) continue;
    for (const action of interaction.actions) {
      applyStateAction(declaredState, nextState, action);
    }
  }

  return nextState;
}
