import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@anim8/compiler": fileURLToPath(new URL("../compiler/src/index.ts", import.meta.url)),
      "@anim8/a11y": fileURLToPath(new URL("../a11y/src/index.ts", import.meta.url)),
      "@anim8/core": fileURLToPath(new URL("../core/src/index.ts", import.meta.url)),
      "@anim8/player": fileURLToPath(new URL("../player/src/index.ts", import.meta.url)),
      "@anim8/renderer-svg": fileURLToPath(new URL("../renderer-svg/src/index.ts", import.meta.url)),
      "@anim8/renderer-sketch/live": fileURLToPath(new URL("../renderer-sketch/src/live.ts", import.meta.url)),
      "@anim8/renderer-sketch": fileURLToPath(new URL("../renderer-sketch/src/index.ts", import.meta.url)),
      "@anim8/sketch": fileURLToPath(new URL("../sketch/src/index.ts", import.meta.url)),
    },
  },
});
