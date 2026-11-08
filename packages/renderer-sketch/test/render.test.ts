import { describe, expect, it } from "vitest";
import {
  defaultStyle,
  defaultTransform,
  evaluate,
  type SceneDocument,
} from "@anim8/core";
import {
  SKETCH_FONT_FAMILY,
  measureSketchText,
  renderSketchSceneAt,
  renderSketchSvg,
  sketchFontFaceCss,
} from "../src/index.js";

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
    // Ellipse fills follow the first rough outline pass rather than a perfect ellipse.
    expect(objectGroup(first, "oval").body).toMatch(/<path data-sketch-part="fill" d="M [^"]+ Z" fill="#eef2ff"/);
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
    }
    expect(objectGroup(half, "path").body).toContain('stroke-dashoffset="0.5"');

    // Multi-segment outlines trace in order like a pen: earlier sides finish
    // before later ones start, instead of every side drawing at once.
    for (const id of ["polygon", "polyline"]) {
      const offsets = [...objectGroup(half, id).body.matchAll(/data-sketch-part="outline" data-sketch-pass="(\d+)"[^>]*stroke-dashoffset="([\d.]+)"/g)]
        .map(match => Number(match[2]));
      expect(offsets.length).toBeGreaterThan(2);
      for (let index = 1; index < offsets.length; index += 1) expect(offsets[index]!).toBeGreaterThanOrEqual(offsets[index - 1]! - 1e-9);
      expect(offsets[0]).toBe(0);
      expect(offsets.at(-1)!).toBeGreaterThan(0.5);
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

  it("canonicalizes renderer numbers to six decimals and removes negative zero", () => {
    const scene: SceneDocument = {
      version: "1.0",
      scene: {
        width: 300.123456789,
        height: 160.0000004,
        seed: 99,
        camera: { x: -0.0000004, y: 2.34567891, zoom: 1.23456789 },
      },
      objects: [
        {
          id: "path",
          type: "path",
          d: "M -0 -0.0000004 L 1.23456789 2.34567891",
          drawProgress: 0.123456789,
          transform: { ...defaultTransform(), x: 10.123456789, y: -0.0000004 },
          style: { ...defaultStyle(), fill: "#ffffff", strokeWidth: 1.23456789 },
          visible: true,
          z: 0,
        },
      ],
      timeline: [],
    };

    const svg = renderSketchSceneAt(scene, 0);

    expect(svg).toContain('viewBox="0 0 300.123457 160"');
    expect(svg).toContain('data-anim8-camera="world" transform="matrix(1.234568 0 0 1.234568 0 2.345679)"');
    expect(svg).toContain('data-anim8-id="path" transform="matrix(1 0 0 1 10.123457 0)"');
    expect(svg).toContain('d="M 0 0 L 1.234568 2.345679"');
    expect(svg).toContain('stroke-width="1.234568"');
    expect(svg).toContain('stroke-dashoffset="0.876543"');
    expect(svg).not.toMatch(/\d+\.\d{7,}/);
  });

  it("is byte-stable when seeking away and re-rendering an equivalent frame", () => {
    const scene: SceneDocument = {
      version: "1.0",
      scene: {
        width: 500,
        height: 220,
        seed: 2026,
        camera: { x: 0.123456789, y: -0.123456789, zoom: 1 },
      },
      objects: [
        {
          id: "moving",
          type: "rect",
          width: 80,
          height: 40,
          transform: { ...defaultTransform(), x: 80.123456789, y: 100 },
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
          kind: "curve",
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
          to: { x: 180.987654321, y: 100 },
          easing: "linear",
        },
        {
          id: "camera",
          type: "camera",
          start: 0,
          duration: 1000,
          easing: "linear",
          to: { x: 50.987654321, y: 10.123456789, zoom: 1.75 },
        },
      ],
    };

    const time = 333.333333;
    const first = renderSketchSceneAt(scene, time);
    renderSketchSceneAt(scene, 812.345678);
    const second = renderSketchSceneAt(scene, time);

    expect(second).toBe(first);
    expect(renderSketchSvg(evaluate(scene, time))).toBe(first);
    expect(first).not.toMatch(/\d+\.\d{7,}/);
  });
  it("renders routed connector base and overdraw from the same deterministic route", () => {
    const scene: SceneDocument = {
      version: "1.0",
      scene: { width: 360, height: 180, seed: 12 },
      objects: [
        { id:"a", type:"rect", width:40, height:40, transform:{...defaultTransform(),x:20,y:90}, style:defaultStyle(), visible:true,z:1 },
        { id:"block", type:"rect", width:80, height:80, transform:{...defaultTransform(),x:160,y:90}, style:defaultStyle(), visible:true,z:1 },
        { id:"b", type:"rect", width:40, height:40, transform:{...defaultTransform(),x:300,y:90}, style:defaultStyle(), visible:true,z:1 },
        { id:"edge", type:"connector", from:{objectId:"a",anchor:"right"}, to:{objectId:"b",anchor:"left"}, kind:"routed", routing:{clearance:10}, transform:defaultTransform(), style:defaultStyle(), visible:true,z:0 },
      ],
      timeline: [],
    };
    const first = renderSketchSceneAt(scene, 0);
    const second = renderSketchSceneAt(scene, 0);
    expect(second).toBe(first);
    expect(connectorBase(first, "edge")).toContain("M 40 90");
    expect(first).toContain('data-sketch-part="connector-overdraw"');
  });


  it("binds center-anchored connectors to shape outlines and draws a hand-drawn arrowhead", () => {
    const scene: SceneDocument = {
      version: "1.0",
      scene: { width: 400, height: 200, seed: 5 },
      objects: [
        { id: "a", type: "rect", width: 80, height: 40, transform: { ...defaultTransform(), x: 80, y: 100 }, style: defaultStyle(), visible: true, z: 1 },
        { id: "b", type: "circle", radius: 30, transform: { ...defaultTransform(), x: 300, y: 100 }, style: defaultStyle(), visible: true, z: 1 },
        { id: "edge", type: "connector", from: { objectId: "a", anchor: "center" }, to: { objectId: "b" }, kind: "straight", transform: defaultTransform(), style: defaultStyle(), visible: true, z: 0 },
      ],
      timeline: [],
    };
    const svg = renderSketchSceneAt(scene, 0);
    // Rect right edge 120 + 6px gap; circle left edge 270 - 6px gap.
    expect(connectorBase(svg, "edge")).toBe("M 126 100 L 264 100");
    expect(svg.match(/data-sketch-part="arrowhead"/g)?.length).toBe(4);
    expect(svg).not.toContain("marker-end");
  });

  it("wraps shape labels into lines that fit the shape", () => {
    const scene: SceneDocument = {
      version: "1.0",
      scene: { width: 400, height: 200 },
      objects: [
        { id: "box", type: "rect", width: 150, height: 72, text: "Payment gateway authorizes card", transform: { ...defaultTransform(), x: 200, y: 100 }, style: { ...defaultStyle(), fontSize: 20 }, visible: true, z: 1 },
      ],
      timeline: [],
    };
    const label = objectGroup(renderSketchSceneAt(scene, 0), "box").body;
    const lines = [...label.matchAll(/<tspan [^>]*>([^<]+)<\/tspan>/g)].map(match => match[1]!);
    const size = Number(label.match(/font-size="([\d.]+)"/)![1]);
    expect(lines.length).toBeGreaterThan(1);
    expect(size).toBeLessThanOrEqual(20);
    expect(size).toBeGreaterThanOrEqual(14);
    for (const line of lines) expect(measureSketchText(line, size)).toBeLessThanOrEqual(150 - 24);
    expect(lines.length * size * 1.25).toBeLessThanOrEqual(72 - 12);
  });

  it("embeds the bundled font once, only when text uses it, and can reference it instead", () => {
    const withText: SceneDocument = {
      version: "1.0",
      scene: { width: 200, height: 100 },
      objects: [
        { id: "t1", type: "text", text: "one", transform: { ...defaultTransform(), x: 50, y: 50 }, style: defaultStyle(), visible: true, z: 1 },
        { id: "t2", type: "text", text: "two", transform: { ...defaultTransform(), x: 150, y: 50 }, style: defaultStyle(), visible: true, z: 1 },
      ],
      timeline: [],
    };
    const embedded = renderSketchSceneAt(withText, 0);
    expect(embedded.match(/@font-face/g)?.length).toBe(1);
    expect(embedded).toContain(`font-family="${SKETCH_FONT_FAMILY.replace(/"/g, "&quot;")}"`);
    expect(renderSketchSceneAt(withText, 0, { font: "reference" })).not.toContain("@font-face");

    const custom: SceneDocument = { ...withText, objects: withText.objects.map(o => ({ ...o, style: { ...o.style, fontFamily: "Georgia" } })) };
    expect(renderSketchSceneAt(custom, 0)).not.toContain("@font-face");
    for (const fontFamily of ["Virgil", '"virgil", serif', "Georgia, 'Virgil', cursive"]) {
      const explicit = { ...withText, scene: { ...withText.scene, fontFamily } };
      expect(renderSketchSceneAt(explicit, 0)).toContain("@font-face");
    }
    custom.scene.fontFamily = "NotVirgil";
    expect(renderSketchSceneAt(custom, 0)).not.toContain("@font-face");
    expect(sketchFontFaceCss()).toContain('font-family:"Virgil"');
  });

  const drawScene = (progress: number | undefined, extra: Record<string, unknown> = {}): SceneDocument => ({
  version: "1.0",
  scene: { width: 400, height: 200, seed: 3 },
  objects: [
    { id: "a", type: "rect", width: 100, height: 50, text: "Start", transform: { ...defaultTransform(), x: 80, y: 100 }, style: { ...defaultStyle(), fill: "#a5d8ff" }, visible: true, z: 1, ...(progress === undefined ? {} : { drawProgress: progress }) },
    { id: "b", type: "circle", radius: 30, transform: { ...defaultTransform(), x: 300, y: 100 }, style: defaultStyle(), visible: true, z: 1 },
    { id: "edge", type: "connector", from: { objectId: "a" }, to: { objectId: "b" }, kind: "straight", transform: defaultTransform(), style: { ...defaultStyle(), fill: "none" }, visible: true, z: 0, ...(progress === undefined ? {} : { drawProgress: progress }), ...extra },
  ],
  timeline: [],
} as SceneDocument);

  it("draws shapes on: outline first, then fill and label fade in", () => {
    const at = (progress: number) => objectGroup(renderSketchSceneAt(drawScene(progress), 0), "a").body;
    expect(at(0)).not.toContain('data-sketch-part="fill"');
    expect(at(0)).not.toContain("Start");
    expect(at(0)).toContain('stroke-dashoffset="1"');
    expect(at(0)).toContain('stroke-opacity="0"');
    expect(at(0.25)).not.toContain('stroke-opacity="0"');
    expect(at(0.25)).toContain('stroke-dashoffset="0.75"');
    expect(at(0.25)).not.toContain("Start");
    expect(at(0.75)).toContain('fill-opacity="0.5"');
    expect(at(0.75)).toMatch(/data-sketch-part="label-fade" opacity="0.5"/);
    expect(at(1).match(/<path data-sketch-part="fill"[^>]*>/)![0]).not.toContain("fill-opacity");
    expect(at(1)).not.toContain("label-fade");
  });

  it("draws connectors on: line first, arrowheads last", () => {
    const edge = (progress: number) => {
      const svg = renderSketchSceneAt(drawScene(progress), 0);
      return svg.slice(svg.indexOf('data-anim8-id="edge"'));
    };
    expect(edge(0.4)).toContain('stroke-dashoffset="0.5"');
    expect(edge(0.4)).not.toContain('data-sketch-part="arrowhead"');
    expect(edge(0.9)).toContain('data-sketch-part="arrowhead"');
    expect(edge(0.9)).toContain('stroke-dashoffset="0.5"');
  });

  it("supports arrowheads at either end, both, or none", () => {
    const heads = (arrowheads: string) => (renderSketchSceneAt(drawScene(undefined, { arrowheads }), 0).match(/data-sketch-part="arrowhead"/g) ?? []).length;
    expect(heads("none")).toBe(0);
    expect(heads("end")).toBe(4);
    expect(heads("start")).toBe(4);
    expect(heads("both")).toBe(8);
  });

  it("renders dashed and dotted strokes as a single pen line, including while drawing", () => {
    const dashed = drawScene(undefined);
    dashed.objects[0]!.style = { ...dashed.objects[0]!.style, strokeStyle: "dashed" };
    const body = objectGroup(renderSketchSceneAt(dashed, 0), "a").body;
    expect(body.match(/data-sketch-part="outline"/g)?.length).toBe(1);
    expect(body).toContain('stroke-dasharray="10 11"');

    const drawing = drawScene(0.5);
    drawing.objects[0]!.style = { ...drawing.objects[0]!.style, strokeStyle: "dotted" };
    const partial = objectGroup(renderSketchSceneAt(drawing, 0), "a").body;
    const list = partial.match(/data-sketch-part="outline"[^>]*stroke-dasharray="([^"]+)"/)![1]!.split(" ").map(Number);
    expect(list.length).toBeGreaterThan(8);
    expect(partial).not.toContain("pathLength");
  });
});
