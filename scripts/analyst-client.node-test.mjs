import assert from "node:assert/strict";
import { createServer } from "node:http";
import { test } from "node:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import os from "node:os";
import path from "node:path";
import { analystCommand } from "../agent-skills/ontomato-analyst/client.mjs";

test("the shared ask uses ontology, preserves continuation and downloads original bytes", async () => {
  const received = [], logs = [], replies = new Map(),
    retrieval = randomUUID(), artifact = randomUUID(), scope = randomUUID();
  const run = randomUUID(), nextRun = randomUUID();
  const state = { status: "stopped", stopReason: "stop", errorMessage: null };
  const paused = { id: retrieval, roundId: run, runtimeSessionId: retrieval, runtimeRunId: run, decisionRevision: 0,
    run: state, cursor: 1, pending: { retriever: false, bindings: false }, deliveries: [
      { cursor: 1, runId: run, source: "retriever", data: { answer: "Which period?", run: state, datasets: [] } },
    ] };
  const done = { ...paused, roundId: nextRun, runtimeRunId: nextRun, decisionRevision: 1, cursor: 2, deliveries: [
    { cursor: 2, runId: nextRun, source: "retriever", data: { answer: "", run: state, datasets: [{ id: artifact, rowCount: 1 }] } },
  ] };
  const bytes = '{"rows":[{"value":null,"zero":0,"valid":false,"large":9007199254740993}]}';
  const server = createServer(async (req, res) => {
    let text = ""; for await (const part of req) text += part;
    const body = text ? JSON.parse(text) : undefined;
    received.push({ url: req.url, body, headers: req.headers });res.setHeader("content-type", "application/json");
    if (req.url === "/ontology/retrievals") res.end(JSON.stringify(paused));
    else if (req.url === `/ontology/retrievals/${retrieval}/answers`) {
      const key = req.headers["idempotency-key"];
      if (replies.has(key)) assert.deepEqual(body, replies.get(key)); else replies.set(key, body);
      res.end(JSON.stringify(done));
    } else if (req.url === `/ontology/retrievals/${retrieval}/datasets/${artifact}`) res.end(JSON.stringify({ id: artifact, payload: JSON.parse(bytes) }));
    else if (req.url === `/ontology/retrievals/${retrieval}/datasets/${artifact}/content`) res.end(bytes);
    else { res.statusCode = 404;res.end(JSON.stringify({ error: { message: "Unexpected request" } })); }
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const directory = await mkdtemp(path.join(os.tmpdir(), "ontology-ask-"));
  const cfg = { ontologyUrl: `http://127.0.0.1:${server.address().port}`, envUrl: "http://unused-workbench.invalid" },
    print = console.log, oldOutput = process.env.ONTOMATO_OUTPUT_DIR, oldScope = process.env.ONTOMATO_RETRIEVAL_CALLER_ID;
  process.env.ONTOMATO_OUTPUT_DIR = path.join(directory, "outputs");process.env.ONTOMATO_RETRIEVAL_CALLER_ID = scope;
  console.log = (...args) => logs.push(args.join(" "));
  try {
    await analystCommand(cfg, ["ask", "--request-id", randomUUID(), "Sales"], { tk: "fixture-user" });
    const reply = { expectedRunId: paused.runtimeRunId, expectedDecisionRevision: 0, message: "Current period" }, key = randomUUID();
    for (let i = 0; i < 2; i++) await analystCommand(cfg, ["ask", "--resume", retrieval, "--request-id", key, "--answers", JSON.stringify(reply)], { tk: "fixture-user" });
    assert.equal(replies.size, 1);
    assert.equal(received.filter(r => r.url.endsWith("/answers")).length, 2);
    assert.ok(received.every(r => r.headers.tk === "fixture-user" && r.headers["x-ontomato-retrieval-caller-id"] === scope));
    assert.equal(await readFile(path.join(directory, "outputs", "retrievals", retrieval, artifact + ".dataset.json"), "utf8"), bytes);
    assert.equal(JSON.parse(logs.at(-1)).files[0].rowCount, 1);
    await assert.rejects(analystCommand(cfg, ["ask", "--resume", retrieval, "--answers", "[]"]), /expectedRunId/);
  } finally {
    console.log = print;
    if (oldOutput === undefined) delete process.env.ONTOMATO_OUTPUT_DIR; else process.env.ONTOMATO_OUTPUT_DIR = oldOutput;
    if (oldScope === undefined) delete process.env.ONTOMATO_RETRIEVAL_CALLER_ID; else process.env.ONTOMATO_RETRIEVAL_CALLER_ID = oldScope;
    server.closeAllConnections();await new Promise(resolve => server.close(resolve));await rm(directory, { recursive: true, force: true });
  }
});

test("standalone skill distributions use the one analyst transport source", async () => {
  const { readFile } = await import("node:fs/promises");
  const source = await readFile(
    new URL("../agent-skills/ontomato-analyst/client.mjs", import.meta.url),
    "utf8",
  );
  const roots = [
    "../agent-skills/ontomato-app-builder/",
    "../agent-skills/ontomato-ontomap-builder/",
  ];
  for (const locale of ["en", "zh"])
    for (const skill of [
      "ontomato-analyst",
      "ontomato-app-builder",
      "ontomato-ontomap-builder",
    ])
      roots.push(`../../ontomato-enterprise/agent-skills/${locale}/${skill}/`);
  for (const root of roots) {
    try {
      assert.equal(
        await readFile(new URL(root + "client.mjs", import.meta.url), "utf8"),
        source,
      );
    } catch (error) {
      if (root.includes("ontomato-enterprise") && error.code === "ENOENT")
        continue;
      throw error;
    }
  }
});
