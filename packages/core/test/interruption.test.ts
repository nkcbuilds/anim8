import { describe, expect, it } from "vitest";
import {
  defaultStyle,
  defaultTransform,
  ease,
  evaluate,
  validateScene,
  type SceneDocument,
} from "../src/index.js";

const scene = (interrupt = true): SceneDocument => ({
  version: "1.0",
  scene: { width: 320, height: 180 },
  objects: [{
    id: "box",
    type: "rect",
    width: 40,
    height: 40,
    transform: defaultTransform(),
    style: defaultStyle(),
    visible: true,
    z: 0,
  }],
  timeline: [
    {
      id: "first",
      type: "move",
      target: "box",
      start: 0,
      duration: 1000,
      easing: "linear",
      to: { x: 100, y: 0 },
    },
    {
      id: "retarget",
      type: "move",
      target: "box",
      start: 500,
      duration: 500,
      easing: "linear",
      ...(interrupt ? { interrupt: true } : {}),
      to: { x: 200, y: 0 },
    },
  ],
});

describe("timeline interruption and custom easing", () => {
  it("retargets from the sampled interruption pose without jumping", () => {
    const doc = scene();
    expect(validateScene(doc).filter(diagnostic => diagnostic.code === "OVERLAPPING_PROPERTY_ACTIONS")).toEqual([]);

    expect(evaluate(doc, 499).objects[0]?.transform.x).toBeCloseTo(49.9, 8);
    expect(evaluate(doc, 500).objects[0]?.transform.x).toBeCloseTo(50, 8);
    expect(evaluate(doc, 750).objects[0]?.transform.x).toBeCloseTo(125, 8);
    expect(evaluate(doc, 1000).objects[0]?.transform.x).toBeCloseTo(200, 8);
  });

  it("remains random-access deterministic across forward/reverse seek order", () => {
    const doc = scene();
    const expected = evaluate(doc, 750);
    evaluate(doc, 1000);
    evaluate(doc, 0);
    expect(evaluate(doc, 750)).toEqual(expected);
  });

  it("still rejects implicit conflicting overlaps", () => {
    expect(validateScene(scene(false))).toContainEqual(expect.objectContaining({
      code: "OVERLAPPING_PROPERTY_ACTIONS",
    }));
  });

  it("evaluates cubic bezier easing deterministically", () => {
    const linearBezier = { type: "cubicBezier", x1: 0.25, y1: 0.25, x2: 0.75, y2: 0.75 } as const;
    expect(ease(linearBezier, 0)).toBe(0);
    expect(ease(linearBezier, 0.37)).toBeCloseTo(0.37, 8);
    expect(ease(linearBezier, 1)).toBe(1);

    const first = ease({ type: "cubicBezier", x1: 0.42, y1: 0, x2: 0.58, y2: 1 }, 0.61);
    const second = ease({ type: "cubicBezier", x1: 0.42, y1: 0, x2: 0.58, y2: 1 }, 0.61);
    expect(second).toBe(first);
  });
});
