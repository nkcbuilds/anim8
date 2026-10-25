import { describe, expect, it } from "vitest";
import type { DrawableObject, SceneDocument } from "@anim8/core";
import { column, grid, layoutSize, radial, row, stack, tree } from "../src/index.js";

const transform = (x = 0, y = 0) => ({
  x,
  y,
  rotation: 0,
  scaleX: 1,
  scaleY: 1,
  opacity: 1,
});

type Rect = Extract<DrawableObject, { type: "rect" }>;
type Circle = Extract<DrawableObject, { type: "circle" }>;
type Ellipse = Extract<DrawableObject, { type: "ellipse" }>;
type Polygon = Extract<DrawableObject, { type: "polygon" }>;
type Polyline = Extract<DrawableObject, { type: "polyline" }>;

const rect = (id: string, width: number, height: number): Rect => ({
  id,
  type: "rect",
  width,
  height,
  transform: transform(999, 999),
  style: {},
  visible: true,
  z: 0,
});

const circle = (id: string, radius: number): Circle => ({
  id,
  type: "circle",
  radius,
  transform: transform(999, 999),
  style: {},
  visible: true,
  z: 0,
});

const ellipse = (id: string, rx: number, ry: number): Ellipse => ({
  id,
  type: "ellipse",
  rx,
  ry,
  transform: transform(999, 999),
  style: {},
  visible: true,
  z: 0,
});

const polygon = (id: string, points: Polygon["points"]): Polygon => ({
  id,
  type: "polygon",
  points,
  transform: transform(999, 999),
  style: {},
  visible: true,
  z: 0,
});

const polyline = (id: string, points: Polyline["points"]): Polyline => ({
  id,
  type: "polyline",
  points,
  transform: transform(999, 999),
  style: {},
  visible: true,
  z: 0,
});

const connector = (id: string, from: string, to: string): Extract<DrawableObject, { type: "connector" }> => ({
  id,
  type: "connector",
  from: { objectId: from, anchor: "bottom" },
  to: { objectId: to, anchor: "top" },
  kind: "orthogonal",
  transform: transform(321, 654),
  style: { stroke: "#111" },
  visible: true,
  z: -1,
});

describe("@anim8/layout", () => {
  it("lays out a row with edge gaps and preserves array/object identity", () => {
    const a = rect("a", 100, 40);
    const b = rect("b", 60, 80);
    const objects = [a, b];

    const result = row(objects, { x: 10, y: 20, gap: 30 });

    expect(result).toBe(objects);
    expect(result[0]).toBe(a);
    expect(result[1]).toBe(b);
    expect(a.transform).toMatchObject({ x: 60, y: 60 });
    expect(b.transform).toMatchObject({ x: 170, y: 60 });
    expect(b.transform.x - b.width / 2 - (a.transform.x + a.width / 2)).toBe(30);
  });

  it("uses core bounds for ellipse/polygon/polyline row sizing and preserves identity", () => {
    const e = ellipse("ellipse", 30, 20);
    const p = polygon("polygon", [
      { x: 0, y: 0 },
      { x: 40, y: 0 },
      { x: 40, y: 30 },
      { x: 0, y: 30 },
    ]);
    const l = polyline("polyline", [
      { x: -10, y: -5 },
      { x: 20, y: 15 },
      { x: 30, y: -5 },
    ]);
    const objects = [e, p, l];

    const result = row(objects, { x: 10, y: 20, gap: 5, align: "start" });

    expect(result).toBe(objects);
    expect(result[0]).toBe(e);
    expect(result[1]).toBe(p);
    expect(result[2]).toBe(l);
    expect(layoutSize(e)).toEqual({ width: 60, height: 40 });
    expect(layoutSize(p)).toEqual({ width: 40, height: 30 });
    expect(layoutSize(l)).toEqual({ width: 40, height: 20 });
    expect(e.transform).toMatchObject({ x: 40, y: 40 });
    expect(p.transform).toMatchObject({ x: 75, y: 20 });
    expect(l.transform).toMatchObject({ x: 130, y: 25 });
  });

  it("lays out ellipse/polygon/polyline in a grid without replacing SceneDocument objects", () => {
    const e = ellipse("ellipse", 30, 20);
    const p = polygon("polygon", [
      { x: 0, y: 0 },
      { x: 40, y: 0 },
      { x: 40, y: 30 },
      { x: 0, y: 30 },
    ]);
    const l = polyline("polyline", [
      { x: -10, y: -5 },
      { x: 20, y: 15 },
      { x: 30, y: -5 },
    ]);
    const document: SceneDocument = {
      version: "1.0",
      scene: { width: 300, height: 200 },
      objects: [e, p, l],
      timeline: [],
    };

    const result = grid(document, {
      columns: 2,
      columnGap: 10,
      rowGap: 10,
    });

    expect(result).toBe(document);
    expect(document.objects[0]).toBe(e);
    expect(document.objects[1]).toBe(p);
    expect(document.objects[2]).toBe(l);
    expect(e.transform).toMatchObject({ x: 30, y: 20 });
    expect(p.transform).toMatchObject({ x: 70, y: 5 });
    expect(l.transform).toMatchObject({ x: 20, y: 55 });
  });

  it("lays out a SceneDocument column in place without replacing objects", () => {
    const a = rect("a", 100, 20);
    const b = rect("b", 40, 60);
    const document: SceneDocument = {
      version: "1.0",
      scene: { width: 400, height: 300 },
      objects: [a, b],
      timeline: [],
    };

    const result = column(document, { x: 50, y: 10, gap: 12, align: "end" });

    expect(result).toBe(document);
    expect(document.objects[0]).toBe(a);
    expect(document.objects[1]).toBe(b);
    expect(a.transform).toMatchObject({ x: 100, y: 20 });
    expect(b.transform).toMatchObject({ x: 130, y: 72 });
  });

  it("uses stable per-column and per-row maxima for grid placement", () => {
    const a = rect("a", 100, 20);
    const b = rect("b", 20, 60);
    const c = rect("c", 40, 40);
    const d = rect("d", 80, 10);
    const objects = [a, b, c, d];

    grid(objects, {
      x: 0,
      y: 0,
      columns: 2,
      columnGap: 10,
      rowGap: 20,
      alignX: "center",
      alignY: "center",
    });

    expect({ x: a.transform.x, y: a.transform.y }).toEqual({ x: 50, y: 30 });
    expect({ x: b.transform.x, y: b.transform.y }).toEqual({ x: 150, y: 30 });
    expect({ x: c.transform.x, y: c.transform.y }).toEqual({ x: 50, y: 100 });
    expect({ x: d.transform.x, y: d.transform.y }).toEqual({ x: 150, y: 100 });
  });

  it("centers a stack without changing z-order and applies deterministic offsets", () => {
    const a = rect("a", 100, 80);
    const b = rect("b", 40, 20);
    a.z = 9;
    b.z = 2;

    stack([a, b], { x: 10, y: 20, offsetX: 5, offsetY: 7 });

    expect(a.transform).toMatchObject({ x: 60, y: 60 });
    expect(b.transform).toMatchObject({ x: 65, y: 67 });
    expect(a.z).toBe(9);
    expect(b.z).toBe(2);
  });

  it("accounts for scale and rotation when spacing measurable objects", () => {
    const a = rect("a", 100, 40);
    const b = circle("b", 10);
    a.transform.scaleX = 2;
    a.transform.rotation = 90;

    expect(layoutSize(a).width).toBeCloseTo(40);
    expect(layoutSize(a).height).toBeCloseTo(200);

    row([a, b], { gap: 10 });

    expect(a.transform.x).toBeCloseTo(20);
    expect(b.transform.x).toBeCloseTo(60);
  });

  it("is idempotent and independent of previous positions", () => {
    const objects = [rect("a", 30, 20), rect("b", 50, 10), circle("c", 15)];

    row(objects, { x: 7, y: 11, gap: 13, align: "start" });
    const first = objects.map(object => ({ x: object.transform.x, y: object.transform.y }));

    objects[0]!.transform.x = -1000;
    objects[1]!.transform.y = 5000;
    row(objects, { x: 7, y: 11, gap: 13, align: "start" });

    expect(objects.map(object => ({ x: object.transform.x, y: object.transform.y }))).toEqual(first);
  });

  it("treats unmeasured drawable kinds as point items deterministically", () => {
    const text: DrawableObject = {
      id: "label",
      type: "text",
      text: "hello",
      transform: transform(),
      style: { fontSize: 20 },
      visible: true,
      z: 0,
    };
    const box = rect("box", 40, 20);

    row([text, box], { x: 10, y: 20, gap: 5, align: "start" });

    expect(text.transform).toMatchObject({ x: 10, y: 20 });
    expect(box.transform).toMatchObject({ x: 35, y: 30 });
  });

  it("lays out radial nodes in stable input order and leaves connectors untouched", () => {
    const a = rect("a", 20, 20);
    const b = rect("b", 20, 20);
    const c = rect("c", 20, 20);
    const d = rect("d", 20, 20);
    const edge = connector("edge", "a", "b");
    const objects: DrawableObject[] = [a, edge, b, c, d];
    const connectorBefore = structuredClone(edge);
    const orderBefore = objects.map(object => object.id);

    const result = radial(objects, {
      centerX: 100,
      centerY: 100,
      radius: 50,
      startAngle: -90,
      direction: "clockwise",
    });

    expect(result).toBe(objects);
    expect(objects.map(object => object.id)).toEqual(orderBefore);
    expect(objects[1]).toBe(edge);
    expect(edge).toEqual(connectorBefore);
    expect(a.transform).toMatchObject({ x: 100, y: 50 });
    expect(b.transform).toMatchObject({ x: 150, y: 100 });
    expect(c.transform).toMatchObject({ x: 100, y: 150 });
    expect(d.transform).toMatchObject({ x: 50, y: 100 });
  });

  it("derives the same radial result for equivalent inputs", () => {
    const makeObjects = (): DrawableObject[] => [
      ellipse("a", 20, 10),
      polygon("b", [{ x: 0, y: 0 }, { x: 30, y: 0 }, { x: 15, y: 20 }]),
      polyline("c", [{ x: -10, y: -5 }, { x: 10, y: 5 }, { x: 20, y: -5 }]),
    ];
    const first = makeObjects();
    const second = makeObjects();

    radial(first, { centerX: 20, centerY: 30, gap: 12, startAngle: 15 });
    radial(second, { centerX: 20, centerY: 30, gap: 12, startAngle: 15 });

    expect(second.map(object => object.transform)).toEqual(first.map(object => object.transform));
  });

  it("lays out a basic connector-defined tree and preserves connector semantics", () => {
    const a = rect("a", 40, 20);
    const b = rect("b", 20, 20);
    const c = rect("c", 20, 20);
    const d = rect("d", 30, 10);
    const ab = connector("ab", "a", "b");
    const ac = connector("ac", "a", "c");
    const bd = connector("bd", "b", "d");
    const objects: DrawableObject[] = [a, ab, b, ac, c, bd, d];
    const orderBefore = objects.map(object => object.id);
    const connectorsBefore = [structuredClone(ab), structuredClone(ac), structuredClone(bd)];

    const result = tree(objects, {
      x: 5,
      y: 7,
      siblingGap: 10,
      levelGap: 20,
      orientation: "top-bottom",
    });

    expect(result).toBe(objects);
    expect(objects.map(object => object.id)).toEqual(orderBefore);
    expect(ab).toEqual(connectorsBefore[0]);
    expect(ac).toEqual(connectorsBefore[1]);
    expect(bd).toEqual(connectorsBefore[2]);
    expect(a.transform.x).toBeCloseTo(37.5);
    expect(a.transform.y).toBeCloseTo(17);
    expect(b.transform).toMatchObject({ x: 20, y: 57 });
    expect(c.transform).toMatchObject({ x: 55, y: 57 });
    expect(d.transform).toMatchObject({ x: 20, y: 92 });
  });

  it("supports deterministic horizontal tree orientation", () => {
    const a = rect("a", 40, 20);
    const b = rect("b", 20, 30);
    const edge = connector("ab", "a", "b");
    const objects: DrawableObject[] = [a, edge, b];

    tree(objects, {
      x: 10,
      y: 20,
      levelGap: 15,
      orientation: "left-right",
    });

    expect(a.transform).toMatchObject({ x: 30, y: 35 });
    expect(b.transform).toMatchObject({ x: 75, y: 35 });
    expect(edge.transform).toEqual(transform(321, 654));
  });

  it("is deterministic for equivalent tree inputs and rejects non-tree topology", () => {
    const makeDocument = (): SceneDocument => {
      const a = rect("a", 40, 20);
      const b = rect("b", 20, 20);
      const c = rect("c", 20, 20);
      return {
        version: "1.0",
        scene: { width: 300, height: 200 },
        objects: [a, connector("ab", "a", "b"), b, connector("ac", "a", "c"), c],
        timeline: [],
      };
    };

    const first = makeDocument();
    const second = makeDocument();
    tree(first, { siblingGap: 11, levelGap: 17, orientation: "bottom-top" });
    tree(second, { siblingGap: 11, levelGap: 17, orientation: "bottom-top" });
    expect(second.objects.map(object => object.transform)).toEqual(first.objects.map(object => object.transform));

    const multipleParents: DrawableObject[] = [
      rect("a", 10, 10),
      rect("b", 10, 10),
      rect("c", 10, 10),
      connector("ac", "a", "c"),
      connector("bc", "b", "c"),
    ];
    expect(() => tree(multipleParents)).toThrow("multiple parents");

    const cycle: DrawableObject[] = [
      rect("a", 10, 10),
      rect("b", 10, 10),
      connector("ab", "a", "b"),
      connector("ba", "b", "a"),
    ];
    expect(() => tree(cycle)).toThrow("cycle");
  });

  it("rejects invalid numeric options rather than producing NaN layout state", () => {
    const objects = [rect("a", 10, 10)];

    expect(() => row(objects, { gap: Number.NaN })).toThrow("row.gap must be a finite number");
    expect(() => grid(objects, { columns: 0 })).toThrow("grid.columns must be a positive integer");
    expect(() => grid(objects, { columns: 1.5 })).toThrow("grid.columns must be a positive integer");
    expect(() => radial(objects, { radius: -1 })).toThrow("radial.radius must be >= 0");
    expect(() => tree(objects, { levelGap: -1 })).toThrow("tree.levelGap must be >= 0");
  });
});
