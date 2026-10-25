import { describe, expect, it } from "vitest";
import { COMPILER_LIMITS, compile } from "../src/index.js";

const baseScene = () => ({
  version: "1.0",
  scene: { width: 320, height: 180 },
  objects: [{ id: "node", type: "rect" }],
  timeline: [],
  state: { count: 0, active: false, label: "idle" },
});

describe("interaction compiler", () => {
  it("compiles bounded click/focus/hover/custom state transitions", () => {
    const result = compile({
      ...baseScene(),
      interactions: [
        {
          id: "clicked",
          event: { type: "click", target: "node" },
          actions: [{ type: "increment", key: "count", by: 1 }],
        },
        {
          id: "focused",
          event: { type: "focus", target: "node" },
          actions: [{ type: "set", key: "label", value: "focused" }],
        },
        {
          id: "hovered",
          event: { type: "hover", target: "node" },
          actions: [{ type: "toggle", key: "active" }],
        },
        {
          id: "advance",
          event: { type: "custom", name: "advance" },
          actions: [
            { type: "increment", key: "count", by: 2 },
            { type: "set", key: "label", value: "advanced" },
          ],
        },
      ],
    });

    expect(result.ok).toBe(true);
    expect(result.scene?.interactions).toHaveLength(4);
    expect(result.scene?.interactions?.[3]).toEqual({
      id: "advance",
      event: { type: "custom", name: "advance" },
      actions: [
        { type: "increment", key: "count", by: 2 },
        { type: "set", key: "label", value: "advanced" },
      ],
    });
  });

  it("diagnoses unknown targets/keys, incompatible actions, and reserved custom names", () => {
    const unknownTarget = compile({
      ...baseScene(),
      interactions: [{
        id: "bad",
        event: { type: "click", target: "missing" },
        actions: [{ type: "increment", key: "count", by: 1 }],
      }],
    });
    expect(unknownTarget.diagnostics).toContainEqual(
      expect.objectContaining({ code: "UNKNOWN_INTERACTION_TARGET", path: "interactions[0].event.target" }),
    );

    const unknownKey = compile({
      ...baseScene(),
      interactions: [{
        id: "bad",
        event: { type: "custom", name: "advance" },
        actions: [{ type: "set", key: "missing", value: 1 }],
      }],
    });
    expect(unknownKey.diagnostics).toContainEqual(
      expect.objectContaining({ code: "UNKNOWN_STATE_KEY", path: "interactions[0].actions[0].key" }),
    );

    const invalidToggle = compile({
      ...baseScene(),
      interactions: [{
        id: "bad",
        event: { type: "hover", target: "node" },
        actions: [{ type: "toggle", key: "count" }],
      }],
    });
    expect(invalidToggle.diagnostics).toContainEqual(
      expect.objectContaining({ code: "INVALID_STATE_ACTION_TYPE", path: "interactions[0].actions[0].key" }),
    );

    const reserved = compile({
      ...baseScene(),
      interactions: [{
        id: "bad",
        event: { type: "custom", name: "click" },
        actions: [{ type: "set", key: "label", value: "x" }],
      }],
    });
    expect(reserved.diagnostics).toContainEqual(
      expect.objectContaining({ code: "RESERVED_INTERACTION_EVENT", path: "interactions[0].event.name" }),
    );
  });

  it("enforces interaction and per-interaction action resource bounds", () => {
    const interactions = Array.from({ length: COMPILER_LIMITS.interactions + 1 }, (_, index) => ({
      id: `i_${index}`,
      event: { type: "custom", name: `event_${index}` },
      actions: [{ type: "set", key: "count", value: index }],
    }));
    const tooMany = compile({ ...baseScene(), interactions });
    expect(tooMany.diagnostics).toContainEqual(
      expect.objectContaining({ code: "LIMIT_INTERACTIONS", path: "interactions" }),
    );

    const tooManyActions = compile({
      ...baseScene(),
      interactions: [{
        id: "many-actions",
        event: { type: "custom", name: "advance" },
        actions: Array.from({ length: COMPILER_LIMITS.interactionActions + 1 }, () => ({
          type: "increment",
          key: "count",
          by: 1,
        })),
      }],
    });
    expect(tooManyActions.diagnostics).toContainEqual(
      expect.objectContaining({ code: "LIMIT_INTERACTION_ACTIONS", path: "interactions[0].actions" }),
    );
  });

  it("diagnoses duplicate interaction ids deterministically", () => {
    const input = {
      ...baseScene(),
      interactions: [
        {
          id: "same",
          event: { type: "click", target: "node" },
          actions: [{ type: "increment", key: "count", by: 1 }],
        },
        {
          id: "same",
          event: { type: "custom", name: "advance" },
          actions: [{ type: "increment", key: "count", by: 1 }],
        },
      ],
    };

    const first = compile(input).diagnostics;
    const second = compile(input).diagnostics;
    expect(first).toEqual(second);
    expect(first).toContainEqual(
      expect.objectContaining({ code: "DUPLICATE_INTERACTION_ID", path: "interactions[1].id" }),
    );
  });
});
