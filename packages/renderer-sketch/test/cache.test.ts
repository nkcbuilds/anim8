import { expect, it, vi } from "vitest";
import { defaultStyle, defaultTransform, evaluate, type SceneDocument } from "@anim8/core";
import * as sketch from "@anim8/sketch";
import { createSketchFrameRenderer, renderSketchFrame } from "../src/render.js";

const document = (): SceneDocument => ({ version: "1.0", scene: { width: 600, height: 300, seed: 7 }, timeline: [], objects: [
  { id: "a", type: "rect", width: 100, height: 50, text: "Label", style: defaultStyle(), transform: defaultTransform(), visible: true, z: 0 },
  { id: "b", type: "circle", radius: 30, text: "B", style: defaultStyle(), transform: { ...defaultTransform(), x: 300 }, visible: true, z: 1 },
  { id: "edge", type: "connector", from: { objectId: "a" }, to: { objectId: "b" }, kind: "straight", label: "Link", style: defaultStyle(), transform: defaultTransform(), visible: true, z: 2 },
] });

it("reuses marks across transform-only updates and clears retained bodies on destroy", () => {
  const spy = vi.spyOn(sketch, "sketchRoundedRectangle");
  const renderer = createSketchFrameRenderer(), source = document();
  try {
    renderer.render(evaluate(source, 0));
    const count = spy.mock.calls.length;
    expect(count).toBeGreaterThan(0);
    for (const x of [10, 20, 0]) {
      source.objects[0]!.transform.x = x;
      renderer.render(evaluate(source, 0));
      expect(spy.mock.calls).toHaveLength(count);
    }
    renderer.clear(); renderer.render(evaluate(source, 0));
    expect(spy.mock.calls.length).toBeGreaterThan(count);
  } finally { spy.mockRestore(); }
});

it("matches uncached rendering after geometry, paint, text, fonts, visibility, hierarchy and seed changes", () => {
  const renderer = createSketchFrameRenderer(), source = document();
  const check = () => { const frame = evaluate(source, 0); expect(renderer.render(frame)).toEqual(renderSketchFrame(frame)); };
  check();
  source.objects[0]!.transform.x = 100; check();
  source.objects[0]!.style.fill = "red"; check();
  source.objects[0]!.style.fontFamily = "serif"; check();
  source.scene.fontFamily = "monospace"; check();
  delete source.objects[0]!.style.fontFamily; check();
  if (source.objects[0]!.type === "rect") { source.objects[0]!.width = 180; source.objects[0]!.text = "Different"; source.objects[0]!.drawProgress = 0.5; }
  check();
  source.objects[0]!.style.strokeDasharray = [4, 2]; check();
  source.objects[0]!.style.fillGradient = { type: "linear", stops: [{ offset: 0, color: "red" }, { offset: 1, color: "blue" }] }; check();
  source.scene.seed = 999; source.scene.background = "#ccffff"; check();
  source.objects[0]!.visible = false; check();
  source.objects[0]!.visible = true; check();
  source.objects[0]!.parentId = "group";
  source.objects.push({ id: "group", type: "group", children: ["a"], style: {}, transform: { ...defaultTransform(), x: 40, opacity: 0.5 }, visible: true, z: 0 }); check();
  source.objects = source.objects.filter(o => o.id !== "a" && o.id !== "edge"); check();
  source.objects.push(document().objects[0]!); check();
  renderer.clear(); check();
});
