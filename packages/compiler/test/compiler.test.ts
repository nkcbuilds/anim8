import { describe, expect, it } from "vitest";
import { COMPILER_LIMITS, compile, compileJson } from "../src/index.js";

function baseScene(objects: unknown[] = [], timeline: unknown[] = []) {
  return {
    version: "1.0",
    scene: { width: 800, height: 450 },
    objects,
    timeline,
  };
}

describe("compiler", () => {
  it("normalizes a minimal scene", () => {
    const result = compile(baseScene(
      [{ id: "a", type: "rect", width: 100, height: 60 }],
      [{ id: "m", type: "move", target: "a", start: 0, duration: 500, to: { x: 200, y: 100 } }],
    ));
    expect(result.ok).toBe(true);
    expect(result.scene?.objects[0]?.transform.scaleX).toBe(1);
    expect(result.scene?.scene.camera).toEqual({ x: 0, y: 0, zoom: 1 });
  });

  it("returns structured repair-friendly diagnostics", () => {
    const result = compile(baseScene(
      [],
      [{ id: "m", type: "move", target: "missing", start: 0, duration: 500, to: { x: 200, y: 100 } }],
    ));
    expect(result.ok).toBe(false);
    expect(result.scene).toBeUndefined();
    expect(result.diagnostics).toContainEqual(expect.objectContaining({
      code: "UNKNOWN_OBJECT",
      path: "timeline[0].target",
    }));
  });

  it("handles malformed JSON without throwing", () => {
    expect(compileJson("{oops").diagnostics[0]?.code).toBe("INVALID_JSON");
  });

  it("rejects JSON before parsing when the source byte limit is exceeded", () => {
    const source = " ".repeat(COMPILER_LIMITS.sourceBytes + 1);
    const result = compileJson(source);
    expect(result).toEqual({
      ok: false,
      diagnostics: [expect.objectContaining({ code: "LIMIT_SOURCE_BYTES", path: "$" })],
    });
  });

  it("rejects oversized object and timeline collections during preflight", () => {
    const tooManyObjects = Array.from(
      { length: COMPILER_LIMITS.objects + 1 },
      (_, index) => ({ id: `n_${index}`, type: "rect" }),
    );
    expect(compile(baseScene(tooManyObjects)).diagnostics).toContainEqual(
      expect.objectContaining({ code: "LIMIT_OBJECTS", path: "objects" }),
    );

    const tooManyActions = Array.from(
      { length: COMPILER_LIMITS.timelineActions + 1 },
      (_, index) => ({ id: `a_${index}`, type: "visibility", target: "n", start: 0, duration: 0, visible: true }),
    );
    expect(compile(baseScene([], tooManyActions)).diagnostics).toContainEqual(
      expect.objectContaining({ code: "LIMIT_TIMELINE_ACTIONS", path: "timeline" }),
    );
  });

  it("compiles bounded scene camera state and targetless camera actions", () => {
    const result = compile({
      ...baseScene([], [
        {
          id: "camera",
          type: "camera",
          start: 0,
          duration: 800,
          easing: "easeInOut",
          to: { x: 120, y: -40, zoom: 2 },
        },
      ]),
      scene: {
        width: 800,
        height: 450,
        camera: { x: 10, y: 20, zoom: 1.25 },
      },
    });

    expect(result.ok).toBe(true);
    expect(result.scene?.scene.camera).toEqual({ x: 10, y: 20, zoom: 1.25 });
    expect(result.scene?.timeline[0]).toEqual({
      id: "camera",
      type: "camera",
      start: 0,
      duration: 800,
      easing: "easeInOut",
      to: { x: 120, y: -40, zoom: 2 },
    });
    expect("target" in result.scene!.timeline[0]!).toBe(false);
  });

  it("enforces camera zoom and pan resource bounds", () => {
    const baseZoom = compile({
      ...baseScene(),
      scene: {
        width: 800,
        height: 450,
        camera: { x: 0, y: 0, zoom: COMPILER_LIMITS.cameraZoomMax + 1 },
      },
    });
    expect(baseZoom.diagnostics).toContainEqual(
      expect.objectContaining({ code: "LIMIT_CAMERA_ZOOM", path: "scene.camera.zoom" }),
    );

    const actionZoom = compile(baseScene([], [{
      id: "camera",
      type: "camera",
      start: 0,
      duration: 100,
      to: { zoom: COMPILER_LIMITS.cameraZoomMin / 2 },
    }]));
    expect(actionZoom.diagnostics).toContainEqual(
      expect.objectContaining({ code: "LIMIT_CAMERA_ZOOM", path: "timeline[0].to.zoom" }),
    );

    const pan = compile(baseScene([], [{
      id: "camera",
      type: "camera",
      start: 0,
      duration: 100,
      to: { x: COMPILER_LIMITS.absoluteNumber + 1 },
    }]));
    expect(pan.diagnostics).toContainEqual(
      expect.objectContaining({ code: "INVALID_CAMERA_TARGET", path: "timeline[0].to.x" }),
    );

    const empty = compile(baseScene([], [{
      id: "camera",
      type: "camera",
      start: 0,
      duration: 100,
      to: {},
    }]));
    expect(empty.diagnostics).toContainEqual(
      expect.objectContaining({ code: "INVALID_CAMERA_TARGET", path: "timeline[0].to" }),
    );

    const targeted = compile(baseScene([], [{
      id: "camera",
      type: "camera",
      target: "anything",
      start: 0,
      duration: 100,
      to: { x: 10 },
    }]));
    expect(targeted.diagnostics).toContainEqual(
      expect.objectContaining({ code: "INVALID_CAMERA_ACTION", path: "timeline[0].target" }),
    );

    const overlap = compile(baseScene([], [
      { id: "camera-a", type: "camera", start: 0, duration: 1000, to: { x: 100 } },
      { id: "camera-b", type: "camera", start: 500, duration: 500, to: { x: 200 } },
    ]));
    expect(overlap.diagnostics).toContainEqual(
      expect.objectContaining({ code: "OVERLAPPING_PROPERTY_ACTIONS", path: "timeline[1]" }),
    );
  });

  it("enforces scene dimension and pixel ceilings", () => {
    const dimension = compile({
      ...baseScene(),
      scene: { width: COMPILER_LIMITS.sceneDimension + 1, height: 1 },
    });
    expect(dimension.diagnostics).toContainEqual(
      expect.objectContaining({ code: "LIMIT_SCENE_DIMENSION", path: "scene" }),
    );

    const pixels = compile({
      ...baseScene(),
      scene: { width: COMPILER_LIMITS.sceneDimension, height: COMPILER_LIMITS.sceneDimension },
    });
    expect(pixels.diagnostics).toContainEqual(
      expect.objectContaining({ code: "LIMIT_SCENE_PIXELS", path: "scene" }),
    );
  });

  it("enforces bounded path and group-child resources", () => {
    const path = compile(baseScene([
      { id: "p", type: "path", d: "M".repeat(COMPILER_LIMITS.pathLength + 1) },
    ]));
    expect(path.diagnostics).toContainEqual(
      expect.objectContaining({ code: "LIMIT_PATH_LENGTH", path: "objects[0].d" }),
    );

    const children = compile(baseScene([
      {
        id: "g",
        type: "group",
        children: Array.from({ length: COMPILER_LIMITS.groupChildren + 1 }, (_, index) => `n_${index}`),
      },
    ]));
    expect(children.diagnostics).toContainEqual(
      expect.objectContaining({ code: "LIMIT_GROUP_CHILDREN", path: "objects[0].children" }),
    );
  });

  it("validates ids and detects duplicate object/action ids", () => {
    const invalid = compile(baseScene([{ id: "bad id", type: "rect" }]));
    expect(invalid.diagnostics).toContainEqual(
      expect.objectContaining({ code: "INVALID_ID", path: "objects[0].id" }),
    );

    const duplicateObjects = compile(baseScene([
      { id: "same", type: "rect" },
      { id: "same", type: "circle" },
    ]));
    expect(duplicateObjects.diagnostics).toContainEqual(
      expect.objectContaining({ code: "DUPLICATE_ID", path: "objects[1].id" }),
    );

    const duplicateActions = compile(baseScene(
      [{ id: "n", type: "rect" }],
      [
        { id: "a", type: "visibility", target: "n", start: 0, duration: 0, visible: true },
        { id: "a", type: "visibility", target: "n", start: 1, duration: 0, visible: false },
      ],
    ));
    expect(duplicateActions.diagnostics).toContainEqual(
      expect.objectContaining({ code: "DUPLICATE_ACTION_ID", path: "timeline[1].id" }),
    );
  });

  it("accepts a consistent group parent graph", () => {
    const result = compile(baseScene([
      { id: "g", type: "group", children: ["child"] },
      { id: "child", type: "rect", parentId: "g" },
    ]));
    expect(result.ok).toBe(true);
    expect(result.scene?.objects[1]).toEqual(expect.objectContaining({ parentId: "g" }));
  });

  it("rejects unknown/non-group parents and group-parent mismatches", () => {
    const unknown = compile(baseScene([
      { id: "child", type: "rect", parentId: "missing" },
    ]));
    expect(unknown.diagnostics).toContainEqual(
      expect.objectContaining({ code: "UNKNOWN_PARENT", path: "objects[0].parentId" }),
    );

    const wrongType = compile(baseScene([
      { id: "parent", type: "rect" },
      { id: "child", type: "rect", parentId: "parent" },
    ]));
    expect(wrongType.diagnostics).toContainEqual(
      expect.objectContaining({ code: "INVALID_PARENT_TYPE", path: "objects[1].parentId" }),
    );

    const mismatch = compile(baseScene([
      { id: "g", type: "group", children: [] },
      { id: "child", type: "rect", parentId: "g" },
    ]));
    expect(mismatch.diagnostics).toContainEqual(
      expect.objectContaining({ code: "PARENT_GROUP_CHILD_MISMATCH", path: "objects[1].parentId" }),
    );
  });

  it("detects parent cycles before rendering can recurse through them", () => {
    const result = compile(baseScene([
      { id: "a", type: "group", parentId: "b", children: ["b"] },
      { id: "b", type: "group", parentId: "a", children: ["a"] },
    ]));
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({ code: "PARENT_CYCLE", path: "objects[1].parentId" }),
    );
  });

  it("strictly validates connector endpoint shapes, anchors, and references", () => {
    const anchor = compile(baseScene([
      { id: "a", type: "rect" },
      { id: "b", type: "rect" },
      { id: "edge", type: "connector", from: { objectId: "a", anchor: "diagonal" }, to: { objectId: "b" } },
    ]));
    expect(anchor.diagnostics).toContainEqual(
      expect.objectContaining({ code: "INVALID_CONNECTOR_ANCHOR", path: "objects[2].from.anchor" }),
    );

    const missing = compile(baseScene([
      { id: "a", type: "rect" },
      { id: "edge", type: "connector", from: { objectId: "a" }, to: { objectId: "missing" } },
    ]));
    expect(missing.diagnostics).toContainEqual(
      expect.objectContaining({ code: "UNKNOWN_CONNECTOR_OBJECT", path: "objects[1].to.objectId" }),
    );

    const self = compile(baseScene([
      { id: "a", type: "rect" },
      { id: "edge", type: "connector", from: { objectId: "a" }, to: { objectId: "a" } },
    ]));
    expect(self.diagnostics).toContainEqual(
      expect.objectContaining({ code: "CONNECTOR_SAME_ENDPOINT", path: "objects[1].to.objectId" }),
    );
  });

  it("rejects connectors that target other connectors", () => {
    const result = compile(baseScene([
      { id: "a", type: "rect" },
      { id: "b", type: "rect" },
      { id: "edge1", type: "connector", from: { objectId: "a" }, to: { objectId: "b" } },
      { id: "edge2", type: "connector", from: { objectId: "edge1" }, to: { objectId: "b" } },
    ]));
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({ code: "INVALID_CONNECTOR_TARGET", path: "objects[3].from.objectId" }),
    );
  });

  it.each([
    "javascript:alert(1)",
    "data:image/png;base64,AAAA",
    "blob:https://example.com/id",
    "file:///tmp/a.png",
    "http://example.com/a.png",
    "//example.com/a.png",
    "#local-image",
    "https://user:pass@example.com/a.png",
    "https://127.0.0.1/a.png",
    "https://[::1]/a.png",
    "https://example.com/a b.png",
  ])("rejects unsafe image URL %s", href => {
    const result = compile(baseScene([
      { id: "img", type: "image", href },
    ]));
    expect(result.ok).toBe(false);
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({ code: "UNSAFE_IMAGE_URL", path: "objects[0].href" }),
    );
  });

  it.each([
    "images/a.png",
    "/assets/a.png",
    "../assets/a.png",
    "https://example.com/a.png",
  ])("allows safe image URL %s", href => {
    const result = compile(baseScene([
      { id: "img", type: "image", href },
    ]));
    expect(result.ok).toBe(true);
    expect(result.scene?.objects[0]).toEqual(expect.objectContaining({ href }));
  });

  it("keeps diagnostics deterministic for automated repair", () => {
    const input = baseScene(
      [
        { id: "same", type: "rect" },
        { id: "same", type: "circle" },
      ],
      [{ id: "move", type: "move", target: "missing", start: 0, duration: 10, to: { x: 1, y: 2 } }],
    );
    const first = compile(input).diagnostics;
    const second = compile(input).diagnostics;
    expect(first).toEqual(second);
    expect(first.map(item => `${item.path}:${item.code}`)).toEqual(
      [...first.map(item => `${item.path}:${item.code}`)].sort(),
    );
  });

  it("compiles bounded declarative state and bindings", () => {
    const result = compile({
      ...baseScene([{ id: "pointer", type: "text", text: "i" }]),
      state: { index: 0 },
      bindings: [{
        id: "pointer-x",
        target: { objectId: "pointer", property: "x" },
        expression: {
          kind: "op",
          op: "add",
          args: [
            { kind: "literal", value: 50 },
            { kind: "op", op: "mul", args: [
              { kind: "get", path: "inputs.index" },
              { kind: "literal", value: 80 },
            ] },
          ],
        },
      }],
    });
    expect(result.ok).toBe(true);
    expect(result.scene?.state).toEqual({ index: 0 });
    expect(result.scene?.bindings?.[0]).toEqual(expect.objectContaining({ id: "pointer-x" }));
  });

  it("rejects unsafe expression paths and action-binding conflicts", () => {
    const unsafe = compile({
      ...baseScene([{ id: "a", type: "rect" }]),
      bindings: [{
        id: "bad",
        target: { objectId: "a", property: "x" },
        expression: { kind: "get", path: "window.location" },
      }],
    });
    expect(unsafe.diagnostics).toContainEqual(expect.objectContaining({ code: "INVALID_EXPRESSION_PATH" }));

    const conflict = compile({
      ...baseScene(
        [{ id: "a", type: "rect" }],
        [{ id: "move", type: "move", target: "a", start: 0, duration: 100, to: { x: 10, y: 20 } }],
      ),
      bindings: [{
        id: "x",
        target: { objectId: "a", property: "x" },
        expression: { kind: "literal", value: 5 },
      }],
    });
    expect(conflict.diagnostics).toContainEqual(expect.objectContaining({ code: "BINDING_ACTION_CONFLICT" }));
  });

  it("compiles ellipse, polygon, polyline, and path drawProgress", () => {
    const result = compile(baseScene([
      { id: "e", type: "ellipse", rx: 0, ry: 20, text: "oval" },
      { id: "pg", type: "polygon", points: [{ x: 0, y: 0 }, { x: 30, y: 0 }, { x: 15, y: 20 }], drawProgress: 0.25 },
      { id: "pl", type: "polyline", points: [{ x: 0, y: 0 }, { x: 10, y: 10 }], drawProgress: 1 },
      { id: "p", type: "path", d: "M0 0 L10 10", drawProgress: 0 },
    ]));

    expect(result.ok).toBe(true);
    expect(result.scene?.objects).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "e", type: "ellipse", rx: 0, ry: 20, text: "oval" }),
      expect.objectContaining({ id: "pg", type: "polygon", drawProgress: 0.25 }),
      expect.objectContaining({ id: "pl", type: "polyline", drawProgress: 1 }),
      expect.objectContaining({ id: "p", type: "path", drawProgress: 0 }),
    ]));
  });

  it("rejects invalid ellipse, point geometry, and drawProgress", () => {
    const ellipse = compile(baseScene([
      { id: "e", type: "ellipse", rx: -1, ry: 10 },
    ]));
    expect(ellipse.diagnostics).toContainEqual(
      expect.objectContaining({ code: "INVALID_DIMENSION", path: "objects[0].rx" }),
    );

    const missingEllipseRadius = compile(baseScene([
      { id: "e", type: "ellipse", ry: 10 },
    ]));
    expect(missingEllipseRadius.diagnostics).toContainEqual(
      expect.objectContaining({ code: "INVALID_DIMENSION", path: "objects[0].rx" }),
    );

    const polygon = compile(baseScene([
      { id: "pg", type: "polygon", points: [{ x: 0, y: 0 }, { x: 1, y: 1 }] },
    ]));
    expect(polygon.diagnostics).toContainEqual(
      expect.objectContaining({ code: "INVALID_POINTS", path: "objects[0].points" }),
    );

    const point = compile(baseScene([
      { id: "pl", type: "polyline", points: [{ x: 0, y: 0 }, { x: Infinity, y: 1 }] },
    ]));
    expect(point.diagnostics).toContainEqual(
      expect.objectContaining({ code: "INVALID_POINT", path: "objects[0].points[1]" }),
    );

    const drawProgress = compile(baseScene([
      { id: "p", type: "path", d: "M0 0", drawProgress: 1.01 },
    ]));
    expect(drawProgress.diagnostics).toContainEqual(
      expect.objectContaining({ code: "INVALID_DRAW_PROGRESS", path: "objects[0].drawProgress" }),
    );
  });

  it("enforces the per-object point resource limit before traversing points", () => {
    const result = compile(baseScene([{
      id: "pg",
      type: "polygon",
      points: Array.from({ length: COMPILER_LIMITS.pointsPerObject + 1 }, () => ({ x: 0, y: 0 })),
    }]));

    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({ code: "LIMIT_POINTS", path: "objects[0].points" }),
    );
  });

  it("compiles resize and draw actions with core target semantics", () => {
    const result = compile(baseScene(
      [
        { id: "rect", type: "rect", width: 40, height: 20 },
        { id: "ellipse", type: "ellipse", rx: 20, ry: 10 },
        { id: "circle", type: "circle", radius: 10 },
        { id: "path", type: "path", d: "M0 0 L10 10" },
        { id: "polygon", type: "polygon", points: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 5, y: 10 }] },
      ],
      [
        { id: "resize-rect", type: "resize", target: "rect", start: 0, duration: 100, to: { width: 0, height: 50 } },
        { id: "resize-ellipse", type: "resize", target: "ellipse", start: 100, duration: 100, to: { width: 80, height: 40 } },
        { id: "resize-circle", type: "resize", target: "circle", start: 200, duration: 100, to: { width: 30, height: 30 } },
        { id: "draw-path", type: "draw", target: "path", start: 300, duration: 100, to: 0.5 },
        { id: "draw-polygon", type: "draw", target: "polygon", start: 400, duration: 100, to: 1 },
      ],
    ));

    expect(result.ok).toBe(true);
    expect(result.scene?.timeline).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "resize-rect", type: "resize", to: { width: 0, height: 50 } }),
      expect.objectContaining({ id: "draw-path", type: "draw", to: 0.5 }),
    ]));
  });

  it("rejects invalid resize/draw values and unsupported targets", () => {
    const invalidResize = compile(baseScene(
      [{ id: "r", type: "rect" }],
      [{ id: "resize", type: "resize", target: "r", start: 0, duration: 1, to: { width: -1, height: 10 } }],
    ));
    expect(invalidResize.diagnostics).toContainEqual(
      expect.objectContaining({ code: "INVALID_RESIZE_TARGET", path: "timeline[0].to" }),
    );

    const circle = compile(baseScene(
      [{ id: "c", type: "circle", radius: 10 }],
      [{ id: "resize", type: "resize", target: "c", start: 0, duration: 1, to: { width: 20, height: 30 } }],
    ));
    expect(circle.diagnostics).toContainEqual(
      expect.objectContaining({ code: "INVALID_CIRCLE_RESIZE", path: "timeline[0].to" }),
    );

    const resizeTarget = compile(baseScene(
      [{ id: "p", type: "path", d: "M0 0" }],
      [{ id: "resize", type: "resize", target: "p", start: 0, duration: 1, to: { width: 10, height: 10 } }],
    ));
    expect(resizeTarget.diagnostics).toContainEqual(
      expect.objectContaining({ code: "UNSUPPORTED_RESIZE_TARGET", path: "timeline[0].target" }),
    );

    const invalidDraw = compile(baseScene(
      [{ id: "p", type: "path", d: "M0 0" }],
      [{ id: "draw", type: "draw", target: "p", start: 0, duration: 1, to: 2 }],
    ));
    expect(invalidDraw.diagnostics).toContainEqual(
      expect.objectContaining({ code: "INVALID_DRAW_PROGRESS", path: "timeline[0].to" }),
    );

    const drawTarget = compile(baseScene(
      [{ id: "r", type: "rect" }],
      [{ id: "draw", type: "draw", target: "r", start: 0, duration: 1, to: 0.5 }],
    ));
    expect(drawTarget.diagnostics).toContainEqual(
      expect.objectContaining({ code: "UNSUPPORTED_DRAW_TARGET", path: "timeline[0].target" }),
    );
  });

  it("allows text bindings on ellipses", () => {
    const result = compile({
      ...baseScene([{ id: "e", type: "ellipse", rx: 20, ry: 10, text: "before" }]),
      bindings: [{
        id: "label",
        target: { objectId: "e", property: "text" },
        expression: { kind: "literal", value: "after" },
      }],
    });

    expect(result.ok).toBe(true);
    expect(result.scene?.bindings?.[0]).toEqual(expect.objectContaining({
      target: { objectId: "e", property: "text" },
    }));
  });

  it("compiles explicit followPath actions and the deterministic spring easing", () => {
    const result = compile(baseScene(
      [{ id: "dot", type: "circle", radius: 5 }],
      [{
        id: "route",
        type: "followPath",
        target: "dot",
        start: 0,
        duration: 800,
        easing: "spring",
        points: [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 300 }],
      }],
    ));

    expect(result.ok).toBe(true);
    expect(result.scene?.timeline[0]).toEqual(expect.objectContaining({
      type: "followPath",
      easing: "spring",
      points: [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 300 }],
    }));
  });

  it("rejects malformed, degenerate, and oversized followPath point arrays", () => {
    const tooShort = compile(baseScene(
      [{ id: "dot", type: "circle", radius: 5 }],
      [{ id: "route", type: "followPath", target: "dot", start: 0, duration: 100, points: [{ x: 0, y: 0 }] }],
    ));
    expect(tooShort.diagnostics).toContainEqual(
      expect.objectContaining({ code: "INVALID_FOLLOW_PATH", path: "timeline[0].points" }),
    );

    const degenerate = compile(baseScene(
      [{ id: "dot", type: "circle", radius: 5 }],
      [{ id: "route", type: "followPath", target: "dot", start: 0, duration: 100, points: [{ x: 4, y: 4 }, { x: 4, y: 4 }] }],
    ));
    expect(degenerate.diagnostics).toContainEqual(
      expect.objectContaining({ code: "INVALID_FOLLOW_PATH", path: "timeline[0].points" }),
    );

    const invalidPoint = compile(baseScene(
      [{ id: "dot", type: "circle", radius: 5 }],
      [{ id: "route", type: "followPath", target: "dot", start: 0, duration: 100, points: [{ x: 0, y: 0 }, { x: Infinity, y: 1 }] }],
    ));
    expect(invalidPoint.diagnostics).toContainEqual(
      expect.objectContaining({ code: "INVALID_FOLLOW_PATH_POINT", path: "timeline[0].points[1]" }),
    );

    const oversized = compile(baseScene(
      [{ id: "dot", type: "circle", radius: 5 }],
      [{
        id: "route",
        type: "followPath",
        target: "dot",
        start: 0,
        duration: 100,
        points: Array.from({ length: COMPILER_LIMITS.followPathPoints + 1 }, (_, index) => ({ x: index, y: 0 })),
      }],
    ));
    expect(oversized.diagnostics).toContainEqual(
      expect.objectContaining({ code: "LIMIT_FOLLOW_PATH_POINTS", path: "timeline[0].points" }),
    );
  });

  it("treats followPath as an x/y writer for binding conflicts", () => {
    const result = compile({
      ...baseScene(
        [{ id: "dot", type: "circle", radius: 5 }],
        [{
          id: "route",
          type: "followPath",
          target: "dot",
          start: 0,
          duration: 100,
          points: [{ x: 0, y: 0 }, { x: 20, y: 0 }],
        }],
      ),
      bindings: [{
        id: "x",
        target: { objectId: "dot", property: "x" },
        expression: { kind: "literal", value: 5 },
      }],
    });

    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({ code: "BINDING_ACTION_CONFLICT", path: "bindings[0].target.property" }),
    );
  });
});
