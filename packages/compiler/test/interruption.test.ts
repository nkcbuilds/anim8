import { describe, expect, it } from "vitest";
import { compile } from "../src/index.js";

const base = {
  version: "1.0",
  scene: { width: 320, height: 180 },
  objects: [{ id: "box", type: "rect", width: 40, height: 40 }],
};

describe("timeline interruption compiler", () => {
  it("accepts an explicit interrupt and cubic bezier easing", () => {
    const result = compile({
      ...base,
      timeline: [
        { id: "a", type: "move", target: "box", start: 0, duration: 1000, to: { x: 100, y: 0 } },
        {
          id: "b",
          type: "move",
          target: "box",
          start: 500,
          duration: 500,
          interrupt: true,
          easing: { type: "cubicBezier", x1: 0.42, y1: 0, x2: 0.58, y2: 1 },
          to: { x: 200, y: 0 },
        },
      ],
    });

    expect(result.ok).toBe(true);
    expect(result.scene?.timeline[1]).toEqual(expect.objectContaining({
      interrupt: true,
      easing: { type: "cubicBezier", x1: 0.42, y1: 0, x2: 0.58, y2: 1 },
    }));
  });

  it("rejects implicit overlap and malformed cubic control points", () => {
    const overlap = compile({
      ...base,
      timeline: [
        { id: "a", type: "move", target: "box", start: 0, duration: 1000, to: { x: 100, y: 0 } },
        { id: "b", type: "move", target: "box", start: 500, duration: 500, to: { x: 200, y: 0 } },
      ],
    });
    expect(overlap.diagnostics).toContainEqual(expect.objectContaining({ code: "OVERLAPPING_PROPERTY_ACTIONS" }));

    const malformed = compile({
      ...base,
      timeline: [{
        id: "a",
        type: "move",
        target: "box",
        start: 0,
        duration: 1000,
        easing: { type: "cubicBezier", x1: -0.1, y1: 0, x2: 0.5, y2: 1 },
        to: { x: 100, y: 0 },
      }],
    });
    expect(malformed.diagnostics).toContainEqual(expect.objectContaining({
      code: "INVALID_EASING",
      path: "timeline[0].easing",
    }));
  });
});
