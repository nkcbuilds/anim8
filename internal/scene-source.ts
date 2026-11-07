import type { SceneDocument } from "@anim8/core";

/** Remote JSON crosses the same bounded compiler boundary as imported scene files. */
export async function readSceneResponse(response: Response): Promise<SceneDocument> {
  if (!response.ok) throw new Error(`Failed to load Anim8 scene: ${response.status}`);
  const { compileJson, COMPILER_LIMITS } = await import("@anim8/compiler");
  let source = "";
  const reader = response.body?.getReader();
  if (reader) {
    const decoder = new TextDecoder();
    let bytes = 0;
    try {
      for (;;) {
        const chunk = await reader.read();
        if (chunk.done) break;
        bytes += chunk.value.byteLength;
        if (bytes > COMPILER_LIMITS.sourceBytes) {
          await reader.cancel();
          throw new Error("Anim8 scene exceeds the compiler source-size limit.");
        }
        source += decoder.decode(chunk.value, { stream: true });
      }
      source += decoder.decode();
    } finally {
      reader.releaseLock();
    }
  } else {
    source = await response.text();
  }
  const result = compileJson(source);
  if (!result.ok || !result.scene) throw new Error("Invalid Anim8 scene: " + result.diagnostics.slice(0, 8).map(d => `${d.code} at ${d.path}`).join("; "));
  return result.scene;
}
