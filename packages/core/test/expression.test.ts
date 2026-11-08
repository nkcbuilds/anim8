import { describe, expect, it } from "vitest";
import { defaultStyle, defaultTransform, evaluate, evaluateExpression, type SceneDocument } from "../src/index.js";

describe("declarative expressions", () => {
  it("reads only own scalar input properties and rejects invalid runtime values", () => {
    for (const path of ["inputs.toString", "state.constructor"]) {
      expect(evaluateExpression({ kind: "get", path }, { time: 0, progress: 0, inputs: {}, state: {} })).toMatchObject({ ok: false, code: "EXPR_UNKNOWN_PATH" });
    }
    for (const value of [NaN, Infinity, "x".repeat(32769), {}]) {
      expect(evaluateExpression({ kind: "get", path: "inputs.value" }, { time: 0, progress: 0, inputs: { value: value as number } })).toMatchObject({ ok: false });
    }
    expect(evaluateExpression({ kind: "get", path: "inputs.constructor" }, { time: 0, progress: 0, inputs: { constructor: "own" } })).toEqual({ ok: true, value: "own" });
  });
  it("evaluates a bounded arithmetic AST without code execution", () => {
    const result = evaluateExpression(
      { kind: "op", op: "lerp", args: [
        { kind: "literal", value: 100 },
        { kind: "literal", value: 300 },
        { kind: "get", path: "inputs.progress" },
      ] },
      { time: 0, progress: 0, inputs: { progress: 0.25 }, state: {} },
    );
    expect(result).toEqual({ ok: true, value: 150 });
  });

  it("rejects unknown paths", () => {
    const result = evaluateExpression({ kind: "get", path: "window.location" }, { time: 0, progress: 0 });
    expect(result).toEqual(expect.objectContaining({ ok: false, code: "EXPR_UNKNOWN_PATH" }));
  });

  it("applies bindings deterministically from player inputs", () => {
    const scene: SceneDocument = {
      version: "1.0",
      scene: { width: 400, height: 200 },
      objects: [{
        id: "pointer", type: "text", text: "i",
        transform: { ...defaultTransform(), x: 50, y: 100 },
        style: defaultStyle(), visible: true, z: 1,
      }],
      timeline: [],
      bindings: [{
        id: "pointer-x",
        target: { objectId: "pointer", property: "x" },
        expression: { kind: "op", op: "add", args: [
          { kind: "literal", value: 50 },
          { kind: "op", op: "mul", args: [
            { kind: "get", path: "inputs.index" },
            { kind: "literal", value: 80 },
          ] },
        ] },
      }],
    };

    expect(evaluate(scene, 0, { inputs: { index: 3 } }).objects[0]?.transform.x).toBe(290);
    expect(evaluate(scene, 0, { inputs: { index: 1 } }).objects[0]?.transform.x).toBe(130);
  });
});
