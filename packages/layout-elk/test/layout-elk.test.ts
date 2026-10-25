import { describe, expect, it } from "vitest";
import {
  defaultStyle,
  defaultTransform,
  type DrawableObject,
  type SceneDocument,
} from "@anim8/core";
import {
  ELK_LAYOUT_LIMITS,
  layoutElk,
} from "../src/index.js";

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

describe("layoutElk", () => {
  it("returns directed positions and routed connector sections without mutating input", async () => {
    const input = scene([
      rect("client"),
      rect("api", 120, 60),
      rect("db", 140, 70),
      edge("client-api", "client", "api"),
      edge("api-db", "api", "db"),
    ]);
    const before = structuredClone(input);

    const result = await layoutElk(input);

    expect(result.positions.client!.y).toBeLessThan(result.positions.api!.y);
    expect(result.positions.api!.y).toBeLessThan(result.positions.db!.y);
    expect(result.positions.client).toEqual(expect.objectContaining({
      width: 100,
      height: 50,
    }));
    expect(result.routes["client-api"]!.from).toBe("client");
    expect(result.routes["client-api"]!.to).toBe("api");
    expect(result.routes["client-api"]!.sections.length).toBeGreaterThan(0);
    expect(result.routes["client-api"]!.sections[0]!.points.length).toBeGreaterThanOrEqual(2);
    expect(result.width).toBeGreaterThan(0);
    expect(result.height).toBeGreaterThan(0);
    expect(input).toEqual(before);
  });

  it("normalizes node and edge order so shuffled equivalent input is stable", async () => {
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

    const a = await layoutElk(first, { direction: "left-right" });
    const b = await layoutElk(second, { direction: "left-right" });

    expect(b).toEqual(a);
    expect(a.positions.source!.x).toBeLessThan(a.positions.sink!.x);
  });

  it("returns repeatable coordinates and routes for identical input", async () => {
    const input = scene([
      rect("a"),
      rect("b"),
      rect("c"),
      edge("ab", "a", "b"),
      edge("ac", "a", "c"),
    ]);

    const first = await layoutElk(input, {
      direction: "left-right",
      nodeGap: 32,
      layerGap: 84,
      edgeGap: 20,
      padding: 16,
    });
    const second = await layoutElk(input, {
      direction: "left-right",
      nodeGap: 32,
      layerGap: 84,
      edgeGap: 20,
      padding: 16,
    });

    expect(second).toEqual(first);
  });

  it("supports all directions and configurable spacing", async () => {
    const input = scene([
      rect("a"),
      rect("b"),
      edge("ab", "a", "b"),
    ]);

    const lr = await layoutElk(input, {
      direction: "left-right",
      layerGap: 120,
      nodeGap: 24,
      edgeGap: 12,
      padding: 30,
    });
    const rl = await layoutElk(input, { direction: "right-left" });
    const tb = await layoutElk(input, { direction: "top-bottom" });
    const bt = await layoutElk(input, { direction: "bottom-top" });

    expect(lr.positions.a!.x).toBeLessThan(lr.positions.b!.x);
    expect(rl.positions.a!.x).toBeGreaterThan(rl.positions.b!.x);
    expect(tb.positions.a!.y).toBeLessThan(tb.positions.b!.y);
    expect(bt.positions.a!.y).toBeGreaterThan(bt.positions.b!.y);
    expect(lr.positions.b!.x - lr.positions.a!.x).toBeGreaterThan(150);
  });

  it("measures transformed core geometry while ignoring existing translation", async () => {
    const node = rect("rotated", 100, 40);
    node.transform = {
      ...defaultTransform(),
      x: 900,
      y: -600,
      rotation: 90,
      scaleX: 2,
      scaleY: 1,
    };

    const result = await layoutElk(scene([node]));

    expect(result.positions.rotated!.width).toBeCloseTo(40);
    expect(result.positions.rotated!.height).toBeCloseTo(200);
    expect(result.positions.rotated!.x).not.toBe(900);
    expect(result.positions.rotated!.y).not.toBe(-600);
  });

  it("rejects duplicate ids and connectors that reference unknown nodes", async () => {
    await expect(layoutElk(scene([rect("same"), rect("same")]))).rejects.toThrow(
      "Duplicate layout node id 'same'",
    );

    await expect(layoutElk(scene([
      rect("a"),
      edge("bad", "a", "missing"),
    ]))).rejects.toThrow(
      "Connector 'bad' references unknown ELK node 'missing'",
    );

    await expect(layoutElk(scene([
      rect("a"),
      rect("b"),
      edge("dup", "a", "b"),
      edge("dup", "b", "a"),
    ]))).rejects.toThrow(
      "Duplicate layout connector id 'dup'",
    );
  });

  it("enforces bounded options, ids, geometry, and graph size before ELK", async () => {
    const input = scene([rect("a")]);

    await expect(layoutElk(input, { nodeGap: -1 })).rejects.toThrow(
      "layoutElk.nodeGap must be a finite number between 0 and",
    );
    await expect(layoutElk(input, { layerGap: Number.NaN })).rejects.toThrow(
      "layoutElk.layerGap must be a finite number between 0 and",
    );
    await expect(layoutElk(input, { padding: ELK_LAYOUT_LIMITS.padding + 1 })).rejects.toThrow(
      "layoutElk.padding must be a finite number between 0 and",
    );

    const huge = rect("huge", ELK_LAYOUT_LIMITS.dimension + 1, 10);
    await expect(layoutElk(scene([huge]))).rejects.toThrow(
      "layout width must be finite and between 0 and",
    );

    const longId = "x".repeat(ELK_LAYOUT_LIMITS.idLength + 1);
    await expect(layoutElk(scene([rect(longId)]))).rejects.toThrow(
      "Node id must be a non-empty string of at most",
    );

    const tooMany = Array.from(
      { length: ELK_LAYOUT_LIMITS.nodes + 1 },
      (_, index) => rect("n" + index, 1, 1),
    );
    await expect(layoutElk(scene(tooMany))).rejects.toThrow(
      "layoutElk supports at most " + ELK_LAYOUT_LIMITS.nodes + " nodes",
    );
  });
});
