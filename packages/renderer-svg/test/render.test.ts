import { describe, expect, it } from "vitest";
import { defaultStyle, defaultTransform, evaluate, type SceneDocument } from "@anim8/core";
import { renderSceneAt, renderSvg } from "../src/index.js";

describe("SVG renderer", () => {
  it("serializes standalone text without duplicate SVG attributes", () => {
    const doc: SceneDocument = {
      version: "1.0", scene: { width: 300, height: 160 },
      objects: [
        { id:"label", type:"text", text:"hello", transform:{...defaultTransform(),x:150,y:80}, style:defaultStyle(), visible:true,z:1 },
      ],
      timeline:[],
    };
    const svg = renderSvg(evaluate(doc, 0));
    const tag = svg.match(/<text[^>]*data-anim8-id="label"[^>]*>/)?.[0] ?? "";
    expect(tag).not.toBe("");
    expect((tag.match(/\sfill=/g) ?? [])).toHaveLength(1);
    expect((tag.match(/\sstroke=/g) ?? [])).toHaveLength(1);
  });

  it("keeps a connector attached to a moving node at arbitrary time", () => {
    const doc: SceneDocument = {
      version: "1.0", scene: { width: 500, height: 200 },
      objects: [
        { id:"a", type:"rect", width:80, height:40, transform:{...defaultTransform(),x:80,y:100}, style:defaultStyle(), visible:true,z:1 },
        { id:"b", type:"rect", width:80, height:40, transform:{...defaultTransform(),x:300,y:100}, style:defaultStyle(), visible:true,z:1 },
        { id:"e", type:"connector", from:{objectId:"a",anchor:"right"}, to:{objectId:"b",anchor:"left"}, kind:"straight", transform:defaultTransform(), style:defaultStyle(), visible:true,z:0 },
      ],
      timeline:[{ id:"move", type:"move", target:"a", start:0,duration:1000,to:{x:180,y:100},easing:"linear" }],
    };
    const svg = renderSvg(evaluate(doc, 500));
    expect(svg).toContain('data-anim8-id="e"');
    expect(svg).toContain("M 170 100 L 260 100");
  });

  it("applies resolved camera as one top-level world transform without rewriting connector geometry", () => {
    const doc: SceneDocument = {
      version: "1.0",
      scene: {
        width: 500,
        height: 200,
        background: "#ffffff",
        camera: { x: 10, y: 20, zoom: 1 },
      },
      objects: [
        { id:"a", type:"rect", width:80, height:40, transform:{...defaultTransform(),x:80,y:100}, style:defaultStyle(), visible:true,z:1 },
        { id:"b", type:"rect", width:80, height:40, transform:{...defaultTransform(),x:300,y:100}, style:defaultStyle(), visible:true,z:1 },
        { id:"e", type:"connector", from:{objectId:"a",anchor:"right"}, to:{objectId:"b",anchor:"left"}, kind:"straight", transform:defaultTransform(), style:defaultStyle(), visible:true,z:0 },
      ],
      timeline:[
        { id:"camera", type:"camera", start:0, duration:1000, easing:"linear", to:{x:110,y:-20,zoom:2} },
      ],
    };

    const svg = renderSvg(evaluate(doc, 500));
    expect(svg).toContain('<g data-anim8-camera="world" transform="matrix(1.5 0 0 1.5 60 0)">');
    expect(svg).toContain('d="M 120 100 L 260 100"');
    expect(svg.indexOf('<rect width="100%" height="100%" fill="#ffffff"/>'))
      .toBeLessThan(svg.indexOf('data-anim8-camera="world"'));
  });

  it("renders ellipse, polygon, and polyline as native SVG primitives", () => {
    const doc: SceneDocument = {
      version: "1.0", scene: { width: 400, height: 240 },
      objects: [
        { id:"oval", type:"ellipse", rx:50, ry:20, transform:{...defaultTransform(),x:80,y:70}, style:defaultStyle(), visible:true,z:0 },
        { id:"tri", type:"polygon", points:[{x:-20,y:20},{x:0,y:-20},{x:20,y:20}], transform:{...defaultTransform(),x:180,y:70}, style:defaultStyle(), visible:true,z:1 },
        { id:"wave", type:"polyline", points:[{x:0,y:0},{x:20,y:-10},{x:40,y:0}], transform:{...defaultTransform(),x:250,y:70}, style:{...defaultStyle(),fill:"none"}, visible:true,z:2 },
      ],
      timeline:[],
    };
    const svg = renderSvg(evaluate(doc, 0));
    expect(svg).toContain('<ellipse cx="0" cy="0" rx="50" ry="20"/>');
    expect(svg).toContain('<polygon');
    expect(svg).toContain('points="-20,20 0,-20 20,20"');
    expect(svg).toContain('<polyline');
    expect(svg).toContain('points="0,0 20,-10 40,0"');
  });

  it("keeps legacy path JSON unchanged when drawProgress is omitted", () => {
    const doc: SceneDocument = {
      version: "1.0", scene: { width: 200, height: 120 },
      objects: [
        { id:"path", type:"path", d:"M 0 0 L 50 0", transform:defaultTransform(), style:{...defaultStyle(),fill:"none"}, visible:true,z:0 },
      ],
      timeline:[],
    };
    const svg = renderSvg(evaluate(doc, 0));
    expect(svg).toContain('d="M 0 0 L 50 0"');
    expect(svg).not.toContain('pathLength="1"');
    expect(svg).not.toContain('stroke-dasharray="1"');
  });

  it("renders deterministic path draw progress without measuring path length", () => {
    const doc: SceneDocument = {
      version: "1.0", scene: { width: 300, height: 160 },
      objects: [
        { id:"path", type:"path", d:"M 0 0 L 100 0", drawProgress:0, transform:{...defaultTransform(),x:50,y:80}, style:{...defaultStyle(),fill:"none"}, visible:true,z:0 },
      ],
      timeline:[
        { id:"draw", type:"draw", target:"path", start:0, duration:1000, easing:"linear", to:1 },
      ],
    };
    const svg = renderSvg(evaluate(doc, 500));
    expect(svg).toContain('pathLength="1"');
    expect(svg).toContain('stroke-dasharray="1"');
    expect(svg).toContain('stroke-dashoffset="0.5"');
  });

  it("renders geometry after random-access resize evaluation", () => {
    const doc: SceneDocument = {
      version: "1.0", scene: { width: 300, height: 160 },
      objects: [
        { id:"oval", type:"ellipse", rx:40, ry:20, transform:{...defaultTransform(),x:150,y:80}, style:defaultStyle(), visible:true,z:0 },
      ],
      timeline:[
        { id:"resize", type:"resize", target:"oval", start:0, duration:1000, easing:"linear", to:{width:120,height:80} },
      ],
    };
    const svg = renderSvg(evaluate(doc, 500));
    expect(svg).toContain('<ellipse cx="0" cy="0" rx="50" ry="30"/>');
  });

  it("canonicalizes renderer numbers to six decimals and removes negative zero", () => {
    const doc: SceneDocument = {
      version: "1.0",
      scene: {
        width: 300.123456789,
        height: 160.0000004,
        camera: { x: -0.0000004, y: 2.34567891, zoom: 1.23456789 },
      },
      objects: [
        {
          id: "line",
          type: "line",
          x2: -0,
          y2: 1.23456789,
          transform: { ...defaultTransform(), x: 10.123456789, y: -0.0000004 },
          style: { ...defaultStyle(), strokeWidth: 1.23456789 },
          visible: true,
          z: 0,
        },
        {
          id: "path",
          type: "path",
          d: "M -0 -0.0000004 L 1.23456789 2.34567891",
          transform: defaultTransform(),
          style: { ...defaultStyle(), fill: "none" },
          visible: true,
          z: 1,
        },
      ],
      timeline: [],
    };

    const svg = renderSvg(evaluate(doc, 0));

    expect(svg).toContain('viewBox="0 0 300.123457 160"');
    expect(svg).toContain('data-anim8-camera="world" transform="matrix(1.234568 0 0 1.234568 0 2.345679)"');
    expect(svg).toContain('data-anim8-id="line" transform="matrix(1 0 0 1 10.123457 0)"');
    expect(svg).toContain('stroke-width="1.234568"');
    expect(svg).toContain('x2="0" y2="1.234568"');
    expect(svg).toContain('d="M 0 0 L 1.234568 2.345679"');
    expect(svg).not.toMatch(/\d+\.\d{7,}/);
  });

  it("is byte-stable when seeking away and re-rendering an equivalent frame", () => {
    const doc: SceneDocument = {
      version: "1.0",
      scene: {
        width: 500,
        height: 200,
        camera: { x: 0.123456789, y: -0.123456789, zoom: 1 },
      },
      objects: [
        { id:"a", type:"rect", width:80, height:40, transform:{...defaultTransform(),x:80.123456789,y:100}, style:defaultStyle(), visible:true,z:1 },
        { id:"b", type:"rect", width:80, height:40, transform:{...defaultTransform(),x:300,y:100}, style:defaultStyle(), visible:true,z:1 },
        { id:"e", type:"connector", from:{objectId:"a",anchor:"right"}, to:{objectId:"b",anchor:"left"}, kind:"curve", transform:defaultTransform(), style:defaultStyle(), visible:true,z:0 },
      ],
      timeline: [
        { id:"move", type:"move", target:"a", start:0, duration:1000, to:{x:180.987654321,y:100}, easing:"linear" },
        { id:"camera", type:"camera", start:0, duration:1000, easing:"linear", to:{x:50.987654321,y:10.123456789,zoom:1.75} },
      ],
    };

    const time = 333.333333;
    const first = renderSceneAt(doc, time);
    renderSceneAt(doc, 812.345678);
    const second = renderSceneAt(doc, time);

    expect(second).toBe(first);
    expect(renderSvg(evaluate(doc, time))).toBe(first);
    expect(first).not.toMatch(/\d+\.\d{7,}/);
  });
  it("renders routed connectors around evaluated obstacles deterministically", () => {
    const doc: SceneDocument = {
      version: "1.0",
      scene: { width: 360, height: 180 },
      objects: [
        { id:"a", type:"rect", width:40, height:40, transform:{...defaultTransform(),x:20,y:90}, style:defaultStyle(), visible:true,z:1 },
        { id:"block", type:"rect", width:80, height:80, transform:{...defaultTransform(),x:160,y:90}, style:defaultStyle(), visible:true,z:1 },
        { id:"b", type:"rect", width:40, height:40, transform:{...defaultTransform(),x:300,y:90}, style:defaultStyle(), visible:true,z:1 },
        { id:"edge", type:"connector", from:{objectId:"a",anchor:"right"}, to:{objectId:"b",anchor:"left"}, kind:"routed", routing:{clearance:10}, transform:defaultTransform(), style:defaultStyle(), visible:true,z:0 },
      ],
      timeline: [],
    };
    const first = renderSceneAt(doc, 0);
    const second = renderSceneAt(doc, 0);
    expect(second).toBe(first);
    const path = first.match(/data-anim8-id="edge" d="([^"]+)"/)?.[1] ?? "";
    expect(path).toBe("M 40 90 L 40 140 L 280 140 L 280 90");
  });

});
