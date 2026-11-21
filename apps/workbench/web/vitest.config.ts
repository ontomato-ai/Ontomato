import { fileURLToPath, pathToFileURL } from "node:url";
import vue from "@vitejs/plugin-vue";
import { defineConfig } from "vitest/config";
import { elementComponents } from "../../../packages/apps-sdk/element-components.mjs";
import { panelAppearance } from "../../../packages/apps-sdk/panel-appearance.mjs";

const editionSource = fileURLToPath(new URL("./src/sdk-edition.ts", import.meta.url));
// A panel's own module imports the SDK by the specifier its frame's import map serves; a test running that module binds
// it to the SDK's source entry.
const panelEntry = fileURLToPath(new URL("../../../packages/apps-sdk/src/entries/panel.ts", import.meta.url));

const integration = process.env.WEB_INTEGRATION === "1";
/**
 * The full-chain tests run the Node server and runtime in the same process as the page. Their modules are transformed
 * for the browser here, where `import.meta.url` is not a file URL, so the few that locate their own files by it are given
 * the file URL they have on disk.
 */
const serverFileUrls = {
  name: "server-file-urls",
  enforce: "pre" as const,
  transform(code: string, id: string) {
    if (!/\/packages\/(workbench-server|agent-runtime)\/src\//.test(id) || !code.includes("import.meta.url")) return null;
    return code.replaceAll("import.meta.url", JSON.stringify(pathToFileURL(id.split("?")[0]!).href));
  },
};

export default defineConfig(async () => ({
  plugins: [vue(), elementComponents(), await panelAppearance(editionSource), ...(integration ? [serverFileUrls] : [])],
  resolve: {
    // The apps SDK's sources name their product's edition by this module; the tests bind this product's, as build:sdk does.
    alias: [
      { find: /^apps-sdk:edition$/, replacement: editionSource },
      { find: /^@ontomato\/sdk\/panel$/, replacement: panelEntry },
    ],
  },
  test: {
    environment: integration ? "./integration-environment.ts" : "happy-dom",
    // The panel entrance's full chain runs against a real Node origin and PostgreSQL (`test:web:integration`); the
    // ordinary web tests need neither.
    include: [integration ? "src/**/__tests__/**/*.integration.test.ts" : "src/**/__tests__/**/*.test.ts"],
    exclude: integration ? [] : ["src/**/*.integration.test.ts"],
  },
}));
