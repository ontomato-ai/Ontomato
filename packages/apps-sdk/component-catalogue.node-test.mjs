import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
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
  return import(pathToFileURL(join(out, version, "node/panel-check.mjs")).href).then(({ appsSdkComponentCatalogSchema }) => {
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
    // Configuration is the props a projection sets, kept apart from the running inputs a placement supplies.
    assert.deepEqual(declared.get("ObjectSummary").config, declared.get("ObjectSummary").ports.props);
    assert.equal(declared.get("MetricChart").config, undefined, "a component with no configuration declares none");
  });
});
