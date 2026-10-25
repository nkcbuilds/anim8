import { describe, expect, it } from "vitest";
import {
  applyInteractions,
  defaultStyle,
  defaultTransform,
  evaluate,
  validateScene,
  type SceneDocument,
} from "../src/index.js";

function scene(): SceneDocument {
  return {
    version: "1.0",
    scene: { width: 320, height: 180 },
    objects: [{
      id: "node",
      type: "rect",
      width: 80,
      height: 40,
      transform: defaultTransform(),
      style: defaultStyle(),
      visible: true,
      z: 0,
    }],
    timeline: [],
    state: { count: 0, active: false, label: "idle" },
    bindings: [{
      id: "count-x",
      target: { objectId: "node", property: "x" },
      expression: { kind: "get", path: "state.count" },
    }],
    interactions: [
      {
        id: "click-node",
        event: { type: "click", target: "node" },
        actions: [
          { type: "increment", key: "count", by: 2 },
          { type: "toggle", key: "active" },
        ],
      },
      {
        id: "click-node-again",
        event: { type: "click", target: "node" },
        actions: [{ type: "increment", key: "count", by: 3 }],
      },
      {
        id: "reset",
        event: { type: "custom", name: "reset" },
        actions: [
          { type: "set", key: "count", value: 0 },
          { type: "set", key: "label", value: "reset" },
        ],
      },
    ],
  };
}

describe("declarative interactions", () => {
  it("applies matching state actions deterministically without mutating input state", () => {
    const doc = scene();
    const initial = { count: 10, active: false, label: "idle" };

    const first = applyInteractions(doc, initial, { type: "click", target: "node" });
    const second = applyInteractions(doc, initial, { type: "click", target: "node" });

    expect(first).toEqual({ count: 15, active: true, label: "idle" });
    expect(second).toEqual(first);
    expect(initial).toEqual({ count: 10, active: false, label: "idle" });
  });

  it("lets evaluate remain random-access deterministic for explicit interaction state", () => {
    const doc = scene();
    const clicked = applyInteractions(doc, doc.state ?? {}, { type: "click", target: "node" });

    const first = evaluate(doc, 0, { state: clicked, inputs: { unused: 1 } });
    evaluate(doc, 0, { state: { ...clicked, count: 99 }, inputs: { unused: 2 } });
    const second = evaluate(doc, 0, { state: clicked, inputs: { unused: 1 } });

    expect(second).toEqual(first);
    expect(first.objects[0]?.transform.x).toBe(5);
  });

  it("supports custom named events and saturates increments at the state numeric bound", () => {
    const doc = scene();
    const reset = applyInteractions(
      doc,
      { count: 999_999, active: false, label: "changed" },
      { type: "custom", name: "reset" },
    );
    expect(reset).toEqual({ count: 0, active: false, label: "reset" });

    const saturated = applyInteractions(
      doc,
      { count: 999_999, active: false, label: "idle" },
      { type: "click", target: "node" },
    );
    expect(saturated.count).toBe(1_000_000);
  });

  it("diagnoses invalid interaction targets, state keys, and state action types", () => {
    const doc = scene();
    doc.interactions = [
      {
        id: "bad-target",
        event: { type: "click", target: "missing" },
        actions: [{ type: "increment", key: "missing", by: 1 }],
      },
      {
        id: "bad-toggle",
        event: { type: "custom", name: "advance" },
        actions: [{ type: "toggle", key: "count" }],
      },
    ];

    expect(validateScene(doc)).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "UNKNOWN_INTERACTION_TARGET", path: "interactions[0].event.target" }),
      expect.objectContaining({ code: "UNKNOWN_STATE_KEY", path: "interactions[0].actions[0].key" }),
      expect.objectContaining({ code: "INVALID_STATE_ACTION_TYPE", path: "interactions[1].actions[0].key" }),
    ]));
  });
});
