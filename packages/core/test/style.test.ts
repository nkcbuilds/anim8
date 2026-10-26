import { describe, expect, it } from "vitest";
import { defaultStyle, defaultTransform, evaluate, interpolateStyle, lerpColor, validateScene, type SceneDocument } from "../src/index.js";

const scene = (): SceneDocument => ({
  version: "1.0", scene: { width: 400, height: 200 },
  objects: [{ id: "node", type: "rect", width: 100, height: 50, text: "working", transform: defaultTransform(), style: { ...defaultStyle(), strokeDasharray: [8, 4] }, visible: true, z: 0 }],
  timeline: [{ id: "flow", type: "style", target: "node", start: 0, duration: 1000, to: { color: "#ffffff", stroke: "#00ff00", strokeWidth: 6, strokeDashoffset: -24, strokeDasharray: [] } }],
});

describe("visual styles", () => {
  it("animates independent channels, persists finished states and remains seek-order independent", () => {
    const document = scene(), original = structuredClone(document);
    const halfway = evaluate(document, 500);
    expect(halfway.objects[0]!.style).toMatchObject({ strokeWidth: 4, strokeDashoffset: -12, strokeDasharray: [8, 4] });
    expect(evaluate(document, 1000).objects[0]!.style).toMatchObject({ color: "#ffffff", stroke: "#00ff00", strokeWidth: 6, strokeDasharray: [] });
    evaluate(document, 0); evaluate(document, 950);
    expect(evaluate(document, 500)).toEqual(halfway);
    expect(document).toEqual(original);
  });
  it("interpolates matching gradients and resets to solid paint at the endpoint", () => {
    const a = { type: "linear" as const, stops: [{ offset: 0, color: "#000" }, { offset: 1, color: "#fff" }] };
    const b = { type: "linear" as const, stops: [{ offset: 0, color: "#fff" }, { offset: 1, color: "#000" }] };
    expect(interpolateStyle({ fillGradient: a }, { fillGradient: b }, 0.5).fillGradient?.stops[0]?.color).toBe("#808080");
    expect(interpolateStyle({ fillGradient: a }, { fill: "red" }, 0.5).fillGradient).toEqual(a);
    expect(interpolateStyle({ fillGradient: a }, { fill: "red" }, 1).fillGradient).toBeUndefined();
  });
  it("clamps bounded style easing and interpolates short hex, alpha and RGB colors", () => {
    expect(lerpColor("#000", "#fff", 0.5)).toBe("#808080");
    expect(lerpColor("rgba(0,0,0,0)", "#ffffff", 0.5)).toBe("rgba(128,128,128,0.5)");
    expect(lerpColor("#000", "#fff", 2)).toBe("#fff");
    expect(interpolateStyle({ strokeOpacity: 0 }, { strokeOpacity: 1 }, 1.1).strokeOpacity).toBe(1);
  });
  it("detects paint conflicts across legacy actions, gradients and style patches", () => {
    const document = scene();
    document.timeline.push({ id: "legacy", type: "stroke", target: "node", start: 0, duration: 100, to: "red" });
    expect(validateScene(document)).toContainEqual(expect.objectContaining({ code: "OVERLAPPING_PROPERTY_ACTIONS" }));
  });
  it("supports state-bound text color/dash flow and clears spans on text replacement", () => {
    const document = scene(); document.timeline = [];
    const object = document.objects[0]!;
    if (object.type === "rect") object.textRuns = [{ text: "working", color: "red" }];
    document.bindings = [
      { id: "color", target: { objectId: "node", property: "color" }, expression: { kind: "literal", value: "green" } },
      { id: "dash", target: { objectId: "node", property: "strokeDashoffset" }, expression: { kind: "literal", value: -12 } },
      { id: "label", target: { objectId: "node", property: "text" }, expression: { kind: "literal", value: "done" } },
    ];
    const frame = evaluate(document, 0);
    expect(frame.objects[0]).toMatchObject({ text: "done", style: { color: "green", strokeDashoffset: -12 } });
    expect(frame.objects[0]).not.toHaveProperty("textRuns");
  });
});

it("replaces labels/spans at the endpoint and preserves them under reverse seeks", () => {
  const document = scene();
  document.timeline = [{ id: "text", type: "text", target: "node", start: 100, duration: 200, to: "done", textRuns: [{ text: "done", color: "green" }] }];
  expect(evaluate(document, 299).objects[0]).toHaveProperty("text", "working");
  expect(evaluate(document, 300).objects[0]).toHaveProperty("textRuns", [{ text: "done", color: "green" }]);
  expect(evaluate(document, 100).objects[0]).not.toHaveProperty("textRuns");
});
