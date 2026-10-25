import { describe, expect, it } from "vitest";
import { COMPILER_LIMITS, compile } from "../src/index.js";

const baseScene = () => ({
  version: "1.0",
  scene: { width: 320, height: 180 },
  objects: [{ id: "node", type: "rect" }],
  timeline: [],
  state: { count: 0, enabled: false },
});

describe("state-machine compiler", () => {
  it("compiles bounded serializable state machines", () => {
    const result = compile({
      ...baseScene(),
      stateMachines: [{
        id: "flow",
        initial: "idle",
        states: [
          {
            id: "idle",
            transitions: [{
              id: "start",
              event: { type: "click", target: "node" },
              target: "running",
              guard: { key: "count", equals: 0 },
              actions: [
                { type: "increment", key: "count", by: 1 },
                { type: "set", key: "enabled", value: true },
              ],
            }],
          },
          { id: "running", transitions: [] },
        ],
      }],
    });

    expect(result.ok).toBe(true);
    expect(result.scene?.stateMachines?.[0]?.states[0]?.transitions[0]).toEqual({
      id: "start",
      event: { type: "click", target: "node" },
      target: "running",
      guard: { key: "count", equals: 0 },
      actions: [
        { type: "increment", key: "count", by: 1 },
        { type: "set", key: "enabled", value: true },
      ],
    });
  });

  it("rejects bad machine references and guard keys", () => {
    const result = compile({
      ...baseScene(),
      stateMachines: [{
        id: "flow",
        initial: "missing",
        states: [{
          id: "idle",
          transitions: [{
            id: "advance",
            event: { type: "click", target: "missing-object" },
            target: "missing-state",
            guard: { key: "missing", equals: true },
          }],
        }],
      }],
    });

    expect(result.ok).toBe(false);
    expect(result.diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "UNKNOWN_STATE_MACHINE_INITIAL" }),
      expect.objectContaining({ code: "UNKNOWN_STATE_MACHINE_TARGET" }),
      expect.objectContaining({ code: "UNKNOWN_STATE_MACHINE_STATE" }),
      expect.objectContaining({ code: "UNKNOWN_STATE_KEY" }),
    ]));
  });

  it("enforces top-level state-machine limits before deep parsing", () => {
    const result = compile({
      ...baseScene(),
      stateMachines: Array.from({ length: COMPILER_LIMITS.stateMachines + 1 }, (_, index) => ({
        id: `machine_${index}`,
        initial: "idle",
        states: [{ id: "idle", transitions: [] }],
      })),
    });

    expect(result.ok).toBe(false);
    expect(result.diagnostics).toContainEqual(expect.objectContaining({
      code: "LIMIT_STATE_MACHINES",
      path: "stateMachines",
    }));
  });
});
