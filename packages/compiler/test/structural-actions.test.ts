import { describe, expect, it } from "vitest";
import { compile } from "../src/index.js";

const base = {
  version: "1.0",
  scene: { width: 400, height: 240 },
  objects: [
    { id: "container", type: "group", children: [] },
    { id: "card", type: "rect", width: 60, height: 40 },
    { id: "not-group", type: "rect", width: 60, height: 40 },
  ],
};

describe("structural action compiler", () => {
  it("accepts bounded zero-duration reparent and z-order actions", () => {
    const result = compile({
      ...base,
      timeline: [
        { id: "group", type: "reparent", target: "card", parentId: "container", start: 100, duration: 0 },
        { id: "front", type: "zOrder", target: "card", to: 4, start: 200, duration: 0 },
        { id: "ungroup", type: "reparent", target: "card", parentId: null, start: 300, duration: 0 },
      ],
    });
    expect(result.ok).toBe(true);
    expect(result.scene?.timeline.map(action => action.type)).toEqual(["reparent", "zOrder", "reparent"]);
  });

  it("rejects non-group parents and non-instant structural actions", () => {
    const result = compile({
      ...base,
      timeline: [
        { id: "bad-parent", type: "reparent", target: "card", parentId: "not-group", start: 0, duration: 0 },
        { id: "bad-duration", type: "zOrder", target: "card", to: 2, start: 0, duration: 10 },
      ],
    });
    expect(result.ok).toBe(false);
    expect(result.diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "INVALID_REPARENT_TARGET" }),
      expect.objectContaining({ code: "INVALID_STRUCTURAL_DURATION" }),
    ]));
  });
});
