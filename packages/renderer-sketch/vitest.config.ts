import { fileURLToPath, URL } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@anim8/core": fileURLToPath(new URL("../core/src/index.ts", import.meta.url)),
      "@anim8/sketch": fileURLToPath(new URL("../sketch/src/index.ts", import.meta.url)),
    },
  },
});
