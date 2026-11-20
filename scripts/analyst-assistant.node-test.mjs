import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createServer } from "node:http";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const run = promisify(execFile);
const script = new URL("../agent-skills/ontomato-analyst/assistant.mjs", import.meta.url).pathname;

async function withServer(handler, body) {
  const requests = [];
  const server = createServer(async (req, res) => {
    let text = "";
    for await (const chunk of req) text += chunk;
    const request = { method: req.method, url: req.url, headers: req.headers, body: text ? JSON.parse(text) : undefined };
    requests.push(request);
    await handler(request, res);
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const directory = await mkdtemp(path.join(os.tmpdir(), "assistant-metrics-"));
  try {
    return await body({ requests, base: `http://127.0.0.1:${server.address().port}`, directory });
  } finally {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
    await rm(directory, { recursive: true, force: true });
  }
}

function reply(res, status, value) {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(typeof value === "string" ? value : JSON.stringify(value));
}

test("recall-metrics sends the question and prints the items the ontology returns", async () => {
  const items = [{ id: "metric", revision: "rev", name: "Sales", description: "", logic: "sum", parameterDefs: [], preset: null }];
  await withServer((request, res) => reply(res, 200, { items }), async ({ requests, base, directory }) => {
    const { stdout } = await run(process.execPath, [script, "recall-metrics", "How", "many", "sales?"], {
      env: { ...process.env, ONTOMATO_ONTOLOGY_URL: base, ONTOMATO_TK: "fixture", ONTOMATO_OUTPUT_DIR: directory },
    });
    assert.deepEqual(JSON.parse(stdout), { items });
    assert.equal(requests.length, 1);
    assert.equal(requests[0].url, "/ontology/query/metrics/recall");
    assert.deepEqual(requests[0].body, { question: "How many sales?" });
    assert.equal(requests[0].headers.tk, "fixture");
  });
});

test("run-metric opens one retrieval run, delivers one table and writes the returned bytes", async () => {
  const retrieval = randomUUID();
  const bytes = '{"schema":"workbench.dataset.v2","title":"Sales total","rows":[{"value":9007199254740993}]}';
  await withServer((request, res) => {
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
  }, async ({ requests, base, directory }) => {
    const values = path.join(directory, "values.json");
    await writeFile(values, JSON.stringify({ threshold: 50 }));
    const { stdout } = await run(process.execPath, [script, "run-metric", "metric", "--revision", "rev",
      "--question", "How many sales?", "--params", "@" + values], {
      cwd: directory,
      env: { ...process.env, ONTOMATO_ONTOLOGY_URL: base, ONTOMATO_TK: "fixture" },
    });
    const delivered = JSON.parse(stdout);
    assert.deepEqual(delivered.columns, [{ key: "value", label: "Value", type: null }]);
    assert.equal(delivered.title, "Sales total");
    assert.equal(delivered.receiptId, delivered.path.split("/").at(-1).replace(".dataset.json", ""));
    assert.equal(await readFile(path.resolve(directory, delivered.path), "utf8"), bytes);
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

test("the assistant entry exposes the metric reuse commands and only the read-only definitions besides", async () => {
  await withServer((_request, res) => reply(res, 200, { items: [] }), async ({ requests, base }) => {
    for (const command of [["metrics", "Sales?"], ["agent", "list"], ["retriever-cancel", "x", "--run", "y"], ["execute-dsl", "@q.json"]]) {
      await assert.rejects(run(process.execPath, [script, ...command], { env: { ...process.env, ONTOMATO_ONTOLOGY_URL: base } }),
        (error) => /Commands: dataset-desc, classes, schema, relationships, knowledge, recall-metrics, run-metric/u.test(error.stderr));
    }
    assert.deepEqual(requests, []);
  });
});
