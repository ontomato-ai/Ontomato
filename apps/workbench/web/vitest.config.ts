import { fileURLToPath } from "node:url";
import vue from "@vitejs/plugin-vue";
import { defineConfig } from "vitest/config";
import { elementComponents } from "../../../packages/apps-sdk/element-components.mjs";
import { panelAppearance } from "../../../packages/apps-sdk/panel-appearance.mjs";

const editionSource = fileURLToPath(new URL("./src/sdk-edition.ts", import.meta.url));

export default defineConfig(async () => ({
  plugins: [vue(), elementComponents(), await panelAppearance(editionSource)],
  resolve: {
    // The apps SDK's sources name their product's edition by this module; the tests bind this product's, as build:sdk does.
    alias: [{ find: /^apps-sdk:edition$/, replacement: editionSource }],
  },
  test: {
    environment: "happy-dom",
    include: ["src/**/__tests__/**/*.test.ts"],
  },
}));
