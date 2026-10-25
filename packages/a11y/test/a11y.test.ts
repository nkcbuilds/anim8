import { describe, expect, it } from "vitest";
import { defaultStyle, defaultTransform, type SceneDocument } from "@anim8/core";
import { describeScene } from "../src/index.js";

const base = (): SceneDocument => ({
  version: "1.0",
  scene: { width: 400, height: 240 },
  objects: [
    {
      id: "client", type: "rect", width: 100, height: 50, text: "Client",
      description: "User-facing client",
      transform: { ...defaultTransform(), x: 80, y: 120 },
      style: defaultStyle(), visible: true, z: 1,
    },
    {
      id: "server", type: "rect", width: 100, height: 50, text: "API Server",
      transform: { ...defaultTransform(), x: 300, y: 120 },
      style: defaultStyle(), visible: true, z: 1,
    },
    {
      id: "edge", type: "connector",
      from: { objectId: "client", anchor: "right" },
      to: { objectId: "server", anchor: "left" },
      kind: "straight", label: "request",
      transform: defaultTransform(), style: defaultStyle(), visible: true, z: 0,
    },
  ],
  timeline: [],
  state: { count: 2, active: true },
  markers: [{ id: "start", label: "Send request", time: 0 }],
});

describe("@anim8/a11y", () => {
  it("produces deterministic semantic summaries", () => {
    const scene = base();
    const first = describeScene(scene, { title: "API flow" });
    const second = describeScene(structuredClone(scene), { title: "API flow" });
    expect(second).toEqual(first);
    expect(first.text).toContain("API flow.");
    expect(first.text).toContain("Step: Send request.");
    expect(first.text).toContain("User-facing client");
    expect(first.text).toContain("User-facing client to API Server (request)");
    expect(first.text).toContain("active=true, count=2");
  });

  it("omits hidden objects and connectors hidden by an ancestor", () => {
    const scene = base();
    scene.objects.push({
      id: "group", type: "group", children: ["secret"],
      transform: defaultTransform(), style: defaultStyle(), visible: false, z: 2,
    });
    scene.objects.push({
      id: "secret", type: "text", text: "Secret",
      parentId: "group", transform: defaultTransform(), style: defaultStyle(), visible: true, z: 3,
    });
    const summary = describeScene(scene);
    expect(summary.text).not.toContain("Secret");
    expect(summary.objects.some(object => object.id === "secret")).toBe(false);
  });

  it("uses evaluated visibility and current marker at arbitrary time", () => {
    const scene = base();
    scene.timeline.push({
      id: "hide-server", type: "visibility", target: "server",
      start: 500, duration: 0, visible: false,
    });
    scene.markers!.push({ id: "done", label: "Done", time: 500 });
    const summary = describeScene(scene, { time: 700 });
    expect(summary.step?.label).toBe("Done");
    expect(summary.objects.some(object => object.id === "server")).toBe(false);
  });

  it("supports bounded output options and explicit state overrides", () => {
    const summary = describeScene(base(), {
      maxObjects: 1,
      includeRelationships: false,
      context: { state: { count: 9 } },
    });
    expect(summary.objects).toHaveLength(1);
    expect(summary.relationships).toEqual([]);
    expect(summary.state).toEqual({ count: 9, active: true });
    expect(summary.text).toContain("1 additional visible objects omitted.");
  });
});
