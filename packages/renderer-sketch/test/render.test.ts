import { describe, expect, it } from "vitest";
import {
  defaultStyle,
  defaultTransform,
  evaluate,
  type SceneDocument,
} from "@anim8/core";
import { renderSketchSceneAt, renderSketchSvg } from "../src/index.js";

function allSketchPathData(svgFragment: string, part: string): string[] {
  const expression = new RegExp(
    `<path data-sketch-part="${part}"[^>]* d="([^"]+)"`,
    "g",
  );
  return [...svgFragment.matchAll(expression)].map(match => match[1]!);
}

function objectGroup(svg: string, id: string): { transform: string; body: string } {
  const expression = new RegExp(
    `<g data-anim8-id="${id}" transform="([^"]+)" opacity="[^"]+">([\\s\\S]*?)</g>`,
  );
  const match = svg.match(expression);
  if (!match) throw new Error(`Missing object group '${id}'.`);
  return { transform: match[1]!, body: match[2]! };
}

function connectorBase(svg: string, id: string): string {
  const expression = new RegExp(
    `<g data-anim8-id="${id}" opacity="[^"]+"><path data-sketch-part="connector-base" d="([^"]+)"`,
  );
  const match = svg.match(expression);
  if (!match) throw new Error(`Missing connector '${id}'.`);
  return match[1]!;
}

function comprehensiveScene(): SceneDocument {
  return {
    version: "1.0",
    scene: { width: 640, height: 360, seed: 2026, background: "#faf7f2" },
    objects: [
      {
        id: "rect",
        type: "rect",
        width: 120,
        height: 70,
        text: "Box",
        transform: { ...defaultTransform(), x: 100, y: 100, rotation: 8 },
        style: { ...defaultStyle(), fill: "#fff7ed", radius: 12 },
        visible: true,
        z: 1,
      },
      {
        id: "circle",
        type: "circle",
        radius: 42,
        text: "C",
        transform: { ...defaultTransform(), x: 300, y: 100 },
        style: { ...defaultStyle(), fill: "#eff6ff" },
        visible: true,
        z: 1,
      },
      {
        id: "text",
        type: "text",
        text: "hello <sketch>",
        transform: { ...defaultTransform(), x: 210, y: 220 },
        style: { ...defaultStyle(), color: "#172554", fontSize: 20, fontFamily: "sans-serif" },
        visible: true,
        z: 2,
      },
      {
        id: "line",
        type: "line",
        x2: 110,
        y2: 30,
        transform: { ...defaultTransform(), x: 60, y: 280 },
        style: defaultStyle(),
        visible: true,
        z: 2,
      },
      {
        id: "path",
        type: "path",
        d: "M 0 0 C 25 -30 50 30 75 0",
        transform: { ...defaultTransform(), x: 350, y: 270 },
        style: { ...defaultStyle(), fill: "none" },
        visible: true,
        z: 2,
      },
      {
        id: "edge",
        type: "connector",
        from: { objectId: "rect", anchor: "right" },
        to: { objectId: "circle", anchor: "left" },
        kind: "curve",
        label: "edge",
        transform: defaultTransform(),
        style: defaultStyle(),
        visible: true,
        z: 0,
      },
    ],
    timeline: [],
  };
}

describe("@anim8/renderer-sketch", () => {
  it("renders supported objects with byte-stable seeded output", () => {
    const scene = comprehensiveScene();
    const frame = evaluate(scene, 0);

    const first = renderSketchSvg(frame);
    const second = renderSketchSvg(frame);
    const sceneRender = renderSketchSceneAt(scene, 0);

    expect(second).toBe(first);
    expect(sceneRender).toBe(first);

    expect(first).toContain('data-anim8-id="rect"');
    expect(first).toContain('data-anim8-id="circle"');
    expect(first).toContain('data-anim8-id="text"');
    expect(first).toContain('data-anim8-id="line"');
    expect(first).toContain('data-anim8-id="path"');
    expect(first).toContain('data-anim8-id="edge"');
    expect(first).toContain("hello &lt;sketch&gt;");
    expect(first).toContain('data-sketch-part="connector-overdraw"');

    const changedSeed = comprehensiveScene();
    changedSeed.scene.seed = 2027;
    expect(renderSketchSceneAt(changedSeed, 0)).not.toBe(first);
  });

  it("keeps local sketch strokes stable while an object moves and keeps its connector attached", () => {
    const scene: SceneDocument = {
      version: "1.0",
      scene: { width: 500, height: 200, seed: 77 },
      objects: [
        {
          id: "moving",
          type: "rect",
          width: 80,
          height: 40,
          transform: { ...defaultTransform(), x: 80, y: 100 },
          style: defaultStyle(),
          visible: true,
          z: 1,
        },
        {
          id: "fixed",
          type: "rect",
          width: 80,
          height: 40,
          transform: { ...defaultTransform(), x: 300, y: 100 },
          style: defaultStyle(),
          visible: true,
          z: 1,
        },
        {
          id: "edge",
          type: "connector",
          from: { objectId: "moving", anchor: "right" },
          to: { objectId: "fixed", anchor: "left" },
          kind: "straight",
          transform: defaultTransform(),
          style: defaultStyle(),
          visible: true,
          z: 0,
        },
      ],
      timeline: [
        {
          id: "move",
          type: "move",
          target: "moving",
          start: 0,
          duration: 1000,
          to: { x: 180, y: 100 },
          easing: "linear",
        },
      ],
    };

    const atStart = renderSketchSceneAt(scene, 0);
    const atHalf = renderSketchSceneAt(scene, 500);
    const startObject = objectGroup(atStart, "moving");
    const halfObject = objectGroup(atHalf, "moving");

    expect(allSketchPathData(startObject.body, "outline")).toEqual(
      allSketchPathData(halfObject.body, "outline"),
    );
    expect(startObject.transform).toBe("matrix(1 0 0 1 80 100)");
    expect(halfObject.transform).toBe("matrix(1 0 0 1 130 100)");

    expect(connectorBase(atStart, "edge")).toBe("M 120 100 L 260 100");
    expect(connectorBase(atHalf, "edge")).toBe("M 170 100 L 260 100");
  });



  it("wraps world content in the resolved camera transform without changing connector geometry", () => {
    const scene: SceneDocument = {
      version: "1.0",
      scene: {
        width: 500,
        height: 220,
        seed: 13,
        background: "#ffffff",
        camera: { x: 10, y: -10, zoom: 1 },
      },
      objects: [
        {
          id: "a",
          type: "rect",
          width: 80,
          height: 40,
          transform: { ...defaultTransform(), x: 80, y: 100 },
          style: defaultStyle(),
          visible: true,
          z: 1,
        },
        {
          id: "b",
          type: "rect",
          width: 80,
          height: 40,
          transform: { ...defaultTransform(), x: 300, y: 100 },
          style: defaultStyle(),
          visible: true,
          z: 1,
        },
        {
          id: "edge",
          type: "connector",
          from: { objectId: "a", anchor: "right" },
          to: { objectId: "b", anchor: "left" },
          kind: "straight",
          transform: defaultTransform(),
          style: defaultStyle(),
          visible: true,
          z: 0,
        },
      ],
      timeline: [
        { id: "camera", type: "camera", start: 0, duration: 1000, easing: "linear", to: { x: 110, y: 30, zoom: 2 } },
      ],
    };

    const svg = renderSketchSceneAt(scene, 500);
    expect(svg).toContain('<g data-anim8-camera="world" transform="matrix(1.5 0 0 1.5 60 10)">');
    expect(connectorBase(svg, "edge")).toBe("M 120 100 L 260 100");
    expect(svg.indexOf('data-sketch-part="background"')).toBeLessThan(svg.indexOf('data-anim8-camera="world"'));
  });

  it("renders ellipse, polygon, and polyline with deterministic local sketch strokes", () => {
    const scene: SceneDocument = {
      version: "1.0",
      scene: { width: 420, height: 220, seed: 31415 },
      objects: [
        {
          id: "oval",
          type: "ellipse",
          rx: 50,
          ry: 24,
          text: "oval",
          transform: { ...defaultTransform(), x: 80, y: 80 },
          style: { ...defaultStyle(), fill: "#eef2ff" },
          visible: true,
          z: 0,
        },
        {
          id: "tri",
          type: "polygon",
          points: [{ x: -30, y: 25 }, { x: 0, y: -30 }, { x: 30, y: 25 }],
          transform: { ...defaultTransform(), x: 210, y: 80 },
          style: { ...defaultStyle(), fill: "#fef3c7" },
          visible: true,
          z: 1,
        },
        {
          id: "wave",
          type: "polyline",
          points: [{ x: 0, y: 0 }, { x: 30, y: -20 }, { x: 60, y: 10 }],
          transform: { ...defaultTransform(), x: 300, y: 150 },
          style: { ...defaultStyle(), fill: "none" },
          visible: true,
          z: 2,
        },
      ],
      timeline: [],
    };

    const first = renderSketchSceneAt(scene, 0);
    const second = renderSketchSceneAt(scene, 0);

    expect(second).toBe(first);
    expect(first).toContain('data-anim8-id="oval"');
    expect(first).toContain('<ellipse data-sketch-part="fill" cx="0" cy="0" rx="50" ry="24"');
    expect(first).toContain('data-anim8-id="tri"');
    expect(first).toContain('<polygon data-sketch-part="fill" points="-30,25 0,-30 30,25"');
    expect(first).toContain('data-anim8-id="wave"');
    expect(objectGroup(first, "oval").body).toContain('data-sketch-part="outline"');
    expect(objectGroup(first, "tri").body).toContain('data-sketch-part="outline"');
    expect(objectGroup(first, "wave").body).toContain('data-sketch-part="outline"');
  });

  it("uses normalized SVG dash reveal for path, polygon, and polyline without changing seeded stroke geometry", () => {
    const scene: SceneDocument = {
      version: "1.0",
      scene: { width: 500, height: 260, seed: 91 },
      objects: [
        {
          id: "path",
          type: "path",
          d: "M 0 0 C 30 -20 60 20 90 0",
          drawProgress: 0,
          transform: { ...defaultTransform(), x: 40, y: 60 },
          style: { ...defaultStyle(), fill: "none" },
          visible: true,
          z: 0,
        },
        {
          id: "polygon",
          type: "polygon",
          points: [{ x: -25, y: 20 }, { x: 0, y: -25 }, { x: 25, y: 20 }],
          drawProgress: 0,
          transform: { ...defaultTransform(), x: 220, y: 80 },
          style: { ...defaultStyle(), fill: "#fff7ed" },
          visible: true,
          z: 1,
        },
        {
          id: "polyline",
          type: "polyline",
          points: [{ x: 0, y: 0 }, { x: 35, y: -15 }, { x: 70, y: 10 }],
          drawProgress: 0,
          transform: { ...defaultTransform(), x: 330, y: 160 },
          style: { ...defaultStyle(), fill: "none" },
          visible: true,
          z: 2,
        },
      ],
      timeline: [
        { id: "draw-path", type: "draw", target: "path", start: 0, duration: 1000, easing: "linear", to: 1 },
        { id: "draw-polygon", type: "draw", target: "polygon", start: 0, duration: 1000, easing: "linear", to: 1 },
        { id: "draw-polyline", type: "draw", target: "polyline", start: 0, duration: 1000, easing: "linear", to: 1 },
      ],
    };

    const start = renderSketchSceneAt(scene, 0);
    const half = renderSketchSceneAt(scene, 500);

    for (const id of ["path", "polygon", "polyline"]) {
      const startBody = objectGroup(start, id).body;
      const halfBody = objectGroup(half, id).body;
      const part = id === "path" ? "path" : "outline";

      expect(allSketchPathData(halfBody, part)).toEqual(allSketchPathData(startBody, part));
      expect(halfBody).toContain('pathLength="1"');
      expect(halfBody).toContain('stroke-dasharray="1"');
      expect(halfBody).toContain('stroke-dashoffset="0.5"');
    }

    expect(objectGroup(half, "polygon").body).toContain('<polygon data-sketch-part="fill"');
    expect(objectGroup(half, "polygon").body).not.toContain(
      '<polygon data-sketch-part="fill" pathLength="1"',
    );
  });

  it("omits draw dash attributes when drawProgress is absent and clamps explicit progress", () => {
    const scene: SceneDocument = {
      version: "1.0",
      scene: { width: 260, height: 140, seed: 4 },
      objects: [
        {
          id: "plain",
          type: "path",
          d: "M 0 0 L 80 0",
          transform: { ...defaultTransform(), x: 30, y: 40 },
          style: { ...defaultStyle(), fill: "none" },
          visible: true,
          z: 0,
        },
        {
          id: "over",
          type: "polyline",
          points: [{ x: 0, y: 0 }, { x: 80, y: 0 }],
          drawProgress: 2,
          transform: { ...defaultTransform(), x: 30, y: 90 },
          style: { ...defaultStyle(), fill: "none" },
          visible: true,
          z: 1,
        },
      ],
      timeline: [],
    };

    const svg = renderSketchSceneAt(scene, 0);
    expect(objectGroup(svg, "plain").body).not.toContain('pathLength="1"');
    expect(objectGroup(svg, "over").body).toContain('stroke-dashoffset="0"');
  });


  it("applies parent transforms after generating child-local sketch geometry", () => {
    const scene: SceneDocument = {
      version: "1.0",
      scene: { width: 300, height: 200, seed: 5 },
      objects: [
        {
          id: "group",
          type: "group",
          children: ["child"],
          transform: { ...defaultTransform(), x: 100, y: 50 },
          style: defaultStyle(),
          visible: true,
          z: 0,
        },
        {
          id: "child",
          type: "circle",
          parentId: "group",
          radius: 20,
          transform: { ...defaultTransform(), x: 25, y: 10 },
          style: defaultStyle(),
          visible: true,
          z: 1,
        },
      ],
      timeline: [],
    };

    const child = objectGroup(renderSketchSceneAt(scene, 0), "child");
    expect(child.transform).toBe("matrix(1 0 0 1 125 60)");
    expect(allSketchPathData(child.body, "outline").length).toBeGreaterThan(0);
  });
});
