import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import test from "node:test";

/*
 * The trial's own material as the platform takes it in (design 1, 4, 8): P is a layout and a declaration with no code,
 * which the platform draws itself, and its four projections each name the owner's registered reads; Q keeps its module.
 * What this rules out: a trial panel the platform would have to run in a frame, a layout or declaration the shared
 * parser refuses, and a projection whose data is not a registered read.
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
      import { parsePanelLayout } from "@ontomato/contracts/panel-layout";
      import * as trial from ${JSON.stringify(join(HERE, "definitions.mjs"))};
      console.log(JSON.stringify(await (${check})({ ...panels, parsePanelLayout }, trial)));
    `,
  ], { cwd: HERE });
  return JSON.parse(stdout);
}

test("P is a direct panel: its layout parses against its declaration and it carries no code", async () => {
  const answer = await taken(String(({ productPanelInputSchema, parsePanelLayout }, { panels: [p], panelContent }) => {
    const content = panelContent(p.directory);
    const input = productPanelInputSchema.parse({ name: p.name, description: p.description, visibility: "domain", content, manifest: p.manifest });
    return { module: Object.hasOwn(content, "module"), roots: parsePanelLayout(input.content.html, input.manifest).nodes.filter(node => node.kind !== "text").map(node => node.kind) };
  }));
  assert.deepEqual(answer, { module: false, roots: ["element"] });
});

test("every trial projection names the owner's registered reads under the data names its component takes", async () => {
  const answer = await taken(String(({ productProjectionInputSchema }, { projections }) =>
    Object.fromEntries(projections.map(({ id, input }) => [id, Object.keys(productProjectionInputSchema.parse(input).data)]))));
  assert.deepEqual(answer, {
    "projection-schedules-summary": ["record"],
    "projection-schedules-tasks": ["rows"],
    "projection-schedules-form": ["form"],
    "projection-schedules-run": ["operation"],
  });
});

test("Q keeps its module and stays a panel written with code", async () => {
  const answer = await taken(String(({ productPanelInputSchema }, { panels: [, q], panelContent }) => {
    const content = panelContent(q.directory);
    productPanelInputSchema.parse({ name: q.name, description: q.description, visibility: "domain", content, manifest: q.manifest });
    return typeof content.module;
  }));
  assert.equal(answer, "string");
});
