import vue from "@vitejs/plugin-vue";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [vue()],
  test: {
    environment: "happy-dom",
    include: ["src/**/__tests__/**/*.test.ts"],
    setupFiles: ["src/__tests__/setup.ts"],
    // The components' own styles are applied, so a test can read the layout they give Element Plus's elements.
    css: true,
    // The dialog tests walk a full Element Plus form through several async reads; shared CI runners take longer
    // than the 5 s default for that, so the limit only bounds a hung test.
    testTimeout: 30000,
  },
});
