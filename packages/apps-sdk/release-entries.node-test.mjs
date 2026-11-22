import { test } from "node:test";
import assert from "node:assert/strict";
import { CHECK, ENTRIES, STYLESHEET } from "./release-entries.mjs";

// Hosted applications are published with these files linked under `/apps-sdk/current/` (D, 2026-11-21): a release that
// renames, drops or adds one changes what those pages load, and needs the hosts that inject them changed with it.
test("a release's public files keep the names hosted pages link", () => {
  assert.deepEqual(Object.fromEntries(ENTRIES.map(({ specifier, file }) => [specifier, file])), {
    vue: "vue.js",
    "element-plus": "element-plus.js",
    echarts: "echarts.js",
    "@ontomato/sdk": "sdk.js",
    "@ontomato/sdk/ui": "ui.js",
    "@ontomato/sdk/chart": "chart.js",
    "@ontomato/sdk/markdown": "markdown.js",
    "@ontomato/sdk/form": "form.js",
    "@ontomato/sdk/code": "code.js",
    "@ontomato/sdk/preview": "preview.js",
    "@ontomato/sdk/chat": "chat.js",
    "@ontomato/sdk/panel": "panel.js",
    "@ontomato/sdk/base": "base.js",
    "@ontomato/sdk/graph": "graph.js",
  });
  assert.equal(STYLESHEET, "styles/sdk.css");
  assert.equal(CHECK, "node/panel-check.mjs");
});
