import { describe, expect, it } from "vitest";
import { evaluate } from "@anim8/core";
import { scene } from "../src/index.js";

describe("styling authoring", () => {
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
    expect(() => s.text([{ text: "x", color: "url(x)" }])).toThrow();
    expect(() => s.box().styleTo({ strokeOpacity: 2 })).toThrow();
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
