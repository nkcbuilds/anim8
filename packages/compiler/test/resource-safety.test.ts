import { describe, expect, it } from "vitest";
import { evaluate, validateScene, worldMatrix, worldOpacity } from "@anim8/core";
import { compile, COMPILER_LIMITS } from "../src/index.js";

const base = () => ({ version: "1.0", scene: { width: 400, height: 200 }, objects: [{ id: "a", type: "rect" }], timeline: [] as unknown[] });
const move = (index: number, start = 0, duration = 1000) => ({ id: "m" + index, type: "move", target: "a", start, duration, to: { x: 100, y: 0 } });
const hierarchy = (scale: number) => ({
  ...base(), objects: [
    ...Array.from({ length: 55 }, (_, index) => ({ id: "g" + index, type: "group", children: [index === 54 ? "a" : "g" + (index + 1)], ...(index ? { parentId: "g" + (index - 1) } : {}), transform: { scaleX: scale, scaleY: scale } })),
    { id: "a", type: "rect", parentId: "g54" },
  ],
});

describe("resource safety across compiler and evaluator", () => {
  it("bounds conflict diagnostics and returns deterministic ordinary arrays", () => {
    const document = { ...base(), timeline: Array.from({ length: 200 }, (_, index) => move(index)) };
    const first = compile(document), second = compile(document);
    expect(first.ok).toBe(false);
    expect(first.diagnostics).toHaveLength(COMPILER_LIMITS.diagnostics);
    expect(first.diagnostics).toContainEqual(expect.objectContaining({ code: "LIMIT_DIAGNOSTICS" }));
    expect(second.diagnostics).toEqual(first.diagnostics);
    expect(Object.hasOwn(first.diagnostics, "push")).toBe(false);
  });
  it("stops expression sibling traversal at the first exhausted node budget", () => {
    const document = { ...base(), bindings: [{ id: "b", target: { objectId: "a", property: "x" }, expression: { kind: "op", op: "add", args: Array.from({ length: 20_000 }, () => ({ kind: "literal", value: 1 })) } }] };
    const result = compile(document);
    expect(result.ok).toBe(false);
    expect(result.diagnostics.filter(d => d.code === "LIMIT_EXPRESSION_NODES")).toHaveLength(1);
    expect(result.diagnostics.length).toBeLessThan(5);
  });
  it("accepts the maximum sequential timeline without enumerating non-overlapping pairs", () => {
    const result = compile({ ...base(), timeline: Array.from({ length: COMPILER_LIMITS.timelineActions }, (_, index) => move(index, index, 1)) });
    expect(result.diagnostics).toEqual([]);
    expect(result.ok).toBe(true);
  });
  it("bounds validation work even when a dense interrupt timeline emits no conflicts", () => {
    const result = compile({ ...base(), timeline: Array.from({ length: 1500 }, (_, index) => ({ ...move(index, index, 3000), interrupt: true })) });
    expect(result.ok).toBe(false);
    expect(result.diagnostics).toContainEqual(expect.objectContaining({ code: "LIMIT_VALIDATION_WORK" }));
  });
  it("preserves conflict decisions for unsorted actions, zero durations, camera channels and interrupts", () => {
    let seed = 51;
    const next = (maximum: number) => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed % maximum; };
    for (let sample = 0; sample < 100; sample++) {
      const actions = Array.from({ length: 16 }, (_, index) => {
        const camera = next(3) === 0;
        const channel = next(2) === 0 ? "x" : "y";
        const { target, ...timing } = move(index, next(8) * 100, next(4) * 100);
        return camera
          ? { ...timing, type: "camera", to: { [channel]: 10 }, interrupt: next(2) === 0 }
          : { ...timing, target, interrupt: next(2) === 0 };
      });
      const referencePaths: string[] = [];
      for (let i = 0; i < actions.length; i++) for (let j = i + 1; j < actions.length; j++) {
        const a = actions[i]!, b = actions[j]!;
        if (!(a.start < b.start + b.duration && b.start < a.start + a.duration)) continue;
        if ((a.type === "camera") !== (b.type === "camera")) continue;
        if (a.type === "camera" && !Object.keys(a.to).some(key => Object.hasOwn(b.to, key))) continue;
        if ((a.start < b.start && b.interrupt) || (b.start < a.start && a.interrupt)) continue;
        referencePaths.push(`timeline[${j}]`);
      }
      const result = compile({ ...base(), timeline: actions });
      expect(result.diagnostics.filter(d => d.code === "OVERLAPPING_PROPERTY_ACTIONS").map(d => d.path).sort(), `sample ${sample}`).toEqual(referencePaths.sort());
    }
  });
  it("rejects static world overflow and guards scale bindings and actions at runtime", () => {
    expect(compile(hierarchy(1_000_000))).toMatchObject({ ok: false, diagnostics: expect.arrayContaining([expect.objectContaining({ code: "INVALID_WORLD_TRANSFORM" })]) });
    const result = compile(hierarchy(1));
    expect(result.ok).toBe(true);
    const document = result.scene!;
    document.bindings = document.objects.filter(o => o.type === "group").map(o => ({ id: "b-" + o.id, target: { objectId: o.id, property: "scaleX" }, expression: { kind: "get", path: "inputs.scale" } }));
    expect(() => evaluate(document, 0, { inputs: { scale: 2 } })).not.toThrow();
    expect(() => evaluate(document, 0, { inputs: { scale: 1_000_000 } })).toThrow(/World transform/);
    for (const binding of document.bindings) binding.target.property = "opacity";
    expect(() => evaluate(document, 0, { inputs: { scale: 1_000_000 } })).toThrow(/World opacity/);
    document.bindings = [];
    document.timeline = document.objects.filter(o => o.type === "group").map(o => ({ id: "scale-" + o.id, type: "scale", target: o.id, start: 0, duration: 100, to: { x: 1_000_000, y: 1_000_000 } }));
    expect(() => evaluate(document, 100)).toThrow(/World transform/);
    document.timeline = [];
    for (const object of document.objects) object.transform.scaleX = 1_000_000;
    expect(validateScene(document)).toContainEqual(expect.objectContaining({ code: "INVALID_WORLD_TRANSFORM" }));
  });
  it("validates a maximum-depth hierarchy in leaf-first input order without recursion", () => {
    const groups = COMPILER_LIMITS.objects - 1;
    const objects = [
      ...Array.from({ length: groups }, (_, index) => ({ id: "g" + index, type: "group", children: [index === groups - 1 ? "a" : "g" + (index + 1)], ...(index ? { parentId: "g" + (index - 1) } : {}) })),
      { id: "a", type: "rect", parentId: "g" + (groups - 1) },
    ].reverse();
    expect(compile({ ...base(), objects }).diagnostics).toEqual([]);
  });
  it("uses the same root-to-leaf composition bounds during validation and rendering", () => {
    const input = hierarchy(1_000_000);
    input.objects = input.objects.slice(0, 22);
    const root = input.objects[0]!;
    if ("transform" in root) root.transform = { scaleX: 1e-100, scaleY: 1e-100 };
    const parent = input.objects[21]!;
    if ("children" in parent) parent.children = ["a"];
    input.objects.push({ id: "a", type: "rect", parentId: "g21" });
    const result = compile(input);
    expect(result.diagnostics).toEqual([]);
    const frame = evaluate(result.scene!, 0), index = new Map(frame.objects.map(o => [o.id, o]));
    expect(() => worldMatrix(index.get("a")!, index)).not.toThrow();
    expect(worldMatrix(index.get("a")!, index).a).toBeCloseTo(1e26, -12);
    for (const object of frame.objects) if (object.type === "group") object.transform.opacity = object.id === "g0" ? 1e-100 : 1_000_000;
    expect(worldOpacity(index.get("a")!, index)).toBeCloseTo(1e26, -12);
  });
});
