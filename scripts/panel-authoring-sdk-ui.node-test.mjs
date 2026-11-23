import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const TSX_LOADER = join(ROOT, "packages/contracts/node_modules/tsx/dist/loader.mjs");
const PANEL_CHECK_URL = pathToFileURL(join(ROOT, "agent-skills/ontomato-app-builder/panel-check.mjs")).href;
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

test("checkPanelWorkspace accepts domain-component listColumn, per-row operationParams, and listRowDetail", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "panel-list-column-ok-"));
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
      members: {
        apps: {
          component: "ObjectList",
          type: "platform:BusinessKnowledge",
          data: { rows: "query" },
          state: { selected: "selected" },
          config: {
            columns: [
              { key: "name", labelKey: "col.app" },
              { key: "actions", labelKey: "col.actions" },
            ],
          },
        },
        appNameCell: {
          component: domainComponentId,
          listColumn: { slot: "apps", column: "name" },
          inputs: {
            icon: { itemField: "icon" },
            names: { itemField: "names" },
            fallbackLabel: { item: "label" },
          },
        },
        revokeRow: {
          component: "OperationButton",
          listColumn: { slot: "apps", column: "actions" },
          type: "platform:BusinessKnowledge",
          target: "selected",
          operation: "knowledge.approve",
          operationParams: {
            principalId: { itemField: "principalId" },
            remove: { literal: true },
          },
        },
        rowDetail: {
          component: "ObjectSummary",
          listRowDetail: { slot: "apps" },
          type: "platform:BusinessKnowledge",
          inputs: { target: { item: true } },
          data: { record: "record" },
        },
      },
    },
    content: {
      messages: {
        en: { "panel.name": "Apps", "col.app": "Application", "col.actions": "Actions" },
      },
    },
  }, null, 2));
  writeFileSync(join(dir, "panel.html"), `<div id="app"><projection slot="apps"></projection></div>\n`);
  writeFileSync(join(dir, "panel.mjs"), `import { mountPanel } from "@ontomato/sdk/panel";\nawait mountPanel({});\n`);

  const script = `
    import * as checks from ${JSON.stringify(CONTRACTS_CHECK_URL)};
    import { registerDomainComponentRequestSchema } from ${JSON.stringify(pathToFileURL(join(ROOT, "packages/contracts/src/domain-components.ts")).href)};
    import { checkPanelWorkspace } from ${JSON.stringify(PANEL_CHECK_URL)};
    const domainComponent = registerDomainComponentRequestSchema.parse({
      name: "Application icon and localized name cell",
      visibility: "domain",
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

test("checkPanelWorkspace reports actionable diagnostics for invalid listColumn and listRowDetail bindings", (t) => {
  const cases = [
    {
      label: "listColumn targeting non-ObjectList host",
      members: {
        detail: { component: "ObjectSummary", type: "platform:BusinessKnowledge", target: "selected", data: { record: "record" } },
        badCell: { component: "OperationButton", listColumn: { slot: "detail", column: "actions" }, type: "platform:BusinessKnowledge", target: "selected", operation: "knowledge.approve" },
      },
      html: `<div id="app"><projection slot="detail"></projection></div>\n`,
      pattern: /manifest\.members\.badCell\.listColumn\.slot:.*'detail'.*'@ontomato\/sdk:ObjectSummary'.*ObjectList/u,
    },
    {
      label: "listColumn targeting compact ObjectList without config.columns",
      members: {
        apps: { component: "ObjectList", type: "platform:BusinessKnowledge", data: { rows: "query" } },
        badCell: { component: "OperationButton", listColumn: { slot: "apps", column: "actions" }, type: "platform:BusinessKnowledge", target: "selected", operation: "knowledge.approve" },
      },
      html: `<div id="app"><projection slot="apps"></projection></div>\n`,
      pattern: /manifest\.members\.badCell\.listColumn\.column:.*'apps'.*no config\.columns.*actions/u,
    },
    {
      label: "listColumn targeting undeclared column key",
      members: {
        apps: { component: "ObjectList", type: "platform:BusinessKnowledge", data: { rows: "query" }, config: { columns: [{ key: "label" }] } },
        badCell: { component: "OperationButton", listColumn: { slot: "apps", column: "missingCol" }, type: "platform:BusinessKnowledge", target: "selected", operation: "knowledge.approve" },
      },
      html: `<div id="app"><projection slot="apps"></projection></div>\n`,
      pattern: /manifest\.members\.badCell\.listColumn\.column:.*'missingCol'.*'apps'.*\(label\)/u,
    },
    {
      label: "listColumn declaring independent data read",
      members: {
        apps: { component: "ObjectList", type: "platform:BusinessKnowledge", data: { rows: "query" }, config: { columns: [{ key: "summary" }] } },
        badCell: { component: "ObjectSummary", listColumn: { slot: "apps", column: "summary" }, type: "platform:BusinessKnowledge", target: "selected", data: { record: "record" } },
      },
      html: `<div id="app"><projection slot="apps"></projection></div>\n`,
      pattern: /manifest\.members\.badCell\.data:.*listColumn.*cannot declare independent data reads/u,
    },
    {
      label: "listRowDetail targeting non-ObjectList host",
      members: {
        detail: { component: "ObjectSummary", type: "platform:BusinessKnowledge", target: "selected", data: { record: "record" } },
        badDetail: { component: "ObjectSummary", listRowDetail: { slot: "detail" }, type: "platform:BusinessKnowledge", inputs: { target: { item: true } }, data: { record: "record" } },
      },
      html: `<div id="app"><projection slot="detail"></projection></div>\n`,
      pattern: /manifest\.members\.badDetail\.listRowDetail\.slot:.*'detail'.*'@ontomato\/sdk:ObjectSummary'.*ObjectList/u,
    },
    {
      label: "duplicate listColumn on same host column",
      members: {
        apps: { component: "ObjectList", type: "platform:BusinessKnowledge", data: { rows: "query" }, config: { columns: [{ key: "actions" }] } },
        firstCell: { component: "OperationButton", listColumn: { slot: "apps", column: "actions" }, type: "platform:BusinessKnowledge", target: "selected", operation: "knowledge.approve" },
        secondCell: { component: "OperationButton", listColumn: { slot: "apps", column: "actions" }, type: "platform:BusinessKnowledge", target: "selected", operation: "knowledge.approve" },
      },
      html: `<div id="app"><projection slot="apps"></projection></div>\n`,
      pattern: /manifest\.members\.secondCell\.listColumn:.*'apps'.*'actions'.*'firstCell'/u,
    },
  ];

  for (const item of cases) {
    const dir = mkdtempSync(join(tmpdir(), "panel-list-column-bad-"));
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
    writeFileSync(join(dir, "panel.mjs"), `import { mountPanel } from "@ontomato/sdk/panel";\nawait mountPanel({});\n`);

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

test("checkPanelWorkspace leaves viewport units allowed by default and rejects them across panel.html and CSS files when enabled", (t) => {
  const runWithViewportToggle = (directory, rejectViewportUnits) => {
    const script = `
      import * as baseChecks from ${JSON.stringify(CONTRACTS_CHECK_URL)};
      import { checkPanelWorkspace } from ${JSON.stringify(PANEL_CHECK_URL)};
      const checks = ${rejectViewportUnits}
        ? {
            ...baseChecks,
            checkAuthoringStyles: (css, file, baseOffset = 0, fullSource = css) =>
              baseChecks.checkAuthoringStyles(css, file, baseOffset, fullSource, { rejectViewportUnits: true }),
            checkAuthoringTemplate: (template, file, options = {}) =>
              baseChecks.checkAuthoringTemplate(template, file, { ...options, rejectViewportUnits: true }),
          }
        : baseChecks;
      console.log(JSON.stringify(await checkPanelWorkspace(${JSON.stringify(directory)}, {
        checks,
        catalogue: { version: "1.0.0", components: [] },
        version: "1.0.0",
      })));
    `;
    return execFileSync(process.execPath, ["--import", TSX_LOADER, "--input-type=module", "-e", script], {
      cwd: ROOT,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
  };

  // Default (off): existing panels with viewport units continue to pass checkPanelWorkspace.
  const defaultDir = mkdtempSync(join(tmpdir(), "panel-viewport-default-"));
  t.after(() => rmSync(defaultDir, { recursive: true, force: true }));
  writeWorkspace(defaultDir, {
    html: `<style>.root { height: calc(100dvh - 120px); }</style>\n<div id="app"></div>\n`,
    extraCss: `.pane { width: 50vw; min-height: 80svh; }\n`,
  });
  assert.equal(JSON.parse(runWithViewportToggle(defaultDir, false)).status, "valid");

  // Enabled: rejects viewport units in both panel.html <style> and standalone CSS files with exact locations.
  const badCases = [
    {
      label: "100vh in panel.html <style>",
      files: { html: `<style>\n.root { height: 100vh; }\n</style>\n<div id="app"></div>\n` },
      pattern: /panel\.html:2:17:.*100vh.*content box/u,
    },
    {
      label: "calc(100dvh - 120px) in panel.html <style>",
      files: { html: `<style>.root { height: calc(100dvh - 120px); }</style>\n<div id="app"></div>\n` },
      pattern: /panel\.html:1:29:.*100dvh.*rem\/px min-height/u,
    },
    {
      label: "50vw and 80svh in standalone CSS file",
      files: { extraCss: `.pane { width: 50vw; }\n.side { min-height: 80svh; }\n` },
      pattern: /extra\.css:1:16:.*50vw[\s\S]*extra\.css:2:21:.*80svh/u,
    },
  ];
  for (const item of badCases) {
    const dir = mkdtempSync(join(tmpdir(), "panel-viewport-bad-"));
    t.after(() => rmSync(dir, { recursive: true, force: true }));
    writeWorkspace(dir, item.files);
    assert.throws(
      () => runWithViewportToggle(dir, true),
      (error) => {
        const output = `${error.stderr ?? ""}${error.stdout ?? ""}`;
        assert.match(output, item.pattern, `${item.label} diagnostic mismatch: ${output}`);
        return true;
      },
      `${item.label} should fail when viewport unit rejection is enabled`,
    );
  }

  // Enabled: accepts normal content-box CSS, comments, strings, and custom property names containing viewport substrings.
  const okDir = mkdtempSync(join(tmpdir(), "panel-viewport-ok-"));
  t.after(() => rmSync(okDir, { recursive: true, force: true }));
  writeWorkspace(okDir, {
    html: [
      "<style>",
      "  /* 100vh in comment is ignored */",
      '  .root-100vh { height: 100%; min-height: 24rem; --pane-50vw: 320px; }',
      '  .badge::after { content: "100dvh"; }',
      "</style>",
      '<div id="app" class="root-100vh"></div>',
    ].join("\n"),
    extraCss: `.pane { flex: 1; min-height: 0; overflow: auto; padding: 12px; width: 100%; }\n`,
  });
  assert.equal(JSON.parse(runWithViewportToggle(okDir, true)).status, "valid");
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
    ["--import", TSX_LOADER, join(ROOT, "agent-skills/ontomato-app-builder/ontomato.mjs"), ...args],
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
