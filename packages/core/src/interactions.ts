import type {
  InteractionTrigger,
  ScalarValue,
  SceneDocument,
  StateAction,
  StateMachineSnapshot,
} from "./types.js";

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
 * Applies bounded state actions without mutating the caller's state.
 *
 * Only keys declared in scene.state may be changed.
 */
export function applyStateActions(
  scene: SceneDocument,
  currentState: Readonly<Record<string, ScalarValue>>,
  actions: readonly StateAction[],
): Record<string, ScalarValue> {
  const declaredState = scene.state ?? {};
  const nextState: Record<string, ScalarValue> = {
    ...declaredState,
    ...currentState,
  };

  for (const action of actions) applyStateAction(declaredState, nextState, action);
  return nextState;
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
  let nextState: Record<string, ScalarValue> = {
    ...(scene.state ?? {}),
    ...currentState,
  };

  for (const interaction of scene.interactions ?? []) {
    if (!matches(interaction.event, event)) continue;
    nextState = applyStateActions(scene, nextState, interaction.actions);
  }

  return nextState;
}

/** Returns the explicit initial state for every declared state machine. */
export function initializeStateMachines(scene: SceneDocument): StateMachineSnapshot {
  const snapshot: StateMachineSnapshot = {};
  for (const machine of scene.stateMachines ?? []) snapshot[machine.id] = machine.initial;
  return snapshot;
}

export interface StateMachineResult {
  state: Record<string, ScalarValue>;
  machines: StateMachineSnapshot;
}

/**
 * Pure deterministic state-machine transition.
 *
 * Machines run in document order. Within the current state, the first
 * transition whose event and optional scalar-equality guard match wins.
 * Transition actions are applied immediately, so later machines observe the
 * resulting scene state. Timeline evaluation remains history-free because the
 * machine snapshot is supplied explicitly by the caller.
 */
export function applyStateMachines(
  scene: SceneDocument,
  currentState: Readonly<Record<string, ScalarValue>>,
  currentMachines: Readonly<StateMachineSnapshot>,
  event: InteractionTrigger,
): StateMachineResult {
  let nextState: Record<string, ScalarValue> = {
    ...(scene.state ?? {}),
    ...currentState,
  };
  const machines: StateMachineSnapshot = {
    ...initializeStateMachines(scene),
    ...currentMachines,
  };

  for (const machine of scene.stateMachines ?? []) {
    const current = machines[machine.id] ?? machine.initial;
    const stateNode = machine.states.find(state => state.id === current);
    if (!stateNode) continue;

    const transition = stateNode.transitions.find(candidate => {
      if (!matches(candidate.event, event)) return false;
      if (!candidate.guard) return true;
      if (!own(scene.state ?? {}, candidate.guard.key)) return false;
      return Object.is(nextState[candidate.guard.key], candidate.guard.equals);
    });
    if (!transition) continue;
    if (!machine.states.some(state => state.id === transition.target)) continue;

    if (transition.actions?.length) {
      nextState = applyStateActions(scene, nextState, transition.actions);
    }
    machines[machine.id] = transition.target;
  }

  return { state: nextState, machines };
}

/**
 * Applies legacy declarative interactions first, then state machines.
 *
 * This preserves existing interaction behavior while allowing machine guards
 * to observe state mutations caused by the same event.
 */
export function applySceneEvent(
  scene: SceneDocument,
  currentState: Readonly<Record<string, ScalarValue>>,
  currentMachines: Readonly<StateMachineSnapshot>,
  event: InteractionTrigger,
): StateMachineResult {
  const interactedState = applyInteractions(scene, currentState, event);
  return applyStateMachines(scene, interactedState, currentMachines, event);
}
