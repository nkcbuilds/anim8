import { describe, expect, it } from "vitest";
import { COMPILER_LIMITS, compile } from "../src/index.js";
import { applySceneEvent, initializeStateMachines } from "@anim8/core";

const baseScene = () => ({
  version: "1.0",
  scene: { width: 320, height: 180 },
  objects: [{ id: "node", type: "rect" }],
  timeline: [],
  state: { count: 0, enabled: false },
});

describe("state-machine compiler", () => {
  it("preserves prototype-like state keys and machine identifiers as own data", () => {
    const result = compile({ ...baseScene(), state: JSON.parse('{"__proto__":0}'), stateMachines: [{ id: "__proto__", initial: "idle", states: [
      { id: "idle", transitions: [{ id: "go", event: { type: "custom", name: "advance" }, target: "done", actions: [{ type: "increment", key: "__proto__", by: 1 }] }] },
      { id: "done", transitions: [] },
    ] }] });
    expect(result.ok).toBe(true);
    const document = result.scene!;
    expect(Object.keys(document.state!)).toContain("__proto__");
    const machines = initializeStateMachines(document);
    expect(Object.keys(machines)).toEqual(["__proto__"]);
    const next = applySceneEvent(document, document.state!, machines, { type: "custom", name: "advance" });
    expect(next.state.__proto__).toBe(1);
    expect(next.machines.__proto__).toBe("done");
  });
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
