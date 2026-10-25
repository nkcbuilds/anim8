import { describe, expect, it } from "vitest";
import {
  defaultStyle,
  defaultTransform,
  type DrawableObject,
  type SceneDocument,
} from "@anim8/core";
import { layoutDagre } from "../src/index.js";

function rect(id: string, width = 100, height = 50): DrawableObject {
  return {
    id,
    type: "rect",
    width,
    height,
    transform: defaultTransform(),
    style: defaultStyle(),
    visible: true,
    z: 1,
  };
}

function edge(id: string, from: string, to: string): DrawableObject {
  return {
    id,
    type: "connector",
    from: { objectId: from },
    to: { objectId: to },
    kind: "straight",
    transform: defaultTransform(),
    style: defaultStyle(),
    visible: true,
    z: 0,
  };
}

function scene(objects: DrawableObject[]): SceneDocument {
  return {
    version: "1.0",
    scene: { width: 800, height: 500 },
    objects,
    timeline: [],
  };
}

describe("layoutDagre", () => {
  it("returns directed top-bottom positions without mutating Anim8 objects", () => {
    const input = scene([
      rect("a"),
      rect("b", 80, 40),
      rect("c", 120, 60),
      edge("ab", "a", "b"),
      edge("bc", "b", "c"),
    ]);
    const before = structuredClone(input);

    const result = layoutDagre(input);

    expect(result.positions.a!.y).toBeLessThan(result.positions.b!.y);
    expect(result.positions.b!.y).toBeLessThan(result.positions.c!.y);
    expect(result.positions.a).toEqual(expect.objectContaining({ width: 100, height: 50 }));
    expect(result.width).toBeGreaterThan(0);
    expect(result.height).toBeGreaterThan(0);
    expect(input).toEqual(before);
  });

  it("normalizes symmetric tie ordering independently of source array order", () => {
    const first = scene([
      rect("source"),
      rect("left"),
      rect("right"),
      rect("sink"),
      edge("source-left", "source", "left"),
      edge("source-right", "source", "right"),
      edge("left-sink", "left", "sink"),
      edge("right-sink", "right", "sink"),
    ]);
    const second = scene([
      edge("right-sink", "right", "sink"),
      rect("sink"),
      rect("right"),
      edge("source-right", "source", "right"),
      rect("left"),
      edge("left-sink", "left", "sink"),
      rect("source"),
      edge("source-left", "source", "left"),
    ]);

    const a = layoutDagre(first, { direction: "top-bottom" });
    const b = layoutDagre(second, { direction: "top-bottom" });

    expect(b).toEqual(a);
    expect(a.positions.left!.x).not.toBe(a.positions.right!.x);
  });

  it("uses transformed core visual envelopes but ignores existing translation", () => {
    const node = rect("rotated", 100, 40);
    node.transform = {
      ...defaultTransform(),
      x: 900,
      y: -600,
      rotation: 90,
      scaleX: 2,
      scaleY: 1,
    };

    const result = layoutDagre(scene([node]));

    expect(result.positions.rotated!.width).toBeCloseTo(40);
    expect(result.positions.rotated!.height).toBeCloseTo(200);
    expect(result.positions.rotated!.x).not.toBe(900);
    expect(result.positions.rotated!.y).not.toBe(-600);
  });

  it("supports deterministic direction and spacing options", () => {
    const input = scene([
      rect("a"),
      rect("b"),
      edge("ab", "a", "b"),
    ]);

    const first = layoutDagre(input, {
      direction: "left-right",
      rankGap: 80,
      nodeGap: 30,
      marginX: 12,
      marginY: 18,
      ranker: "network-simplex",
    });
    const second = layoutDagre(input, {
      direction: "left-right",
      rankGap: 80,
      nodeGap: 30,
      marginX: 12,
      marginY: 18,
      ranker: "network-simplex",
    });

    expect(first).toEqual(second);
    expect(first.positions.a!.x).toBeLessThan(first.positions.b!.x);
  });

  it("rejects duplicate node ids and malformed connector references", () => {
    expect(() => layoutDagre(scene([rect("same"), rect("same")]))).toThrow(
      "Duplicate layout node id 'same'",
    );

    expect(() => layoutDagre(scene([
      rect("a"),
      edge("bad", "a", "missing"),
    ]))).toThrow(
      "Connector 'bad' references unknown Dagre node 'missing'",
    );
  });

  it("rejects invalid numeric layout options", () => {
    const input = scene([rect("a")]);

    expect(() => layoutDagre(input, { rankGap: -1 })).toThrow(
      "layoutDagre.rankGap must be a finite number >= 0.",
    );
    expect(() => layoutDagre(input, { nodeGap: Number.NaN })).toThrow(
      "layoutDagre.nodeGap must be a finite number >= 0.",
    );
  });
});
