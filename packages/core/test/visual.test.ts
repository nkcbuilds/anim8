import { describe, expect, it } from "vitest";
import {
  DIAGRAM_ROLES,
  DIAGRAM_TONES,
  connectorGeometry,
  connectorMidpoint,
  defaultStyle,
  defaultTransform,
  diagramTone,
  fitText,
  lintDesign,
  wrapTextLines,
  type ConnectorObject,
  type DrawableObject,
} from "../src/index.js";

const rect = (id: string, x: number, y: number, extra: Partial<DrawableObject> = {}): DrawableObject => ({
  id, type: "rect", width: 100, height: 50,
  transform: { ...defaultTransform(), x, y }, style: defaultStyle(), visible: true, z: 0,
  ...extra,
} as DrawableObject);

const edge = (kind: ConnectorObject["kind"], from = "center", to = "center"): ConnectorObject => ({
  id: "edge", type: "connector",
  from: { objectId: "a", anchor: from as "center" }, to: { objectId: "b", anchor: to as "center" },
  kind, transform: defaultTransform(), style: defaultStyle(), visible: true, z: 0,
});

describe("connectorGeometry", () => {
  it("binds centre anchors to the outline with a gap", () => {
    const objects = new Map([rect("a", 0, 0), rect("b", 300, 0)].map(o => [o.id, o]));
    const geometry = connectorGeometry(edge("straight"), objects)!;
    expect(geometry).toEqual({ kind: "polyline", points: [{ x: 56, y: 0 }, { x: 244, y: 0 }] });
  });

  it("keeps explicit side anchors exact", () => {
    const objects = new Map([rect("a", 0, 0), rect("b", 300, 0)].map(o => [o.id, o]));
    const geometry = connectorGeometry(edge("straight", "right", "left"), objects)!;
    expect(geometry).toEqual({ kind: "polyline", points: [{ x: 50, y: 0 }, { x: 250, y: 0 }] });
  });

  it("clips diagonal lines on the correct side and respects rotation", () => {
    const objects = new Map([rect("a", 0, 0), rect("b", 200, 200)].map(o => [o.id, o]));
    const [start] = (connectorGeometry(edge("straight"), objects) as { points: { x: number; y: number }[] }).points;
    // A 45 degree ray leaves a 100x50 box through the bottom edge at (25, 25).
    expect(start!.x).toBeCloseTo(25 + 6 / Math.SQRT2);
    expect(start!.y).toBeCloseTo(25 + 6 / Math.SQRT2);

    const rotated = new Map([
      rect("a", 0, 0, { transform: { ...defaultTransform(), rotation: 90 } }),
      rect("b", 300, 0),
    ].map(o => [o.id, o]));
    const [rotatedStart] = (connectorGeometry(edge("straight"), rotated) as { points: { x: number; y: number }[] }).points;
    // Rotated 90 degrees, the box is 25 wide to the right.
    expect(rotatedStart!.x).toBeCloseTo(31);
  });

  it("keeps the centre when the shapes overlap instead of inverting the arrow", () => {
    const objects = new Map([rect("a", 0, 0), rect("b", 10, 0)].map(o => [o.id, o]));
    const geometry = connectorGeometry(edge("straight"), objects) as { points: { x: number; y: number }[] };
    expect(geometry.points).toEqual([{ x: 0, y: 0 }, { x: 10, y: 0 }]);
  });

  it("leaves curves horizontally and places labels on the curve", () => {
    const objects = new Map([rect("a", 0, 0), rect("b", 300, 200)].map(o => [o.id, o]));
    const geometry = connectorGeometry(edge("curve"), objects)!;
    expect(geometry.kind).toBe("cubic");
    if (geometry.kind !== "cubic") return;
    expect(geometry.from).toEqual({ x: 56, y: 0 });
    expect(geometry.to).toEqual({ x: 244, y: 200 });
    expect(connectorMidpoint(geometry)).toEqual({ x: 150, y: 100 });
  });
});

describe("text layout", () => {
  const measure = (text: string, size: number) => text.length * size * 0.5;

  it("wraps on words and keeps explicit newlines", () => {
    expect(wrapTextLines("one two three four", 50, 10, measure)).toEqual(["one two", "three four"]);
    expect(wrapTextLines("a\nb", 500, 10, measure)).toEqual(["a", "b"]);
  });

  it("shrinks to fit a box and reports overflow when it cannot", () => {
    const fit = fitText("alpha beta gamma delta", { maxWidth: 90, maxHeight: 40, fontSize: 20, measure });
    expect(fit).toEqual({ lines: ["alpha beta", "gamma delta"], fontSize: 16, lineHeight: 20, overflow: false });

    const impossible = fitText("supercalifragilistic", { maxWidth: 20, fontSize: 20, minFontSize: 16, measure });
    expect(impossible.overflow).toBe(true);
    expect(impossible.fontSize).toBe(16);
  });
});

describe("palette", () => {
  it("maps every role to a matched stroke/fill tone", () => {
    for (const role of Object.keys(DIAGRAM_ROLES) as (keyof typeof DIAGRAM_ROLES)[]) {
      const tone = diagramTone(role);
      expect(Object.values(DIAGRAM_TONES)).toContain(tone);
      expect(tone.stroke).toMatch(/^#[0-9a-f]{6}$/);
      expect(tone.fill).toMatch(/^#[0-9a-f]{6}$/);
    }
    expect(diagramTone("output")).toBe(DIAGRAM_TONES.green);
  });
});

describe("lintDesign", () => {
  const frame = (objects: DrawableObject[]) => ({
    version: "1.0" as const, scene: { width: 600, height: 300 }, camera: { x: 0, y: 0, zoom: 1 }, objects, time: 0, duration: 0,
  });
  const box = (id: string, x: number, y: number, fill = "#ffffff", stroke = "#1e1e1e", text?: string): DrawableObject => ({
    ...rect(id, x, y), style: { ...defaultStyle(), fill, stroke, fontSize: 20 }, ...(text ? { text } : {}),
  } as DrawableObject);
  const link = (from: string, to: string): ConnectorObject => ({ ...edge("straight"), id: `${from}-${to}`, from: { objectId: from }, to: { objectId: to } });

  it("accepts a well-spaced, tone-consistent diagram", () => {
    const blue = DIAGRAM_TONES.blue, green = DIAGRAM_TONES.green;
    expect(lintDesign(frame([box("a", 100, 150, blue.fill, blue.stroke), box("b", 300, 150, green.fill, green.stroke), link("a", "b")]))).toEqual([]);
  });

  it("flags overlap, crowding, short connectors and canvas overflow", () => {
    const codes = lintDesign(frame([box("a", 100, 150), box("b", 160, 150), box("c", 280, 150), link("b", "c"), box("d", 590, 150)])).map(issue => issue.code);
    expect(codes).toContain("SHAPES_OVERLAP");
    expect(codes).toContain("SHAPES_CROWDED");
    expect(codes).toContain("CONNECTOR_TOO_SHORT");
    expect(codes).toContain("OUTSIDE_CANVAS");
  });

  it("flags mismatched tone pairs, colour overload and overflowing labels", () => {
    const t = DIAGRAM_TONES;
    const issues = lintDesign(frame([
      box("a", 70, 60, t.blue.fill, t.red.stroke),
      box("b", 230, 60, t.green.fill, t.green.stroke),
      box("c", 390, 60, t.violet.fill, t.violet.stroke),
      box("d", 70, 220, t.yellow.fill, t.yellow.stroke, "an extremely long label that cannot possibly fit inside"),
      box("e", 230, 220, t.teal.fill, t.teal.stroke),
    ]), { measure: (text, size) => text.length * size * 0.55 });
    expect(issues.map(issue => issue.code).sort()).toEqual(["LABEL_OVERFLOW", "TONE_MISMATCH", "TOO_MANY_TONES"]);
  });

  it("allows four semantic accents by default and honours a stricter limit", () => {
    const tones = [DIAGRAM_TONES.blue, DIAGRAM_TONES.green, DIAGRAM_TONES.yellow, DIAGRAM_TONES.red];
    const diagram = frame(tones.map((tone, i) => box(String(i), 70 + i * 145, 150, tone.fill, tone.stroke)));
    expect(lintDesign(diagram)).toEqual([]);
    expect(lintDesign(diagram, { maxTones: 3 }).map(issue => issue.code)).toEqual(["TOO_MANY_TONES"]);
  });
});
