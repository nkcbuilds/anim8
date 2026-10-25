import { describe, expect, it } from "vitest";
import { anchorPoint, defaultStyle, defaultTransform, type DrawableObject } from "../src/index.js";

describe("world transforms", () => {
  it("applies parent transforms to children", () => {
    const group: DrawableObject = { id: "g", type: "group", children: ["a"], transform: { ...defaultTransform(), x: 100, y: 50 }, style: defaultStyle(), visible: true, z: 0 };
    const child: DrawableObject = { id: "a", type: "rect", parentId: "g", width: 40, height: 20, transform: { ...defaultTransform(), x: 20, y: 0 }, style: defaultStyle(), visible: true, z: 1 };
    const objects = new Map<string, DrawableObject>([["g", group], ["a", child]]);
    expect(anchorPoint(child, "center", objects)).toEqual({ x: 120, y: 50 });
    expect(anchorPoint(child, "right", objects)).toEqual({ x: 140, y: 50 });
  });

  it("uses intrinsic ellipse bounds for anchors", () => {
    const ellipse: DrawableObject = {
      id: "e", type: "ellipse", rx: 40, ry: 20,
      transform: { ...defaultTransform(), x: 100, y: 60 },
      style: defaultStyle(), visible: true, z: 0,
    };
    expect(anchorPoint(ellipse, "right")).toEqual({ x: 140, y: 60 });
    expect(anchorPoint(ellipse, "top")).toEqual({ x: 100, y: 40 });
  });

  it("derives polygon anchors from its serialized local point bounds", () => {
    const polygon: DrawableObject = {
      id: "p", type: "polygon",
      points: [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 50, y: 80 }],
      transform: { ...defaultTransform(), x: 10, y: 20 },
      style: defaultStyle(), visible: true, z: 0,
    };
    expect(anchorPoint(polygon, "center")).toEqual({ x: 60, y: 60 });
    expect(anchorPoint(polygon, "left")).toEqual({ x: 10, y: 60 });
    expect(anchorPoint(polygon, "bottom")).toEqual({ x: 60, y: 100 });
  });

  it("preserves legacy point-anchor behavior for existing line objects", () => {
    const line: DrawableObject = {
      id: "line", type: "line", x2: 100, y2: 40,
      transform: { ...defaultTransform(), x: 10, y: 20 },
      style: defaultStyle(), visible: true, z: 0,
    };
    expect(anchorPoint(line, "center")).toEqual({ x: 10, y: 20 });
    expect(anchorPoint(line, "right")).toEqual({ x: 10, y: 20 });
  });
});
