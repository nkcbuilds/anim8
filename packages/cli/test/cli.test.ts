import { describe, expect, it } from "vitest";
import { renderSource, validateSource } from "../src/index.js";

const validScene = JSON.stringify({
  version: "1.0",
  scene: { width: 320, height: 180 },
  objects: [{ id: "a", type: "rect", width: 80, height: 40, text: "A" }],
  timeline: [{ id: "move", type: "move", target: "a", start: 0, duration: 1000, to: { x: 200, y: 90 } }],
});

describe("@anim8/cli library helpers", () => {
  it("validates valid scene source", () => {
    const result = validateSource(validScene);
    expect(result.ok).toBe(true);
    expect(result.diagnostics).toEqual([]);
  });

  it("returns compiler diagnostics for invalid input", () => {
    const result = validateSource("{oops");
    expect(result.ok).toBe(false);
    expect(result.diagnostics[0]?.code).toBe("INVALID_JSON");
  });

  it("renders deterministic SVG at an arbitrary timestamp", () => {
    const first = renderSource(validScene, 500);
    const second = renderSource(validScene, 500);
    expect(first.ok).toBe(true);
    expect(first.svg).toBe(second.svg);
    expect(first.svg).toContain('data-anim8-id="a"');
  });
});
