import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@anim8/compiler": fileURLToPath(new URL("../compiler/src/index.ts", import.meta.url)),
      "@anim8/core": fileURLToPath(new URL("../core/src/index.ts", import.meta.url)),
    },
  },
});
