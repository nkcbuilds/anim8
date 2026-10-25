import { describe, expect, it } from "vitest";
import { Anim8PlayerElement, defineAnim8Player } from "../src/index.js";

describe("@anim8/player SSR safety", () => {
  it("imports without browser globals", () => {
    expect(typeof Anim8PlayerElement).toBe("function");
    expect(() => defineAnim8Player()).not.toThrow();
  });
});
