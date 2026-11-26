import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { installedPackageClosure } from "./package-components-release.mjs";
import { resolveDeclaredConfig } from "./reference.mjs";

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
  ObjectList: { rows: ["panelRecordList", "panelRecordQuery"], objects: ["panelOntologyObjects"], supplement: ["panelRecordList"] },
  GroupedGrid: { record: ["panelRecord"], rows: ["panelRecordList", "panelRecordQuery"] },
  ObjectCount: { rows: ["panelRecordList", "panelRecordQuery"], objects: ["panelOntologyObjects"] },
  ObjectSummary: { record: ["panelRecord"] },
  ObjectTitle: { record: ["panelRecord"] },
  ObjectHeader: { record: ["panelRecord"] },
  TypedValue: { record: ["panelRecord"], result: ["metricOutput"] },
  RecordTemplate: { record: ["panelRecord"], result: ["metricOutput"] },
  InfoBanner: { record: ["panelRecord"], result: ["metricOutput"] },
  ObjectRefCard: { record: ["panelRecord"], result: ["metricOutput"] },
  MetricCard: {
    result: ["metricOutput"],
    record: ["panelRecord"],
    rows: ["panelRecordList", "panelRecordQuery"],
    objects: ["panelOntologyObjects"],
  },
  ObjectForm: { form: ["panelFormDescription"], createForm: ["panelFormDescription"] },
  OperationButton: {},
  FileUploadControl: {},
  ReferencePicker: {
    options: ["panelOptionList"],
    selected: ["panelOptionList", "panelRecord"],
    rows: ["panelRecordList", "panelRecordQuery"],
  },
  ObjectGraph: { nodes: ["panelRecordList", "panelRecordQuery"], edges: ["panelRecordList", "panelRecordQuery"] },
  OntologyGraph: {
    schema: ["panelGraphSchema"],
    counts: ["panelGraphCounts"],
    start: ["panelGraphStart"],
    overview: ["panelGraphOverview"],
    connections: ["panelGraphConnections"],
    neighbors: ["panelGraphNeighbors", "panelRelationNeighbors"],
  },
  ObjectRelations: { neighbors: ["panelGraphNeighbors", "panelRelationNeighbors"] },
  MetricChart: { template: ["chartTemplate"], result: ["metricOutput"] },
  SegmentedControl: { counts: ["panelGroupCounts"] },
  // Readable as a member it reads nothing; an empty table says so, and Node registers it on that declaration.
  ConversationEntry: {},
  AgentChat: {},
  AppPreview: {},
  ObjectTree: { files: ["panelRecordList", "panelRecordQuery"], rows: ["panelRecordList", "panelRecordQuery"] },
  ObjectTextReader: { sources: ["panelRecordList"], page: ["panelRecordQuery"], record: ["panelRecord"] },
  AnnotatedCode: { content: ["annotatedCode"] },
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
      json("panel/panel.json", { manifest: { state: {},
        members: { badge: { component: badge.componentId, type: objectType,
          data: { rows: "list" }, config: { caption: "Ready" } } } } });
      write("panel/panel.html", '<div id="app"><projection slot="badge"></projection></div>');
      write("panel/panel.mjs", 'import { mountPanel } from "@ontomato/sdk/panel";\nawait mountPanel({});\n');
      json("types.json", { objectTypes: {
        [objectType]: { reads: { list: { source: "type", parameterMode: "fixed", params: {}, result: "panelRecordList" } },
          operations: [] },
      }, resultSchemas: { panelRecordList: { type: "array" } } });
      const cli = join(HERE, "../../agent-skills/ontomato-app-builder/scripts/ontomato.mjs");
      const checked = exec([cli, "panel", "check", "panel", "--sdk-dir", sdk, "--component-package", author, "--type-table", "types.json"]);
      assert.deepEqual(JSON.parse(checked), { status: "valid", version, typeTableChecked: true, unchecked: [] });
    });

    await t.test("the offline checker requires an explicit form for a draft read before writing any IDs", () => {
      const workspace = join(out, "builtin-panel");
      mkdirSync(workspace);
      writeFileSync(join(workspace, "registration.json"), JSON.stringify({ panels: [{ id: "builtin-product-metric-check" }] }));
      const editor = { component: "ObjectForm", type: "platform:MetricView", data: { createForm: "createForm" },
        operation: "platform:MetricView.save" };
      const trial = { component: "OperationButton", operation: "metricViews.test" };
      const descriptor = join(workspace, "panel.json");
      const document = { manifest: { state: {}, members: { metricEditor: editor, preview: trial } } };
      const cli = join(HERE, "../../agent-skills/ontomato-app-builder/scripts/ontomato.mjs");
      const check = () => execFileSync(process.execPath, [
        cli, "panel", "check", workspace, "--builtin", "--sdk-dir", join(out, version),
      ], { encoding: "utf8", stdio: "pipe" });

      const withoutDraft = JSON.stringify(document);
      writeFileSync(descriptor, withoutDraft);
      assert.throws(check, error => error.stderr.includes("member preview") && error.stderr.includes("metricViews.test") &&
        error.stderr.includes("draft"));
      assert.equal(readFileSync(descriptor, "utf8"), withoutDraft);

      trial.draft = "metricEditor";
      writeFileSync(descriptor, JSON.stringify(document));
      assert.deepEqual(Object.keys(JSON.parse(check()).assigned), ["metricEditor", "preview"]);
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
    assert.deepEqual(declared.get("ObjectList").inputs, {
      expandedKeys: { kind: "list", items: { kind: "scalar", type: "string" } },
    });
    assert.deepEqual(declared.get("ObjectList").outputs, {
      selected: { kind: "object", objectType: "@binding" },
      checked: { kind: "list", items: { kind: "object", objectType: "@binding" } },
      listed: { kind: "list", items: { kind: "object", objectType: "@binding" } },
      search: { kind: "scalar", type: "string" },
      expandedKeys: { kind: "list", items: { kind: "scalar", type: "string" } },
    });
    assert.equal(declared.get("ObjectCount").outputs, undefined, "ObjectCount is presentation-only");
    assert.deepEqual(declared.get("ReferencePicker").outputs, {
      selected: { kind: "object", objectType: "@binding" },
    });
    assert.equal(declared.get("ReferencePicker").data.options.required, false);
    assert.equal(declared.get("ReferencePicker").data.selected.required, false);
    assert.equal(declared.get("ReferencePicker").data.rows.required, false);
    assert.deepEqual(declared.get("ReferencePicker").data.rows.runtimeParams, ["search"]);
    assert.equal(declared.get("ObjectSummary").outputs, undefined, "navigating is an event, not a state");
    const ontologyNode = { kind: "object-union", layers: ["fact", "capability", "governance", "product"], objectTypes: ["platform:OntologyType"] };
    assert.deepEqual(declared.get("ObjectRefCard").outputs, { navigate: ontologyNode });
    assert.ok(declared.get("ObjectForm").bindsElement.includes("ObjectType:*"), "ObjectForm applies to customer object types");
    // A placement hands a graph its running inputs from the panel's state, which an inline member binds by these names.
    const stringList = { kind: "list", items: { kind: "scalar", type: "string" } };
    const anyObject = { kind: "object", objectType: "@any" };
    const anyObjectList = { kind: "list", items: anyObject };
    assert.deepEqual(declared.get("OntologyGraph").inputs, {
      mode: { kind: "scalar", type: "string" },
      start: anyObject,
      selected: anyObject,
      selectedType: { kind: "scalar", type: "string" },
      selectedGroup: { kind: "scalar", type: "string" },
      query: { kind: "scalar", type: "string" },
      visibleLayers: stringList,
      expandedNodes: anyObjectList,
      neighborFilter: { kind: "json" },
    });
    const platformRelationKindList = { kind: "list", items: { kind: "object", objectType: "platform:OntologyRelationKind" } };
    assert.deepEqual(declared.get("OntologyGraph").outputs, {
      selectedNode: anyObject,
      selected: anyObject,
      selectedType: { kind: "scalar", type: "string" },
      selectedGroup: { kind: "scalar", type: "string" },
      visibleRelationKinds: platformRelationKindList,
      visibleLayers: stringList,
      expandedNodes: anyObjectList,
      neighborFilter: { kind: "json" },
      positions: { kind: "json" },
    });
    assert.deepEqual(declared.get("OntologyGraph").data.connections.runtimeParams, ["version", "sampleToken"]);
    assert.deepEqual(declared.get("OntologyGraph").data.neighbors.runtimeParams, [
      "node", "layers", "relationKinds", "targetClass", "direction", "limit", "offset",
    ]);
    const relationKindList = { kind: "list", items: { kind: "scalar", type: "string" } };
    const objectRelations = declared.get("ObjectRelations");
    assert.ok(objectRelations.bindsElement.includes("Relationship:*"));
    assert.deepEqual(objectRelations.inputs, {
      selected: anyObject,
      visibleRelationKinds: relationKindList,
    });
    assert.deepEqual(objectRelations.outputs, {
      selected: anyObject,
      start: anyObject,
      visibleRelationKinds: relationKindList,
    });
    for (const propName of ["show-relation-filter", "allow-set-start", "show-summary", "collapse-empty-groups"]) {
      const prop = declared.get("ObjectRelations").config.find((entry) => entry.name === propName);
      assert.equal(prop?.required, false, `ObjectRelations.${propName} is optional`);
      assert.match(prop?.type ?? "", /boolean/, `ObjectRelations.${propName} is boolean`);
      assert.equal(prop?.default, "false", `ObjectRelations.${propName} defaults to false`);
    }
    // The upload control runs its operation through the platform's upload contract without baking in domain-specific overwrite flows.
    assert.equal(declared.get("FileUploadControl").config.find(prop => prop.name === "operation")?.required, true);
    assert.equal(declared.get("FileUploadControl").config.find(prop => prop.name === "overwrite-on"), undefined);
    // Configuration is the props a projection sets, kept apart from the running inputs a placement supplies.
    const listLayout = declared.get("ObjectList").config.find(prop => prop.name === "layout");
    assert.equal(listLayout?.required, false);
    assert.match(listLayout?.type ?? "", /cards/);
    const formLayout = declared.get("ObjectForm").config.find(prop => prop.name === "layout");
    assert.equal(formLayout?.required, false);
    assert.match(formLayout?.type ?? "", /rows/);
    const formActions = declared.get("ObjectForm").config.find(prop => prop.name === "actions");
    assert.equal(formActions?.required, false);
    assert.match(formActions?.type ?? "", /create-only/);
    assert.doesNotMatch(formActions?.type ?? "", /header/);
    const opLabel = declared.get("OperationButton").config.find(prop => prop.name === "label");
    assert.equal(opLabel?.required, false);
    assert.match(opLabel?.type ?? "", /string/);
    assert.equal(declared.get("OperationButton").config.find(prop => prop.name === "placement"), undefined);
    const subtitleLines = declared.get("ObjectList").config.find(prop => prop.name === "subtitle-lines");
    assert.equal(subtitleLines?.required, false);
    assert.match(subtitleLines?.type ?? "", /number/);
    assert.match(subtitleLines?.description ?? "", /visible lines in a compact summary/);
    const showRowIndex = declared.get("ObjectList").config.find(prop => prop.name === "show-row-index");
    assert.equal(showRowIndex?.required, false);
    assert.match(showRowIndex?.type ?? "", /boolean/);
    assert.equal(showRowIndex?.default, "false");
    const pinPrimaryColumn = declared.get("ObjectList").config.find(prop => prop.name === "pin-primary-column");
    assert.equal(pinPrimaryColumn?.required, false);
    assert.match(pinPrimaryColumn?.type ?? "", /boolean/);
    assert.equal(pinPrimaryColumn?.default, "false");
    const rowActivation = declared.get("ObjectList").config.find(prop => prop.name === "row-activation");
    assert.equal(rowActivation?.required, false);
    assert.match(rowActivation?.type ?? "", /"click"/);
    assert.match(rowActivation?.type ?? "", /"dblclick"/);
    assert.match(rowActivation?.type ?? "", /"expand"/);
    assert.equal(rowActivation?.default, '"click"');
    const showPageJumper = declared.get("ObjectList").config.find(prop => prop.name === "show-page-jumper");
    assert.equal(showPageJumper?.required, false);
    assert.match(showPageJumper?.type ?? "", /boolean/);
    assert.equal(showPageJumper?.default, "true");
    const showRangeBar = declared.get("ObjectList").config.find(prop => prop.name === "show-range-bar");
    assert.equal(showRangeBar?.required, false);
    assert.match(showRangeBar?.type ?? "", /boolean/);
    assert.equal(showRangeBar?.default, "false");
    const countItems = declared.get("ObjectCount").config.find(prop => prop.name === "items");
    assert.equal(countItems?.required, false);
    assert.match(countItems?.type ?? "", /ObjectCountItem/);
    const countAppearance = declared.get("ObjectCount").config.find(prop => prop.name === "appearance");
    assert.equal(countAppearance?.required, false);
    assert.match(countAppearance?.type ?? "", /badge/);
    const countOmit = declared.get("ObjectCount").config.find(prop => prop.name === "omit-when-unavailable");
    assert.equal(countOmit?.required, false);
    assert.match(countOmit?.type ?? "", /boolean/);
    const appMenuPorts = declared.get("AppMenu").ports;
    assert.ok(appMenuPorts.props.some(prop => prop.name === "item-trailing-text"), "AppMenu publishes item-trailing-text prop");
    assert.ok(!appMenuPorts.props.some(prop => prop.name === "counts"), "AppMenu does not publish legacy counts prop");
    assert.ok(appMenuPorts.slots.some(slot => slot.name === "item-trailing"), "AppMenu publishes #item-trailing slot");
    assert.ok(declared.get("ObjectCount").bindsElement.includes("ObjectType:*"), "ObjectCount applies to customer object types");
    const metricCardItems = declared.get("MetricCard").config.find(prop => prop.name === "items");
    assert.equal(metricCardItems?.required, false);
    assert.match(metricCardItems?.type ?? "", /MetricCardItem/);
    const formPresentation = declared.get("ObjectForm").config.find(prop => prop.name === "presentation");
    assert.equal(formPresentation?.required, false);
    assert.match(formPresentation?.type ?? "", /ObjectFormPresentation/);
    const formGroups = declared.get("ObjectForm").config.find(prop => prop.name === "groups");
    assert.equal(formGroups?.required, false);
    assert.match(formGroups?.type ?? "", /ObjectFormGroup/);
    const formFieldsParent = declared.get("ObjectFormFields").config.find(prop => prop.name === "parent");
    assert.equal(formFieldsParent?.required, false);
    assert.match(formFieldsParent?.description ?? "", /JSON Pointer/);
    const pickerPlaceholder = declared.get("ReferencePicker").config.find(prop => prop.name === "placeholder");
    assert.equal(pickerPlaceholder?.required, false);
    assert.equal(declared.get("ReferencePicker").config.find(prop => prop.name === "clearable")?.required, false);
    assert.equal(declared.get("ReferencePicker").config.find(prop => prop.name === "group-by")?.required, false);
    const summaryShowTitle = declared.get("ObjectSummary").config.find(prop => prop.name === "show-title");
    assert.equal(summaryShowTitle?.required, false);
    assert.match(summaryShowTitle?.type ?? "", /boolean/);
    assert.equal(summaryShowTitle?.default, "true");
    assert.match(summaryShowTitle?.description ?? "", /record\.label/);
    const summaryDensity = declared.get("ObjectSummary").config.find(prop => prop.name === "density");
    assert.equal(summaryDensity?.required, false);
    assert.match(summaryDensity?.type ?? "", /"comfortable"/);
    assert.match(summaryDensity?.type ?? "", /"compact"/);
    assert.equal(summaryDensity?.default, '"comfortable"');
    assert.deepEqual(declared.get("ObjectSummary").config, declared.get("ObjectSummary").ports.props);
    const readerFormat = declared.get("ObjectTextReader").config.find((prop) => prop.name === "format");
    assert.equal(readerFormat?.required, false);
    for (const mode of ["auto", "plain", "markdown", "code", "table", "diff"]) {
      assert.match(readerFormat?.type ?? "", new RegExp(`"${mode}"`), `ObjectTextReader.format includes "${mode}"`);
    }
    assert.equal(declared.get("PanelData").config, undefined, "a component with no configuration declares none");
    const metricChartConfigNames = (declared.get("MetricChart").config ?? []).map((prop) => prop.name);
    assert.ok(metricChartConfigNames.includes("file-override"), "MetricChart exposes file-override for live draft preview");
    assert.ok(metricChartConfigNames.includes("min-height"), "MetricChart exposes min-height for grid cell sizing");
    const groupedGrid = declared.get("GroupedGrid");
    assert.ok(groupedGrid, "GroupedGrid is published in the SDK component catalogue");
    assert.deepEqual(groupedGrid.inputs, {
      selected: { kind: "object", objectType: "@data:rows" },
      layout: { kind: "grid-layout" },
    });
    assert.deepEqual(groupedGrid.outputs, {
      selected: { kind: "object", objectType: "@data:rows" },
      layout: { kind: "grid-layout" },
    });
    assert.deepEqual(Object.keys(groupedGrid.readOnlyOutputs ?? {}).sort(), [
      "groupCount", "hiddenCount", "itemCount", "status",
    ]);
    const groupedGridConfigNames = (groupedGrid.config ?? []).map((prop) => prop.name);
    for (const expectedProp of [
      "columns", "row-height", "gap", "group-key-field", "groups-field", "section-field",
      "editable", "row-actions", "items", "groups", "show-group-headers", "show-item-headers", "allow-hide",
    ]) {
      assert.ok(groupedGridConfigNames.includes(expectedProp), `GroupedGrid config includes ${expectedProp}`);
    }

    // Official components declare read-only outputs separately from writable public state.
    assert.deepEqual(Object.keys(declared.get("ObjectList").readOnlyOutputs ?? {}).sort(), [
      "activeLabel", "checkedCount", "filteredCount", "listed", "loadedCount", "selectedLabel", "status", "total",
    ]);
    assert.deepEqual(declared.get("ObjectList").readOnlyOutputs.listed, declared.get("ObjectList").outputs.listed);
    assert.deepEqual(declared.get("ObjectCount").readOnlyOutputs, {
      total: { kind: "scalar", type: "number" },
    });
    assert.deepEqual(Object.keys(declared.get("ObjectForm").readOnlyOutputs ?? {}).sort(), ["dirty", "draft", "label"]);
    assert.deepEqual(Object.keys(declared.get("ObjectSummary").readOnlyOutputs ?? {}).sort(), ["label", "status"]);
    assert.deepEqual(Object.keys(declared.get("ObjectTitle").readOnlyOutputs ?? {}).sort(), ["label"]);
    assert.deepEqual(Object.keys(declared.get("ObjectHeader").readOnlyOutputs ?? {}).sort(), [
      "errorMessage", "label", "status",
    ]);
    assert.deepEqual(Object.keys(declared.get("ObjectGraph").readOnlyOutputs ?? {}).sort(), [
      "edgeCount", "error", "nodeCount", "pathHops", "pathMessage", "pathStatus", "status",
    ]);
    assert.deepEqual(Object.keys(declared.get("OntologyGraph").readOnlyOutputs ?? {}).sort(), [
      "activeMode",
      "complete",
      "drawingProgress",
      "drawnEdgeCount",
      "drawnNodeCount",
      "edgeCount",
      "failures",
      "graphStatus",
      "graphVersion",
      "groups",
      "hasMoreNeighbors",
      "neighborProgress",
      "nodeCount",
      "overviewEdgesTruncated",
      "relationKinds",
      "sampleToken",
      "startDetail",
      "startLabel",
      "versionChanged",
      "visibleRelationKindLabels",
    ]);
    assert.deepEqual(Object.keys(declared.get("ObjectRelations").readOnlyOutputs ?? {}).sort(), [
      "edgeCount", "label", "status",
    ]);

    // SDK UI primitives, directives, and theme tokens are published under Ontomato SDK names with zero third-party leaks.
    assert.equal(catalogue.uiPrimitives.length, 108);
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
    const componentsDocBytes = Buffer.byteLength(componentsDoc, "utf8");
    assert.ok(
      componentsDocBytes < 12_000,
      `docs/components.md overview must stay within a few KB (got ${componentsDocBytes} bytes)`,
    );
    assert.doesNotMatch(componentsDoc, /^Binds:/mu, "docs/components.md must not emit misleading bare 'Binds:' lines");
    // Every component carries a purpose group and derived panelUsable flag; only panel-usable components appear in the overview.
    for (const component of catalogue.components) {
      assert.equal(typeof component.group, "string", `${component.componentId} must declare a group`);
      assert.equal(typeof component.panelUsable, "boolean", `${component.componentId} must derive panelUsable`);
      const singlePage = readFileSync(join(out, version, "docs/components", `${component.componentId}.md`), "utf8");
      assert.match(singlePage, new RegExp(`^# ${component.componentId}\\b`, "mu"));
      assert.doesNotMatch(singlePage, /^Binds:/mu, `${component.componentId}.md must not emit misleading bare 'Binds:' lines`);
      const overviewLink = `[**${component.componentId}**](components/${component.componentId}.md)`;
      if (component.panelUsable) {
        assert.ok(componentsDoc.includes(overviewLink), `panel-usable ${component.componentId} must appear in docs/components.md`);
      } else {
        assert.ok(!componentsDoc.includes(overviewLink), `non-panel ${component.componentId} must be excluded from docs/components.md`);
      }
    }
for (const excluded of ["AgentShell", "AgentPicker", "ShellComposer", "PageComposer", "ShellColumn", "MetricViewData", "ProductAsset", "Projection", "ScheduledTaskSummaryList", "EffectivePermissionsView", "TestcaseWorkbench", "ProductAssetGraph", "OntologyModelGraph", "VisualModelingGraph"]) {
      const entry = catalogue.components.find((c) => c.componentId === excluded);
      assert.equal(entry?.panelUsable, false, `${excluded} must derive panelUsable === false`);
      assert.equal(entry?.config, undefined, `non-panel ${excluded} must not emit author-facing config`);
    }
    for (const removed of ["DashboardMetricPreview", "ScheduledTaskAppFilterBar", "ScheduledTaskRunDetail", "DataAdapterTestReport"]) {
      assert.equal(catalogue.components.find((c) => c.componentId === removed), undefined, `${removed} must be removed from the SDK catalogue`);
    }
    const objectGraph = declared.get("ObjectGraph");
    const objectGraphConfigNames = (objectGraph.config ?? []).map((prop) => prop.name);
    for (const reclaimedGraphProp of ["node-size", "label-size", "highlight-banner", "show-focus-button", "export-background", "export-filename"]) {
      assert.equal(
        objectGraphConfigNames.includes(reclaimedGraphProp),
        false,
        `ObjectGraph must not emit reclaimed single-page prop '${reclaimedGraphProp}' in author-facing config`,
      );
    }
    assert.doesNotMatch(
      objectGraph.meaning,
      /exportBackground|exportFilename|export-background|export-filename/u,
      "ObjectGraph meaning must not list single-page PNG export presentation attributes",
    );
    // Author-facing `config` is emitted strictly from explicit `catalogue.ts` declarations: host-only inputs,
    // platform-fixed styles, deleted props, and duplicate wiring/locale-map props stay out of `components.json`
    // and `docs/components/<ComponentId>.md`.
    const excludedAuthorConfigs = [
      ["AgentChat", ["client", "agent-id", "agent", "labels", "session-id"]],
      ["ObjectList", ["leading-icon-kind", "leading-icon-size", "skeleton-count", "tabs-variant", "inline-rename", "expanded-keys", "search-submit", "row-tone-map", "row-action-icon-variant"]],
      ["GroupedGrid", ["section-columns", "section-row-heights", "section-order", "section-min-col-spans", "section-resize-axes"]],
      ["ObjectCount", ["labels"]],
      ["ObjectSummary", ["text-field"]],
      ["ObjectHeader", ["record", "danger-operations", "primary-operation"]],
      ["ObjectForm", ["show-required-mark"]],
      ["FileUploadControl", ["overwrite-on"]],
      ["ReferencePicker", ["placeholders"]],
      ["InteractiveGraphCanvas", ["style-overrides"]],
      ["OntologyGraph", ["mode", "start", "selected", "selected-type", "selected-group", "query", "layers", "show-layer-filter", "show-hint", "show-aggregate-toggle", "show-edge-label-toggle", "show-zoom-controls", "show-refresh-control", "neighbor-filter"]],
      ["ObjectRelations", ["selected", "visible-relation-kinds"]],
      ["PageHeader", ["compact"]],
      ["RecordTemplate", ["templates", "record"]],
      ["InfoBanner", ["tone-map", "titles", "texts", "templates"]],
      ["ObjectRefCard", ["record", "captions", "button-labels"]],
      ["MetricCard", ["labels", "units", "descriptions", "value-size"]],
      ["AnnotatedCode", ["stale-label", "stale-hint", "segments-title", "summary-title", "empty-summary-text", "legend-label"]],
      ["ConversationEntry", ["agent-picker-variant"]],
    ];
    for (const [componentId, forbiddenProps] of excludedAuthorConfigs) {
      const names = new Set((declared.get(componentId).config ?? []).map((prop) => prop.name));
      const pageMd = readFileSync(join(out, version, "docs/components", `${componentId}.md`), "utf8");
      const configSection = pageMd.match(/Configuration \(the projection's `config`\):([\s\S]*?)(?:\n\n[A-Z]|$)/u)?.[1] ?? "";
      for (const propName of forbiddenProps) {
        assert.equal(names.has(propName), false, `${componentId}.config must not expose '${propName}'`);
        const camel = propName.replace(/-([a-z])/g, (_, ch) => ch.toUpperCase());
        assert.doesNotMatch(
          configSection,
          new RegExp(`^- \`${camel}\`\\b`, "mu"),
          `docs/components/${componentId}.md Configuration must not list '${camel}'`,
        );
      }
    }
    // Guard against single-page exclusive presentation attributes (Groups A–F) leaking into public component meanings.
    const singlePageExclusions = [
      ["ObjectList", /rowToneMap|row-tone-map|rowToneField|row-tone-field|searchSubmit|search-submit|skeletonCount|skeleton-count|leadingIconSize|leading-icon-size|tagEffect|tag-effect|rowActionIconVariant|row-action-icon-variant|iconVariant|icon-variant|\bmetaField\b|meta-field/u],
      ["ObjectTree", /directoryIndexFile|directory-index-file/u],
      ["ObjectForm", /showRequiredMark|show-required-mark|showToc|show-toc|array-item-footer|fixedRows|fixed-rows|labelPosition|label-position|labelWidth|label-width|field-after-|variablesCollapsible|variables-collapsible|variablesPresentation|variables-presentation/u],
      ["ObjectSummary", /\btextField\b|text-field/u],
    ];
    for (const [name, pattern] of singlePageExclusions) {
      assert.doesNotMatch(
        declared.get(name).meaning,
        pattern,
        `${name} meaning must not list single-page exclusive presentation attributes`,
      );
    }
    // Status semantic tones travel on values or record.tones — never via ObjectList.rowToneMap or InfoBanner.toneMap.
    const objectListConfigNames = (declared.get("ObjectList").config ?? []).map((prop) => prop.name);
    assert.equal(objectListConfigNames.includes("row-tone-map"), false, "ObjectList must not expose row-tone-map");
    assert.equal(objectListConfigNames.includes("row-tone-field"), true, "ObjectList retains row-tone-field");
    for (const removed of ["search-submit", "leading-icon-kind", "inline-rename"]) {
      assert.equal(objectListConfigNames.includes(removed), false, `ObjectList must not expose removed prop ${removed}`);
    }
    const infoBannerConfigNames = (declared.get("InfoBanner").config ?? []).map((prop) => prop.name);
    assert.equal(infoBannerConfigNames.includes("tone-map"), false, "InfoBanner must not expose tone-map");
    assert.equal(infoBannerConfigNames.includes("tone-field"), true, "InfoBanner retains tone-field");
    const conversationConfigNames = (declared.get("ConversationEntry").config ?? []).map((prop) => prop.name);
    assert.equal(conversationConfigNames.includes("agent-picker-variant"), false, "ConversationEntry must not expose agent-picker-variant");
    assert.equal(groupedGridConfigNames.includes("sections"), true, "GroupedGrid exposes unified ordered sections prop");
    for (const removed of ["section-order", "section-columns", "section-row-heights", "section-min-col-spans", "section-resize-axes"]) {
      assert.equal(groupedGridConfigNames.includes(removed), false, `GroupedGrid must not expose removed prop ${removed}`);
    }
    const objectHeaderConfigNames = (declared.get("ObjectHeader").config ?? []).map((prop) => prop.name);
    for (const removed of ["danger-operations", "primary-operation"]) {
      assert.equal(objectHeaderConfigNames.includes(removed), false, `ObjectHeader must not expose removed prop ${removed}`);
    }
    // Verify Group F public general capabilities are reflected in catalogue metadata and config.
    assert.match(declared.get("ObjectForm").meaning, /\bsubmitOn\b/u, "ObjectForm meaning documents submitOn");
    assert.doesNotMatch(
      declared.get("ObjectForm").meaning,
      /config\.actions` to `header`/u,
      "ObjectForm meaning must not document removed actions: 'header'",
    );
    assert.ok(
      declared.get("OperationButton").bindsElement.includes("Action:*"),
      "OperationButton bindsElement must include customer Action:*",
    );
    assert.equal(
      declared.get("AnnotatedCode").inputs?.language?.kind,
      "scalar",
      "AnnotatedCode declares inputs.language port",
    );
    assert.ok(
      (declared.get("AnnotatedCode").config ?? []).some((prop) => prop.name === "language"),
      "AnnotatedCode exposes language config prop",
    );
    assert.ok(
      (declared.get("ReferencePicker").config ?? []).some((prop) => prop.name === "refreshable"),
      "ReferencePicker exposes refreshable config prop",
    );
    assert.match(declared.get("ReferencePicker").meaning, /\brefreshable\b/u, "ReferencePicker meaning documents refreshable");
    assert.match(declared.get("ReferencePicker").meaning, /\bMemberDataState\b/u, "ReferencePicker meaning documents MemberDataState retry");
    for (const forbidden of ["style-overrides", "toolbar-placement", "connect-ports", "show-pending-edge", "pending-edge"]) {
      assert.equal(
        objectGraphConfigNames.includes(forbidden),
        false,
        `ObjectGraph must not expose dedicated platform prop '${forbidden}'`,
      );
    }
    assert.ok(
      (objectGraph.ports?.events ?? []).some((event) => event.name === "choose"),
      "ObjectGraph declares the choose activation event matching ObjectList",
    );
    assert.deepEqual(
      declared.get("TestcaseWorkbench").bindsElement,
      ["PlatformObjectType:platform:AutotestCaseSet"],
      "TestcaseWorkbench must bind PlatformObjectType:platform:AutotestCaseSet",
    );
    for (const included of ["ObjectList", "ObjectForm", "ConversationEntry", "AgentChat", "AppPreview", "PageHeader", "MarkdownView"]) {
      const entry = catalogue.components.find((c) => c.componentId === included);
      assert.equal(entry?.panelUsable, true, `${included} must derive panelUsable === true`);
    }
    assert.deepEqual(Object.keys(declared.get("AppPreview").readOnlyOutputs ?? {}).sort(), [
      "activePage",
      "selection",
      "status",
    ]);
    const uiPrimitivesDoc = readFileSync(join(out, version, "docs/components/ui-primitives.md"), "utf8");
    const themeTokensDoc = readFileSync(join(out, version, "docs/components/theme-tokens.md"), "utf8");
    assert.match(uiPrimitivesDoc, /`<sdk-button>`/);
    assert.match(uiPrimitivesDoc, /`v-sdk-loading`/);
    assert.match(themeTokensDoc, /`--sdk-color-primary`/);
    const objectFormDoc = readFileSync(join(out, version, "docs/components/ObjectForm.md"), "utf8");
    assert.match(
      objectFormDoc,
      /# ObjectForm[\s\S]*?Applicable object types \(bind through a projection's declared reads or operations\): `PlatformObjectType:\*`, `ObjectType:\*`/u,
      "docs/components/ObjectForm.md must explain that applicable object types bind through a projection's declared reads or operations",
    );
    const objectRefCardDoc = readFileSync(join(out, version, "docs/components/ObjectRefCard.md"), "utf8");
    assert.match(
      objectRefCardDoc,
      /Hands over \(bindable to the panel's state\):\n\n[\s\S]*?- `navigate`: one object of the fact, capability, governance, product layers or platform:OntologyType\n/u,
      "docs/components/ObjectRefCard.md must print both layers and objectTypes for object-union ports",
    );
    const ontologyGraphDoc = readFileSync(join(out, version, "docs/components/OntologyGraph.md"), "utf8");
    assert.match(
      ontologyGraphDoc,
      /Inputs:\n\n[\s\S]*?- `selected`: any ontology object\n[\s\S]*?Hands over \(bindable to the panel's state\):\n\n[\s\S]*?- `selectedNode`: any ontology object\n/u,
      "docs/components/OntologyGraph.md must print any ontology object for OntologyGraph @any node ports",
    );
    const objectListDoc = readFileSync(join(out, version, "docs/components/ObjectList.md"), "utf8");
    assert.match(
      objectListDoc,
      /# ObjectList[\s\S]*?Configuration types:\n\n```ts\n[\s\S]*?type ObjectListColumn = \{[\s\S]*?key: string;[\s\S]*?labelKey\?:[\s\S]*?subtitleKey\?:[\s\S]*?emptyKey\?:[\s\S]*?wrap\?:/u,
      "docs/components/ObjectList.md must expand ObjectListColumn fields beside ObjectList config",
    );
    const columnTypeLine = objectListDoc.match(/type ObjectListColumn = [^\n]+/u)?.[0] ?? "";
    assert.ok(columnTypeLine.includes("minContainerWidth"), `ObjectListColumn in docs/components/ObjectList.md must include minContainerWidth: ${columnTypeLine}`);
    for (const kind of ['"text"', '"tag"', '"tags"', '"reference"', '"time"']) {
      assert.ok(columnTypeLine.includes(kind), `ObjectListColumn in docs/components/ObjectList.md must include kind ${kind}: ${columnTypeLine}`);
    }
    const relationsDoc = readFileSync(join(out, version, "docs/components/ObjectRelations.md"), "utf8");
    assert.match(relationsDoc, /`selected`: any ontology object/u);
    assert.match(relationsDoc, /`visibleRelationKinds`: a list of relation kind IDs or object references/u);
    assert.doesNotMatch(relationsDoc, /@any/u);
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
  const sdkWrappedPrimitives = new Set(["SdkButton", "SdkDialog", "SdkDrawer"]);
  for (const entry of SDK_UI_COMPONENTS) {
    if (sdkWrappedPrimitives.has(entry.sdkExport)) {
      assert.match(
        uiSource,
        new RegExp(`\\bexport\\s*\\{\\s*${entry.sdkExport}\\s*\\}\\s*from\\s*"\\.\\./ui/${entry.sdkExport}"`),
        `src/entries/ui.ts must export SDK-wrapped ${entry.sdkExport}`,
      );
      continue;
    }
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

test("resolveDeclaredConfig emits strictly declared author-facing props and rejects missing, unknown, or duplicate entries", () => {
  const vueProps = [
    { name: "layout", type: "string", description: "", required: false },
    { name: "page-size", type: "number", description: "", required: false },
    { name: "host-client", type: "object", description: "", required: false },
  ];
  assert.deepEqual(
    resolveDeclaredConfig({ componentId: "Demo", configProps: ["layout", "pageSize"] }, vueProps, { requireDeclaration: true })
      ?.map((p) => p.name),
    ["layout", "page-size"],
  );
  assert.equal(
    resolveDeclaredConfig({ componentId: "PanelData", configProps: [] }, [], { requireDeclaration: true }),
    undefined,
  );
  assert.equal(
    resolveDeclaredConfig({ componentId: "HostOnly" }, vueProps, { requireDeclaration: false }),
    undefined,
  );
  assert.throws(
    () => resolveDeclaredConfig({ componentId: "Undocumented" }, vueProps, { requireDeclaration: true }),
    /must explicitly declare its author-facing `configProps` prop list/,
  );
  assert.throws(
    () => resolveDeclaredConfig({ componentId: "Demo", configProps: ["missingProp"] }, vueProps, { requireDeclaration: true }),
    /is not declared on its Vue component/,
  );
  assert.throws(
    () => resolveDeclaredConfig({ componentId: "Demo", configProps: ["pageSize", "page-size"] }, vueProps, { requireDeclaration: true }),
    /declares duplicate `configProps` prop/,
  );
});
