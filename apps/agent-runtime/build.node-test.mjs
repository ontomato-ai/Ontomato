import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import yaml from "yaml";
import { app } from "./build.mjs";
import { productionGraph } from "../../scripts/workbench/production-graph.mjs";

test("runtime production closure contains only the public runtime and contracts", () => {
  const lock = yaml.parse(readFileSync(join(app.repoRoot, "pnpm-lock.yaml"), "utf8"));
  const manifests = Object.fromEntries(Object.keys(lock.importers).map(importer =>
    [importer, JSON.parse(readFileSync(join(app.repoRoot, importer, "package.json"), "utf8"))]));
  for (const arch of ["x64", "arm64"]) {
    const graph = productionGraph(lock, app.appImporter, manifests, arch);
    assert.deepEqual(Object.keys(graph.bindings).sort(), ["apps/agent-runtime", "packages/agent-runtime", "packages/contracts"]);
    assert.ok(Object.keys(graph.packages).some(key => key.startsWith("@earendil-works/pi-ai@1.3.0")));
  }
  assert.equal(app.sources.length, 1);
  assert.equal(app.sources[0].root, app.repoRoot);
  assert.equal(app.component, "ontomato-agent-runtime");
});

test("source staging accepts an app without a web bundle and preserves the fork license", async t => {
  const { mkdtempSync, mkdirSync, rmSync, existsSync, writeFileSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { assembleAppStage } = await import("../../scripts/workbench/stage-app.mjs");
  const root = mkdtempSync(join(tmpdir(), "runtime-stage-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const absolute = join(root, "app");
  mkdirSync(join(absolute, "src/core/pi"), { recursive: true });
  writeFileSync(join(absolute, "package.json"), JSON.stringify({ name: "fixture" }));
  writeFileSync(join(absolute, "src/core/pi/LICENSE"), "MIT fixture");
  assembleAppStage({ root, stageRoot: join(root, "stage"), storeRoot: join(root, "store"),
    record: { appImporter: "app", web: false }, platform: "linux/arm64",
    lock: { lockfileVersion: "9.0", importers: { app: {} }, packages: {}, snapshots: {} },
    members: [{ path: "app", absolute, manifest: { name: "fixture" } }], selected: [{ path: "app" }],
  });
  assert.equal(readFileSync(join(root, "stage/app/src/core/pi/LICENSE"), "utf8"), "MIT fixture");
  assert.equal(existsSync(join(root, "stage/dist/web")), false);
});
