import { test } from "node:test";
import assert from "node:assert/strict";
import { probeBatch } from "../agent-skills/data-retrieval/scripts/probe.mjs";

test("independent probes overlap, preserve order and partial facts, and isolate refusals", async () => {
  let active = 0, peak = 0;
  const waiting = [];
  const input = Array.from({ length: 7 }, (_, index) => ({ id: String(index), operation: "distinct-values", input: { className: "/person", attribute: "status", limit: index + 1 } }));
  const request = async (url, options) => {
    assert.equal(url, "http://ontology.test/ontology/query/distinct-values");
    assert.equal(options.headers.tk, "fixture");
    assert.equal(options.headers["X-Ontomato-Run-Id"], "run");
    active++; peak = Math.max(peak, active);
    await new Promise(resolve => { waiting.push(resolve); if (waiting.length === 4) waiting.splice(0).forEach(done => done()); else setTimeout(() => waiting.splice(0).forEach(done => done()), 5); });
    active--;
    const index = JSON.parse(options.body).limit - 1;
    return index === 2 ? Response.json({ error: { code: "FORBIDDEN", message: "Field not readable" } }, { status: 403 })
      : Response.json({ values: [null, 0, false], truncated: true, rowLimit: 3 });
  };
  const { results } = await probeBatch(input, { ONTOMATO_ONTOLOGY_URL: "http://ontology.test", ONTOMATO_TK: "fixture", ONTOMATO_RUN_ID: "run" }, request);
  assert.equal(peak, 4);
  assert.deepEqual(results.map(row => row.id), input.map(row => row.id));
  assert.deepEqual(results[0].result, { values: [null, 0, false], truncated: true, rowLimit: 3 });
  assert.equal(results[2].error.code, "FORBIDDEN");
  assert.equal(results[6].ok, true);
});

test("invalid batches fail before any request and transport failure is not an empty result", async () => {
  let calls = 0;
  const request = async () => { calls++; throw new Error("transport"); };
  const item = { id: "one", operation: "schema", input: { classNames: ["/person"] } };
  await assert.rejects(probeBatch([item, item], {}, request), /unique id/);
  await assert.rejects(probeBatch([{ ...item, operation: "write" }], {}, request), /supported operation/);
  assert.equal(calls, 0);
  const { results } = await probeBatch([item], { ONTOMATO_ONTOLOGY_URL: "http://ontology.test" }, request);
  assert.equal(results[0].ok, false);
  assert.equal(results[0].error.code, "PROBE_TRANSPORT_FAILED");
  assert.equal(results[0].result, undefined);
});

test("schema rejects invalid value probes without discarding the valid requests in the batch", async () => {
  const schema = { classes: [{ className: "/person", attrs: [
    { name: "status", type: "varchar" }, { name: "hire_date", type: "date" },
  ] }] };
  const probes = ["status", "hire_date", "missing"].map(attribute => ({
    id: attribute, operation: "distinct-values", input: { className: "/person", attribute },
  }));
  const bodies = [];
  const { results } = await probeBatch(probes, { ONTOMATO_ONTOLOGY_URL: "http://ontology.test" }, async (_url, options) => {
    bodies.push(JSON.parse(options.body));
    return Response.json({ values: [] });
  }, schema);
  assert.deepEqual(bodies, [{ className: "/person", attribute: "status", limit: 100 }]);
  assert.deepEqual(results[0].result, { values: [] });
  assert.match(results[1].error.message, /hire_date.*scoped DSL/);
  assert.equal(results[2].error.code, "INVALID_PROBE_INPUT");
});
