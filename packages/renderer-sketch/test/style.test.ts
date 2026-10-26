import { expect, it } from "vitest";
import { defaultStyle, defaultTransform, type SceneDocument } from "@anim8/core";
import { renderSketchSceneAt } from "../src/index.js";

it("isolates reveal masks for identical paths with different fill states", () => {
  const scene: SceneDocument = {
    version: "1.0", scene: { width: 480, height: 180 }, timeline: [],
    objects: ["none", "#fde68a"].map((fill, i) => ({
      id: "curve-" + i, type: "path", d: "M 20 140 Q 120 -80 220 140", drawProgress: 0.5,
      transform: { ...defaultTransform(), x: i * 240 }, visible: true, z: i,
      style: { ...defaultStyle(), fill, strokeWidth: 12, strokeDasharray: [12, 6] },
    })),
  };
  const svg = renderSketchSceneAt(scene, 0);
  const masks = [...svg.matchAll(/<mask id="([^"]+)"[\s\S]*?<path[^>]* fill="([^"]+)"/g)];
  expect(masks).toHaveLength(2);
  expect(new Set(masks.map(m => m[1])).size).toBe(2);
  expect(masks.map(m => m[2])).toEqual(["none", "white"]);
  for (const mask of masks) expect(svg).toContain(`mask="url(#${mask[1]})"`);
});
