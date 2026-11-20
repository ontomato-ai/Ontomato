import { fileURLToPath } from "node:url";
import vue from "@vitejs/plugin-vue";
import { defineConfig } from "vitest/config";
import { elementComponents } from "../apps-sdk/element-components.mjs";
import { panelAppearance } from "../apps-sdk/panel-appearance.mjs";

// A panel written with code runs in the platform's document on the SDK's own sources, which name the product's edition:
// these tests bind the platform's own, as its build does.
const editionSource = fileURLToPath(new URL("../../apps/workbench/web/src/sdk-edition.ts", import.meta.url));

export default defineConfig(async () => ({
  plugins: [vue(), elementComponents(), await panelAppearance(editionSource)],
  resolve: { alias: [{ find: /^apps-sdk:edition$/, replacement: editionSource }] },
  test: {
    environment: "happy-dom",
    include: ["src/**/__tests__/**/*.test.ts"],
  },
}));
