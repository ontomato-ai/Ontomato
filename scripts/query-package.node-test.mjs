import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, mkdir, symlink, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { collectPackage } from "../agent-skills/data-retrieval/scripts/query-package.mjs";
import { generationCommand } from "../agent-skills/ontology-generation/scripts/generation.mjs";
import { metricViewCommand } from "../agent-skills/metricview-generation/scripts/generation.mjs";
const fixture = JSON.parse(await readFile(new URL("../packages/contracts/examples/query-packages.json", import.meta.url), "utf8")).pythonAggregate;
const env = { ONTOMATO_ONTOLOGY_URL: "http://ontology.invalid", ONTOMATO_GENERATION_ID: "00000000-0000-4000-8000-000000000001", ONTOMATO_TK: "fixture" };
test("collector closes the manifest over exact source files and rejects links and traversal", async () => {
  const dir = await mkdtemp(join(tmpdir(), "query-package-"));
  try {
    for (const file of fixture.files) {
      await mkdir(join(dir, "queries"), { recursive: true });
      await writeFile(join(dir, file.path), file.content);
    }
    const manifest = join(dir, "package.json");
    await writeFile(manifest, JSON.stringify(fixture.manifest));
    assert.deepEqual(await collectPackage(manifest), fixture);
    const plain = await collectPackage(join(dir, "queries/employees.json"));
    assert.equal(plain.manifest.entry.kind, "dsl"); assert.equal(plain.files.length, 1);
    await symlink(join(dir, "calculate.py"), join(dir, "linked.py"));
    const linked = structuredClone(fixture.manifest); linked.entry.path = "linked.py";
    await writeFile(manifest, JSON.stringify(linked));
    await assert.rejects(collectPackage(manifest), /links/);
    linked.entry.path = "../outside.py";
    await writeFile(manifest, JSON.stringify(linked));
    await assert.rejects(collectPackage(manifest), /relative/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
test("both generation clients submit the whole bundle, never source paths", async () => {
  const dir = await mkdtemp(join(tmpdir(), "query-generation-"));
  try {
    for (const file of fixture.files) {
      await mkdir(join(dir, "queries"), { recursive: true });
      await writeFile(join(dir, file.path), file.content);
    }
    const manifest = join(dir, "package.json"), labels = join(dir, "labels.json");
    await writeFile(manifest, JSON.stringify(fixture.manifest)); await writeFile(labels, '{"total":"Total"}');
    for (const command of [generationCommand, metricViewCommand]) {
      let calls = 0;
      await command(["test-package", manifest, labels], env, async (url, options) => {
        calls++; assert.equal(url, `${env.ONTOMATO_ONTOLOGY_URL}/ontology/ai/generation/${env.ONTOMATO_GENERATION_ID}/test`);
        assert.deepEqual(JSON.parse(options.body), { queryPackage: fixture, columnLabels: { total: "Total" } });
        return Response.json({ result: "ok" });
      });
      assert.equal(calls, 1);
    }
  } finally { await rm(dir, { recursive: true, force: true }); }
});
