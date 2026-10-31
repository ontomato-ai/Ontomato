import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { generationCommand } from "../agent-skills/ontology-generation/scripts/generation.mjs";

const env = {
  ONTOMATO_ONTOLOGY_URL: "http://ontology.invalid/",
  ONTOMATO_GENERATION_ID: "00000000-0000-4000-8000-000000000001",
  ONTOMATO_TK: "fixture-generation-credential",
};
test("business test sends exact file bytes and parameter definitions, never host paths", async () => {
  const dir = await mkdtemp(join(tmpdir(), "ontology-generation-"));
  try {
    const source = "# ontomato-python:2\nprint('中文')\n";
    const definitions = [{ name: "limit", type: "TYPE_NUMBER", value: 0 }];
    const program = join(dir, "program.py"), params = join(dir, "params.json");
    await writeFile(program, source); await writeFile(params, JSON.stringify(definitions));
    let calls = 0;
    const result = await generationCommand(["test", program, params], env, async (url, options) => {
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
    await assert.rejects(generationCommand(["test", program, params], env, async () => assert.fail("Invalid shape must not execute")), /array/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
test("source reading preserves requested line ranges and never fabricates a successful error result", async () => {
  const read = async () => Response.json({ source: "first\nsecond\nthird\n" });
  assert.equal(await generationCommand(["source", "2", "3"], env, read), "second\nthird");
  await assert.rejects(generationCommand(["source"], env, async () => Response.json({ error: { code: "CLOSED", message: "Gate closed" } }, { status: 409 })), /Gate closed/);
  await assert.rejects(generationCommand(["begin", "action"], env, read), /host already owns/);
});

test("Python business failures retain their corrective feedback", async () => {
  await assert.rejects(generationCommand(["reset"], env,
    async () => Response.json({ error: "Unknown class /Order; inspect the schema first" })), /Unknown class \/Order/);
});
