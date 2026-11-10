import { fileURLToPath } from "node:url";
import vue from "@vitejs/plugin-vue";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [vue()],
  resolve: {
    // The apps SDK's sources name their product's edition by this module; the tests bind this product's, as build:sdk does.
    alias: [{ find: /^apps-sdk:edition$/, replacement: fileURLToPath(new URL("./src/sdk-edition.ts", import.meta.url)) }],
  },
  test: {
    environment: "happy-dom",
    include: ["src/**/__tests__/**/*.test.ts"],
  },
});
