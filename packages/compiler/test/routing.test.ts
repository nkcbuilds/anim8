import { describe, expect, it } from "vitest";
import { compile } from "../src/index.js";

const base = () => ({
  version: "1.0",
  scene: { width: 400, height: 240 },
  objects: [
    { id: "a", type: "rect", x: 40, y: 120, width: 60, height: 40 },
    { id: "b", type: "rect", x: 360, y: 120, width: 60, height: 40 },
  ],
  timeline: [],
});

describe("routed connector compiler", () => {
  it("accepts bounded routed connector configuration", () => {
    const result = compile({
      ...base(),
      objects: [
        ...base().objects,
        {
          id: "edge",
          type: "connector",
          from: { objectId: "a", anchor: "right" },
          to: { objectId: "b", anchor: "left" },
          kind: "routed",
          routing: { clearance: 18, bendPenalty: 12 },
        },
      ],
    });
    expect(result.ok).toBe(true);
    expect(result.scene?.objects.at(-1)).toEqual(expect.objectContaining({
      kind: "routed",
      routing: { clearance: 18, bendPenalty: 12 },
    }));
  });

  it("rejects routing options on non-routed connectors", () => {
    const result = compile({
      ...base(),
      objects: [
        ...base().objects,
        {
          id: "edge",
          type: "connector",
          from: { objectId: "a" },
          to: { objectId: "b" },
          kind: "orthogonal",
          routing: { clearance: 8 },
        },
      ],
    });
    expect(result.ok).toBe(false);
    expect(result.diagnostics).toContainEqual(expect.objectContaining({
      code: "INVALID_CONNECTOR_ROUTING",
      path: "objects[2].routing",
    }));
  });

  it("rejects unbounded routing values", () => {
    const result = compile({
      ...base(),
      objects: [
        ...base().objects,
        {
          id: "edge",
          type: "connector",
          from: { objectId: "a" },
          to: { objectId: "b" },
          kind: "routed",
          routing: { clearance: 1000 },
        },
      ],
    });
    expect(result.ok).toBe(false);
    expect(result.diagnostics).toContainEqual(expect.objectContaining({
      code: "INVALID_CONNECTOR_ROUTING",
      path: "objects[2].routing.clearance",
    }));
  });
});
