import { fileURLToPath } from "node:url";
import vue from "@vitejs/plugin-vue";
import { defineConfig } from "vitest/config";
import { elementComponents } from "../apps-sdk/element-components.mjs";
import { panelAppearance } from "../apps-sdk/panel-appearance.mjs";

// The platform's pages these tests draw run a panel written with code on the SDK's own sources, which name the
// product's edition: the tests bind the platform's own, as its build does.
const editionSource = fileURLToPath(new URL("../../apps/workbench/web/src/sdk-edition.ts", import.meta.url));

export default defineConfig(async () => ({
  plugins: [vue(), elementComponents(), await panelAppearance(editionSource)],
  resolve: { alias: [{ find: /^apps-sdk:edition$/, replacement: editionSource }] },
  test: {
    environment: "happy-dom",
    include: ["src/**/__tests__/**/*.test.ts"],
    setupFiles: ["src/__tests__/setup.ts"],
  },
}));
