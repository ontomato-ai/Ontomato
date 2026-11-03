import { defineConfig, loadEnv } from "vite";
import vue from "@vitejs/plugin-vue";
import path from "node:path";

export default defineConfig(({ command, mode }) => {
  const env = { ...loadEnv(mode, path.resolve(process.cwd(), "../.."), ""), ...process.env };
  const prefix = env.PUBLIC_BASE_PATH || "";
  return {
    base: command === "serve" ? `${prefix}/ontology-manager/` : "./",
    plugins: [vue()],
    build: { outDir: "dist", emptyOutDir: true },
    server: {
      port: 5174,
      host: "0.0.0.0",
      strictPort: true,
      hmr: { clientPort: 8080, path: "__hmr/manager" },
    },
  };
});
