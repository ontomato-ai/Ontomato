import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createServer } from "node:http";
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const run = promisify(execFile);
const source = new URL("../agent-skills/ontology-query/scripts/ontomato.mjs", import.meta.url).pathname;

async function withQueryPackage(handler, body) {
  const requests = [];
  const server = createServer(async (req, res) => {
    let text = "";
    for await (const chunk of req) text += chunk;
    const request = { method: req.method, url: req.url, headers: req.headers, body: text ? JSON.parse(text) : undefined };
    requests.push(request);
    await handler(request, res);
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const directory = await mkdtemp(path.join(os.tmpdir(), "ontology-query-package-"));
  const workspace = await mkdtemp(path.join(os.tmpdir(), "ontology-query-workspace-"));
  const scriptDirectory = path.join(directory, "ontology-query", "scripts");
  await mkdir(scriptDirectory, { recursive: true });
  const script = path.join(scriptDirectory, "ontomato.mjs");
  await copyFile(source, script);
  try {
    return await body({ requests, base: `http://127.0.0.1:${server.address().port}`, workspace, script });
  } finally {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
    await rm(directory, { recursive: true, force: true });
    await rm(workspace, { recursive: true, force: true });
  }
}

function reply(res, status, value) {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(typeof value === "string" ? value : JSON.stringify(value));
}

test("recall-metrics posts the question through the ontology query endpoint", async () => {
  await withQueryPackage((request, res) => {
    if (request.url === "/ontology/query/metrics/recall") reply(res, 200, { items: [{ id: "metric" }] });
    else reply(res, 404, { error: "Unexpected request " + request.url });
  }, async ({ requests, base, workspace, script }) => {
    const { stdout } = await run(process.execPath, [script, "recall-metrics", "How many sales?"], {
      cwd: workspace,
      env: { PATH: process.env.PATH, ONTOMATO_ONTOLOGY_URL: base, ONTOMATO_TK: "fixture" },
    });
    assert.deepEqual(JSON.parse(stdout), { items: [{ id: "metric" }] });
    assert.deepEqual(requests[0].body, { question: "How many sales?" });
    assert.equal(requests[0].headers.tk, "fixture");
  });
});

test("run-metric opens one retrieval run, delivers one table and writes the returned bytes", async () => {
  const retrieval = randomUUID();
  const bytes = '{"schema":"workbench.dataset.v2","title":"Sales total","rows":[{"value":9007199254740993}]}';
  await withQueryPackage((request, res) => {
    const url = request.url;
    if (url === "/ontology/retrievals/skill-runs") reply(res, 201, { id: retrieval, sessionId: retrieval, runId: retrieval });
    else if (url.endsWith("/submit-metric")) reply(res, 202, { id: request.headers["idempotency-key"] });
    else if (url.endsWith("/content")) reply(res, 200, bytes);
    else if (/\/outputs\/[^/]+$/u.test(url))
      reply(res, 200, { id: "output", running: false, error: null, dataset: {
        title: "Sales total", rows: [{ value: 1 }], columns: [{ key: "value", label: "Value", type: null }],
        truncation: null, execution: { receiptId: url.split("/").at(-1), executedAt: "2026-11-20T00:00:00Z" } } });
    else if (url.endsWith("/close")) reply(res, 204, "");
    else reply(res, 404, { error: "Unexpected request " + url });
  }, async ({ requests, base, workspace, script }) => {
    const values = path.join(workspace, "values.json");
    await writeFile(values, JSON.stringify({ threshold: 50 }));
    const { stdout } = await run(process.execPath, [script, "run-metric", "metric", "--revision", "rev",
      "--question", "How many sales?", "--params", "@" + values], {
      cwd: workspace,
      env: { PATH: process.env.PATH, ONTOMATO_ONTOLOGY_URL: base, ONTOMATO_TK: "fixture" },
    });
    const delivered = JSON.parse(stdout);
    assert.deepEqual(delivered.columns, [{ key: "value", label: "Value", type: null }]);
    assert.equal(delivered.title, "Sales total");
    assert.equal(delivered.receiptId, delivered.path.split("/").at(-1).replace(".dataset.json", ""));
    assert.equal(await readFile(path.resolve(workspace, delivered.path), "utf8"), bytes);
    const submit = requests.find((r) => r.url.endsWith("/submit-metric"));
    assert.deepEqual(submit.body, { id: "metric", revision: "rev", parameters: { threshold: 50 } });
    assert.match(submit.headers["idempotency-key"], /^[0-9a-f-]{36}$/u);
    assert.equal(submit.headers["x-ontomato-run-id"], retrieval);
    assert.deepEqual(requests.map((r) => r.url.replace(/[0-9a-f-]{36}/gu, ":id")), [
      "/ontology/retrievals/skill-runs",
      "/ontology/retrievals/:id/runs/:id/submit-metric",
      "/ontology/retrievals/:id/runs/:id/outputs/:id",
      "/ontology/retrievals/:id/runs/:id/outputs/:id/content",
      "/ontology/retrievals/:id/skill-runs/:id/close",
    ]);
  });
});

test("read-only query commands run from the self-contained output", async () => {
  await withQueryPackage((request, res) => {
    if (request.url === "/ontology/query/execute-dsl") reply(res, 200, { rows: [{ total: 2 }] });
    else reply(res, 404, { error: "Unexpected request " + request.url });
  }, async ({ requests, base, workspace, script }) => {
    const query = path.join(workspace, "query.json");
    await writeFile(query, '{"answer":{"steps":[]}}');
    const { stdout } = await run(process.execPath, [script, "execute-dsl", "@" + query], {
      cwd: workspace,
      env: { PATH: process.env.PATH, ONTOMATO_ONTOLOGY_URL: base, ONTOMATO_TK: "fixture" },
    });
    assert.deepEqual(JSON.parse(stdout), { rows: [{ total: 2 }] });
    assert.deepEqual(requests[0].body, { dsl: { answer: { steps: [] } } });
    await assert.rejects(run(process.execPath, [script, "agent", "list"], {
      cwd: workspace,
      env: { PATH: process.env.PATH, ONTOMATO_ONTOLOGY_URL: base },
    }), (error) => /recall-metrics, run-metric/.test(error.stderr));
  });
});
