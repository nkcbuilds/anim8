import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@anim8/core": fileURLToPath(new URL("../core/src/index.ts", import.meta.url)),
      "@anim8/renderer-svg": fileURLToPath(new URL("../renderer-svg/src/index.ts", import.meta.url)),
    },
  },
});
