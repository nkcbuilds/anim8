import { describe, expect, it } from "vitest";
import { defaultStyle, defaultTransform, ease, evaluate, validateScene, type SceneDocument } from "../src/index.js";

const scene: SceneDocument = {
  version: "1.0",
  scene: { width: 800, height: 450 },
  objects: [{
    id: "a", type: "rect", width: 100, height: 60, text: "A",
    transform: { ...defaultTransform(), x: 100, y: 100 },
    style: defaultStyle(), visible: true, z: 0,
  }],
  timeline: [
    { id: "move", type: "move", target: "a", start: 0, duration: 1000, easing: "linear", to: { x: 300, y: 100 } },
    { id: "rotate", type: "rotate", target: "a", start: 0, duration: 1000, easing: "linear", to: 90 },
  ],
};

describe("evaluate", () => {
  it("is random-access deterministic", () => {
    const first = evaluate(scene, 500);
    evaluate(scene, 900);
    evaluate(scene, 100);
    const second = evaluate(scene, 500);
    expect(second).toEqual(first);
    expect(first.objects[0]?.transform.x).toBe(200);
    expect(first.objects[0]?.transform.rotation).toBe(45);
  });

  it("clamps time without frame-history dependence", () => {
    expect(evaluate(scene, -100).time).toBe(0);
    expect(evaluate(scene, 5000).time).toBe(1000);
  });

  it("rejects overlapping writes to the same property", () => {
    const conflicting: SceneDocument = {
      ...scene,
      timeline: [
        { id: "m1", type: "move", target: "a", start: 0, duration: 1000, to: { x: 200, y: 100 } },
        { id: "m2", type: "move", target: "a", start: 500, duration: 500, to: { x: 400, y: 100 } },
      ],
    };
    expect(validateScene(conflicting).some(d => d.code === "OVERLAPPING_PROPERTY_ACTIONS")).toBe(true);
  });

  it("evaluates resize and stroke drawing by absolute time", () => {
    const expanded: SceneDocument = {
      version: "1.0",
      scene: { width: 500, height: 300 },
      objects: [
        {
          id: "box", type: "rect", width: 100, height: 40,
          transform: defaultTransform(), style: defaultStyle(), visible: true, z: 0,
        },
        {
          id: "oval", type: "ellipse", rx: 40, ry: 20,
          transform: defaultTransform(), style: defaultStyle(), visible: true, z: 1,
        },
        {
          id: "path", type: "path", d: "M 0 0 L 100 0", drawProgress: 0,
          transform: defaultTransform(), style: { ...defaultStyle(), fill: "none" }, visible: true, z: 2,
        },
      ],
      timeline: [
        { id: "resize-box", type: "resize", target: "box", start: 0, duration: 1000, easing: "linear", to: { width: 200, height: 80 } },
        { id: "resize-oval", type: "resize", target: "oval", start: 0, duration: 1000, easing: "linear", to: { width: 120, height: 80 } },
        { id: "draw-path", type: "draw", target: "path", start: 0, duration: 1000, easing: "linear", to: 1 },
      ],
    };

    const first = evaluate(expanded, 500);
    evaluate(expanded, 900);
    evaluate(expanded, 100);
    const second = evaluate(expanded, 500);
    expect(second).toEqual(first);

    const box = first.objects.find(object => object.id === "box");
    const oval = first.objects.find(object => object.id === "oval");
    const path = first.objects.find(object => object.id === "path");
    expect(box?.type === "rect" && { width: box.width, height: box.height }).toEqual({ width: 150, height: 60 });
    expect(oval?.type === "ellipse" && { rx: oval.rx, ry: oval.ry }).toEqual({ rx: 50, ry: 30 });
    expect(path?.type === "path" && path.drawProgress).toBe(0.5);
  });

  it("diagnoses unsupported or ambiguous geometric actions", () => {
    const invalid: SceneDocument = {
      version: "1.0",
      scene: { width: 300, height: 200 },
      objects: [
        {
          id: "circle", type: "circle", radius: 20,
          transform: defaultTransform(), style: defaultStyle(), visible: true, z: 0,
        },
        {
          id: "path", type: "path", d: "M 0 0 L 10 10",
          transform: defaultTransform(), style: defaultStyle(), visible: true, z: 1,
        },
      ],
      timeline: [
        { id: "bad-circle", type: "resize", target: "circle", start: 0, duration: 100, to: { width: 80, height: 40 } },
        { id: "bad-resize", type: "resize", target: "path", start: 0, duration: 100, to: { width: 80, height: 40 } },
        { id: "bad-draw", type: "draw", target: "circle", start: 0, duration: 100, to: 1 },
      ],
    };
    const codes = validateScene(invalid).map(diagnostic => diagnostic.code);
    expect(codes).toContain("INVALID_CIRCLE_RESIZE");
    expect(codes).toContain("UNSUPPORTED_RESIZE_TARGET");
    expect(codes).toContain("UNSUPPORTED_DRAW_TARGET");
  });

  it("follows explicit polyline points by arc length with random-access evaluation", () => {
    const pathScene: SceneDocument = {
      version: "1.0",
      scene: { width: 500, height: 500 },
      objects: [{
        id: "dot", type: "circle", radius: 5,
        transform: { ...defaultTransform(), x: 0, y: 0 },
        style: defaultStyle(), visible: true, z: 0,
      }],
      timeline: [{
        id: "route",
        type: "followPath",
        target: "dot",
        start: 0,
        duration: 1000,
        easing: "linear",
        points: [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 300 }],
      }],
    };

    const midpoint = evaluate(pathScene, 500);
    evaluate(pathScene, 900);
    evaluate(pathScene, 100);
    expect(evaluate(pathScene, 500)).toEqual(midpoint);
    expect(midpoint.objects[0]?.transform).toEqual(expect.objectContaining({ x: 100, y: 100 }));
    expect(evaluate(pathScene, 0).objects[0]?.transform).toEqual(expect.objectContaining({ x: 0, y: 0 }));
    expect(evaluate(pathScene, 1000).objects[0]?.transform).toEqual(expect.objectContaining({ x: 100, y: 300 }));
  });

  it("validates followPath geometry and treats it as an x/y writer for overlap detection", () => {
    const invalid: SceneDocument = {
      version: "1.0",
      scene: { width: 300, height: 200 },
      objects: [{
        id: "a", type: "rect", width: 20, height: 20,
        transform: defaultTransform(), style: defaultStyle(), visible: true, z: 0,
      }],
      timeline: [
        { id: "route", type: "followPath", target: "a", start: 0, duration: 1000, points: [{ x: 0, y: 0 }, { x: 0, y: 0 }] },
        { id: "move", type: "move", target: "a", start: 500, duration: 200, to: { x: 10, y: 10 } },
      ],
    };

    const diagnostics = validateScene(invalid);
    expect(diagnostics).toContainEqual(expect.objectContaining({ code: "INVALID_FOLLOW_PATH", path: "timeline[0].points" }));
    expect(diagnostics).toContainEqual(expect.objectContaining({ code: "OVERLAPPING_PROPERTY_ACTIONS", path: "timeline[1]" }));
  });

  it("resolves the default camera for legacy scenes", () => {
    const legacy: SceneDocument = {
      version: "1.0",
      scene: { width: 320, height: 180 },
      objects: [],
      timeline: [],
    };
    expect(evaluate(legacy, 0).camera).toEqual({ x: 0, y: 0, zoom: 1 });
  });

  it("evaluates camera pan/zoom by absolute time with deterministic seek and reverse sampling", () => {
    const cameraScene: SceneDocument = {
      version: "1.0",
      scene: {
        width: 800,
        height: 450,
        camera: { x: 10, y: -20, zoom: 1 },
      },
      objects: [],
      timeline: [
        { id: "camera-a", type: "camera", start: 0, duration: 1000, easing: "linear", to: { x: 110, zoom: 2 } },
        { id: "camera-b", type: "camera", start: 1000, duration: 1000, easing: "linear", to: { y: 80, zoom: 1 } },
      ],
    };

    expect(evaluate(cameraScene, 500).camera).toEqual({ x: 60, y: -20, zoom: 1.5 });
    expect(evaluate(cameraScene, 1500).camera).toEqual({ x: 110, y: 30, zoom: 1.5 });

    const forward = [0, 250, 500, 750, 1000, 1250, 1500, 1750, 2000]
      .map(time => [time, evaluate(cameraScene, time).camera] as const);
    const reverse = [...forward].reverse().map(([time]) => [time, evaluate(cameraScene, time).camera] as const);
    expect(reverse).toEqual([...forward].reverse());
    expect(evaluate(cameraScene, 500)).toEqual(evaluate(cameraScene, 500));
  });

  it("diagnoses invalid and overlapping camera writes without object targets", () => {
    const cameraScene: SceneDocument = {
      version: "1.0",
      scene: { width: 320, height: 180, camera: { x: 0, y: 0, zoom: 0 } },
      objects: [],
      timeline: [
        { id: "camera-a", type: "camera", start: 0, duration: 1000, to: { x: 100 } },
        { id: "camera-b", type: "camera", start: 500, duration: 500, to: { x: 200, zoom: 2 } },
      ],
    };
    const diagnostics = validateScene(cameraScene);
    expect(diagnostics).toContainEqual(expect.objectContaining({ code: "INVALID_CAMERA", path: "scene.camera" }));
    expect(diagnostics).toContainEqual(expect.objectContaining({ code: "OVERLAPPING_PROPERTY_ACTIONS", path: "timeline[1]" }));
    expect(diagnostics.some(item => item.code === "UNKNOWN_OBJECT")).toBe(false);
  });

  it("provides a fixed deterministic spring easing with exact endpoints", () => {
    expect(ease("spring", 0)).toBe(0);
    expect(ease("spring", 1)).toBe(1);
    const first = ease("spring", 0.3);
    const second = ease("spring", 0.3);
    expect(Number.isFinite(first)).toBe(true);
    expect(second).toBe(first);
    expect(first).toBeGreaterThan(1);
  });
});
