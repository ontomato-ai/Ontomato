import assert from "node:assert/strict";
import { createServer } from "node:http";
import { test } from "node:test";
import { analystCommand } from "../agent-skills/ontomato-analyst/client.mjs";

test("external ask preserves the reply revision on retries and downloads exact nullable data", async () => {
  const received = [],
    logs = [];
  const paused = {
    id: "retrieval",
    runtimeSessionId: "session",
    runtimeRunId: "run-1",
    decisionRevision: 0,
    phase: "settled",
    datasetArtifactIds: [],
    result: { status: "needs_input", questions: [{ id: "question" }] },
  };
  const done = {
    ...paused,
    runtimeRunId: "run-2",
    decisionRevision: 1,
    datasetArtifactIds: ["dataset"],
    result: { status: "completed" },
  };
  const replies = new Map();
  const server = createServer(async (req, res) => {
    let text = "";
    for await (const part of req) text += part;
    const body = text ? JSON.parse(text) : undefined;
    received.push({ url: req.url, body, headers: req.headers });
    res.setHeader("content-type", "application/json");
    if (req.url === "/api/retrievals") res.end(JSON.stringify(paused));
    else if (req.url === "/api/retrievals/retrieval/answers") {
      const key = req.headers["idempotency-key"];
      if (replies.has(key)) assert.deepEqual(body, replies.get(key));
      else replies.set(key, body);
      res.end(JSON.stringify(done));
    } else if (req.url === "/api/retrievals/retrieval/datasets/dataset")
      res.end(
        JSON.stringify({
          id: "dataset",
          payload: { rows: [{ value: null, zero: 0, valid: false }] },
        }),
      );
    else {
      res.statusCode = 404;
      res.end(JSON.stringify({ error: { message: "Unexpected request" } }));
    }
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const cfg = { envUrl: `http://127.0.0.1:${server.address().port}` },
    print = console.log;
  console.log = (...args) => logs.push(args.join(" "));
  try {
    await analystCommand(cfg, ["ask", "--request-id", "create-1", "Sales"], {
      tk: "fixture-user",
    });
    const answer = {
      expectedRunId: "run-1",
      expectedDecisionRevision: 0,
      answers: [{ questionId: "question", choiceId: "now" }],
    };
    for (let i = 0; i < 2; i++)
      await analystCommand(
        cfg,
        [
          "ask",
          "--resume",
          "retrieval",
          "--request-id",
          "reply-1",
          "--answers",
          JSON.stringify(answer),
        ],
        { tk: "fixture-user" },
      );
    assert.equal(replies.size, 1);
    assert.equal(received.filter((r) => r.url.endsWith("/answers")).length, 2);
    assert.deepEqual(received[0].body, {
      question: "Sales",
      interaction: "resumable",
      userQuotes: [],
      previousDatasetIds: [],
    });
    assert.ok(received.every((r) => r.headers.tk === "fixture-user"));
    assert.deepEqual(JSON.parse(logs.at(-1)).payload.rows, [
      { value: null, zero: 0, valid: false },
    ]);
    await assert.rejects(
      analystCommand(cfg, ["ask", "--resume", "retrieval", "--answers", "[]"]),
      /expectedRunId/,
    );
  } finally {
    console.log = print;
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
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
