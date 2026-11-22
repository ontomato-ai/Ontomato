import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  appsSdkComponentCatalogSchema,
  appsSdkThemeTokenEntrySchema,
  appsSdkUiDirectiveEntrySchema,
  appsSdkUiPrimitiveEntrySchema,
} from "./apps-sdk";
import {
  checkAuthoringScript,
  checkAuthoringStyles,
  checkAuthoringTemplate,
  checkAuthoringTheme,
  componentModuleImports,
  componentOfficialSpecifiers,
  isComponentOfficialSpecifier,
  panelModuleImports,
  REJECT_PARADIGM_VIOLATIONS,
  REJECT_VIEWPORT_UNITS,
} from "./panel-module";
import {
  SDK_PLATFORM_THEME_TOKENS,
  SDK_RENAMED_EXPORTS,
  SDK_THEME_TOKENS,
  SDK_UI_COMPONENTS,
  SDK_UI_DIRECTIVES,
  SDK_UI_ENTRY_SPECIFIER,
  SDK_UI_FORBIDDEN_COMPONENTS,
  sdkRenamedExportByImpl,
  sdkThemeTokenCatalogueEntries,
  sdkThemeTokenReplacement,
  sdkUiComponentByImplExport,
  sdkUiComponentByImplTag,
  sdkUiComponentByTag,
  sdkUiDirectiveByImplName,
  sdkUiDirectiveByName,
  sdkUiForbiddenByImplExport,
  sdkUiForbiddenByImplTag,
} from "./sdk-ui-map";

test("SDK_UI_COMPONENTS maps every supported primitive uniquely and excludes platform-owned controls", () => {
  assert.ok(SDK_UI_COMPONENTS.length >= 100);
  const sdkTags = new Set(SDK_UI_COMPONENTS.map(item => item.sdkTag));
  const sdkExports = new Set(SDK_UI_COMPONENTS.map(item => item.sdkExport));
  const implTags = new Set(SDK_UI_COMPONENTS.map(item => item.implTag));
  const implExports = new Set(SDK_UI_COMPONENTS.map(item => item.implExport));
  assert.equal(sdkTags.size, SDK_UI_COMPONENTS.length);
  assert.equal(sdkExports.size, SDK_UI_COMPONENTS.length);
  assert.equal(implTags.size, SDK_UI_COMPONENTS.length);
  assert.equal(implExports.size, SDK_UI_COMPONENTS.length);

  for (const excluded of ["el-config-provider", "el-page-header", "el-popper", "el-popconfirm"]) {
    assert.equal(sdkUiComponentByImplTag(excluded), undefined);
    assert.ok(sdkUiForbiddenByImplTag(excluded)?.replacement);
  }
  for (const service of ["ElMessage", "ElMessageBox", "ElNotification", "ElLoading"]) {
    assert.equal(sdkUiComponentByImplExport(service), undefined);
    assert.ok(sdkUiForbiddenByImplExport(service)?.replacement);
  }
  assert.equal(sdkUiComponentByTag("sdk-button")?.sdkExport, "SdkButton");
  assert.equal(sdkUiComponentByImplExport("ElDialog")?.sdkTag, "sdk-dialog");
  assert.ok(SDK_UI_FORBIDDEN_COMPONENTS.length >= 8);
});

test("SDK_UI_DIRECTIVES maps all three directives into v-sdk-* and vSdk*", () => {
  assert.deepEqual(
    SDK_UI_DIRECTIVES.map(d => [d.sdkName, d.sdkExport, d.implName]),
    [
      ["v-sdk-loading", "vSdkLoading", "v-loading"],
      ["v-sdk-infinite-scroll", "vSdkInfiniteScroll", "v-infinite-scroll"],
      ["v-sdk-popover", "vSdkPopover", "v-popover"],
    ],
  );
  assert.equal(sdkUiDirectiveByName("v-sdk-loading")?.sdkExport, "vSdkLoading");
  assert.equal(sdkUiDirectiveByImplName("v-loading")?.sdkName, "v-sdk-loading");
});

test("SDK theme token catalogue aligns 1-to-1 with design-tokens themeOverrideTokens", () => {
  const source = readFileSync(new URL("../../design-tokens/src/theme-overrides.ts", import.meta.url), "utf8");
  const block = /export const themeOverrideTokens = \{([\s\S]*?)\} as const;/u.exec(source)?.[1];
  assert.ok(block, "Could not locate themeOverrideTokens in design-tokens");
  const designOverrideKeys = [...block.matchAll(/"(--[a-z0-9-]+)"\s*:/gu)].map(match => match[1]!);
  assert.ok(designOverrideKeys.length > 0);
  // No --el-* keys remain in themeOverrideTokens.
  assert.deepEqual(designOverrideKeys.filter(key => key.startsWith("--el-")), []);

  const overridableInContract = sdkThemeTokenCatalogueEntries()
    .filter(token => token.overridable)
    .map(token => token.name)
    .sort();
  assert.deepEqual(overridableInContract, [...designOverrideKeys].sort());

  // Every --el-* color/surface/border/text override has a canonical --sdk-* replacement.
  assert.equal(sdkThemeTokenReplacement("--el-color-primary"), "--sdk-color-primary");
  assert.equal(sdkThemeTokenReplacement("--el-bg-color"), "--sdk-bg-color");
  assert.equal(sdkThemeTokenReplacement("--el-text-color-tertiary"), "--sdk-text-color-placeholder");
  assert.equal(sdkThemeTokenReplacement("--el-disabled-text-color"), "--sdk-text-color-disabled");
  assert.equal(sdkThemeTokenReplacement("--el-font-family-mono"), "--font-mono");
  assert.equal(sdkThemeTokenReplacement("--el-box-shadow"), "--elevation-overlay");
  assert.ok(SDK_THEME_TOKENS.length > 0 && SDK_PLATFORM_THEME_TOKENS.length > 0);
});

test("appsSdkComponentCatalogSchema validates SDK-owned UI primitive, directive, and theme token lists", () => {
  const primitive = appsSdkUiPrimitiveEntrySchema.parse({
    tag: "sdk-button",
    exportName: "SdkButton",
    module: SDK_UI_ENTRY_SPECIFIER,
    description: "Triggers an action.",
    props: [{ name: "type", type: "string", description: "Visual style", required: false }],
    events: [{ name: "click", type: "(event: MouseEvent) => void", description: "Fired on click" }],
    slots: [{ name: "default", type: "{}", description: "Button content" }],
  });
  // Must not accept third-party metadata fields such as backedBy.
  assert.equal(appsSdkUiPrimitiveEntrySchema.safeParse({ ...primitive, backedBy: "el-button" }).success, false);

  const directive = appsSdkUiDirectiveEntrySchema.parse({
    name: "v-sdk-loading",
    exportName: "vSdkLoading",
    module: SDK_UI_ENTRY_SPECIFIER,
    description: "Loading overlay",
  });
  const token = appsSdkThemeTokenEntrySchema.parse({
    name: "--sdk-color-primary",
    kind: "color",
    overridable: true,
  });

  const catalogue = appsSdkComponentCatalogSchema.parse({
    version: "1.0.0",
    components: [],
    uiPrimitives: [primitive],
    uiDirectives: [directive],
    themeTokens: [token],
  });
  assert.equal(catalogue.uiPrimitives?.length, 1);
  assert.equal(catalogue.uiDirectives?.length, 1);
  assert.equal(catalogue.themeTokens?.length, 1);
});

test("componentModuleImports allows @ontomato/sdk/ui and rejects element-plus", async () => {
  assert.ok(componentOfficialSpecifiers.includes(SDK_UI_ENTRY_SPECIFIER));
  assert.equal(isComponentOfficialSpecifier("element-plus"), false);

  const allowed = await componentModuleImports(`
    import { ref } from "vue";
    import { SdkButton, vSdkLoading } from "@ontomato/sdk/ui";
    import { helper } from "./helper.js";
  `);
  assert.deepEqual(allowed.map(item => [item.specifier, item.kind]), [
    ["vue", "official"],
    ["@ontomato/sdk/ui", "official"],
    ["./helper.js", "relative"],
  ]);

  await assert.rejects(
    componentModuleImports('import { ElButton } from "element-plus";'),
    /import SDK UI primitives from '@ontomato\/sdk\/ui'/u,
  );
  await assert.rejects(
    componentModuleImports('import { ElButton } from "element-plus/es/components/button/index";'),
    /import SDK UI primitives from '@ontomato\/sdk\/ui'/u,
  );
  await assert.rejects(
    panelModuleImports('import { SdkButton } from "@ontomato/sdk/ui";'),
    /imports @ontomato\/sdk\/ui/u,
  );
  await assert.rejects(
    panelModuleImports('import { ElButton } from "element-plus";'),
    /use <sdk-\*> tags in panel\.html/u,
  );
});

test("checkAuthoringTemplate reports file, line, column, and replacement for tags, directives, styles, and renamed exports", () => {
  const html = [
    "<!-- <el-button> comment ignored -->",
    "<style>",
    "  /* var(--el-bg-color) comment ignored */",
    "  .box { color: var(--el-text-color-primary); background: var(--el-bg-color); }",
    "</style>",
    '<div id="app" v-loading="busy">',
    '  <el-button type="primary">Save</el-button>',
    '  <el-popconfirm title="Delete?"></el-popconfirm>',
    '  <sdk-popconfirm></sdk-popconfirm>',
    '  <sdk-nonexistent></sdk-nonexistent>',
    '  <component :is="\'el-input\'"></component>',
    '  <g6-graph-canvas></g6-graph-canvas>',
    '  <sdk-button v-sdk-loading="ok">OK</sdk-button>',
    "</div>",
  ].join("\n");

  const violations = checkAuthoringTemplate(html, "panel.html");
  assert.deepEqual(
    violations.map(v => ({ line: v.line, kind: v.kind, found: v.found, replacement: v.replacement })),
    [
      { line: 4, kind: "forbidden-token", found: "--el-text-color-primary", replacement: "--sdk-text-color-primary" },
      { line: 4, kind: "forbidden-token", found: "--el-bg-color", replacement: "--sdk-bg-color" },
      { line: 6, kind: "forbidden-directive", found: "v-loading", replacement: "v-sdk-loading" },
      { line: 7, kind: "forbidden-tag", found: "el-button", replacement: "<sdk-button>" },
      { line: 8, kind: "forbidden-tag", found: "el-popconfirm", replacement: sdkUiForbiddenByImplTag("el-popconfirm")!.replacement },
      { line: 9, kind: "unknown-sdk-tag", found: "sdk-popconfirm", replacement: sdkUiForbiddenByImplTag("el-popconfirm")!.replacement },
      { line: 10, kind: "unknown-sdk-tag", found: "sdk-nonexistent", replacement: null },
      { line: 11, kind: "forbidden-tag", found: "el-input", replacement: "sdk-input" },
      { line: 12, kind: "forbidden-export", found: "g6-graph-canvas", replacement: "<interactive-graph-canvas>" },
    ],
  );
  assert.ok(violations.every(v => v.file === "panel.html" && v.column >= 1));
});

test("checkAuthoringScript, checkAuthoringStyles, and checkAuthoringTheme report replacements from the single map", async () => {
  const script = [
    'import { ElButton, ElMessage } from "element-plus";',
    'import { G6GraphCanvas } from "@ontomato/sdk/graph";',
  ].join("\n");
  const scriptViolations = await checkAuthoringScript(script, "Widget.vue");
  assert.equal(scriptViolations.length, 2);
  assert.equal(scriptViolations[0]!.kind, "forbidden-import");
  assert.equal(scriptViolations[0]!.line, 1);
  assert.match(scriptViolations[0]!.replacement ?? "", /ElButton -> SdkButton/);
  assert.match(scriptViolations[0]!.replacement ?? "", /ElMessage -> usePanelContext\(\)\.notify/);
  assert.equal(scriptViolations[1]!.kind, "forbidden-export");
  assert.equal(scriptViolations[1]!.found, "G6GraphCanvas");
  assert.equal(scriptViolations[1]!.replacement, "InteractiveGraphCanvas");
  assert.equal(sdkRenamedExportByImpl("G6GraphCanvas")?.sdkExport, "InteractiveGraphCanvas");
  assert.equal(SDK_RENAMED_EXPORTS[0]?.sdkTag, "interactive-graph-canvas");

  const styleViolations = checkAuthoringStyles(".a { border-color: var(--el-border-color); }", "style.css");
  assert.equal(styleViolations.length, 1);
  assert.equal(styleViolations[0]!.replacement, "--sdk-border-color");

  const themeViolations = checkAuthoringTheme(
    { light: Object.fromEntries([["--el-color-primary", "#123456"], ["--sdk-bg-color", "#fff"]]) },
    "panel.json",
  );
  assert.equal(themeViolations.length, 1);
  assert.equal(themeViolations[0]!.found, "--el-color-primary");
  assert.equal(themeViolations[0]!.replacement, "--sdk-color-primary");
});

test("checkAuthoringStyles and checkAuthoringTemplate reject all CSS viewport units when enabled and stay off by default", () => {
  assert.equal(REJECT_VIEWPORT_UNITS, false);

  const allUnits = [
    "vh", "vw", "vmin", "vmax", "vi", "vb",
    "svh", "svw", "svmin", "svmax", "svi", "svb",
    "lvh", "lvw", "lvmin", "lvmax", "lvi", "lvb",
    "dvh", "dvw", "dvmin", "dvmax", "dvi", "dvb",
  ];
  const allUnitsCss = allUnits.map((unit, idx) => `.u${idx} { height: ${idx + 1}${idx % 2 === 0 ? unit : unit.toUpperCase()}; }`).join("\n");

  // Default switch is off: viewport units are not reported until enabled.
  assert.deepEqual(checkAuthoringStyles(allUnitsCss, "style.css"), []);

  // Enabled explicitly: every viewport unit is reported with exact file/line/column and replacement guidance.
  const allHits = checkAuthoringStyles(allUnitsCss, "style.css", 0, allUnitsCss, { rejectViewportUnits: true });
  assert.equal(allHits.length, allUnits.length);
  allHits.forEach((violation, idx) => {
    const unit = allUnits[idx]!;
    const expectedFound = `${idx + 1}${idx % 2 === 0 ? unit : unit.toUpperCase()}`;
    assert.equal(violation.file, "style.css");
    assert.equal(violation.line, idx + 1);
    assert.equal(violation.column, `.u${idx} { height: `.length + 1);
    assert.equal(violation.kind, "forbidden-viewport-unit");
    assert.equal(violation.found, expectedFound);
    assert.match(violation.message, /content box.*rem\/px min-height.*<sdk-dialog>/u);
  });

  // Expressions, signs, decimals, scientific notation, and negative false-positive cases.
  const mixedCss = [
    "/* height: 100vh; don't break 50vw inside a comment */",
    '.safe-100vh { --card-100vh: 24rem; --100vh: 320px; content: "100vh"; background: url(/img/50vw.png); }',
    ".p50vw, #id100vh, #100vh { min-height: 24rem; width: 100%; padding: 12px 1.5em; height: 50cqh; }",
    ".bad-expr { height: calc(100dvh - 120px); width: 50vw; min-height: 80svh; }",
    ".bad-num { margin-top: -10vh; padding-left: .5Vw; max-height: 1e2LVH; }",
  ].join("\n");
  const mixedHits = checkAuthoringStyles(mixedCss, "panel.css", 0, mixedCss, { rejectViewportUnits: true });
  assert.deepEqual(
    mixedHits.map(v => ({ line: v.line, column: v.column, found: v.found })),
    [
      { line: 4, column: 26, found: "100dvh" },
      { line: 4, column: 50, found: "50vw" },
      { line: 4, column: 68, found: "80svh" },
      { line: 5, column: 24, found: "-10vh" },
      { line: 5, column: 45, found: ".5Vw" },
      { line: 5, column: 63, found: "1e2LVH" },
    ],
  );

  // Template check covers inline <style> blocks and static style="..." attributes, preserving exact offsets.
  const html = [
    "<!-- <style>.ignored { height: 100vh; }</style> -->",
    "<style>",
    "  .root { height: 100vh; min-height: 24rem; }",
    "</style>",
    '<div id="app" style="min-height: 80svh">',
    "  <div :style=\"{ height: '100vh' }\"></div>",
    "</div>",
  ].join("\n");
  assert.deepEqual(checkAuthoringTemplate(html, "panel.html"), []);
  const templateHits = checkAuthoringTemplate(html, "panel.html", { rejectViewportUnits: true });
  assert.deepEqual(
    templateHits.map(v => ({ file: v.file, line: v.line, column: v.column, kind: v.kind, found: v.found })),
    [
      { file: "panel.html", line: 3, column: 19, kind: "forbidden-viewport-unit", found: "100vh" },
      { file: "panel.html", line: 5, column: 34, kind: "forbidden-viewport-unit", found: "80svh" },
    ],
  );
});

test("strictParadigm rejects hardcoded colors, hardcoded font sizes, and handwritten pane widths while staying off by default", () => {
  assert.equal(REJECT_PARADIGM_VIOLATIONS, false);

  const badCss = [
    "#beef { color: #333; background: rgba(15, 23, 42, 0.12); border-color: hsl(210, 50%, 50%); }",
    ".label { font-size: 12px; }",
    ".sub { font-size: 0.875rem !important; }",
    ".shorthand { font: 600 14px/1.5 sans-serif; }",
    ".split { display: grid; grid-template-columns: clamp(26rem, 42%, 29rem) minmax(0, 1fr); }",
    ".wb { display: grid; grid-template-columns: 264px minmax(320px, 1fr) 320px; }",
    ".ratio { display: grid; grid-template-columns: minmax(0, 1.45fr) minmax(0, 1fr); }",
    ".flex-pane { flex: 0 0 22rem; }",
    ".aside-basis { flex-basis: 320px; }",
    ".sidebar { width: 280px; }",
    ".aside-flex { flex: 1 1 18rem; }",
  ].join("\n");

  // Default switch is off: legacy styles pass without paradigm errors.
  assert.deepEqual(checkAuthoringStyles(badCss, "panel.css"), []);

  const hits = checkAuthoringStyles(badCss, "panel.css", 0, badCss, { strictParadigm: true });
  const colorHits = hits.filter(v => v.kind === "forbidden-hardcoded-color");
  assert.deepEqual(
    colorHits.map(v => ({ line: v.line, found: v.found })),
    [
      { line: 1, found: "#333" },
      { line: 1, found: "rgba(15, 23, 42, 0.12)" },
      { line: 1, found: "hsl(210, 50%, 50%)" },
    ],
  );
  for (const hit of colorHits) {
    assert.match(hit.message, /--sdk-text-color-primary.*--ui-divider/u);
    assert.doesNotMatch(hit.message, /--el-/u);
  }

  const fontHits = hits.filter(v => v.kind === "forbidden-hardcoded-font-size");
  assert.deepEqual(
    fontHits.map(v => ({ line: v.line, found: v.found })),
    [
      { line: 2, found: "12px" },
      { line: 3, found: "0.875rem" },
      { line: 4, found: "14px" },
    ],
  );
  for (const hit of fontHits) {
    assert.match(hit.message, /--text-xs.*--text-sm.*--text-base.*--text-lg/u);
  }

  const paneHits = hits.filter(v => v.kind === "forbidden-pane-column-width");
  assert.deepEqual(
    paneHits.map(v => ({ line: v.line, found: v.found })),
    [
      { line: 5, found: "clamp(26rem, 42%, 29rem) minmax(0, 1fr)" },
      { line: 6, found: "264px minmax(320px, 1fr) 320px" },
      { line: 7, found: "minmax(0, 1.45fr) minmax(0, 1fr)" },
      { line: 8, found: "22rem" },
      { line: 9, found: "320px" },
      { line: 10, found: "280px" },
      { line: 11, found: "18rem" },
    ],
  );
  for (const hit of paneHits) {
    assert.match(hit.message, /<two-pane-layout>.*<workbench-layout>/u);
  }

  // Legitimate styles allowed under strictParadigm: ID selectors, comments, theme tokens, typography tokens,
  // responsive form/card grids, equal splits, label-value grids, and small icons/controls.
  const okCss = [
    "/* color: #fff; font-size: 14px; grid-template-columns: 280px 1fr; */",
    "#cafe { color: var(--sdk-text-color-primary); background: transparent; border: 1px solid var(--ui-divider /* #e5e7eb */); }",
    ".tint { background: color-mix(in srgb, var(--sdk-bg-color) 88%, transparent); box-shadow: 0 0 0 1px rgba(var(--sdk-color-primary-rgb), 0.12); }",
    '.note::after { content: "#123456 14px"; }',
    ".text { font-size: var(--text-sm); font: inherit; color: currentColor; }",
    ".inherit-size { font-size: inherit; }",
    ".form-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); }",
    ".cards { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); }",
    ".equal { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); }",
    ".facts { display: grid; grid-template-columns: max-content minmax(0, 1fr); }",
    ".single { display: grid; grid-template-columns: minmax(0, 1fr); }",
    ".tokenized { display: grid; grid-template-columns: var(--pane-aside-width) minmax(0, 1fr); }",
    ".icon { flex: 0 0 28px; width: 24px; }",
    ".search { width: 260px; max-width: 100%; flex: 1 1 200px; }",
    ".pane { width: 100%; flex: 1 1 auto; }",
  ].join("\n");
  assert.deepEqual(checkAuthoringStyles(okCss, "clean.css", 0, okCss, { strictParadigm: true }), []);
});

test("strictParadigm rejects panel dialogs/drawers, SDK data-display primitives, and viewport units together", () => {
  const html = [
    "<!-- <sdk-dialog></sdk-dialog><sdk-table></sdk-table> -->",
    "<style>",
    "  .root { height: 100vh; color: #333; }",
    "</style>",
    '<div id="app" style="font-size: 13px">',
    "  <sdk-dialog v-model=\"open\"></sdk-dialog>",
    "  <SdkDrawer v-model=\"drawer\"></SdkDrawer>",
    "  <el-dialog v-model=\"legacy\"></el-dialog>",
    "  <el-drawer v-model=\"legacyDrawer\"></el-drawer>",
    '  <component :is="\'sdk-dialog\'"></component>',
    "  <sdk-table :data=\"rows\"></sdk-table>",
    "  <sdk-pagination :total=\"10\"></sdk-pagination>",
    "  <sdk-descriptions></sdk-descriptions>",
    "  <sdk-tree :data=\"nodes\"></sdk-tree>",
    '  <component is="sdk-tree"></component>',
    "</div>",
  ].join("\n");

  // Default (off): only <el-dialog> and <el-drawer> are rejected by the baseline third-party tag rule.
  const baseline = checkAuthoringTemplate(html, "panel.html");
  assert.deepEqual(
    baseline.map(v => ({ line: v.line, kind: v.kind, found: v.found })),
    [
      { line: 8, kind: "forbidden-tag", found: "el-dialog" },
      { line: 9, kind: "forbidden-tag", found: "el-drawer" },
    ],
  );

  // Strict paradigm enabled: rejects viewport unit + color + font-size + overlays + data-display primitives.
  const strict = checkAuthoringTemplate(html, "panel.html", { strictParadigm: true });
  assert.deepEqual(
    strict.map(v => ({ line: v.line, kind: v.kind, found: v.found })),
    [
      { line: 3, kind: "forbidden-viewport-unit", found: "100vh" },
      { line: 3, kind: "forbidden-hardcoded-color", found: "#333" },
      { line: 5, kind: "forbidden-hardcoded-font-size", found: "13px" },
      { line: 6, kind: "forbidden-panel-overlay", found: "sdk-dialog" },
      { line: 7, kind: "forbidden-panel-overlay", found: "SdkDrawer" },
      { line: 8, kind: "forbidden-panel-overlay", found: "el-dialog" },
      { line: 9, kind: "forbidden-panel-overlay", found: "el-drawer" },
      { line: 10, kind: "forbidden-panel-overlay", found: "sdk-dialog" },
      { line: 11, kind: "forbidden-panel-data-display", found: "sdk-table" },
      { line: 12, kind: "forbidden-panel-data-display", found: "sdk-pagination" },
      { line: 13, kind: "forbidden-panel-data-display", found: "sdk-descriptions" },
      { line: 14, kind: "forbidden-panel-data-display", found: "sdk-tree" },
      { line: 15, kind: "forbidden-panel-data-display", found: "sdk-tree" },
    ],
  );

  for (const hit of strict.filter(v => v.kind === "forbidden-panel-overlay")) {
    assert.match(hit.message, /TwoPaneLayout.*WorkbenchLayout.*ObjectList.*OperationButton/u);
  }
  for (const hit of strict.filter(v => v.kind === "forbidden-panel-data-display")) {
    assert.match(hit.message, /ObjectList.*ObjectSummary.*ObjectTree.*<projection>.*HTML/u);
  }

  // Compliant panel template passes strictParadigm cleanly.
  const compliant = [
    "<style>",
    "  .hint { color: var(--sdk-text-color-secondary); font-size: var(--text-sm); }",
    "</style>",
    '<div id="app">',
    "  <two-pane-layout>",
    '    <template #aside><projection slot="list"></projection></template>',
    '    <projection slot="summary"></projection>',
    '    <projection slot="form"></projection>',
    '    <p class="hint">Static explanation</p>',
    "  </two-pane-layout>",
    "</div>",
  ].join("\n");
  assert.deepEqual(checkAuthoringTemplate(compliant, "panel.html", { strictParadigm: true }), []);
});
