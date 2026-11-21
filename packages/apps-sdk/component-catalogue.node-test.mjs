import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

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
  ObjectForm: { form: ["panelFormDescription"], createForm: ["panelFormDescription"] },
  OperationButton: {},
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
    applicationIconKeys, appsSdkComponentCatalogSchema, panelModuleImports,
  }) => {
    await t.test("the offline checker requires an explicit form for a draft read before writing any IDs", () => {
      const workspace = join(out, "builtin-panel");
      mkdirSync(workspace);
      writeFileSync(join(workspace, "registration.json"), JSON.stringify({ panels: [{ id: "builtin-product-metric-check" }] }));
      const editor = { component: "ObjectForm", type: "platform:MetricView", data: { createForm: "createForm" } };
      const trial = { component: "OperationButton", operation: "metricViews.test" };
      const descriptor = join(workspace, "panel.json");
      const document = { manifest: { state: {}, events: {}, members: { metricEditor: editor, preview: trial } } };
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
    // Components that only ran in the old frame are not offered until each runs in the platform's page: an author never
    // places one that would not work there.
    for (const withdrawn of ["FileUploadControl"])
      assert.equal(declared.get(withdrawn), undefined, `${withdrawn} is not offered`);
    // Configuration is the props a projection sets, kept apart from the running inputs a placement supplies.
    assert.deepEqual(declared.get("ObjectSummary").config, declared.get("ObjectSummary").ports.props);
    assert.equal(declared.get("MetricChart").config, undefined, "a component with no configuration declares none");
  });
});
