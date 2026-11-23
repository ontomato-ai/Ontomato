import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createServer } from "node:http";
import { copyFile, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const run = promisify(execFile);
const assistantSource = new URL("../agent-skills/ontomato-analyst/assistant.mjs", import.meta.url).pathname;
const clientSource = new URL("../agent-skills/ontomato-analyst/client.mjs", import.meta.url).pathname;
const retrieverRef = { providerId: "ontology", agentId: "dd3b91b9-9214-4aa6-9937-fb07fd37b232" };

async function withAssistantPackage(handler, body) {
  const requests = [];
  const server = createServer(async (req, res) => {
    let text = "";
    for await (const chunk of req) text += chunk;
    const request = { method: req.method, url: req.url, headers: req.headers, body: text ? JSON.parse(text) : undefined };
    requests.push(request);
    await handler(request, res);
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const directory = await mkdtemp(path.join(os.tmpdir(), "assistant-package-"));
  await copyFile(assistantSource, path.join(directory, "ontomato.mjs"));
  await copyFile(clientSource, path.join(directory, "client.mjs"));
  await writeFile(path.join(directory, "retriever-ref.json"), JSON.stringify(retrieverRef));
  try {
    return await body({
      requests,
      base: `http://127.0.0.1:${server.address().port}`,
      directory,
      script: path.join(directory, "ontomato.mjs"),
    });
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

test("start-retrieval dispatches the retriever and recalls metrics concurrently", async () => {
  const runId = randomUUID();
  const taskId = randomUUID();
  const sessionId = randomUUID();
  const pending = new Map();
  const releaseWhenBothArrive = (key, fn) => {
    pending.set(key, fn);
    if (pending.size === 2) {
      for (const release of pending.values()) release();
    }
  };

  await withAssistantPackage((request, res) => {
    if (request.url === `/v1/channel/hosts/workbench/domains/a/runs/${runId}/commands`) {
      if (request.body?.op === "list") {
        reply(res, 200, { agents: [{ ref: retrieverRef, contextSchema: { properties: { queryIntent: { type: "object" } } } }] });
        return;
      }
      releaseWhenBothArrive("start", () => reply(res, 200, { taskId, sessionRef: { providerId: "ontology", sessionId }, status: "starting" }));
    } else if (request.url === "/ontology/query/metrics/recall") {
      releaseWhenBothArrive("recall", () => reply(res, 200, { items: [] }));
    } else {
      reply(res, 404, { error: "Unexpected request " + request.url });
    }
  }, async ({ requests, base, directory, script }) => {
    const intent = { schema: "ontomato.query-intent.v1", conditions: [{ id: "status", quote: "active", mapping: null }], outputs: ["Faculty count"] };
    await writeFile(path.join(directory, "intent.json"), JSON.stringify(intent));
    const { stdout } = await run(process.execPath, [script, "start-retrieval", "How many active faculty?", "--intent", "@intent.json"], {
      cwd: directory,
      env: {
        PATH: process.env.PATH,
        ONTOMATO_SKILL_SCENARIO: "platform",
        ONTOMATO_AGENT_COMMAND_URL: `${base}/v1/channel/hosts/workbench/domains/a/runs/${runId}/commands`,
        ONTOMATO_AGENT_CALLBACK: "channel-secret",
        ONTOMATO_RUN_ID: runId,
        ONTOMATO_ONTOLOGY_URL: base,
        ONTOMATO_EXECUTION_CALLBACK: "business-callback",
      },
    });
    assert.deepEqual(JSON.parse(stdout), {
      retriever: { taskId, sessionRef: { providerId: "ontology", sessionId }, status: "starting" },
      recall: { items: [] },
    });
    const startReq = requests.find((r) => r.url.endsWith("/commands") && r.body.op === "start");
    const recallReq = requests.find((r) => r.url === "/ontology/query/metrics/recall");
    assert.deepEqual(startReq.body, { op: "start", agent: retrieverRef, message: "How many active faculty?", context: { queryIntent: intent } });
    assert.equal(startReq.headers["x-ontomato-callback-credential"], "channel-secret");
    assert.deepEqual(recallReq.body, { question: "How many active faculty?" });
    assert.equal(recallReq.headers["x-ontomato-callback-credential"], "business-callback");
  });
});

test("an older retriever receives no intent extension and is started only once", async () => {
  await withAssistantPackage((request, res) => {
    if (request.url.endsWith("/commands")) return reply(res, 200, request.body.op === "list"
      ? { agents: [{ ref: retrieverRef }] } : { taskId: "legacy-task", status: "starting" });
    reply(res, 200, { items: [] });
  }, async ({ requests, base, directory, script }) => {
    await writeFile(path.join(directory, "intent.json"), JSON.stringify({ schema: "ontomato.query-intent.v1", conditions: [], outputs: ["Count"] }));
    const { stdout } = await run(process.execPath, [script, "start-retrieval", "Count people", "--intent", "@intent.json"], {
      cwd: directory, env: { PATH: process.env.PATH, ONTOMATO_ONTOLOGY_URL: base, ONTOMATO_TK: "fixture" },
    });
    const starts = requests.filter(request => request.body?.op === "start");
    assert.equal(starts.length, 1);
    assert.equal(starts[0].body.context, undefined);
    assert.equal(JSON.parse(stdout).queryIntentApplied, false);
  });
});

test("the bundled retriever descriptor sends intent without consulting the provider directory", async () => {
  await withAssistantPackage((request, res) => {
    if (request.url.endsWith("/commands")) return reply(res, 200, { taskId: "task", status: "starting" });
    reply(res, 200, { items: [] });
  }, async ({ requests, base, directory, script }) => {
    const intent = { schema: "ontomato.query-intent.v1", conditions: [{ id: "status", quote: "active", mapping: null }], outputs: ["Count"] };
    await writeFile(path.join(directory, "intent.json"), JSON.stringify(intent));
    await writeFile(path.join(directory, "retriever-ref.json"), JSON.stringify({ ref: retrieverRef,
      contextSchema: { properties: { queryIntent: { type: "object" } } } }));
    await run(process.execPath, [script, "start-retrieval", "Count active staff", "--intent", "@intent.json"], {
      cwd: directory, env: { PATH: process.env.PATH, ONTOMATO_ONTOLOGY_URL: base, ONTOMATO_TK: "fixture" },
    });
    assert.deepEqual(requests.filter(request => request.url.endsWith("/commands")).map(request => request.body), [
      { op: "start", agent: retrieverRef, message: "Count active staff", context: { queryIntent: intent } },
    ]);
  });
});

test("a malformed intent file is rejected before dispatching either branch", async () => {
  await withAssistantPackage((_request, res) => reply(res, 500, { error: "Unexpected request" }),
    async ({ requests, base, directory, script }) => {
      await writeFile(path.join(directory, "intent.json"), JSON.stringify({
        schema: "ontomato.query-intent.v1", question: "Count staff", conditions: [], outputs: ["Count"],
      }));
      await assert.rejects(run(process.execPath, [script, "start-retrieval", "Count staff", "--intent", "@intent.json"], {
        cwd: directory, env: { PATH: process.env.PATH, ONTOMATO_ONTOLOGY_URL: base, ONTOMATO_TK: "fixture" },
      }), /pass the question as the command argument/);
      assert.deepEqual(requests, []);
    });
});

test("a stalled recall leaves the admitted retrieval available after the timeout", async () => {
  await withAssistantPackage((request, res) => {
    if (request.url.endsWith("/commands")) {
      if (request.body.op === "list") return reply(res, 503, { error: "Directory unavailable" });
      reply(res, 200, { taskId: "running-task", status: "running" });
    }
  }, async ({ requests, base, directory, script }) => {
    await writeFile(path.join(directory, "intent.json"), JSON.stringify({ schema: "ontomato.query-intent.v1", conditions: [], outputs: ["Count"] }));
    const result = await run(process.execPath, [script, "start-retrieval", "Count people", "--intent", "@intent.json"], {
      cwd: directory, timeout: 8000,
      env: { PATH: process.env.PATH, ONTOMATO_ONTOLOGY_URL: base, ONTOMATO_TK: "fixture" },
    }).catch(error => error);
    assert.equal(result.code, 1);
    const output = JSON.parse(result.stdout);
    assert.equal(output.recall.error.code, "RECALL_TIMEOUT");
    assert.equal(output.retriever.taskId, "running-task");
    assert.equal(output.queryIntentStatus, "capability_check_unavailable");
    assert.deepEqual(requests.filter(request => request.body?.op === "start").map(request => request.body), [{
      op: "start", agent: retrieverRef, message: "Count people",
    }]);
  });
});

test("start-retrieval preserves taskId on recall failure and reports start failure with exit code 1", async () => {
  const runId = randomUUID(), taskId = randomUUID(), sessionId = randomUUID();
  let mode = "recall-error";
  await withAssistantPackage((request, res) => {
    if (request.url.endsWith("/commands")) {
      if (mode === "start-error") reply(res, 409, { error: { code: "RUN_CLOSED", message: "Run is closed" } });
      else reply(res, 200, { taskId, sessionRef: { providerId: "ontology", sessionId }, status: "starting" });
    } else if (request.url === "/ontology/query/metrics/recall") {
      if (mode === "recall-error") reply(res, 503, { error: { code: "RECALL_UNAVAILABLE", message: "Recall unavailable" } });
      else reply(res, 200, { items: [{ id: "m1", revision: "r1", name: "M1", description: "", logic: "", parameterDefs: [], preset: null }] });
    }
  }, async ({ base, directory, script }) => {
    const env = {
      PATH: process.env.PATH,
      ONTOMATO_SKILL_SCENARIO: "platform",
      ONTOMATO_AGENT_COMMAND_URL: `${base}/v1/channel/hosts/workbench/domains/a/runs/${runId}/commands`,
      ONTOMATO_AGENT_CALLBACK: "channel-secret",
      ONTOMATO_RUN_ID: runId,
      ONTOMATO_ONTOLOGY_URL: base,
      ONTOMATO_TK: "fixture",
    };

    const recallFailed = await run(process.execPath, [script, "start-retrieval", "Question A"], { cwd: directory, env }).catch((e) => e);
    assert.equal(recallFailed.code, 1);
    assert.deepEqual(JSON.parse(recallFailed.stdout), {
      retriever: { taskId, sessionRef: { providerId: "ontology", sessionId }, status: "starting" },
      recall: { error: { message: "Recall unavailable", status: 503, code: "RECALL_UNAVAILABLE" } },
    });

    mode = "start-error";
    const startFailed = await run(process.execPath, [script, "start-retrieval", "Question B"], { cwd: directory, env }).catch((e) => e);
    assert.equal(startFailed.code, 1);
    const startFailedBody = JSON.parse(startFailed.stdout);
    assert.deepEqual(startFailedBody.retriever, { error: { message: "Run is closed", status: 409, code: "RUN_CLOSED" } });
    assert.equal(startFailedBody.recall.items[0].id, "m1");
  });
});

test("run-metric opens one retrieval run, delivers one table and writes the returned bytes", async () => {
  const retrieval = randomUUID();
  const bytes = '{"schema":"workbench.dataset.v2","title":"Sales total","rows":[{"value":9007199254740993}]}';
  await withAssistantPackage((request, res) => {
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
  }, async ({ requests, base, directory, script }) => {
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

test("the assistant entry exposes start-retrieval, run-metric and read-only definitions without recall-metrics", async () => {
  await withAssistantPackage((_request, res) => reply(res, 200, { items: [] }), async ({ requests, base, script }) => {
    for (const command of [["recall-metrics", "Sales?"], ["metrics", "Sales?"], ["agent", "list"], ["retriever-cancel", "x", "--run", "y"], ["execute-dsl", "@q.json"]]) {
      await assert.rejects(run(process.execPath, [script, ...command], { env: { ...process.env, ONTOMATO_ONTOLOGY_URL: base } }),
        (error) => /Commands: dataset-desc, classes, schema, relationships, knowledge, start-retrieval, run-metric/u.test(error.stderr));
    }
    assert.deepEqual(requests, []);
  });
});
