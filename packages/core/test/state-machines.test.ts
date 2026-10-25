import { describe, expect, it } from "vitest";
import {
  applySceneEvent,
  applyStateMachines,
  evaluate,
  initializeStateMachines,
  type SceneDocument,
} from "../src/index.js";

const scene = (): SceneDocument => ({
  version: "1.0",
  scene: { width: 320, height: 180 },
  objects: [{
    id: "node",
    type: "rect",
    width: 20,
    height: 20,
    transform: { x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1, opacity: 1 },
    style: {},
    visible: true,
    z: 0,
  }],
  timeline: [],
  state: { count: 0, enabled: false },
  bindings: [{
    id: "x",
    target: { objectId: "node", property: "x" },
    expression: { kind: "get", path: "state.count" },
  }],
  interactions: [{
    id: "legacy",
    event: { type: "custom", name: "advance" },
    actions: [{ type: "increment", key: "count", by: 1 }],
  }],
  stateMachines: [{
    id: "flow",
    initial: "idle",
    states: [
      {
        id: "idle",
        transitions: [{
          id: "start",
          event: { type: "custom", name: "advance" },
          target: "running",
          guard: { key: "count", equals: 1 },
          actions: [{ type: "set", key: "enabled", value: true }],
        }],
      },
      {
        id: "running",
        transitions: [{
          id: "finish",
          event: { type: "click", target: "node" },
          target: "done",
          actions: [{ type: "increment", key: "count", by: 4 }],
        }],
      },
      { id: "done", transitions: [] },
    ],
  }],
});

describe("state machines", () => {
  it("initializes explicit machine state without hidden timeline history", () => {
    expect(initializeStateMachines(scene())).toEqual({ flow: "idle" });
  });

  it("takes the first matching guarded transition deterministically", () => {
    const doc = scene();
    const initialMachines = initializeStateMachines(doc);
    const first = applySceneEvent(doc, doc.state ?? {}, initialMachines, { type: "custom", name: "advance" });
    const second = applySceneEvent(doc, doc.state ?? {}, initialMachines, { type: "custom", name: "advance" });

    expect(first).toEqual({
      state: { count: 1, enabled: true },
      machines: { flow: "running" },
    });
    expect(second).toEqual(first);

    const finished = applyStateMachines(doc, first.state, first.machines, { type: "click", target: "node" });
    expect(finished).toEqual({
      state: { count: 5, enabled: true },
      machines: { flow: "done" },
    });
  });

  it("keeps random-access evaluation deterministic for an explicit machine-derived state snapshot", () => {
    const doc = scene();
    const transitioned = applySceneEvent(
      doc,
      doc.state ?? {},
      initializeStateMachines(doc),
      { type: "custom", name: "advance" },
    );

    const first = evaluate(doc, 0, { state: transitioned.state });
    evaluate(doc, 0, { state: { count: 99, enabled: false } });
    const second = evaluate(doc, 0, { state: transitioned.state });

    expect(second).toEqual(first);
    expect(first.objects[0]?.transform.x).toBe(1);
  });
});
