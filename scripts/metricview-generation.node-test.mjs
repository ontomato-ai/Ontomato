import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { metricViewCommand } from "../agent-skills/metricview-generation/scripts/generation.mjs";

const env = {
  ONTOMATO_ONTOLOGY_URL: "http://ontology.invalid/",
  ONTOMATO_GENERATION_ID: "00000000-0000-4000-8000-000000000002",
  ONTOMATO_TK: "fixture-generation-credential",
};
const external = { ONTOMATO_ONTOLOGY_URL: "http://ontology.invalid/" };
test("MetricView business test sends exact file bytes and parameter definitions, never host paths", async () => {
  const dir = await mkdtemp(join(tmpdir(), "metricview-generation-"));
  try {
    const source = '{"answer":{"steps":[{}]}}';
    const program = join(dir, "query.json"), labels = join(dir, "labels.json");
    await writeFile(program, source); await writeFile(labels, '{"total":"Total"}');
    let calls = 0;
    const result = await metricViewCommand(["test-package", program, labels], env, async (url, options) => {
      calls++;
      assert.equal(url, `http://ontology.invalid/ontology/ai/generation/${env.ONTOMATO_GENERATION_ID}/test`);
      const body = JSON.parse(options.body);
      assert.equal(body.queryPackage.files[0].content, source);
      assert.deepEqual(body.columnLabels, { total: "Total" });
      assert.equal(options.headers.tk, env.ONTOMATO_TK);
      assert.equal(options.headers["X-Ontomato-Run-Id"], env.ONTOMATO_GENERATION_ID);
      assert.equal(options.redirect, "error");
      return Response.json({ result: "ok", error: null });
    });
    assert.equal(calls, 1); assert.equal(result.result, "ok");
    await writeFile(program, "{}");
    await assert.rejects(metricViewCommand(["test-package", program, labels], env, async () => assert.fail("Invalid shape must not execute")), /DSL/);
    await assert.rejects(metricViewCommand(["begin"], env, async () => assert.fail("The host already owns the gate")), /host already owns/);
    await assert.rejects(
      metricViewCommand(["begin"], external, async (url, options) => {
        assert.equal(url, "http://ontology.invalid/ontology/ai/generation/gates");
        assert.equal(JSON.parse(options.body).kind, "metric");
        return Response.json({ error: { code: "FORBIDDEN", message: "Gate denied" } }, { status: 403 });
      }),
      /Gate denied/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
