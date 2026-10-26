import { describe, expect, it } from "vitest";
import { defaultStyle, defaultTransform, type SceneDocument } from "@anim8/core";
import { renderSceneAt } from "../src/index.js";

describe("SVG styling composition", () => {
  it("escapes rich text, colors arrows, and reveals dashed paths without duplicate attributes", () => {
    const scene: SceneDocument = {
      version: "1.0", scene: { width: 500, height: 200 }, timeline: [],
      objects: [
        { id: "a", type: "rect", width: 80, height: 40, text: "<A>B", textRuns: [{ text: "<A>", color: "red" }, { text: "B", color: "blue" }], transform: defaultTransform(), style: { ...defaultStyle(), strokeDasharray: [8, 4], fillGradient: { type: "linear", stops: [{ offset: 0, color: "red" }, { offset: 1, color: "blue" }] } }, visible: true, z: 0 },
        { id: "b", type: "circle", radius: 20, transform: { ...defaultTransform(), x: 300, y: 100 }, style: defaultStyle(), visible: true, z: 1 },
        { id: "edge", type: "connector", from: { objectId: "a" }, to: { objectId: "b" }, kind: "straight", label: "ACK", transform: defaultTransform(), style: { ...defaultStyle(), stroke: "red", color: "blue", strokeDasharray: [8, 4] }, visible: true, z: 2 },
        { id: "draw", type: "path", d: "M 0 100 L 400 100", drawProgress: 0.5, transform: defaultTransform(), style: { ...defaultStyle(), fill: "none", strokeDasharray: [8, 4] }, visible: true, z: 3 },
      ],
    };
    const svg = renderSceneAt(scene, 0);
    expect(svg).toContain('<tspan fill="red">&lt;A&gt;</tspan>');
    expect(svg).toContain('fill="context-stroke"');
    expect(svg).toContain('data-anim8-connector-label="edge"');
    expect(svg).toContain("<linearGradient");
    expect(svg).toContain("<mask");
    const path = svg.match(/<path[^>]*data-anim8-id="draw"[^>]*>/)?.[0] ?? "";
    expect(path).toContain('stroke-dasharray="8 4"');
    expect(path).toContain('mask="url(#');
    for (const tag of svg.match(/<[a-zA-Z][^>]*>/g) ?? []) {
      const names = [...tag.matchAll(/\s([\w:-]+)="/g)].map(match => match[1]);
      expect(new Set(names).size, tag).toBe(names.length);
    }
  });
});
