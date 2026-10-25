import { describe, expect, it } from "vitest";
import {
  canonicalMorphPathToString,
  defaultStyle,
  defaultTransform,
  evaluate,
  parseMorphPathData,
  validateScene,
  type SceneDocument,
} from "../src/index.js";

function morphScene(from: string, to: string): SceneDocument {
  return {
    version: "1.0",
    scene: { width: 320, height: 180 },
    objects: [{
      id: "shape",
      type: "path",
      d: from,
      transform: defaultTransform(),
      style: defaultStyle(),
      visible: true,
      z: 0,
    }],
    timeline: [{
      id: "morph",
      type: "morph",
      target: "shape",
      start: 0,
      duration: 1000,
      easing: "linear",
      to,
    }],
  };
}

describe("deterministic path morphing", () => {
  it("canonicalizes the documented safe subset to absolute cubic segments", () => {
    const parsed = parseMorphPathData("m 10 10 l 30 0 q 10 20 20 0 z");
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;

    expect(canonicalMorphPathToString(parsed.path)).toBe(
      "M 10 10 C 20 10 30 10 40 10 C 46.6666666666667 23.3333333333333 53.3333333333333 23.3333333333333 60 10 Z",
    );
  });

  it("interpolates compatible cubic topology at the midpoint", () => {
    const scene = morphScene(
      "M 0 0 C 0 0 10 0 10 0",
      "M 10 10 C 10 10 20 10 20 10",
    );

    const midpoint = evaluate(scene, 500);
    expect(midpoint.objects[0]).toEqual(expect.objectContaining({
      type: "path",
      d: "M 5 5 C 5 5 15 5 15 5",
    }));
  });

  it("is seek/reverse deterministic because morph evaluation depends only on absolute time", () => {
    const scene = morphScene(
      "M 0 0 C 0 0 20 0 20 0",
      "M 20 20 C 20 20 40 20 40 20",
    );
    const times = [0, 200, 500, 800, 1000];
    const forward = new Map(times.map(time => [time, evaluate(scene, time)]));

    for (const time of [...times].reverse()) {
      expect(evaluate(scene, time)).toEqual(forward.get(time));
    }
    expect(evaluate(scene, 500)).toEqual(forward.get(500));
  });

  it("reports malformed/unsupported path data without executing or resampling it", () => {
    const scene = morphScene("M 0 0 L 10 0", "M 0 0 A 10 10 0 0 0 20 20");
    expect(validateScene(scene)).toContainEqual(expect.objectContaining({
      code: "MORPH_PATH_UNSUPPORTED_COMMAND",
      path: "timeline[0].to",
    }));
  });

  it("reports subpath, closedness, and segment-structure incompatibility separately", () => {
    const subpaths = validateScene(morphScene(
      "M 0 0 L 10 0",
      "M 0 0 L 10 0 M 20 20 L 30 20",
    ));
    expect(subpaths).toContainEqual(expect.objectContaining({
      code: "MORPH_SUBPATH_COUNT_MISMATCH",
      path: "timeline[0].to",
    }));

    const closedness = validateScene(morphScene(
      "M 0 0 L 10 0 Z",
      "M 0 0 L 10 0",
    ));
    expect(closedness).toContainEqual(expect.objectContaining({
      code: "MORPH_SUBPATH_CLOSEDNESS_MISMATCH",
      path: "timeline[0].to",
    }));

    const segments = validateScene(morphScene(
      "M 0 0 L 10 0",
      "M 0 0 L 5 0 L 10 0",
    ));
    expect(segments).toContainEqual(expect.objectContaining({
      code: "MORPH_SEGMENT_STRUCTURE_MISMATCH",
      path: "timeline[0].to",
    }));
  });

  it("preserves path-property overlap detection for morph actions", () => {
    const scene = morphScene(
      "M 0 0 L 10 0",
      "M 0 0 L 20 0",
    );
    scene.timeline.push({
      id: "morph-2",
      type: "morph",
      target: "shape",
      start: 500,
      duration: 1000,
      easing: "linear",
      to: "M 0 0 L 30 0",
    });

    expect(validateScene(scene)).toContainEqual(expect.objectContaining({
      code: "OVERLAPPING_PROPERTY_ACTIONS",
      path: "timeline[1]",
    }));
  });
});
