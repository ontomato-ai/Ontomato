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

test("strictParadigm does not reject colors, font sizes, handwritten pane widths, or SDK dialogs/drawers", () => {
  assert.equal(REJECT_PARADIGM_VIOLATIONS, false);

  const allowedCss = [
    "#beef { color: #333; background: rgba(15, 23, 42, 0.12); border-color: hsl(210, 50%, 50%); }",
    ".label { font-size: 12px; }",
    ".sub { font-size: 0.875rem !important; }",
    ".shorthand { font: 600 14px/1.5 sans-serif; }",
    ".split { display: grid; grid-template-columns: clamp(26rem, 42%, 29rem) minmax(0, 1fr); }",
    ".wb { display: grid; grid-template-columns: 264px minmax(320px, 1fr) 320px; }",
    ".flex-pane { flex: 0 0 22rem; }",
    ".aside-basis { flex-basis: 320px; }",
    ".sidebar { width: 280px; }",
  ].join("\n");

  assert.deepEqual(checkAuthoringStyles(allowedCss, "panel.css"), []);
  assert.deepEqual(checkAuthoringStyles(allowedCss, "panel.css", 0, allowedCss, { strictParadigm: true }), []);

  const allowedTemplate = [
    "<style>",
    "  .card { color: #333; font-size: 14px; width: 280px; }",
    "</style>",
    '<div id="app" style="color: rgba(0, 0, 0, 0.5); font-size: 13px">',
    '  <sdk-dialog v-model="open"><p>Modal body</p></sdk-dialog>',
    '  <SdkDrawer v-model="drawer"><span>Drawer body</span></SdkDrawer>',
    '  <component :is="\'sdk-dialog\'"></component>',
    "</div>",
  ].join("\n");
  assert.deepEqual(checkAuthoringTemplate(allowedTemplate, "panel.html", { strictParadigm: true }), []);

  // Third-party <el-dialog>/<el-drawer> are still rejected only by the baseline third-party tag rule.
  const legacyOverlays = '<el-dialog v-model="open"></el-dialog>\n<el-drawer v-model="drawer"></el-drawer>';
  assert.deepEqual(
    checkAuthoringTemplate(legacyOverlays, "panel.html", { strictParadigm: true }).map(v => ({
      line: v.line,
      kind: v.kind,
      found: v.found,
      replacement: v.replacement,
    })),
    [
      { line: 1, kind: "forbidden-tag", found: "el-dialog", replacement: "<sdk-dialog>" },
      { line: 2, kind: "forbidden-tag", found: "el-drawer", replacement: "<sdk-drawer>" },
    ],
  );
});

test("strictParadigm enforces the three decidable rules: viewport units, SDK data-display primitives, and native interactive controls", () => {
  const html = [
    "<!-- <sdk-table></sdk-table><button>comment</button><input><select><textarea></textarea> -->",
    "<style>",
    "  .root { height: 100vh; color: #333; font-size: 14px; }",
    "</style>",
    '<div id="app" style="min-height: calc(80dvh - 40px)">',
    '  <sdk-table :data="rows"></sdk-table>',
    '  <sdk-pagination :total="10"></sdk-pagination>',
    "  <sdk-descriptions></sdk-descriptions>",
    '  <sdk-tree :data="nodes"></sdk-tree>',
    '  <component is="sdk-tree"></component>',
    '  <el-table :data="rows"></el-table>',
    '  <input v-model="query" placeholder="type=\'checkbox\'" />',
    '  <input type="checkbox" :checked="all" />',
    '  <input type="radio" name="mode" />',
    '  <input type="number" v-model="count" />',
    '  <select v-model="scope"><option value="all">All</option></select>',
    '  <button type="button" @click="save">Save</button>',
    '  <BUTTON type="button">Loud</BUTTON>',
    '  <textarea v-model="notes"></textarea>',
    '  <component :is="\'button\'"></component>',
    "</div>",
  ].join("\n");

  // Default (off): only <el-table> is rejected by the baseline third-party tag rule.
  const baseline = checkAuthoringTemplate(html, "panel.html");
  assert.deepEqual(
    baseline.map(v => ({ line: v.line, kind: v.kind, found: v.found })),
    [{ line: 11, kind: "forbidden-tag", found: "el-table" }],
  );

  // Strict paradigm enabled: enforces viewport units, SDK data-display primitives, and native controls.
  const strict = checkAuthoringTemplate(html, "panel.html", { strictParadigm: true });
  assert.deepEqual(
    strict.map(v => ({ line: v.line, kind: v.kind, found: v.found, replacement: v.replacement })),
    [
      { line: 3, kind: "forbidden-viewport-unit", found: "100vh", replacement: strict[0]!.replacement },
      { line: 5, kind: "forbidden-viewport-unit", found: "80dvh", replacement: strict[1]!.replacement },
      { line: 6, kind: "forbidden-panel-data-display", found: "sdk-table", replacement: "ObjectList via <projection>" },
      { line: 7, kind: "forbidden-panel-data-display", found: "sdk-pagination", replacement: "ObjectList pagination via <projection>" },
      { line: 8, kind: "forbidden-panel-data-display", found: "sdk-descriptions", replacement: "ObjectSummary via <projection>" },
      { line: 9, kind: "forbidden-panel-data-display", found: "sdk-tree", replacement: "ObjectTree via <projection>" },
      { line: 10, kind: "forbidden-panel-data-display", found: "sdk-tree", replacement: "ObjectTree via <projection>" },
      { line: 11, kind: "forbidden-panel-data-display", found: "el-table", replacement: "ObjectList via <projection>" },
      { line: 12, kind: "forbidden-native-control", found: "input", replacement: "<sdk-input>" },
      { line: 13, kind: "forbidden-native-control", found: "input", replacement: "<sdk-checkbox>" },
      { line: 14, kind: "forbidden-native-control", found: "input", replacement: "<sdk-radio>" },
      { line: 15, kind: "forbidden-native-control", found: "input", replacement: "<sdk-input-number>" },
      { line: 16, kind: "forbidden-native-control", found: "select", replacement: "<sdk-select>" },
      { line: 17, kind: "forbidden-native-control", found: "button", replacement: "<sdk-button>" },
      { line: 18, kind: "forbidden-native-control", found: "BUTTON", replacement: "<sdk-button>" },
      { line: 19, kind: "forbidden-native-control", found: "textarea", replacement: '<sdk-input type="textarea">' },
      { line: 20, kind: "forbidden-native-control", found: "button", replacement: "<sdk-button>" },
    ],
  );

  for (const hit of strict.filter(v => v.kind === "forbidden-panel-data-display")) {
    assert.match(hit.message, /ObjectList.*ObjectSummary.*ObjectTree.*<projection>/u);
  }
  for (const hit of strict.filter(v => v.kind === "forbidden-native-control")) {
    assert.match(hit.message, /<sdk-(?:input|checkbox|radio|input-number|select|button)/u);
  }
});

test("strictParadigm native control check ignores SVG, script blocks, display HTML, attribute strings, and mustaches", async () => {
  const safeTemplate = [
    "<script>",
    '  const raw = "<button><input><select><textarea></textarea></button>";',
    "</script>",
    '<div id="app" title="Use <button>, <input>, <select>, or <textarea>" :data-example="\'<button>\'">',
    "  <two-pane-layout>",
    '    <header><h2>Objects</h2><a href="#help">Docs</a></header>',
    '    <section><p>{{ show ? "<button>ok</button>" : count < inputLimit }}</p></section>',
    '    <label class="field">Search</label>',
    '    <sdk-input v-model="q" @keyup.enter="() => run(a > 0)" />',
    '    <sdk-select v-model="scope"><sdk-option label="All" value="all" /></sdk-select>',
    '    <sdk-button type="primary" @click="() => submit()">Save</sdk-button>',
    '    <sdk-dialog v-model="open">',
    '      <svg viewBox="0 0 16 16" width="14" height="14"><title><button>icon</button></title><circle cx="7" cy="7" r="4.5" /><path d="M0 0" /></svg>',
    '      <component :is="button"></component>',
    "    </sdk-dialog>",
    '    <projection slot="list"></projection>',
    "  </two-pane-layout>",
    "</div>",
  ].join("\n");
  assert.deepEqual(checkAuthoringTemplate(safeTemplate, "panel.html", { strictParadigm: true }), []);

  // Non-template JS/TS strings containing native HTML tags are never flagged by script checks.
  const scriptSource = 'export const snippet = "<button>Click</button><input /><select></select><textarea></textarea>";\n';
  assert.deepEqual(await checkAuthoringScript(scriptSource, "panel.mjs"), []);
});
