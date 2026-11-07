import { describe, expect, it } from "vitest";
import { defaultStyle, defaultTransform, type SceneDocument } from "@anim8/core";
import { renderSketchSceneAt } from "../src/index.js";

function nestedScene(): SceneDocument {
  const common = { style: defaultStyle(), visible: true, z: 0 };
  return {
    version: "1.0", scene: { width: 400, height: 200 }, timeline: [],
    objects: [
      { ...common, id: "outer", type: "group", children: ["inner"], transform: { ...defaultTransform(), opacity: 0.5 } },
      { ...common, id: "inner", type: "group", children: ["box", "label", "edge"], parentId: "outer", transform: { ...defaultTransform(), opacity: 0.4 } },
      { ...common, id: "box", type: "rect", width: 80, height: 60, text: "Value", parentId: "inner", transform: { ...defaultTransform(), x: 70, y: 80, opacity: 0.75 } },
      { ...common, id: "label", type: "text", text: "Label", parentId: "inner", transform: { ...defaultTransform(), x: 170, y: 80, opacity: 0.75 } },
      { ...common, id: "target", type: "circle", radius: 20, transform: { ...defaultTransform(), x: 300, y: 80 } },
      { ...common, id: "edge", type: "connector", kind: "straight", from: { objectId: "box" }, to: { objectId: "target" }, label: "Link", parentId: "inner", transform: { ...defaultTransform(), opacity: 0.75 } },
    ],
  };
}

describe("sketch hierarchy appearance", () => {
  it("multiplies nested ancestor opacity for shapes, text and connectors", () => {
    const svg = renderSketchSceneAt(nestedScene(), 0);
    for (const id of ["box", "label", "edge"]) {
      expect(svg.match(new RegExp(`<g data-anim8-id="${id}"[^>]*>`))?.[0]).toContain('opacity="0.15"');
    }
  });
  it.each(["outer", "inner"])("hides all descendants of invisible group %s", id => {
    const scene = nestedScene(); scene.objects.find(object => object.id === id)!.visible = false;
    const svg = renderSketchSceneAt(scene, 0);
    for (const child of ["box", "label", "edge"]) expect(svg).not.toContain(`data-anim8-id="${child}"`);
    expect(svg).toContain('data-anim8-id="target"');
  });
  it("respects a child's own visibility under visible ancestors", () => {
    const scene = nestedScene(); scene.objects.find(object => object.id === "box")!.visible = false;
    const svg = renderSketchSceneAt(scene, 0);
    expect(svg).not.toContain('data-anim8-id="box"');
    expect(svg).toContain('data-anim8-id="label"');
  });
  it("restores exact appearance after animated opacity and visibility seeks", () => {
    const scene = nestedScene();
    scene.timeline = [
      { id: "fade", type: "opacity", target: "outer", start: 0, duration: 1000, to: 0 },
      { id: "hide", type: "visibility", target: "inner", start: 1000, duration: 0, visible: false },
    ];
    const initial = renderSketchSceneAt(scene, 0);
    expect(renderSketchSceneAt(scene, 500)).toMatch(/data-anim8-id="box"[^>]*opacity="0.075"/);
    expect(renderSketchSceneAt(scene, 1000)).not.toContain('data-anim8-id="box"');
    expect(renderSketchSceneAt(scene, 0)).toBe(initial);
  });
});
