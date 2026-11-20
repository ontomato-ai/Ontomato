import { fileURLToPath } from "node:url";
import { defineConfig, loadEnv } from "vite";
import vue from "@vitejs/plugin-vue";
import { entryRecoveryPlugin } from "@ontomato/platform-web/entry-recovery";
import { elementComponents } from "../../../packages/apps-sdk/element-components.mjs";
import { panelAppearance } from "../../../packages/apps-sdk/panel-appearance.mjs";

// A panel written with code runs in this document on the SDK's own sources, which name this product's edition and the
// components and appearance its panels draw with; build:sdk binds the same for the SDK served to panel frames.
const editionSource = fileURLToPath(new URL("./src/sdk-edition.ts", import.meta.url));

// Web output goes to dist/web at the repository root: the Node production server serves static pages from the product root's dist/web.
export default defineConfig(async ({ command, mode }) => {
  const env = { ...loadEnv(mode, fileURLToPath(new URL("../../../", import.meta.url)), ""), ...process.env };
  const prefix = env.PUBLIC_BASE_PATH || "";
  return {
  base: command === "serve" ? `${prefix}/` : "./",
  plugins: [entryRecoveryPlugin(), vue(), elementComponents(), await panelAppearance(editionSource)],
  resolve: { alias: [{ find: /^apps-sdk:edition$/, replacement: editionSource }] },
  root: fileURLToPath(new URL(".", import.meta.url)),
  build: {
    outDir: fileURLToPath(new URL("../../../dist/web", import.meta.url)),
    emptyOutDir: true,
  },
  server: {
    port: 5173,
    host: "0.0.0.0",
    strictPort: true,
    hmr: { clientPort: 8080, path: "__hmr/workbench" },
  },
  };
});
