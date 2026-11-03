import { fileURLToPath } from "node:url";
import { defineConfig, loadEnv } from "vite";
import vue from "@vitejs/plugin-vue";

// Web output goes to dist/web at the repository root: the Node production server serves static pages from the product root's dist/web.
export default defineConfig(({ command, mode }) => {
  const env = { ...loadEnv(mode, fileURLToPath(new URL("../../../", import.meta.url)), ""), ...process.env };
  const prefix = env.PUBLIC_BASE_PATH || "";
  return {
  base: command === "serve" ? `${prefix}/` : "./",
  plugins: [vue()],
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
