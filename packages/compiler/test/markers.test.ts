import { describe, expect, it } from "vitest";
import { compile, compileJson, COMPILER_LIMITS } from "../src/index.js";

const scene = (markers?: unknown) => ({
  version: "1.0", scene: { width: 400, height: 300 }, objects: [], timeline: [],
  ...(markers === undefined ? {} : { markers }),
});

describe("JSON explanation markers", () => {
  it("preserves labels, absolute timestamps and source order through JSON compilation", () => {
    const markers = [
      { id: "merge", label: "Merge left ≤ right", time: 1500 },
      { id: "split", label: "Split", time: 0 },
      { id: "split-again", label: "Simultaneous step", time: 0 },
    ];
    const result = compileJson(JSON.stringify(scene(markers)));
    expect(result.ok).toBe(true);
    expect(result.scene?.markers).toEqual(markers);
  });
  it("keeps markers optional", () => {
    expect(compile(scene()).ok).toBe(true);
    expect(compile(scene([])).ok).toBe(true);
  });
  it.each([null, "steps", {}])("rejects malformed marker collections: %j", markers => {
    expect(compile(scene(markers)).diagnostics).toContainEqual(expect.objectContaining({ code: "INVALID_MARKERS", path: "markers" }));
  });
  it.each([null, 1, "step"])("rejects malformed markers: %j", marker => {
    expect(compile(scene([marker])).diagnostics).toContainEqual(expect.objectContaining({ code: "INVALID_MARKER", path: "markers[0]" }));
  });
  it.each([-1, NaN, Infinity, "100", undefined, COMPILER_LIMITS.actionTime + 1])("rejects invalid marker times: %s", time => {
    expect(compile(scene([{ id: "step", label: "Step", time }])).diagnostics).toContainEqual(expect.objectContaining({ code: "INVALID_MARKER_TIME", path: "markers[0].time" }));
  });
  it("rejects duplicate IDs and malformed or oversized labels and IDs", () => {
    const result = compile(scene([
      { id: "step", label: "A", time: 0 }, { id: "step", label: "B", time: 100 },
      { id: "bad id", label: 3, time: 0 },
      { id: "large", label: "x".repeat(COMPILER_LIMITS.textLength + 1), time: 0 },
      { id: "x".repeat(COMPILER_LIMITS.idLength + 1), time: 0 },
    ]));
    expect(result.ok).toBe(false);
    expect(result.scene).toBeUndefined();
    expect(result.diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "DUPLICATE_MARKER_ID", path: "markers[1].id" }),
      expect.objectContaining({ code: "INVALID_ID", path: "markers[2].id" }),
      expect.objectContaining({ code: "INVALID_TEXT", path: "markers[2].label" }),
      expect.objectContaining({ code: "LIMIT_TEXT_LENGTH", path: "markers[3].label" }),
      expect.objectContaining({ code: "INVALID_ID", path: "markers[4].id" }),
      expect.objectContaining({ code: "INVALID_TEXT", path: "markers[4].label" }),
    ]));
  });
  it("checks marker count before traversing entries", () => {
    const markers = Array(COMPILER_LIMITS.markers + 1).fill(null);
    expect(compile(scene(markers)).diagnostics).toEqual([
      expect.objectContaining({ code: "LIMIT_MARKERS", path: "markers" }),
    ]);
  });
});
