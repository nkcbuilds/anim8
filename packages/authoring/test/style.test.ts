import { describe, expect, it } from "vitest";
import { evaluate } from "@anim8/core";
import { scene } from "../src/index.js";

describe("styling authoring", () => {
  it.each(["rect", "circle", "ellipse", "path", "polygon", "polyline", "connector"])("cancels %s draw actions at the sampled progress", type => {
    const s = scene();
    const a = s.box("A"), b = s.box("B", { x: 200 });
    const points = [{ x: 0, y: 0 }, { x: 50, y: 0 }, { x: 25, y: 50 }];
    const node = type === "rect" ? a : type === "circle" ? s.circle("C") : type === "ellipse" ? s.ellipse("E") : type === "path" ? s.path("M 0 0 L 50 0") : type === "polygon" ? s.polygon(points) : type === "polyline" ? s.polyline(points) : s.connect(a, b);
    const [id] = s.sequence(node.draw(0, { duration: 1000, easing: "linear" }));
    s.cancel(id!, 500);
    for (const time of [500, 1000, 750, 500]) {
      const object = evaluate(s.toJSON(), time).objects.find(o => o.id === node.id)!;
      expect(object).toHaveProperty("drawProgress", 0.5);
    }
  });
  it("rolls back an invalid keyframe sequence instead of leaving partially scheduled actions", () => {
    const s = scene(), box = s.box("Node");
    const before = s.toJSON();
    expect(() => s.keyframes(box, [{ offset: 0.5, position: { x: 50, y: 0 } }, { offset: 0.7, style: { strokeOpacity: 2 } }], { duration: 1000 })).toThrow();
    expect(s.toJSON()).toEqual(before);
    expect(() => s.keyframes(box, [{ offset: 0.5, position: { x: 50, y: 0 } }], { duration: 1000 })).toThrow();
    expect(s.toJSON()).toEqual(before);
  });
  it("authors a scene font and keeps it when cancelling an unfinished font change", () => {
    const s = scene({ theme: "sketch", fontFamily: '"Brand Font", sans-serif' });
    const a = s.box("Default"), b = s.text("Code", { fontFamily: "monospace" });
    s.connect(a, b, { label: "inherits" });
    const [id] = s.parallel(a.styleTo({ fontFamily: "serif" }, { duration: 1000 }));
    s.cancel(id!, 400);
    const document = s.toJSON();
    expect(document.scene.fontFamily).toBe('"Brand Font", sans-serif');
    expect(document.objects[0]!.style.fontFamily).toBeUndefined();
    expect(evaluate(document, 1000).objects.map(o => o.style.fontFamily)).toEqual(['"Brand Font", sans-serif', "monospace", '"Brand Font", sans-serif']);
  });
  it.each(["", "   ", "x".repeat(513)])("rejects invalid scene font %j", fontFamily => {
    expect(() => scene({ fontFamily })).toThrow(/fontFamily/);
  });
  it("authors rich labels, styled connectors, dash flow and completion keyframes", () => {
    const s = scene();
    const a = s.box([{ text: "Read ", color: "red" }, { text: "quorum", color: "blue" }], { id: "a", strokeDasharray: [8, 4], fontSize: 20, fontFamily: "serif" });
    const b = s.box("Done", { x: 300 });
    const edge = s.connect(a, b, { id: "edge", stroke: "purple", strokeDasharray: [4, 2], color: "orange", label: "ACK" });
    s.parallel(a.colorTo("green"), edge.dashTo(-24));
    s.keyframes(a, [{ offset: 1, style: { strokeDasharray: [], stroke: "green" } }], { duration: 300 });
    const document = s.toJSON();
    expect(document.objects[0]).toMatchObject({ text: "Read quorum", textRuns: [{ text: "Read ", color: "red" }, { text: "quorum", color: "blue" }], style: { fontSize: 20, fontFamily: "serif" } });
    expect(document.objects.find(o => o.id === "edge")).toMatchObject({ style: { stroke: "purple" }, label: "ACK" });
    expect(evaluate(document, 700).objects[0]!.style).toMatchObject({ color: "green", stroke: "green", strokeDasharray: [] });
  });
  it("rejects malformed authoring styles and spans", () => {
    const s = scene();
    expect(() => s.box("x", { strokeDasharray: [-1] })).toThrow();
    expect(() => s.box("x", { strokeWidth: -6.4, strokeStyle: "dashed" })).toThrow();
    expect(() => s.box("x", { fontSize: -1 })).toThrow();
    expect(() => s.box().styleTo({ radius: -1 })).toThrow();
    expect(() => s.text([{ text: "x", color: "url(x)" }])).toThrow();
    expect(() => s.box().styleTo({ strokeOpacity: 2 })).toThrow();
    expect(() => s.keyframes(s.box(), [{ offset: 1, style: { strokeOpacity: 2 } }], { duration: 300 })).toThrow();
    expect(() => s.keyframes(s.box(), [{ offset: 1, style: {} }], { duration: 300 })).toThrow();
  });
});

it("can cancel a multi-property style action and schedule a finished-state label", () => {
  const s = scene(), a = s.box("Pending", { strokeDasharray: [8, 4] });
  const [id] = s.parallel(a.styleTo({ strokeDashoffset: -80, strokeLinecap: "round" }, { duration: 1000, easing: "linear" }));
  s.cancel(id!, 400);
  s.sequence(a.textTo([{ text: "ACK", color: "green" }]));
  const document = s.toJSON();
  expect(evaluate(document, 1000).objects[0]!.style.strokeDashoffset).toBe(-32);
  expect(evaluate(document, 1000).objects[0]).toHaveProperty("text", "ACK");
});
