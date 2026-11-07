import { describe, expect, it } from "vitest";
import { compile } from "../src/index.js";

const scene = (style: unknown = {}, extra = {}, timeline: unknown[] = []) => ({ version: "1.0", scene: { width: 400, height: 200 }, objects: [{ id: "a", type: "rect", style, text: "A B", ...extra }], timeline });

describe("extended styling compilation", () => {
  it("preserves gradients, dashed outlines, text runs and partial actions", () => {
    const result = compile(scene({ strokeDasharray: [8, 4], strokeDashoffset: -2, fillGradient: { type: "linear", stops: [{ offset: 0, color: "#fff" }, { offset: 1, color: "blue" }] } }, { textRuns: [{ text: "A ", color: "red" }, { text: "B", color: "blue", fontWeight: 700 }] }, [{ id: "done", type: "style", target: "a", start: 0, duration: 100, to: { color: "green", strokeDasharray: [] } }]));
    expect(result.diagnostics).toEqual([]);
    expect(result.scene?.objects[0]).toHaveProperty("textRuns.1.color", "blue");
    expect(result.scene?.timeline[0]).toHaveProperty("to", { color: "green", strokeDasharray: [] });
  });
  it.each([
    { strokeDasharray: [-1, 2] }, { strokeDasharray: [0, 0] }, { strokeDasharray: Array(65).fill(1) },
    { strokeDasharray: "8 4" }, { strokeDashoffset: Infinity }, { fillOpacity: 2 }, { fontWeight: 1001 }, { strokeLinecap: "invalid" },
    { fillGradient: { type: "linear", stops: [{ offset: 1, color: "red" }, { offset: 0, color: "blue" }] } },
    { colorGradient: { type: "linear", stops: [{ offset: 0, color: "url(https://evil.invalid/x)" }, { offset: 1, color: "blue" }] } },
    { strokeGradient: { type: "linear", from: { x: -1, y: 0 }, stops: [{ offset: 0, color: "red" }, { offset: 1, color: "blue" }] } },
  ])("rejects invalid or unsafe style %j", style => { expect(compile(scene(style)).ok).toBe(false); });
  it("rejects inconsistent, unbounded and unsafe text spans", () => {
    for (const textRuns of [[{ text: "wrong" }], [{ text: "A B", color: "url(x)" }], Array(129).fill({ text: "" }), null]) expect(compile(scene({}, { textRuns })).ok).toBe(false);
  });
  it("rejects missing/unknown style patches and binding/action conflicts", () => {
    for (const to of [undefined, {}, { stroek: "red" }]) expect(compile(scene({}, {}, [{ id: "x", type: "style", target: "a", start: 0, duration: 100, to }])).ok).toBe(false);
    const input = { ...scene({}, {}, [{ id: "x", type: "style", target: "a", start: 0, duration: 100, to: { color: "red" } }]), bindings: [{ id: "b", target: { objectId: "a", property: "color" }, expression: { kind: "literal", value: "blue" } }] };
    expect(compile(input).ok).toBe(false);
  });
});

it("validates timed label replacements, rich text and target types", () => {
  const action = { id: "label", type: "text", target: "a", start: 100, duration: 0, to: "ACK", textRuns: [{ text: "ACK", color: "green" }] };
  expect(compile(scene({}, {}, [action])).ok).toBe(true);
  expect(compile(scene({}, {}, [{ ...action, to: "different" }])).ok).toBe(false);
  expect(compile(scene({}, { type: "line", x2: 10, y2: 0 }, [action])).ok).toBe(false);
  expect(compile(scene({ fillGradient: () => 1 })).ok).toBe(false);
});
