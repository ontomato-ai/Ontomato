import { fileURLToPath } from "node:url";
import vue from "@vitejs/plugin-vue";
import { defineConfig } from "vitest/config";
import { elementComponents } from "../../../packages/apps-sdk/element-components.mjs";
import { panelAppearance } from "../../../packages/apps-sdk/panel-appearance.mjs";

const editionSource = fileURLToPath(new URL("./src/sdk-edition.ts", import.meta.url));
// A panel's own module imports the SDK by the specifier its frame's import map serves; a test running that module binds
// it to the SDK's source entry.
const panelEntry = fileURLToPath(new URL("../../../packages/apps-sdk/src/entries/panel.ts", import.meta.url));
// The panel host's tests clean a panel's HTML as a browser does; see the file.
const panelSanitizer = fileURLToPath(new URL("../../../packages/platform-shell/test-sanitizer.ts", import.meta.url));

export default defineConfig(async () => ({
  plugins: [vue(), elementComponents(), await panelAppearance(editionSource)],
  resolve: {
    // The apps SDK's sources name their product's edition by this module; the tests bind this product's, as build:sdk does.
    alias: [
      { find: /^apps-sdk:edition$/, replacement: editionSource },
      { find: /^@ontomato\/sdk\/panel$/, replacement: panelEntry },
    ],
  },
  test: {
    environment: "happy-dom",
    include: ["src/**/__tests__/**/*.test.ts"],
    setupFiles: [panelSanitizer],
  },
}));
