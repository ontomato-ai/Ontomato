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
    const source = "# ontomato-python:2\nprint('中文')\n";
    const definitions = [{ name: "limit", type: "TYPE_NUMBER", value: 0 }];
    const program = join(dir, "program.py"), params = join(dir, "params.json");
    await writeFile(program, source); await writeFile(params, JSON.stringify(definitions));
    let calls = 0;
    const result = await metricViewCommand(["test", program, params], env, async (url, options) => {
      calls++;
      assert.equal(url, `http://ontology.invalid/ontology/ai/generation/${env.ONTOMATO_GENERATION_ID}/test`);
      assert.deepEqual(JSON.parse(options.body), { code: source, parameterDefs: definitions });
      assert.equal(options.headers.tk, env.ONTOMATO_TK);
      assert.equal(options.headers["X-Ontomato-Run-Id"], env.ONTOMATO_GENERATION_ID);
      assert.equal(options.redirect, "error");
      return Response.json({ result: "ok", error: null });
    });
    assert.equal(calls, 1); assert.equal(result.result, "ok");
    await writeFile(params, "{}");
    await assert.rejects(metricViewCommand(["test", program, params], env, async () => assert.fail("Invalid shape must not execute")), /array/);
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
