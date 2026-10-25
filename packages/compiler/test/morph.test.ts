import { describe, expect, it } from "vitest";
import { compile } from "../src/index.js";

const base = (d = "M 0 0 L 10 0") => ({
  version: "1.0",
  scene: { width: 320, height: 180 },
  objects: [{ id: "shape", type: "path", d }],
  timeline: [],
});

describe("path morph compiler", () => {
  it("canonicalizes a supported morph target without changing the source object path", () => {
    const input = base();
    input.timeline = [{
      id: "morph",
      type: "morph",
      target: "shape",
      start: 0,
      duration: 1000,
      easing: "linear",
      to: "m 5 5 q 10 15 20 0",
    }] as typeof input.timeline;

    const result = compile(input);
    expect(result.ok).toBe(true);
    expect(result.scene?.objects[0]).toEqual(expect.objectContaining({
      type: "path",
      d: "M 0 0 L 10 0",
    }));
    expect(result.scene?.timeline[0]).toEqual(expect.objectContaining({
      type: "morph",
      to: "M 5 5 C 11.6666666666667 15 18.3333333333333 15 25 5",
    }));
  });

  it("rejects unsupported/malformed target path commands with structured diagnostics", () => {
    const unsupported = compile({
      ...base(),
      timeline: [{
        id: "morph",
        type: "morph",
        target: "shape",
        start: 0,
        duration: 100,
        to: "M 0 0 A 10 10 0 0 0 20 20",
      }],
    });
    expect(unsupported.diagnostics).toContainEqual(expect.objectContaining({
      code: "MORPH_PATH_UNSUPPORTED_COMMAND",
      path: "timeline[0].to",
    }));

    const malformed = compile({
      ...base(),
      timeline: [{
        id: "morph",
        type: "morph",
        target: "shape",
        start: 0,
        duration: 100,
        to: "M 0",
      }],
    });
    expect(malformed.diagnostics).toContainEqual(expect.objectContaining({
      code: "MORPH_PATH_MALFORMED",
      path: "timeline[0].to",
    }));

    const unsupportedSource = compile({
      ...base("M 0 0 A 10 10 0 0 0 20 20"),
      timeline: [{
        id: "morph",
        type: "morph",
        target: "shape",
        start: 0,
        duration: 100,
        to: "M 0 0 L 20 20",
      }],
    });
    expect(unsupportedSource.diagnostics).toContainEqual(expect.objectContaining({
      code: "MORPH_PATH_UNSUPPORTED_COMMAND",
      path: "timeline[0].target",
    }));
  });

  it("diagnoses incompatible subpaths, closedness, and segment structure", () => {
    const cases = [
      {
        to: "M 0 0 L 10 0 M 20 20 L 30 20",
        code: "MORPH_SUBPATH_COUNT_MISMATCH",
      },
      {
        from: "M 0 0 L 10 0 Z",
        to: "M 0 0 L 10 0",
        code: "MORPH_SUBPATH_CLOSEDNESS_MISMATCH",
      },
      {
        to: "M 0 0 L 5 0 L 10 0",
        code: "MORPH_SEGMENT_STRUCTURE_MISMATCH",
      },
    ] as const;

    for (const item of cases) {
      const result = compile({
        ...base("from" in item ? item.from : undefined),
        timeline: [{
          id: "morph",
          type: "morph",
          target: "shape",
          start: 0,
          duration: 100,
          to: item.to,
        }],
      });
      expect(result.diagnostics).toContainEqual(expect.objectContaining({
        code: item.code,
        path: "timeline[0].to",
      }));
    }
  });

  it("rejects non-path targets and preserves morph overlap diagnostics", () => {
    const wrongTarget = compile({
      ...base(),
      objects: [{ id: "shape", type: "rect" }],
      timeline: [{
        id: "morph",
        type: "morph",
        target: "shape",
        start: 0,
        duration: 100,
        to: "M 0 0 L 20 0",
      }],
    });
    expect(wrongTarget.diagnostics).toContainEqual(expect.objectContaining({
      code: "UNSUPPORTED_MORPH_TARGET",
      path: "timeline[0].target",
    }));

    const overlap = compile({
      ...base(),
      timeline: [
        {
          id: "morph-a",
          type: "morph",
          target: "shape",
          start: 0,
          duration: 100,
          to: "M 0 0 L 20 0",
        },
        {
          id: "morph-b",
          type: "morph",
          target: "shape",
          start: 50,
          duration: 100,
          to: "M 0 0 L 30 0",
        },
      ],
    });
    expect(overlap.diagnostics).toContainEqual(expect.objectContaining({
      code: "OVERLAPPING_PROPERTY_ACTIONS",
      path: "timeline[1]",
    }));
  });

  it("accepts sequential compatible morphs while preserving deterministic topology", () => {
    const result = compile({
      ...base("M 0 0 L 10 0"),
      timeline: [
        {
          id: "morph-a",
          type: "morph",
          target: "shape",
          start: 0,
          duration: 100,
          to: "M 10 0 L 20 0",
        },
        {
          id: "morph-b",
          type: "morph",
          target: "shape",
          start: 100,
          duration: 100,
          to: "M 20 0 L 30 0",
        },
      ],
    });

    expect(result.ok).toBe(true);
    expect(result.scene?.timeline.map(action => action.type)).toEqual(["morph", "morph"]);
  });
});
