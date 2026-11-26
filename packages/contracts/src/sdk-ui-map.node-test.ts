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
  checkAuthoringDirectApiCalls,
  checkAuthoringScript,
  checkAuthoringStyles,
  checkAuthoringTemplate,
  checkAuthoringTheme,
  checkProjectionConfigSources,
  componentModuleImports,
  componentOfficialSpecifiers,
  isComponentOfficialSpecifier,
  panelModuleImports,
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

  for (const excluded of ["el-config-provider", "el-popper"]) {
    assert.equal(sdkUiComponentByImplTag(excluded), undefined);
    assert.ok(sdkUiForbiddenByImplTag(excluded)?.replacement);
  }
  for (const service of ["ElMessage", "ElNotification", "ElLoading"]) {
    assert.equal(sdkUiComponentByImplExport(service), undefined);
    assert.ok(sdkUiForbiddenByImplExport(service)?.replacement);
  }
  // Popconfirm, PageHeader, and MessageBox are released as SDK UI primitives/services.
  assert.equal(sdkUiComponentByImplTag("el-popconfirm")?.sdkTag, "sdk-popconfirm");
  assert.equal(sdkUiComponentByImplTag("el-page-header")?.sdkTag, "sdk-page-header");
  assert.equal(sdkUiForbiddenByImplExport("ElMessageBox"), undefined);
  assert.equal(sdkUiComponentByTag("sdk-button")?.sdkExport, "SdkButton");
  assert.equal(sdkUiComponentByImplExport("ElDialog")?.sdkTag, "sdk-dialog");
  assert.ok(SDK_UI_FORBIDDEN_COMPONENTS.length >= 5);
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

test("componentModuleImports allows @ontomato/sdk/* official specifiers and rejects element-plus and bare echarts", async () => {
  assert.ok(componentOfficialSpecifiers.includes(SDK_UI_ENTRY_SPECIFIER));
  assert.equal(isComponentOfficialSpecifier("@ontomato/sdk/chart"), true);
  assert.equal(isComponentOfficialSpecifier("@ontomato/sdk/base"), true);
  assert.equal(isComponentOfficialSpecifier("element-plus"), false);
  assert.equal(isComponentOfficialSpecifier("echarts"), false);

  const allowed = await componentModuleImports(`
    import { ref } from "vue";
    import { SdkButton, vSdkLoading } from "@ontomato/sdk/ui";
    import { EChart } from "@ontomato/sdk/chart";
    import { MetricChart } from "@ontomato/sdk/base";
    import { helper } from "./helper.js";
  `);
  assert.deepEqual(allowed.map(item => [item.specifier, item.kind]), [
    ["vue", "official"],
    ["@ontomato/sdk/ui", "official"],
    ["@ontomato/sdk/chart", "official"],
    ["@ontomato/sdk/base", "official"],
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
    componentModuleImports('import * as echarts from "echarts";'),
    /import chart components from '@ontomato\/sdk\/chart'/u,
  );
  await assert.rejects(
    componentModuleImports('import { init } from "echarts/core";'),
    /import chart components from '@ontomato\/sdk\/chart'/u,
  );
  await assert.rejects(
    panelModuleImports('import { ElButton } from "element-plus";'),
    /use <sdk-\*> tags in panel\.html/u,
  );
  await assert.rejects(
    panelModuleImports('import * as echarts from "echarts";'),
    /use <e-chart> in panel\.html or the MetricChart projection component/u,
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
    '  <el-config-provider></el-config-provider>',
    '  <sdk-popconfirm title="Delete?"></sdk-popconfirm>',
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
      { line: 8, kind: "forbidden-tag", found: "el-config-provider", replacement: sdkUiForbiddenByImplTag("el-config-provider")!.replacement },
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

test("checkAuthoringTemplate rejects attributes that would configure a projection where it is placed", () => {
  const cases = ["disabled", ":disabled", "v-bind:title", "fallback-title", ":columns", "size"] as const;
  for (const attribute of cases) {
    const html = `<projection slot="a" ${attribute}="value"></projection>`;
    const violations = checkAuthoringTemplate(`<!-- Panel template -->\n  ${html}`, "panel.html");
    assert.equal(violations.length, 1, html);
    assert.equal(violations[0]?.kind, "projection-placement-attribute", html);
    assert.equal(violations[0]?.file, "panel.html");
    assert.equal(violations[0]?.line, 2);
    assert.equal(violations[0]?.column, html.indexOf(`${attribute}=`) + 3);
    assert.equal(violations[0]?.found, attribute);
    assert.match(violations[0]!.message, /configures nothing.*config.*:values/u);
  }
});

test("checkAuthoringTemplate rejects projection inputs outside a component's scoped slot", () => {
  const cases = [
    ['<projection slot="a" :inputs="{ className: key }"/>', ":inputs"],
    ['<section><div><PROJECTION slot="a" inputs="key"/></div></section>', "inputs"],
    ['<two-pane-layout><template #default><projection slot="a" v-bind:inputs="{ x: key }"></projection></template></two-pane-layout>', "v-bind:inputs"],
    ['<sdk-drawer><template #header="{ close }"><projection slot="a" :inputs="{ x: close }"></projection></template></sdk-drawer>', ":inputs"],
    ['<div><template #default="scope"><projection slot="a" :inputs="{ x: scope }"/></template></div>', ":inputs"],
    ['<my-card v-slot="scope"/><projection slot="a" :inputs="{ x: key }"/>', ":inputs"],
  ] as const;
  for (const [html, attribute] of cases) {
    const violations = checkAuthoringTemplate(`<!-- Panel template -->\n  ${html}`, "panel.html");
    assert.equal(violations.length, 1, html);
    assert.equal(violations[0]?.kind, "projection-inputs-outside-slot", html);
    assert.equal(violations[0]?.line, 2);
    assert.equal(violations[0]?.column, html.indexOf(`${attribute}=`) + 3);
    assert.equal(violations[0]?.found, attribute);
    assert.match(violations[0]!.message, /scoped slot.*panel\.json.*:values/u);
  }
});

test("checkAuthoringTemplate accepts a projection placed anywhere, with page values wherever it is", () => {
  const cases = [
    '<my-card><template #item="{ item }"><projection slot="a" :inputs="{ className: item }"/></template></my-card>',
    '<projection slot="a" :values="{ title: title, disabled: dirty }" class="box" style="min-height: 40px"></projection>',
    '<section><div><PROJECTION slot="a" values="key"/></div></section>',
    '<projection slot="a" :values="{ title: title, disabled: dirty }"></projection>',
    '<projection slot="a" v-if="ready" v-show="shown" :key="key" ref="memberRef" @choose="choose"></projection>',
    '<projection :slot="countMember(item.id)" @row-action="onRowAction"></projection>',
    '<my-card v-slot="scope"><projection slot="a" :inputs="{ x: scope }"/></my-card>',
    '<sdk-drawer><template #header="{ close }"><projection slot="a" :values="{ x: close }"></projection></template></sdk-drawer>',
  ] as const;
  for (const html of cases) {
    assert.deepEqual(checkAuthoringTemplate(html, "panel.html"), [], html);
  }
});

test("checkProjectionConfigSources rejects one member value written in two places", () => {
  const members = {
    list: { config: { columns: [{ key: "label" }], emptyText: "list.empty" }, inputs: { className: { state: "chosen" } } },
    trial: { config: { type: "primary" } },
  };
  const html = [
    '<projection slot="list" :inputs="{ className: row.className }"></projection>',
    '<projection slot="trial" :values="{ type: type }"></projection>',
    '<projection slot="trial" :values="{ disabled: dirty }"></projection>',
    '<projection slot="list" :values="viewValues"></projection>',
    '<projection slot="trial" :values="{ title: title }"></projection>',
    '<projection slot="trial" :inputs="{ type: type }"></projection>',
  ].join("\n");
  const violations = checkProjectionConfigSources(members, html, "panel.html");
  assert.deepEqual(violations.map(({ kind, found, line }) => ({ kind, found, line })), [
    { kind: "projection-config-duplicate", found: "className", line: 1 },
    { kind: "projection-config-duplicate", found: "type", line: 2 },
    { kind: "projection-config-duplicate", found: "type", line: 6 },
  ]);
  assert.match(violations[0]!.message, /binds input 'className' in its declaration/u);
  assert.match(violations[1]!.message, /writes 'type' in its config/u);
});

test("checkProjectionConfigSources rejects config and inputs of one member naming the same value", () => {
  const violations = checkProjectionConfigSources(
    { header: { config: { fallbackTitle: "x", subtitle: "" }, inputs: { fallbackTitle: { state: "selected" } } } },
    undefined,
    "panel.json",
  );
  assert.equal(violations.length, 1);
  assert.equal(violations[0]!.kind, "projection-config-duplicate");
  assert.equal(violations[0]!.found, "fallbackTitle");
  assert.equal(violations[0]!.file, "panel.json");
});

test("checkAuthoringTemplate accepts projection inputs in row, field, and custom scoped slots", () => {
  const cases = [
    '<projection slot="list"><template #row-detail="{ ref }"><projection slot="detail" :inputs="{ target: ref }"></projection></template></projection>',
    '<projection slot="form"><template #field-owner="slotProps"><projection slot="ownerCard" :inputs="{ target: slotProps.value }"></projection></template></projection>',
    '<my-card><template #item="{ item }"><projection slot="detail" :inputs="{ target: item }"></projection></template></my-card>',
    '<my-card v-slot="{ item }"><projection slot="detail" :inputs="{ target: item }"></projection></my-card>',
    '<my-card><img src="x"><widget/><template v-slot:item="scope"><div><Projection slot="detail" v-bind:inputs="{ target: scope.item }"/></div></template></my-card>',
  ];
  for (const html of cases) {
    assert.deepEqual(checkAuthoringTemplate(html, "panel.html"), [], html);
  }
});

test("checkAuthoringStyles and checkAuthoringTemplate allow CSS viewport units", () => {
  const css = ".root { height: 100vh; width: 50vw; min-height: 80dvh; }";
  assert.deepEqual(checkAuthoringStyles(css, "style.css"), []);
  const html = '<style>.root { height: 100vh; }</style><div style="min-height: 80svh"></div>';
  assert.deepEqual(checkAuthoringTemplate(html, "panel.html"), []);
});

test("panel styles reject Vue deep selectors without flagging comments or strings", () => {
  const css = [
    "/* :deep(.example) and ::v-deep */",
    '.example::before { content: ":deep(.example) ::v-deep"; }',
    ".wrap :deep(.sdk-owner-form) { padding: 0; }",
    ".wrap ::v-deep .sdk-owner-form { padding: 0; }",
  ].join("\n");
  const stylesheet = checkAuthoringStyles(css, "panel.css");
  const template = checkAuthoringTemplate(`<style>\n${css}\n</style>`, "panel.html");
  const locations = (violations: ReturnType<typeof checkAuthoringStyles>) =>
    violations.map(({ found, line, column, kind }) => ({ found, line, column, kind }));
  assert.deepEqual(locations(stylesheet), [
    { found: ":deep(", line: 3, column: 7, kind: "forbidden-selector" },
    { found: "::v-deep", line: 4, column: 7, kind: "forbidden-selector" },
  ]);
  assert.deepEqual(locations(template), locations(stylesheet).map(item => ({ ...item, line: item.line + 1 })));
});

test("checkAuthoringTemplate and checkAuthoringStyles allow normal HTML/CSS, SDK UI primitives, and ignore comments, scripts, strings, and mustaches", async () => {
  const allowedCss = [
    "#beef { color: #333; background: rgba(15, 23, 42, 0.12); border-color: hsl(210, 50%, 50%); }",
    ".label { font-size: 12px; }",
    ".split { display: grid; grid-template-columns: var(--pane-list-width, 300px) minmax(0, 1fr); }",
  ].join("\n");

  assert.deepEqual(checkAuthoringStyles(allowedCss, "panel.css"), []);

  const allowedTemplate = [
    "<!-- <el-button>commented</el-button> -->",
    "<script>",
    '  const raw = "<el-button><el-table></el-table></el-button>";',
    "</script>",
    "<style>",
    "  .card { color: #333; font-size: 14px; width: 280px; }",
    "</style>",
    '<div id="app" title="Never use <el-button>" :data-example="\'<el-input>\'">',
    '  <section><p>{{ show ? "<el-tag>ok</el-tag>" : count < inputLimit }}</p></section>',
    '  <button type="button" class="tab-chip" @click="selectTab">Overview</button>',
    '  <sdk-table :data="staticLegend"></sdk-table>',
    '  <sdk-input v-model="q" @keyup.enter="() => run(a > 0)" />',
    '  <sdk-button type="primary" @click="() => submit()">Save</sdk-button>',
    '  <sdk-popconfirm title="Confirm?"><template #reference><sdk-button>Delete</sdk-button></template></sdk-popconfirm>',
    '  <sdk-page-header content="Detail" />',
    '  <sdk-dialog v-model="open"><p>Modal body</p></sdk-dialog>',
    '  <SdkDrawer v-model="drawer"><span>Drawer body</span></SdkDrawer>',
    '  <projection slot="list"></projection>',
    "</div>",
  ].join("\n");
  assert.deepEqual(checkAuthoringTemplate(allowedTemplate, "panel.html"), []);

  const scriptSource = 'export const snippet = "<button>Click</button><el-button>Docs</el-button>";\n';
  assert.deepEqual(await checkAuthoringScript(scriptSource, "panel.mjs"), []);
});

test("checkAuthoringDirectApiCalls and checkAuthoringScript block direct API requests and allow comments or safe identifiers", async () => {
  const blocked = [
    'import * as echarts from "echarts";',
    'async function load(id) {',
    '  const res = await fetch("/api/orders");',
    '  const xhr = new XMLHttpRequest();',
    "  const sse = new EventSource('/api/stream');",
    '  const ws = new WebSocket(`wss://example.com/api/ws/${id}`);',
    '  return { res, xhr, sse, ws };',
    '}',
  ].join("\n");

  const directOnly = checkAuthoringDirectApiCalls(blocked, "panel.mjs");
  assert.deepEqual(
    directOnly.map(v => ({ line: v.line, kind: v.kind, found: v.found })),
    [
      { line: 3, kind: "forbidden-direct-api", found: "fetch" },
      { line: 3, kind: "forbidden-direct-api", found: "/api/" },
      { line: 4, kind: "forbidden-direct-api", found: "XMLHttpRequest" },
      { line: 5, kind: "forbidden-direct-api", found: "EventSource" },
      { line: 5, kind: "forbidden-direct-api", found: "/api/" },
      { line: 6, kind: "forbidden-direct-api", found: "WebSocket" },
      { line: 6, kind: "forbidden-direct-api", found: "/api/" },
    ],
  );
  for (const v of directOnly) {
    assert.match(v.message, /declared projection.*registered operation/u);
  }

  const allViolations = await checkAuthoringScript(blocked, "Widget.vue");
  assert.equal(allViolations[0]!.kind, "forbidden-import");
  assert.equal(allViolations[0]!.found, "echarts");
  assert.equal(allViolations[0]!.replacement, "@ontomato/sdk/chart");
  assert.equal(allViolations.length, 1 + directOnly.length);

  const allowed = [
    '// Never call fetch("/api/orders") or new WebSocket("/api/ws") directly.',
    '/* XMLHttpRequest and EventSource are also ignored in block comments: "/api/ignored" */',
    'const quotePattern = /["\']/gu;',
    'const prefetchData = true;',
    'const fetchCount = 3;',
    'const myWebSocketLabel = "fetch XMLHttpRequest EventSource WebSocket";',
    'const safePath = "/applications/demo/rapid/capital";',
    'export default { setup() { return { quotePattern, prefetchData, fetchCount, myWebSocketLabel, safePath }; } };',
  ].join("\n");
  assert.deepEqual(checkAuthoringDirectApiCalls(allowed, "panel.mjs"), []);
  assert.deepEqual(await checkAuthoringScript(allowed, "panel.mjs", { target: "panel" }), []);
});
