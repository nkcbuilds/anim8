import { describe, expect, it } from "vitest";
import { readSceneResponse } from "../../../internal/scene-source.js";

const scene = { version: "1.0", scene: { width: 320, height: 180, fontFamily: "serif" }, objects: [{ id: "a", type: "rect" }], timeline: [] };

describe("remote scene boundary", () => {
  it("normalizes valid remote JSON through the compiler", async () => {
    const result = await readSceneResponse(new Response(JSON.stringify(scene)));
    expect(result.scene.fontFamily).toBe("serif");
    expect(result.objects[0]!.transform.scaleX).toBe(1);
  });
  it("rejects malformed and invalid remote scene data", async () => {
    for (const source of ["bad json", JSON.stringify({ ...scene, objects: [{ id: "a", type: "rect", style: { strokeWidth: -6.4 } }] }), JSON.stringify({ ...scene, objects: [{ id: "a", type: "image", href: "javascript:alert(1)" }] })]) {
      await expect(readSceneResponse(new Response(source))).rejects.toThrow(/Invalid Anim8 scene/);
    }
    await expect(readSceneResponse(new Response("unavailable", { status: 404 }))).rejects.toThrow(/404/);
  });
  it("cancels oversized streams before parsing the full response", async () => {
    let cancelled = false;
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) { controller.enqueue(new Uint8Array(1024 * 1024)); },
      cancel() { cancelled = true; },
    });
    await expect(readSceneResponse(new Response(stream))).rejects.toThrow(/source-size limit/);
    expect(cancelled).toBe(true);
  });
});
