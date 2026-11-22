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
    manifest: { state: {}, members: {}, commands: {} },
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
  assert.ok(result.checked >= 17, `Expected at least 17 builtin panels checked, got ${result.checked}`);
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
