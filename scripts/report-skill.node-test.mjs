import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const root = fileURLToPath(new URL("../", import.meta.url));
const server = path.join(root, "packages/workbench-server");

test("committed report skill artifacts match the source and locked dependencies", async (t) => {
  const output = await mkdtemp(path.join(os.tmpdir(), "report-skill-build-"));
  t.after(() => rm(output, { recursive: true, force: true }));
  await promisify(execFile)(process.execPath, [path.join(server, "report-skill/build.mjs"), output], { cwd: root });
  for (const file of ["scripts/render.cjs", "vendor/echarts.cjs", "vendor/resvg.wasm.b64"]) {
    const generated = await readFile(path.join(output, file));
    const committed = await readFile(path.join(server, "resources/runtime-skills/assistant-report", file));
    assert.equal(Buffer.compare(generated, committed), 0,
      `${file} is stale: run pnpm --filter @ontomato/workbench-server build:report-skill`);
  }
});

test("rejects a slide list that omits a dataset referenced by the report before reading fonts", async (t) => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), "report-skill-coverage-"));
  t.after(() => rm(workspace, { recursive: true, force: true }));
  const report = "outputs/reports/sample/report.md";
  const dataset = "outputs/omitted.dataset.json";
  await mkdir(path.join(workspace, path.dirname(report)), { recursive: true });
  await writeFile(path.join(workspace, report), `# Report\n\n![Evidence](${dataset})\n`);
  await writeFile(path.join(workspace, "slides.json"), JSON.stringify({ report, title: "Report", slides: [
    { layout: "text", title: "Summary", bullets: ["Conclusion"] },
  ] }));
  await assert.rejects(promisify(execFile)(process.execPath, [
    path.join(server, "resources/runtime-skills/assistant-report/scripts/render.cjs"), "slides.json",
  ], { cwd: workspace }), (error) => {
    assert.notEqual(error.code, 0);
    assert.ok(error.stderr.includes(dataset), error.stderr);
    return true;
  });
});
