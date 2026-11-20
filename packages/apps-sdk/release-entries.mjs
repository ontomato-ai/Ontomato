/*
 * The public files of an SDK release, which stay the same from one release to the next: a hosted application's page
 * links them under the platform's stable `/apps-sdk/current/` address, so a new release reaches it without republishing.
 * Adding, removing or renaming one is a change to the release's contract, made with the hosts that inject them.
 * Everything else a release holds (its chunks and assets) is named by content.
 */

/** The public modules: the import-map specifier an app uses, the file it maps to, and the entry source. */
export const ENTRIES = [
  { specifier: "vue", file: "vue.js", source: "src/entries/vue.ts" },
  { specifier: "element-plus", file: "element-plus.js", source: "src/entries/element-plus.ts" },
  { specifier: "echarts", file: "echarts.js", source: "src/entries/echarts.js" },
  { specifier: "@ontomato/sdk", file: "sdk.js", source: "src/entries/sdk.ts" },
  { specifier: "@ontomato/sdk/chart", file: "chart.js", source: "src/entries/chart.ts" },
  { specifier: "@ontomato/sdk/markdown", file: "markdown.js", source: "src/entries/markdown.ts" },
  { specifier: "@ontomato/sdk/form", file: "form.js", source: "src/entries/form.ts" },
  { specifier: "@ontomato/sdk/code", file: "code.js", source: "src/entries/code.ts" },
  { specifier: "@ontomato/sdk/preview", file: "preview.js", source: "src/entries/preview.ts" },
  { specifier: "@ontomato/sdk/chat", file: "chat.js", source: "src/entries/chat.ts" },
  { specifier: "@ontomato/sdk/panel", file: "panel.js", source: "src/entries/panel.ts" },
  { specifier: "@ontomato/sdk/base", file: "base.js", source: "src/entries/base.ts" },
  { specifier: "@ontomato/sdk/graph", file: "graph.js", source: "src/entries/graph.ts" },
];
export const STYLESHEET = "styles/sdk.css";
/** The Node module of the parsers and declarations a check of panel sources runs (the contracts' `panel-check.ts`). */
export const CHECK = "node/panel-check.mjs";
