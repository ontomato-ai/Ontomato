import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { installedPackageClosure } from "./package-components-release.mjs";

/*
 * The component catalogue an SDK release ships (design 6, "需要的数据"): `components.json` declares, beside each public
 * component, the facts it reads from the platform and the configuration a projection sets, in the shape the shared
 * contract defines. The release is built here for real — the same build a product runs — and the file it writes is read
 * back with the schema the platform and the build share, so what a directory shows is what this SDK version actually
 * declares, not a second copy of the same table.
 *
 * What this rules out: a component that reads named data shipping without saying so (a projection could then name a
 * datum nothing reads), a datum naming a read result no owner registers, a contribution to the catalogue that only the
 * documentation lists, and a build that stops checking the file it writes.
 */

const HERE = dirname(fileURLToPath(import.meta.url));

/** The read results the contracts register, as the platform reads them. */
function registeredResults() {
  const loader = join(HERE, "../contracts/node_modules/tsx/dist/loader.mjs");
  const source = `import { panelReadResultSchemas } from ${JSON.stringify(join(HERE, "../contracts/src/panel-operations.ts"))};`
    + "console.log(JSON.stringify(Object.keys(panelReadResultSchemas)));";
  return JSON.parse(execFileSync(process.execPath, ["--import", loader, "--input-type=module", "-e", source], { encoding: "utf8" }));
}
/** Every parameter name an owner's read declares, platform or customer ontology. */
function declaredReadParameters() {
  const loader = join(HERE, "../contracts/node_modules/tsx/dist/loader.mjs");
  const source = `import { platformObjectTypes, customerOntologyReads, customerRelationReads } from ${JSON.stringify(join(HERE, "../contracts/src/platform-object-types.ts"))};`
    + "const reads = [...Object.values(platformObjectTypes).flatMap((type) => Object.values(type.reads ?? {})), ...Object.values(customerOntologyReads), ...Object.values(customerRelationReads)];"
    + "console.log(JSON.stringify([...new Set(reads.flatMap((read) => Object.keys(read.params ?? {})))]));";
  return JSON.parse(execFileSync(process.execPath, ["--import", loader, "--input-type=module", "-e", source], { encoding: "utf8" }));
}
const EDITION = join(HERE, "../../apps/workbench/web/src/sdk-edition.ts");

/** Every directly rendered component's data names, and the read results each may hold. */
const DECLARED_DATA = {
  ObjectList: { rows: ["panelRecordList", "panelRecordQuery"], objects: ["panelOntologyObjects"] },
  ObjectSummary: { record: ["panelRecord"] },
  ObjectHeader: { record: ["panelRecord"] },
  ObjectForm: { form: ["panelFormDescription"], createForm: ["panelFormDescription"] },
  OperationButton: {},
  FileUploadControl: {},
  ReferencePicker: { options: ["panelOptionList"], selected: ["panelOptionList"] },
  ObjectGraph: { nodes: ["panelRecordList"], edges: ["panelRecordList"] },
  OntologyGraph: { schema: ["panelGraphSchema"], counts: ["panelGraphCounts"], start: ["panelGraphStart"], neighbors: ["panelGraphNeighbors"] },
  ObjectRelations: { neighbors: ["panelGraphNeighbors", "panelRelationNeighbors"] },
  MetricChart: { template: ["chartTemplate"], result: ["metricOutput"] },
  SegmentedControl: { counts: ["panelGroupCounts"] },
  // Readable as a member it reads nothing; an empty table says so, and Node registers it on that declaration.
  ConversationEntry: {},
  ObjectTree: { files: ["panelRecordList"] },
  ObjectTextReader: { sources: ["panelRecordList"], page: ["panelRecordQuery"], record: ["panelRecord"] },
};

test("the built SDK's components.json is the catalogue its contract declares", (t) => {
  const out = mkdtempSync(join(tmpdir(), "sdk-catalogue-"));
  t.after(() => rmSync(out, { recursive: true, force: true }));
  execFileSync(process.execPath, [join(HERE, "build.mjs"), EDITION, out], {
    env: { ...process.env, APPS_SDK_BUILD: JSON.stringify({ product: "workbench", release: false }) },
    stdio: "pipe",
  });

  const version = readdirSync(out).find((name) => name !== "current.json");
  assert.ok(version, "the build wrote a version directory");
  const written = JSON.parse(readFileSync(join(out, version, "components.json"), "utf8"));
  // The release's own Node modules are where the platform reads this shape from; the check module carries the schema.
  return import(pathToFileURL(join(out, version, "node/panel-check.mjs")).href).then(async ({
    applicationIconKeys, appsSdkComponentCatalogSchema, appsSdkReleaseManifestSchema, panelModuleImports,
  }) => {
    await t.test("an external Vue author can generate a package catalogue and check a panel with this release", (authorTest) => {
      const author = mkdtempSync(join(tmpdir(), "external-component-author-"));
      authorTest.after(() => rmSync(author, { recursive: true, force: true }));
      const sdk = join(out, version);
      const { packageComponents } = appsSdkReleaseManifestSchema.parse(JSON.parse(readFileSync(join(sdk, "sdk.json"), "utf8")));
      const generator = join(author, "package-components.mjs");
      // The author only needs the advertised executable, and their own Vue dependency.
      cpSync(join(sdk, packageComponents), generator);
      for (const [name, manifest] of installedPackageClosure(["vue"]))
        cpSync(dirname(manifest), join(author, "node_modules", name), { recursive: true, dereference: true });

      const pkg = "@example/author-tools";
      const write = (file, content) => {
        const path = join(author, file);
        mkdirSync(dirname(path), { recursive: true });
        writeFileSync(path, content);
      };
      const json = (file, value) => write(file, JSON.stringify(value));
      json("package.json", {
        name: pkg, version: "1.0.0", author: "Example",
        ontomato: { components: "components.json", entries: { [pkg]: "dist/entry.mjs" } },
      });
      json("tsconfig.json", { compilerOptions: { target: "ES2022", module: "ESNext",
        moduleResolution: "Bundler", strict: true, noEmit: true }, include: ["src/**/*"] });
      write("src/Badge.vue", '<script setup lang="ts">defineProps<{ caption: string }>();</script>\n<template>{{ caption }}</template>');
      write("src/entry.ts", 'export { default as Badge } from "./Badge.vue";');
      write("src/catalogue.ts", `
        import { defineComponentMeta } from "@ontomato/sdk/panel";
        export const components = [defineComponentMeta({
          componentId: "Badge", module: ${JSON.stringify(pkg)}, exportName: "Badge",
          role: "presentation", meaning: "Shows one caption.",
          data: { rows: { results: ["panelRecordList"], required: true } },
        })];
      `);
      write("dist/entry.mjs", "export const Badge = {};");
      const env = { ...process.env, NODE_PATH: "", NODE_OPTIONS: "" };
      const exec = args => execFileSync(process.execPath, args, { cwd: author, env, encoding: "utf8", stdio: "pipe" });
      exec([generator, ".", "--catalogue", "src/catalogue.ts", "--tsconfig", "tsconfig.json", "--source", pkg + "=src/entry.ts"]);
      const [badge] = JSON.parse(readFileSync(join(author, "components.json"), "utf8"));
      assert.equal(badge.componentId, pkg + ":Badge");
      assert.ok(badge.ports.props.some(prop => prop.name === "caption" && prop.required && prop.type === "string"));

      json("panel/registration.json", { panels: [{ id: "example", mode: "create",
        input: { name: "Badge", description: "", visibility: "domain" } }] });
      const objectType = "platform:ScheduledTask";
      json("panel/panel.json", { manifest: { state: {}, commands: {},
        members: { badge: { component: badge.componentId, type: objectType,
          data: { rows: "list" }, config: { caption: "Ready" } } } } });
      write("panel/panel.html", '<div id="app"><projection slot="badge"></projection></div>');
      write("panel/panel.mjs", 'import { mountPanel } from "@ontomato/sdk/panel";\nawait mountPanel({});\n');
      json("types.json", { objectTypes: {
        [objectType]: { reads: { list: { source: "type", parameterMode: "fixed", params: {}, result: "panelRecordList" } },
          operations: [] },
      }, resultSchemas: { panelRecordList: { type: "array" } } });
      const cli = join(HERE, "../../agent-skills/ontomato-app-builder/ontomato.mjs");
      const checked = exec([cli, "panel", "check", "panel", "--sdk-dir", sdk, "--component-package", author, "--type-table", "types.json"]);
      assert.deepEqual(JSON.parse(checked), { status: "valid", version, unchecked: [] });
    });

    await t.test("the offline checker requires an explicit form for a draft read before writing any IDs", () => {
      const workspace = join(out, "builtin-panel");
      mkdirSync(workspace);
      writeFileSync(join(workspace, "registration.json"), JSON.stringify({ panels: [{ id: "builtin-product-metric-check" }] }));
      const editor = { component: "ObjectForm", type: "platform:MetricView", data: { createForm: "createForm" } };
      const trial = { component: "OperationButton", operation: "metricViews.test" };
      const descriptor = join(workspace, "panel.json");
      const document = { manifest: { state: {}, commands: {}, members: { metricEditor: editor, preview: trial } } };
      const cli = join(HERE, "../../agent-skills/ontomato-app-builder/ontomato.mjs");
      const check = () => execFileSync(process.execPath, [
        cli, "panel", "check", workspace, "--builtin", "--sdk-dir", join(out, version),
      ], { encoding: "utf8", stdio: "pipe" });

      const withoutDraft = JSON.stringify(document);
      writeFileSync(descriptor, withoutDraft);
      assert.throws(check, error => error.stderr.includes("member preview") && error.stderr.includes("metricViews.test") &&
        error.stderr.includes("draft"));
      assert.equal(readFileSync(descriptor, "utf8"), withoutDraft);

      trial.draft = "metricEditor";
      const save = { component: "ObjectForm", type: "platform:MetricView", data: { createForm: "createForm" },
        operation: "platform:MetricView.save" };
      document.manifest.members.saveEditor = save;
      writeFileSync(descriptor, JSON.stringify(document));
      assert.deepEqual(Object.keys(JSON.parse(check()).assigned), ["metricEditor", "preview", "saveEditor"]);
      assert.equal(JSON.parse(readFileSync(descriptor, "utf8")).manifest.members.preview.draft, "metricEditor");
    });

    assert.ok(applicationIconKeys.includes("ontology"));
    await panelModuleImports('import { ref } from "vue"');
    await assert.rejects(panelModuleImports('import { ElButton } from "element-plus"'), /imports element-plus/);
    const catalogue = appsSdkComponentCatalogSchema.parse(written);
    const declared = new Map(catalogue.components.map((component) => [component.componentId.replace("@ontomato/sdk:", ""), component]));
    for (const [name, data] of Object.entries(DECLARED_DATA)) {
      const component = declared.get(name);
      assert.ok(component, `${name} is in the catalogue`);
      assert.deepEqual(
        Object.fromEntries(Object.entries(component.data ?? {}).map(([datum, { results }]) => [datum, results])),
        data,
        `${name} declares the data it reads`,
      );
    }
    // The member a panel draws itself takes any datum the projection names, with every read result, and is never required.
    const panelData = declared.get("PanelData");
    assert.deepEqual(Object.keys(panelData.data), ["*"]);
    assert.equal(panelData.data["*"].required, false);
    // Every read result an owner can register, and every run-time value another component gives itself.
    // A page's own code may give an owner's declared parameter no component gives.
    assert.deepEqual([...panelData.data["*"].results].sort(), [...registeredResults()].sort());
    const given = new Set(catalogue.components.filter(({ componentId }) => componentId !== panelData.componentId)
      .flatMap((component) => Object.values(component.data ?? {}).flatMap((datum) => datum.runtimeParams ?? [])));
    for (const param of given) assert.ok(panelData.data["*"].runtimeParams.includes(param), `PanelData takes ${param}`);
    // The page's own code gives any parameter an owner's read declares: a datum read for a class (`className`) takes the
    // class whether the panel's code or another component supplies it.
    for (const param of declaredReadParameters()) assert.ok(panelData.data["*"].runtimeParams.includes(param), `PanelData takes ${param}`);
    // A placement binds a component's outputs to the panel's state by type; an object of the projection's own type is
    // `@binding`, which registration resolves, and a signal with no state stays an event.
    assert.deepEqual(declared.get("ObjectList").outputs, {
      selected: { kind: "object", objectType: "@binding" },
      checked: { kind: "list", items: { kind: "object", objectType: "@binding" } },
      listed: { kind: "list", items: { kind: "object", objectType: "@binding" } },
      search: { kind: "scalar", type: "string" },
    });
    assert.equal(declared.get("ObjectSummary").outputs, undefined, "navigating is an event, not a state");
    // A placement hands a graph its running inputs from the panel's state, which an inline member binds by these names.
    const ontologyNode = { kind: "object-union", layers: ["fact", "capability", "governance", "product"], objectTypes: ["platform:OntologyType"] };
    assert.deepEqual(declared.get("OntologyGraph").inputs, {
      mode: { kind: "scalar", type: "string" },
      start: ontologyNode,
      selected: ontologyNode,
      selectedType: { kind: "scalar", type: "string" },
      query: { kind: "scalar", type: "string" },
    });
    // The upload control runs its operation through the platform's upload contract, in a frame and in the platform's page.
    assert.equal(declared.get("FileUploadControl").config.find(prop => prop.name === "overwrite-on")?.required, false);
    // Configuration is the props a projection sets, kept apart from the running inputs a placement supplies.
    const listLayout = declared.get("ObjectList").config.find(prop => prop.name === "layout");
    assert.equal(listLayout?.required, false);
    assert.match(listLayout?.type ?? "", /cards/);
    const formLayout = declared.get("ObjectForm").config.find(prop => prop.name === "layout");
    assert.equal(formLayout?.required, false);
    assert.match(formLayout?.type ?? "", /rows/);
    const formActions = declared.get("ObjectForm").config.find(prop => prop.name === "actions");
    assert.equal(formActions?.required, false);
    assert.match(formActions?.type ?? "", /header/);
    const subtitleLines = declared.get("ObjectList").config.find(prop => prop.name === "subtitle-lines");
    assert.equal(subtitleLines?.required, false);
    assert.match(subtitleLines?.type ?? "", /number/);
    assert.match(subtitleLines?.description ?? "", /visible lines in a compact summary/);
    assert.deepEqual(declared.get("ObjectSummary").config, declared.get("ObjectSummary").ports.props);
    assert.equal(declared.get("MetricChart").config, undefined, "a component with no configuration declares none");

    // SDK UI primitives, directives, and theme tokens are published under Ontomato SDK names with zero third-party leaks.
    assert.equal(catalogue.uiPrimitives.length, 106);
    const sdkButton = catalogue.uiPrimitives.find((item) => item.tag === "sdk-button");
    assert.equal(sdkButton?.exportName, "SdkButton");
    assert.equal(sdkButton?.module, "@ontomato/sdk/ui");
    assert.ok(sdkButton?.props.length > 0, "SdkButton publishes its props");
    assert.deepEqual(
      catalogue.uiDirectives.map((item) => [item.name, item.exportName]),
      [
        ["v-sdk-loading", "vSdkLoading"],
        ["v-sdk-infinite-scroll", "vSdkInfiniteScroll"],
        ["v-sdk-popover", "vSdkPopover"],
      ],
    );
    assert.ok(catalogue.themeTokens.some((token) => token.name === "--sdk-color-primary" && token.overridable));
    const uiJson = JSON.stringify({
      uiPrimitives: catalogue.uiPrimitives,
      uiDirectives: catalogue.uiDirectives,
      themeTokens: catalogue.themeTokens,
    });
    assert.equal(
      uiJson.match(/Element[\s-]?Plus|element-plus|--el-[a-z0-9-]+|\bel-[a-z][a-z0-9-]*\b|\bEl[A-Z][A-Za-z0-9]*\b/g),
      null,
      "UI catalogue must not leak third-party identifiers",
    );
    const componentsDoc = readFileSync(join(out, version, "docs/components.md"), "utf8");
    assert.match(componentsDoc, /`<sdk-button>`/);
    assert.match(componentsDoc, /`v-sdk-loading`/);
    assert.match(componentsDoc, /`--sdk-color-primary`/);
    assert.match(
      componentsDoc,
      /## ObjectList[\s\S]*?Configuration types:\n\n```ts\n[\s\S]*?type ObjectListColumn = \{[\s\S]*?key: string;[\s\S]*?labelKey\?:[\s\S]*?subtitleKey\?:[\s\S]*?emptyKey\?:[\s\S]*?wrap\?:/u,
      "docs/components.md must expand ObjectListColumn fields beside ObjectList config",
    );
    const columnTypeLine = componentsDoc.match(/type ObjectListColumn = [^\n]+/u)?.[0] ?? "";
    for (const kind of ['"text"', '"tag"', '"tags"', '"reference"', '"time"']) {
      assert.ok(columnTypeLine.includes(kind), `ObjectListColumn in docs/components.md must include kind ${kind}: ${columnTypeLine}`);
    }
    const referenceDoc = readFileSync(join(out, version, "docs/reference.md"), "utf8");
    assert.doesNotMatch(referenceDoc, /type PanelComponent = PanelComponent;/u);
    assert.equal(
      readdirSync(join(out, version, "docs")).includes("element-plus.web-types.json"),
      false,
      "Third-party web-types.json is no longer shipped in docs/",
    );
  });
});

test("the @ontomato/sdk/ui entry exports every SDK_UI_COMPONENTS primitive and directive while keeping component names intact", async () => {
  const { SDK_UI_COMPONENTS, SDK_UI_DIRECTIVES } = await import("../contracts/src/sdk-ui-map.ts");
  const uiSource = readFileSync(join(HERE, "src/entries/ui.ts"), "utf8");
  for (const entry of SDK_UI_COMPONENTS) {
    assert.match(
      uiSource,
      new RegExp(`\\b${entry.implExport} as ${entry.sdkExport}\\b`),
      `src/entries/ui.ts must re-export ${entry.implExport} as ${entry.sdkExport}`,
    );
  }
  for (const directive of SDK_UI_DIRECTIVES) {
    assert.match(
      uiSource,
      new RegExp(`\\b${directive.implExport} as ${directive.sdkExport}\\b`),
      `src/entries/ui.ts must re-export ${directive.implExport} as ${directive.sdkExport}`,
    );
  }
  // Verify live module identity and untouched `.name` on key primitives.
  const buttonMod = await import("element-plus/es/components/button/index.mjs");
  const dialogMod = await import("element-plus/es/components/dialog/index.mjs");
  assert.equal(buttonMod.ElButton.name, "ElButton");
  assert.equal(dialogMod.ElDialog.name, "ElDialog");
});
