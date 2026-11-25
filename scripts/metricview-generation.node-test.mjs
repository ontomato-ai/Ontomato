import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { metricViewCommand } from "../agent-skills/metricview-generation/scripts/generation.mjs";

const runId = "00000000-0000-4000-8000-000000000002";
const env = { ONTOMATO_GENERATION_URL: "http://ontology.invalid/generation", ONTOMATO_EXECUTION_CALLBACK: "session-credential" };
test("MetricView business test sends exact file bytes and parameter definitions, never host paths", async () => {
  const dir = await mkdtemp(join(tmpdir(), "metricview-generation-"));
  try {
    const source = '{"answer":{"steps":[{}]}}';
    const program = join(dir, "query.json"), labels = join(dir, "labels.json");
    await writeFile(program, source); await writeFile(labels, '{"total":"Total"}');
    let calls = 0;
    const result = await metricViewCommand(["test-package", program, labels], env, async (url, options) => {
      assert.equal(options.headers["X-Ontomato-Callback-Credential"], env.ONTOMATO_EXECUTION_CALLBACK);
      assert.equal(options.headers["X-Ontomato-Run-Id"], undefined);
      if (url.endsWith("/runtime-context")) return Response.json({ runId, kind: "metric" });
      calls++;
      assert.equal(url, `${env.ONTOMATO_GENERATION_URL}/${runId}/test`);
      const body = JSON.parse(options.body);
      assert.equal(body.queryPackage.files[0].content, source);
      assert.deepEqual(body.columnLabels, { total: "Total" });
      assert.equal(options.redirect, "error");
      return Response.json({ result: "ok", error: null });
    });
    assert.equal(calls, 1); assert.equal(result.result, "ok");
    await writeFile(program, "{}");
    await assert.rejects(metricViewCommand(["test-package", program, labels], env, async () => assert.fail("Invalid shape must not execute")), /DSL/);
    await assert.rejects(metricViewCommand(["begin"], env, async () => assert.fail("No gate creation")), /Commands:/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
