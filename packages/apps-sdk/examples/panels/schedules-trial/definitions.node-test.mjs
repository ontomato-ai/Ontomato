import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import test from "node:test";

/*
 * The trial's own material as the platform takes it in (design 1, 4, 8): P and Q are each a module and a declaration the
 * shared schema accepts, and P's four projections each name the owner's registered reads.
 * What this rules out: a trial panel the platform refuses to register, and a projection whose data is not a registered
 * read.
 *
 * The contracts are TypeScript, so the checks run as the registration script does: in Node with the contracts' loader,
 * from this directory, whose package resolves them.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "../../../../..");

async function taken(check) {
  const { stdout } = await promisify(execFile)(process.execPath, [
    "--import", join(ROOT, "packages/contracts/node_modules/tsx/dist/loader.mjs"), "--input-type=module", "-e", `
      import * as panels from "@ontomato/contracts/product-panels";
      import * as trial from ${JSON.stringify(join(HERE, "definitions.mjs"))};
      console.log(JSON.stringify(await (${check})(panels, trial)));
    `,
  ], { cwd: HERE });
  return JSON.parse(stdout);
}

test("P and Q are each a module and a declaration the platform registers", async () => {
  const answer = await taken(String(({ productPanelInputSchema }, { panels, panelContent }) => panels.map((panel) => {
    const content = panelContent(panel.directory);
    productPanelInputSchema.parse({ name: panel.name, description: panel.description, visibility: "domain", content, manifest: panel.manifest });
    return typeof content.module;
  })));
  assert.deepEqual(answer, ["string", "string"]);
});

test("every trial projection names the owner's registered reads under the data names its component takes, and the operations it offers", async () => {
  const answer = await taken(String(({ productProjectionInputSchema }, { projections }) =>
    Object.fromEntries(projections.map(({ id, input }) => {
      const { data, operations } = productProjectionInputSchema.parse(input);
      return [id, { data: Object.keys(data), operations: Object.fromEntries(Object.entries(operations ?? {}).map(([name, { operation }]) => [name, operation.id])) }];
    }))));
  assert.deepEqual(answer, {
    "projection-schedules-summary": { data: ["record"], operations: {} },
    "projection-schedules-tasks": { data: ["rows"], operations: {} },
    "projection-schedules-form": { data: ["form"], operations: { save: "platform:ScheduledTask.save" } },
    "projection-schedules-run": { data: [], operations: { runNow: "schedules.runNow" } },
  });
});
