import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const TSX_LOADER = join(ROOT, "packages/contracts/node_modules/tsx/dist/loader.mjs");
const PANEL_CHECK_URL = pathToFileURL(join(ROOT, "agent-skills/ontomato-app-builder/scripts/panel-check.mjs")).href;
const CONTRACTS_CHECK_URL = pathToFileURL(join(ROOT, "packages/contracts/src/panel-check.ts")).href;

function runCheck(kind, directory) {
  const script = kind === "builtin"
    ? `import * as checks from ${JSON.stringify(CONTRACTS_CHECK_URL)};
       import { checkBuiltinPanelSource } from ${JSON.stringify(PANEL_CHECK_URL)};
       console.log(JSON.stringify(await checkBuiltinPanelSource(${JSON.stringify(directory)}, { ...checks, draftReadOperationIds: [] })));`
    : `import * as checks from ${JSON.stringify(CONTRACTS_CHECK_URL)};
       import { checkPanelWorkspace } from ${JSON.stringify(PANEL_CHECK_URL)};
       console.log(JSON.stringify(await checkPanelWorkspace(${JSON.stringify(directory)}, {
         checks,
         catalogue: { version: "1.0.0", components: [] },
         version: "1.0.0",
       })));`;
  return execFileSync(process.execPath, ["--import", TSX_LOADER, "--input-type=module", "-e", script], {
    cwd: ROOT,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
}

function writeWorkspace(directory, { html, module, theme, extraCss } = {}) {
  writeFileSync(join(directory, "panel.json"), JSON.stringify({
    ...(theme ? { theme } : {}),
    manifest: { state: {}, members: {} },
  }, null, 2));
  writeFileSync(join(directory, "panel.html"), html ?? `<style>.box { background: var(--sdk-bg-color); }</style>\n<div id="app" v-sdk-loading="false"><sdk-button type="primary">Save</sdk-button></div>\n`);
  writeFileSync(join(directory, "panel.mjs"), module ?? `import { mountPanel } from "@ontomato/sdk/panel";\nawait mountPanel({});\n`);
  if (extraCss !== undefined) writeFileSync(join(directory, "extra.css"), extraCss);
}

test("checkPanelWorkspace accepts SDK UI primitives, directives, and --sdk-* theme tokens", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "panel-sdk-ui-ok-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  writeWorkspace(dir, { theme: { light: { "--sdk-color-primary": "#0f7b6c" } } });
  const result = JSON.parse(runCheck("workspace", dir));
  assert.equal(result.status, "valid");
});

test("checkPanelWorkspace rejects <el-*>, v-loading, --el-* styles, --el-* theme keys, and element-plus imports with replacements", (t) => {
  const cases = [
    {
      label: "el-button tag",
      files: { html: `<div id="app"><el-button>Save</el-button></div>\n` },
      pattern: /panel\.html:1:\d+:.*<el-button>.*<sdk-button>/u,
    },
    {
      label: "v-loading directive",
      files: { html: `<div id="app" v-loading="busy"><sdk-button>Save</sdk-button></div>\n` },
      pattern: /panel\.html:1:\d+:.*v-loading.*v-sdk-loading/u,
    },
    {
      label: "--el-* in inline <style>",
      files: { html: `<style>.box { background: var(--el-bg-color); }</style>\n<div id="app"></div>\n` },
      pattern: /panel\.html:1:\d+:.*--el-bg-color.*--sdk-bg-color/u,
    },
    {
      label: "--el-* in standalone CSS file",
      files: { extraCss: `.box { border-color: var(--el-border-color); }\n` },
      pattern: /extra\.css:1:\d+:.*--el-border-color.*--sdk-border-color/u,
    },
    {
      label: "--el-* in panel.json theme",
      files: { theme: { light: { "--el-color-primary": "#123456" } } },
      pattern: /panel\.json:1:1:.*--el-color-primary.*--sdk-color-primary/u,
    },
    {
      label: "element-plus import in panel.mjs",
      files: { module: `import { ElButton } from "element-plus";\nimport { mountPanel } from "@ontomato/sdk/panel";\nawait mountPanel({ components: { ElButton } });\n` },
      pattern: /panel\.mjs:.*imports element-plus.*<sdk-\*>/u,
    },
  ];

  for (const item of cases) {
    const dir = mkdtempSync(join(tmpdir(), "panel-sdk-ui-bad-"));
    t.after(() => rmSync(dir, { recursive: true, force: true }));
    writeWorkspace(dir, item.files);
    assert.throws(
      () => runCheck("workspace", dir),
      (error) => {
        const output = `${error.stderr ?? ""}${error.stdout ?? ""}`;
        assert.match(output, item.pattern, `${item.label} diagnostic mismatch: ${output}`);
        return true;
      },
      `${item.label} should fail panel-check`,
    );
  }
});

test("checkBuiltinPanelSource rejects third-party UI tags and tokens in builtin panel sources", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "builtin-sdk-ui-bad-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  writeFileSync(join(dir, "registration.json"), JSON.stringify({
    panels: [{ id: "builtin-product-test", input: { name: "Test", description: "Test" } }],
  }));
  writeWorkspace(dir, {
    html: `<style>.box { color: var(--el-text-color-primary); }</style>\n<div id="app" v-loading="busy"><el-tag>x</el-tag></div>\n`,
  });
  assert.throws(
    () => runCheck("builtin", dir),
    (error) => {
      const output = `${error.stderr ?? ""}${error.stdout ?? ""}`;
      assert.match(output, /--el-text-color-primary.*--sdk-text-color-primary/u);
      assert.match(output, /v-loading.*v-sdk-loading/u);
      assert.match(output, /<el-tag>.*<sdk-tag>/u);
      return true;
    },
  );
});

test("every shipped builtin panel passes checkBuiltinPanelSource with zero third-party UI or theme leaks", () => {
  const script = `
    import { readdirSync } from "node:fs";
    import { join } from "node:path";
    import * as checks from ${JSON.stringify(CONTRACTS_CHECK_URL)};
    import { checkBuiltinPanelSource } from ${JSON.stringify(PANEL_CHECK_URL)};
    const roots = [
      "packages/ontology-manager/resources/builtin-panels",
      "packages/platform-admin/resources/builtin-panels",
      "packages/platform-schedules/resources/builtin-panels",
      "packages/platform-shell/resources/builtin-panels",
      "packages/workbench-ui/resources/builtin-panels",
    ];
    let checked = 0;
    for (const root of roots) {
      const fullRoot = join(${JSON.stringify(ROOT)}, root);
      for (const entry of readdirSync(fullRoot, { withFileTypes: true })) {
        if (!entry.isDirectory()) continue;
        await checkBuiltinPanelSource(join(fullRoot, entry.name), { ...checks, draftReadOperationIds: [] });
        checked++;
      }
    }
    console.log(JSON.stringify({ checked }));
  `;
  const result = JSON.parse(execFileSync(process.execPath, ["--import", TSX_LOADER, "--input-type=module", "-e", script], {
    cwd: ROOT,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }));
  assert.ok(result.checked >= 18, `Expected at least 18 builtin panels checked, got ${result.checked}`);
});

test("every published --sdk-* and platform theme token is backed by design-tokens brand properties or foundation CSS", () => {
  const script = `
    import { readFileSync } from "node:fs";
    import { join } from "node:path";
    import { SDK_THEME_TOKENS, SDK_PLATFORM_THEME_TOKENS } from ${JSON.stringify(pathToFileURL(join(ROOT, "packages/contracts/src/sdk-ui-map.ts")).href)};
    import { brandProperties } from ${JSON.stringify(pathToFileURL(join(ROOT, "packages/design-tokens/src/index.ts")).href)};
    import { ossBrand } from ${JSON.stringify(pathToFileURL(join(ROOT, "packages/design-tokens/src/oss.ts")).href)};
    const foundation = readFileSync(join(${JSON.stringify(ROOT)}, "packages/design-tokens/src/foundation.css"), "utf8");
    const cssDeclared = new Set([...foundation.matchAll(/(?:^|[\\s;{])(--[a-z0-9-]+)\\s*:/gmu)].map(match => match[1]));
    const missing = [];
    for (const mode of ["light", "dark"]) {
      const properties = brandProperties(ossBrand, mode);
      for (const token of SDK_THEME_TOKENS) {
        if (!Object.hasOwn(properties, token.sdk) && !cssDeclared.has(token.sdk)) missing.push(mode + ":" + token.sdk);
      }
      for (const token of SDK_PLATFORM_THEME_TOKENS) {
        if (!Object.hasOwn(properties, token.name) && !cssDeclared.has(token.name)) missing.push(mode + ":" + token.name);
      }
    }
    console.log(JSON.stringify({ total: SDK_THEME_TOKENS.length + SDK_PLATFORM_THEME_TOKENS.length, missing }));
  `;
  const result = JSON.parse(execFileSync(process.execPath, ["--import", TSX_LOADER, "--input-type=module", "-e", script], {
    cwd: ROOT,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }));
  assert.deepEqual(result.missing, []);
  assert.ok(result.total >= 100);
});

test("checkPanelWorkspace accepts manifest.components for Vue slots, ObjectList row operations, and nested slot projections", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "panel-slots-ok-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const domainComponentId = "domain-component:11111111-1111-4111-8111-111111111111";
  writeFileSync(join(dir, "registration.json"), JSON.stringify({
    panels: [{ id: "apps-panel", mode: "create", input: { name: "Apps", description: "", visibility: "domain" } }],
  }, null, 2));
  writeFileSync(join(dir, "panel.json"), JSON.stringify({
    manifest: {
      state: {
        selected: { type: { kind: "object", objectType: "platform:BusinessKnowledge" }, deepLink: true },
      },
      components: {
        "app-icon-name-cell": domainComponentId,
      },
      members: {
        apps: {
          component: "ObjectList",
          type: "platform:BusinessKnowledge",
          data: { rows: "query" },
          state: { selected: "selected" },
          config: {
            columns: [
              { key: "name", labelKey: "col.app", width: "240px" },
            ],
            rowActions: {
              maxVisible: 2,
              items: [
                { kind: "local", id: "edit", labelKey: "action.edit" },
                { kind: "operation", operation: "approve" },
              ],
            },
          },
          operations: {
            approve: {
              operation: "knowledge.approve",
              target: { row: true },
              params: {
                principalId: { rowField: "principalId" },
                remove: { literal: true },
              },
            },
          },
        },
        rowDetail: {
          component: "ObjectSummary",
          type: "platform:BusinessKnowledge",
          inputs: { target: { fromSlot: true } },
          data: { record: "record" },
        },
      },
    },
    content: {
      messages: {
        en: { "panel.name": "Apps", "col.app": "Application", "action.edit": "Edit" },
      },
    },
  }, null, 2));
  writeFileSync(join(dir, "panel.html"), `<main><projection slot="apps"><template #cell-name="{ row }"><app-icon-name-cell :icon="row.fields.icon" :names="row.fields.names" :fallback-label="row.label"></app-icon-name-cell></template><template #row-detail="{ ref }"><projection slot="rowDetail" :inputs="{ target: ref }"></projection></template></projection></main>\n`);

  const script = `
    import * as checks from ${JSON.stringify(CONTRACTS_CHECK_URL)};
    import { registerDomainComponentRequestSchema } from ${JSON.stringify(pathToFileURL(join(ROOT, "packages/contracts/src/domain-components.ts")).href)};
    import { checkPanelWorkspace } from ${JSON.stringify(PANEL_CHECK_URL)};
    const domainComponent = registerDomainComponentRequestSchema.parse({
      name: "Application icon and localized name cell",
      publicationAccess: { kind: "domain" },
      declaration: {
        componentId: ${JSON.stringify(domainComponentId)},
        role: "presentation",
        meaning: "Displays an application's icon key beside its localized name.",
        inputs: {
          icon: { kind: "scalar", type: "string" },
          names: { kind: "json" },
          fallbackLabel: { kind: "scalar", type: "string" },
        },
        ports: { props: [], events: [], slots: [] },
      },
      source: {
        template: '<sdk-tag v-if="icon">{{ icon }}</sdk-tag><span>{{ fallbackLabel }}</span>',
        module: 'import { computed } from "vue"; export default { props: ["icon", "names", "fallbackLabel"], setup(p) { return { text: computed(() => p.fallbackLabel) }; } };',
      },
    });
    const catalogue = {
      version: "1.0.0",
      components: [
        {
          componentId: "ObjectList", module: "@ontomato/sdk/base", exportName: "ObjectList", role: "control", meaning: "List",
          data: { rows: { results: ["panelRecordQuery", "panelRecordList"], required: true, runtimeParams: ["cursor", "size"] } },
          outputs: { selected: { kind: "object", objectType: "@binding" } },
          ports: { props: [], events: [], slots: [] },
        },
        {
          componentId: "ObjectSummary", module: "@ontomato/sdk/base", exportName: "ObjectSummary", role: "presentation", meaning: "Summary",
          data: { record: { results: ["panelRecord"], required: true } },
          ports: { props: [], events: [], slots: [] },
        },
      ],
    };
    const typeTable = {
      objectTypes: {
        "platform:BusinessKnowledge": {
          reads: checks.platformObjectTypes["platform:BusinessKnowledge"].reads,
          operations: [{
            id: "knowledge.approve", kind: "action", effect: "write", batch: false,
            target: { source: "input", input: "knowledge" }, inputSchema: { type: "object" },
          }],
        },
      },
    };
    const result = await checkPanelWorkspace(${JSON.stringify(dir)}, {
      checks, catalogue, version: "1.0.0", typeTable,
      loadDomainComponent: (id) => id === domainComponent.declaration.componentId ? domainComponent.declaration : null,
    });
    console.log(JSON.stringify(result));
  `;
  const result = JSON.parse(execFileSync(process.execPath, ["--import", TSX_LOADER, "--input-type=module", "-e", script], {
    cwd: ROOT,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }));
  assert.equal(result.status, "valid");
});

test("checkPanelWorkspace rejects removed legacy listColumn, listRowDetail, and formField member attachments", (t) => {
  const cases = [
    {
      label: "legacy listColumn attachment",
      members: {
        apps: { component: "ObjectList", type: "platform:BusinessKnowledge", data: { rows: "query" }, config: { columns: [{ key: "actions" }] } },
        badCell: { component: "OperationButton", listColumn: { slot: "apps", column: "actions" }, type: "platform:BusinessKnowledge", target: "selected", operation: "knowledge.approve" },
      },
      html: `<main><projection slot="apps"></projection></main>\n`,
      pattern: /Unrecognized key\(s\) in object: 'listColumn'/u,
    },
    {
      label: "legacy listRowDetail attachment",
      members: {
        apps: { component: "ObjectList", type: "platform:BusinessKnowledge", data: { rows: "query" } },
        badDetail: { component: "ObjectSummary", listRowDetail: { slot: "apps" }, type: "platform:BusinessKnowledge", data: { record: "record" } },
      },
      html: `<main><projection slot="apps"></projection></main>\n`,
      pattern: /Unrecognized key\(s\) in object: 'listRowDetail'/u,
    },
    {
      label: "legacy formField attachment",
      members: {
        picker: { component: "ObjectSummary", formField: { slot: "form", path: "/skills" }, type: "platform:BusinessKnowledge", data: { record: "record" } },
      },
      html: `<main></main>\n`,
      pattern: /Unrecognized key\(s\) in object: 'formField'/u,
    },
  ];

  for (const item of cases) {
    const dir = mkdtempSync(join(tmpdir(), "panel-legacy-hook-bad-"));
    t.after(() => rmSync(dir, { recursive: true, force: true }));
    writeFileSync(join(dir, "registration.json"), JSON.stringify({
      panels: [{ id: "apps-panel", mode: "create", input: { name: "Apps", description: "", visibility: "domain" } }],
    }, null, 2));
    writeFileSync(join(dir, "panel.json"), JSON.stringify({
      manifest: {
        state: { selected: { type: { kind: "object", objectType: "platform:BusinessKnowledge" } } },
        members: item.members,
      },
    }, null, 2));
    writeFileSync(join(dir, "panel.html"), item.html);

    const script = `
      import * as checks from ${JSON.stringify(CONTRACTS_CHECK_URL)};
      import { checkPanelWorkspace } from ${JSON.stringify(PANEL_CHECK_URL)};
      const catalogue = {
        version: "1.0.0",
        components: [
          {
            componentId: "ObjectList", module: "@ontomato/sdk/base", exportName: "ObjectList", role: "control", meaning: "List",
            data: { rows: { results: ["panelRecordQuery", "panelRecordList"], required: true } },
            outputs: { selected: { kind: "object", objectType: "@binding" } },
            ports: { props: [], events: [], slots: [] },
          },
          {
            componentId: "ObjectSummary", module: "@ontomato/sdk/base", exportName: "ObjectSummary", role: "presentation", meaning: "Summary",
            data: { record: { results: ["panelRecord"], required: true } },
            ports: { props: [], events: [], slots: [] },
          },
          {
            componentId: "OperationButton", module: "@ontomato/sdk/base", exportName: "OperationButton", role: "control", meaning: "Button",
            data: {},
            config: [{ name: "operation", type: "string", description: "Local operation", required: true }],
            ports: { props: [], events: [], slots: [] },
          },
        ],
      };
      const typeTable = {
        objectTypes: {
          "platform:BusinessKnowledge": {
            reads: checks.platformObjectTypes["platform:BusinessKnowledge"].reads,
            operations: [{
              id: "knowledge.approve", kind: "action", effect: "write", batch: false,
              target: { source: "input", input: "knowledge" }, inputSchema: { type: "object" },
            }],
          },
        },
      };
      await checkPanelWorkspace(${JSON.stringify(dir)}, { checks, catalogue, version: "1.0.0", typeTable });
    `;
    assert.throws(
      () => execFileSync(process.execPath, ["--import", TSX_LOADER, "--input-type=module", "-e", script], {
        cwd: ROOT,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      }),
      (error) => {
        const output = `${error.stderr ?? ""}${error.stdout ?? ""}`;
        assert.match(output, item.pattern, `${item.label} diagnostic mismatch: ${output}`);
        return true;
      },
      `${item.label} should fail panel-check`,
    );
  }
});

test("checkPanelWorkspace allows CSS viewport units across panel.html and standalone CSS files", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "panel-viewport-allowed-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  writeWorkspace(dir, {
    html: `<style>.root { height: calc(100dvh - 120px); min-height: 100vh; }</style>\n<main class="root"></main>\n`,
    extraCss: `.pane { width: 50vw; min-height: 80svh; }\n`,
  });
  const script = `
    import * as checks from ${JSON.stringify(CONTRACTS_CHECK_URL)};
    import { checkPanelWorkspace } from ${JSON.stringify(PANEL_CHECK_URL)};
    console.log(JSON.stringify(await checkPanelWorkspace(${JSON.stringify(dir)}, {
      checks,
      catalogue: { version: "1.0.0", components: [] },
      version: "1.0.0",
    })));
  `;
  const result = JSON.parse(execFileSync(process.execPath, ["--import", TSX_LOADER, "--input-type=module", "-e", script], {
    cwd: ROOT,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }));
  assert.equal(result.status, "valid");
});

test("panel check allows normal HTML/CSS layout, semantic buttons, and data-free SDK UI primitives", (t) => {
  const sdkDir = mkdtempSync(join(tmpdir(), "panel-clean-sdk-"));
  t.after(() => rmSync(sdkDir, { recursive: true, force: true }));
  writeFileSync(
    join(sdkDir, "sdk.json"),
    JSON.stringify({ version: "1.0.0", check: "check.mjs", components: "components.json" }),
  );
  writeFileSync(
    join(sdkDir, "check.mjs"),
    `export * from ${JSON.stringify(CONTRACTS_CHECK_URL)};\nexport const draftReadOperationIds = [];\n`,
  );
  writeFileSync(join(sdkDir, "components.json"), JSON.stringify({ version: "1.0.0", components: [] }));

  const runCli = (...args) => execFileSync(
    process.execPath,
    ["--import", TSX_LOADER, join(ROOT, "agent-skills/ontomato-app-builder/scripts/ontomato.mjs"), ...args],
    { cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
  );

  const cleanDir = mkdtempSync(join(tmpdir(), "panel-clean-dir-"));
  t.after(() => rmSync(cleanDir, { recursive: true, force: true }));
  writeWorkspace(cleanDir, {
    html: [
      "<style>",
      "  .layout { display: grid; grid-template-columns: var(--pane-list-width, 300px) minmax(0, 1fr); height: 100%; }",
      "  .hint { color: #334155; font-size: 13px; }",
      "</style>",
      '<div id="app" class="layout">',
      '  <p class="hint">Normal HTML/CSS layout with SDK controls</p>',
      '  <button type="button" class="tab-chip">Overview</button>',
      '  <sdk-table :data="staticRows"></sdk-table>',
      '  <sdk-button type="primary">Save</sdk-button>',
      '  <sdk-dialog v-model="open"><sdk-input v-model="name" /></sdk-dialog>',
      "</div>",
    ].join("\n"),
    mjs: 'import { mountPanel } from "@ontomato/sdk/panel";\nmountPanel({});\n',
  });
  assert.equal(JSON.parse(runCli("panel", "check", cleanDir, "--sdk-dir", sdkDir)).status, "valid");
});

test("checkPanelWorkspace accepts official display components bound to metricOutput/panelRecord and multi-card ObjectForm", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "panel-display-form-ok-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  writeFileSync(join(dir, "registration.json"), JSON.stringify({
    panels: [{ id: "metrics-and-form", mode: "create", input: { name: "Overview", description: "", visibility: "domain" } }],
  }, null, 2));
  writeFileSync(join(dir, "panel.json"), JSON.stringify({
    manifest: {
      state: {
        selectedMetric: { type: { kind: "object", objectType: "platform:MetricView" }, deepLink: true },
        selectedRel: { type: { kind: "object", objectType: "platform:Relationship" }, deepLink: true },
      },
      members: {
        kpi: {
          component: "MetricCard",
          type: "platform:MetricView",
          target: "selectedMetric",
          data: { result: "result" },
          config: { field: "total_count", unit: "items" },
        },
        scalar: {
          component: "TypedValue",
          type: "platform:MetricView",
          target: "selectedMetric",
          data: { result: "result" },
          config: { field: "total_count", kind: "number" },
        },
        sentence: {
          component: "RecordTemplate",
          type: "platform:MetricView",
          target: "selectedMetric",
          data: { result: "result" },
          config: { template: "{region}: {total_count}" },
        },
        notice: {
          component: "InfoBanner",
          type: "platform:MetricView",
          target: "selectedMetric",
          data: { result: "result" },
          config: { tone: "info", field: "summary" },
        },
        sourceCard: {
          component: "ObjectRefCard",
          type: "platform:Relationship",
          target: "selectedRel",
          data: { record: "record" },
          config: { field: "sourceObjectType", caption: "Source" },
        },
        editForm: {
          component: "ObjectForm",
          type: "platform:Relationship",
          target: "selectedRel",
          data: { form: "form" },
          operation: "platform:Relationship.save",
          config: {
            presentation: "cards",
            cardColumns: 2,
            groups: [
              { key: "basic", title: "Basic", fields: ["/name"], column: "main" },
              { key: "meta", title: "Meta", fields: ["/description"], column: "side" },
            ],
          },
        },
      },
    },
    content: { messages: { en: { "panel.name": "Overview" } } },
  }, null, 2));
  writeFileSync(join(dir, "panel.html"), [
    '<div id="app">',
    '  <info-banner tone="info" text="Static hint" />',
    '  <projection slot="kpi"></projection>',
    '  <projection slot="scalar"></projection>',
    '  <projection slot="sentence"></projection>',
    '  <projection slot="notice"></projection>',
    '  <projection slot="sourceCard"></projection>',
    '  <projection slot="editForm">',
    '    <template #default>',
    '      <object-form-fields :fields="[\'/name\']" />',
    '      <object-form-fields rest />',
    '    </template>',
    '  </projection>',
    '</div>',
  ].join("\n"));
  writeFileSync(join(dir, "panel.mjs"), 'import { mountPanel } from "@ontomato/sdk/panel";\nawait mountPanel({});\n');

  const script = `
    import * as checks from ${JSON.stringify(CONTRACTS_CHECK_URL)};
    import { checkPanelWorkspace } from ${JSON.stringify(PANEL_CHECK_URL)};
    const catalogue = {
      version: "1.0.0",
      components: [
        { componentId: "MetricCard", module: "@ontomato/sdk/base", exportName: "MetricCard", role: "presentation", meaning: "Metric card", data: { result: { results: ["metricOutput"], required: false } }, ports: { props: [], events: [], slots: [] } },
        { componentId: "TypedValue", module: "@ontomato/sdk/base", exportName: "TypedValue", role: "presentation", meaning: "Typed value", data: { record: { results: ["panelRecord"], required: false }, result: { results: ["metricOutput"], required: false } }, ports: { props: [], events: [], slots: [] } },
        { componentId: "RecordTemplate", module: "@ontomato/sdk/base", exportName: "RecordTemplate", role: "presentation", meaning: "Record template", data: { record: { results: ["panelRecord"], required: false }, result: { results: ["metricOutput"], required: false } }, ports: { props: [], events: [], slots: [] } },
        { componentId: "InfoBanner", module: "@ontomato/sdk/base", exportName: "InfoBanner", role: "presentation", meaning: "Info banner", data: { record: { results: ["panelRecord"], required: false }, result: { results: ["metricOutput"], required: false } }, ports: { props: [], events: [], slots: [] } },
        { componentId: "ObjectRefCard", module: "@ontomato/sdk/base", exportName: "ObjectRefCard", role: "presentation", meaning: "Object ref card", data: { record: { results: ["panelRecord"], required: false }, result: { results: ["metricOutput"], required: false } }, ports: { props: [], events: [], slots: [] } },
        { componentId: "ObjectForm", module: "@ontomato/sdk/base", exportName: "ObjectForm", role: "control", meaning: "Object form", data: { form: { results: ["panelFormDescription"], required: false, runtimeParams: ["values", "changedField"] } }, ports: { props: [], events: [], slots: [] } },
      ],
    };
    const typeTable = {
      objectTypes: {
        "platform:MetricView": { reads: checks.platformObjectTypes["platform:MetricView"].reads, operations: [] },
        "platform:Relationship": {
          reads: checks.platformObjectTypes["platform:Relationship"].reads,
          operations: [{ id: "platform:Relationship.save", kind: "form.save", effect: "write", batch: false, target: { source: "input", input: "target" }, inputSchema: { type: "object" } }],
        },
      },
    };
    console.log(JSON.stringify(await checkPanelWorkspace(${JSON.stringify(dir)}, { checks, catalogue, typeTable, version: "1.0.0" })));
  `;
  const result = JSON.parse(execFileSync(process.execPath, ["--import", TSX_LOADER, "--input-type=module", "-e", script], {
    cwd: ROOT,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }));
  assert.equal(result.status, "valid");
});

test("every shipped skill template workspace passes checkPanelWorkspace", () => {
  const script = `
    import { readdirSync } from "node:fs";
    import { dirname, resolve } from "node:path";
    import * as checks from ${JSON.stringify(CONTRACTS_CHECK_URL)};
    import { checkPanelWorkspace } from ${JSON.stringify(PANEL_CHECK_URL)};
    import { componentMetadata } from ${JSON.stringify(pathToFileURL(join(ROOT, "packages/apps-sdk/reference.mjs")).href)};
    const components = componentMetadata({
      tsconfig: resolve(${JSON.stringify(ROOT)}, "packages/apps-sdk/tsconfig.json"),
      source: resolve(${JSON.stringify(ROOT)}, "packages/apps-sdk/src/catalogue.ts"),
    }).map(({ metadata }) => {
      const rest = { ...metadata };
      delete rest.configProps;
      return { ...rest, ports: { props: [], events: [], slots: [] } };
    });
    const catalogue = { version: "1.0.0", components };
    import { customerOntologyReads } from ${JSON.stringify(pathToFileURL(join(ROOT, "packages/contracts/src/platform-object-types.ts")).href)};
    const objectAction = (id) => ({
      id, kind: "action", effect: "write", target: { source: "input", input: "target" },
      inputSchema: { type: "object" }, batch: false,
    });
    const typeTable = {
      resultSchemas: {
        panelRecordList: { type: "array" },
        panelRecordQuery: { type: "object" },
        panelRecord: { type: "object" },
        panelFormDescription: { type: "object", required: ["fields"] },
      },
      operations: [{
        ...objectAction("student.create"), target: { source: "none" }, affects: ["Student"],
      }],
      objectTypes: {
        Student: { reads: customerOntologyReads, operations: [objectAction("student.update")] },
        Course: { reads: customerOntologyReads, operations: [objectAction("course.update"), objectAction("course.archive")] },
        Enrollment: { reads: customerOntologyReads },
        "platform:AgentDefinition": {
          reads: {
            list: { source: "type", parameterMode: "fixed", params: {}, result: "panelRecordList" },
            record: { source: "object", parameterMode: "fixed", params: {}, result: "panelRecord" },
            form: { source: "object", parameterMode: "fixed", params: {}, result: "panelFormDescription" },
            createForm: { source: "type", parameterMode: "fixed", params: {}, result: "panelFormDescription" },
          },
          operations: [{ id: "platform:AgentDefinition.save", kind: "form.save", effect: "write", target: { source: "draft" }, inputSchema: {}, batch: false }],
        },
      },
    };
    const root = resolve(${JSON.stringify(ROOT)}, "agent-skills/ontomato-app-builder/references/templates");
    const dirs = readdirSync(root, { recursive: true })
      .filter(file => file.endsWith("application.json"))
      .map(file => dirname(resolve(root, file)))
      .sort();
    const results = [];
    for (const dir of dirs) {
      const res = await checkPanelWorkspace(resolve(${JSON.stringify(ROOT)}, dir), { checks, catalogue, version: "1.0.0", typeTable });
      results.push({ dir, status: res.status, unchecked: res.unchecked.length });
    }
    console.log(JSON.stringify(results));
  `;
  const results = JSON.parse(execFileSync(process.execPath, ["--import", TSX_LOADER, "--input-type=module", "-e", script], {
    cwd: ROOT,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }));
  assert.ok(results.length > 0, "Expected to find shipped template workspaces");
  for (const item of results) {
    assert.equal(item.status, "valid", `${item.dir} failed checkPanelWorkspace`);
    assert.equal(item.unchecked, 0, `${item.dir} had unchecked references`);
  }
});

test("panel check accepts top-level targetless customer Actions on ObjectForm and OperationButton", () => {
  const dir = mkdtempSync(join(tmpdir(), "ontomato-targetless-check-"));
  try {
    writeFileSync(join(dir, "panel.html"), `<div id="app"><projection slot="createForm"></projection><projection slot="createBtn"></projection></div>\n`);
    writeFileSync(join(dir, "panel.mjs"), `import { mountPanel } from "@ontomato/sdk/panel";\nawait mountPanel({});\n`);
    writeFileSync(join(dir, "registration.json"), JSON.stringify({
      panels: [{ id: "targetless-panel", mode: "create", input: { name: "Orders", description: "", visibility: "domain" } }],
    }));
    writeFileSync(join(dir, "panel.json"), JSON.stringify({
      manifest: {
        state: {},
        members: {
          createForm: {
            component: "ObjectForm",
            type: "Order",
            data: { createForm: "createForm" },
            operations: { save: "action-create-order" },
          },
          createBtn: {
            component: "OperationButton",
            operation: "action-create-order",
          },
        },
      },
    }));
    const script = `
      import { resolve } from "node:path";
      import * as checks from ${JSON.stringify(CONTRACTS_CHECK_URL)};
      import { checkPanelWorkspace } from ${JSON.stringify(PANEL_CHECK_URL)};
      import { componentMetadata } from ${JSON.stringify(pathToFileURL(join(ROOT, "packages/apps-sdk/reference.mjs")).href)};
      const components = componentMetadata({
        tsconfig: resolve(${JSON.stringify(ROOT)}, "packages/apps-sdk/tsconfig.json"),
        source: resolve(${JSON.stringify(ROOT)}, "packages/apps-sdk/src/catalogue.ts"),
      }).map(({ metadata }) => {
        const rest = { ...metadata };
        delete rest.configProps;
        return { ...rest, ports: { props: [], events: [], slots: [] } };
      });
      const typeTable = {
        resultSchemas: { panelFormDescription: { type: "object" } },
        objectTypes: {
          Order: {
            reads: { createForm: { source: "type", parameterMode: "fixed", params: {}, result: "panelFormDescription" } },
          },
        },
        operations: [
          {
            id: "action-create-order",
            kind: "action",
            effect: "write",
            target: { source: "none" },
            inputSchema: { type: "object", properties: { values: { type: "object", properties: { customer: { type: "string" } } } } },
            batch: false,
            affects: ["Order"],
          },
        ],
      };
      const res = await checkPanelWorkspace(${JSON.stringify(dir)}, { checks, catalogue: { version: "1.0.0", components }, version: "1.0.0", typeTable });
      console.log(JSON.stringify({ status: res.status, unchecked: res.unchecked.length }));
    `;
    const res = JSON.parse(execFileSync(process.execPath, ["--import", TSX_LOADER, "--input-type=module", "-e", script], {
      cwd: ROOT,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }));
    assert.equal(res.status, "valid");
    assert.equal(res.unchecked, 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("describePanelType includes top-level targetless operations affecting the queried type", async () => {
  const { describePanelType } = await import(PANEL_CHECK_URL);
  const typeTable = {
    resultSchemas: {
      panelFormDescription: { type: "object", properties: { fields: { type: "array" } } },
    },
    objectTypes: {
      Student: {
        reads: { form: { source: "object", parameterMode: "fixed", params: {}, result: "panelFormDescription" } },
        operations: [
          {
            id: "action-update-student",
            kind: "action",
            effect: "write",
            target: { source: "input", input: "target" },
            inputSchema: { type: "object", properties: {} },
            batch: false,
          },
        ],
      },
      Course: {
        reads: {},
        operations: [],
      },
    },
    operations: [
      {
        id: "action-create-student",
        kind: "action",
        effect: "write",
        target: { source: "none" },
        inputSchema: { type: "object", properties: {} },
        batch: false,
        affects: ["Student"],
      },
      {
        id: "action-import-other",
        kind: "action",
        effect: "write",
        target: { source: "none" },
        inputSchema: { type: "object", properties: {} },
        batch: false,
        affects: ["Order"],
      },
    ],
  };

  const student = describePanelType(typeTable, "Student");
  assert.equal(student.id, "Student");
  assert.equal(student.operations.length, 1);
  assert.equal(student.operations[0].id, "action-update-student");
  assert.equal(student.targetlessOperations.length, 1);
  assert.equal(student.targetlessOperations[0].id, "action-create-student");
  assert.equal(student.targetlessOperations[0].targetless, true);
  assert.equal(student.targetlessOperations[0].callTarget, null);
  assert.match(student.targetlessOperationsHint, /target: null/);
  assert.match(student.targetlessOperationsHint, /panel type --all/);

  const course = describePanelType(typeTable, "Course");
  assert.deepEqual(course.targetlessOperations, []);
  assert.match(course.targetlessOperationsHint, /panel type --all/);

  const formRead = describePanelType(typeTable, "Student", "form");
  assert.equal(formRead.read, "form");
  assert.equal(formRead.targetlessOperations, undefined);
});
