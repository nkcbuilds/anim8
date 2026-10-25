import { describe, expect, it } from "vitest";
import { scene } from "../src/index.js";

describe("authoring", () => {
  it("builds compact swap semantics into deterministic primitive actions", () => {
    const s = scene({ width: 800, height: 450 });
    const a = s.box("2", { x: 100, y: 150 });
    const b = s.box("7", { x: 300, y: 150 });
    s.step("Swap", () => s.swap(a, b, { duration: 700 }));
    const doc = s.toJSON();
    expect(doc.scene.camera).toEqual({ x: 0, y: 0, zoom: 1 });
    expect(doc.timeline).toHaveLength(2);
    expect(doc.timeline[0]).toEqual(expect.objectContaining({ type: "move", target: a.id, start: 0, duration: 700 }));
    expect(doc.timeline[1]).toEqual(expect.objectContaining({ type: "move", target: b.id, start: 0, duration: 700 }));
  });

  it("authors ellipse, polygon, polyline, rounded rect, and path primitives", () => {
    const s = scene({ width: 640, height: 360 });
    const box = s.box("rounded", { id: "box", width: 120, height: 60, radius: 18 });
    const ellipse = s.ellipse("oval", { id: "oval", width: 100, height: 50 });
    const polygon = s.polygon([{ x: -30, y: 20 }, { x: 0, y: -30 }, { x: 30, y: 20 }], { id: "tri" });
    const polyline = s.polyline([{ x: 0, y: 0 }, { x: 20, y: 10 }, { x: 40, y: 0 }], { id: "line" });
    const path = s.path("M 0 0 C 20 -20 40 20 60 0", { id: "curve", drawProgress: 0 });
    const doc = s.toJSON();

    expect([box.id, ellipse.id, polygon.id, polyline.id, path.id]).toEqual(["box", "oval", "tri", "line", "curve"]);
    expect(doc.objects.find(object => object.id === "box")?.style.radius).toBe(18);
    expect(doc.objects.find(object => object.id === "oval")).toEqual(expect.objectContaining({ type: "ellipse", rx: 50, ry: 25 }));
    expect(doc.objects.find(object => object.id === "tri")).toEqual(expect.objectContaining({ type: "polygon" }));
    expect(doc.objects.find(object => object.id === "line")).toEqual(expect.objectContaining({ type: "polyline", style: expect.objectContaining({ fill: "none" }) }));
    expect(doc.objects.find(object => object.id === "curve")).toEqual(expect.objectContaining({ type: "path", drawProgress: 0 }));
  });

  it("authors deterministic path morphs with canonical cubic targets", () => {
    const s = scene({ width: 640, height: 360 });
    const path = s.path("M 0 0 L 60 0", { id: "shape" });
    s.sequence(path.morphTo("m 10 10 q 20 30 40 0", { duration: 800, easing: "linear" }));

    expect(s.toJSON().timeline).toEqual([
      expect.objectContaining({
        type: "morph",
        target: "shape",
        start: 0,
        duration: 800,
        easing: "linear",
        to: "M 10 10 C 23.3333333333333 30 36.6666666666667 30 50 10",
      }),
    ]);
  });

  it("rejects malformed, incompatible, and non-path authoring morphs", () => {
    const s = scene();
    const path = s.path("M 0 0 L 10 0", { id: "shape" });
    const box = s.box("", { id: "box" });

    expect(() => path.morphTo("M 0 0 A 10 10 0 0 0 20 20")).toThrow("not supported");
    expect(() => path.morphTo("M 0 0 L 5 0 L 10 0")).toThrow("different cubic segment counts");
    expect(() => box.morphTo("M 0 0 L 10 0")).toThrow("cannot be morphed");
  });

  it("serializes resize and stroke-draw actions without hidden runtime state", () => {
    const s = scene({ width: 640, height: 360 });
    const oval = s.ellipse("", { id: "oval", width: 80, height: 40 });
    const path = s.path("M 0 0 L 100 0", { id: "path", drawProgress: 0 });
    s.parallel(
      oval.resize({ width: 160, height: 80 }, { duration: 1000, easing: "linear" }),
      path.draw(1, { duration: 1000, easing: "linear" }),
    );
    const doc = s.toJSON();

    expect(doc.timeline).toEqual([
      expect.objectContaining({ type: "resize", target: "oval", start: 0, duration: 1000, to: { width: 160, height: 80 } }),
      expect.objectContaining({ type: "draw", target: "path", start: 0, duration: 1000, to: 1 }),
    ]);
  });

  it("resolves semantic positions deterministically and keeps shape bounds inside the scene", () => {
    const s = scene({ width: 800, height: 450 });
    const box = s.box("", { id: "box", width: 100, height: 60 });
    expect(s.at("top-left", 20)).toEqual({ x: 20, y: 20 });

    s.sequence(box.moveTo("bottom-right", { margin: 20, duration: 500, easing: "linear" }));
    const action = s.toJSON().timeline[0];
    expect(action).toEqual(expect.objectContaining({
      type: "move",
      target: "box",
      to: { x: 730, y: 400 },
    }));
  });

  it("rejects geometry-specific authoring operations on unsupported shapes", () => {
    const s = scene();
    const box = s.box();
    const path = s.path("M 0 0 L 10 10", { drawProgress: 0 });
    expect(() => box.draw()).toThrow("does not expose drawProgress");
    expect(() => path.resize({ width: 20, height: 20 })).toThrow("cannot be resized geometrically");
    expect(() => s.path("M 0 0 L 10 10", { drawProgress: 2 })).toThrow("drawProgress must be a finite number");
  });

  it("serializes explicit followPath points without renderer-dependent path state", () => {
    const s = scene({ width: 500, height: 400 });
    const dot = s.circle("", { id: "dot", x: 0, y: 0, width: 10 });
    const points = [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 300 }];
    s.sequence(dot.followPath(points, { duration: 900, easing: "spring" }));

    expect(s.toJSON().timeline).toEqual([
      expect.objectContaining({
        type: "followPath",
        target: "dot",
        duration: 900,
        easing: "spring",
        points,
      }),
    ]);

    points[1]!.x = 999;
    expect(s.toJSON().timeline[0]).toEqual(expect.objectContaining({
      points: [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 300 }],
    }));
  });

  it("compiles pulse and shake helpers to existing primitive scale/move actions", () => {
    const s = scene({ width: 500, height: 300 });
    const box = s.box("", { id: "box", x: 100, y: 120 });

    box.pulse({ duration: 400, scale: 1.1, easing: "linear" });
    box.shake({ duration: 400, distance: 10, axis: "x", easing: "linear" });

    const doc = s.toJSON();
    expect(doc.timeline.map(action => action.type)).toEqual([
      "scale",
      "scale",
      "move",
      "move",
      "move",
      "move",
    ]);
    expect(doc.timeline.slice(0, 2)).toEqual([
      expect.objectContaining({ type: "scale", start: 0, duration: 200, to: { x: 1.1, y: 1.1 } }),
      expect.objectContaining({ type: "scale", start: 200, duration: 200, to: { x: 1, y: 1 } }),
    ]);
    expect(doc.timeline.slice(2)).toEqual([
      expect.objectContaining({ type: "move", start: 400, duration: 100, to: { x: 110, y: 120 } }),
      expect.objectContaining({ type: "move", start: 500, duration: 100, to: { x: 90, y: 120 } }),
      expect.objectContaining({ type: "move", start: 600, duration: 100, to: { x: 110, y: 120 } }),
      expect.objectContaining({ type: "move", start: 700, duration: 100, to: { x: 100, y: 120 } }),
    ]);
    expect(doc.timeline.some(action => (action as { type: string }).type === "pulse" || (action as { type: string }).type === "shake")).toBe(false);
  });

  it("authors a serializable base camera and targetless camera motion", () => {
    const s = scene({
      width: 800,
      height: 450,
      camera: { x: 20, zoom: 1.25 },
    });
    s.sequence(s.cameraTo({ x: 120, y: -40, zoom: 2 }, { duration: 900, easing: "linear" }));

    const doc = s.toJSON();
    expect(doc.scene.camera).toEqual({ x: 20, y: 0, zoom: 1.25 });
    expect(doc.timeline).toEqual([
      {
        id: "camera_1",
        type: "camera",
        start: 0,
        duration: 900,
        easing: "linear",
        to: { x: 120, y: -40, zoom: 2 },
      },
    ]);
    expect("target" in doc.timeline[0]!).toBe(false);
  });

  it("rejects invalid camera authoring inputs", () => {
    const s = scene();
    expect(() => s.cameraTo({})).toThrow("must set at least one");
    expect(() => s.cameraTo({ zoom: 0 })).toThrow("zoom must be a finite number > 0");
    expect(() => scene({ camera: { zoom: -1 } }).toJSON()).toThrow("zoom must be a finite number > 0");
  });

  it("rejects invalid followPath, pulse, and shake helper inputs", () => {
    const s = scene();
    const box = s.box();
    expect(() => box.followPath([{ x: 0, y: 0 }])).toThrow("followPath requires at least 2 points");
    expect(() => box.followPath([{ x: 1, y: 1 }, { x: 1, y: 1 }])).toThrow("non-zero-length");
    expect(() => box.pulse({ scale: 0 })).toThrow("Pulse scale");
    expect(() => box.shake({ distance: 0 })).toThrow("Shake distance");
  });
});
