import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createServer } from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const exec = promisify(execFile);
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

async function withChannelServer(handler, body) {
  const requests = [];
  const server = createServer(async (req, res) => {
    let text = "";
    for await (const chunk of req) text += chunk;
    const request = { method: req.method, url: req.url, headers: req.headers, body: text ? JSON.parse(text) : undefined };
    requests.push(request);
    await handler(request, res);
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const emptyCwd = await mkdtemp(path.join(os.tmpdir(), "skill-cli-"));
  try {
    return await body({ requests, base: `http://127.0.0.1:${server.address().port}`, emptyCwd });
  } finally {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
    await rm(emptyCwd, { recursive: true, force: true });
  }
}

for (const name of ["ontomato-analyst", "ontomato-app-builder", "ontomato-ontomap-builder"]) {
  const cli = path.join(repoRoot, "agent-skills", name, "ontomato.mjs");
  const client = await import(`../agent-skills/${name}/client.mjs`);

  test(`${name}: platform CLI routes agent commands to the current run channel without login or workspace`, async () => {
    const taskId = randomUUID(), runId = randomUUID(), sessionId = randomUUID();
    await withChannelServer((request, res) => {
      res.writeHead(200, { "content-type": "application/json" });
      if (request.body.op === "list") res.end(JSON.stringify({ agents: [{ ref: { providerId: "ontology", agentId: "retriever" }, name: "Retriever", description: "" }] }));
      else if (request.body.op === "read") res.end(JSON.stringify({ taskId, sessionRef: { providerId: "ontology", sessionId }, status: "completed", downloaded: [{ id: taskId, path: `outputs/agents/${taskId}/out.json` }] }));
      else res.end(JSON.stringify({ taskId, status: "cancelled" }));
    }, async ({ requests, base, emptyCwd }) => {
      const commandUrl = `${base}/v1/channel/hosts/workbench/domains/domain-a/runs/${runId}/commands`;
      const env = {
        PATH: process.env.PATH,
        ONTOMATO_SKILL_SCENARIO: "platform",
        ONTOMATO_AGENT_COMMAND_URL: commandUrl,
        ONTOMATO_AGENT_CALLBACK: "run-secret",
        ONTOMATO_RUN_ID: runId,
        ONTOMATO_EXECUTION_CALLBACK: "should-not-be-sent",
        ONTOMATO_TK: "should-not-be-sent",
      };
      const listed = await exec(process.execPath, [cli, "agent", "list", "retriever"], { cwd: emptyCwd, env });
      assert.equal(JSON.parse(listed.stdout).agents[0].ref.agentId, "retriever");

      const readFiles = await exec(process.execPath, [cli, "agent", "read", taskId, "--files"], { cwd: emptyCwd, env });
      assert.equal(JSON.parse(readFiles.stdout).downloaded[0].path, `outputs/agents/${taskId}/out.json`);

      const cancelled = await exec(process.execPath, [cli, "agent", "cancel", taskId], { cwd: emptyCwd, env });
      assert.equal(JSON.parse(cancelled.stdout).status, "cancelled");

      assert.equal(requests.length, 3);
      for (const req of requests) {
        assert.equal(req.url, `/v1/channel/hosts/workbench/domains/domain-a/runs/${runId}/commands`);
        assert.equal(req.headers["x-ontomato-callback-credential"], "run-secret");
        assert.equal(req.headers["x-ontomato-run-id"], runId);
        assert.equal(req.headers.tk, undefined);
        assert.equal(req.headers["x-api-key"], undefined);
      }
      assert.deepEqual(requests[0].body, { op: "list", query: "retriever" });
      assert.deepEqual(requests[1].body, { op: "read", taskId, files: true });
      assert.deepEqual(requests[2].body, { op: "cancel", taskId });

      await assert.rejects(
        exec(process.execPath, [cli, "agent", "read", taskId, "--follow"], { cwd: emptyCwd, env }),
        (error) => /交付或提问会通知本会话/.test(error.stderr),
      );
      await assert.rejects(
        exec(process.execPath, [cli, "agent", "list"], {
          cwd: emptyCwd,
          env: { PATH: process.env.PATH, ONTOMATO_SKILL_SCENARIO: "platform", ONTOMATO_RUN_ID: runId },
        }),
        (error) => /ONTOMATO_AGENT_COMMAND_URL/.test(error.stderr),
      );
      assert.equal(requests.length, 3);
    });
  });

  test(`${name}: standalone distribution retains the external agent protocol`, async (t) => {
    const previous = process.env.ONTOMATO_SKILL_SCENARIO;
    delete process.env.ONTOMATO_SKILL_SCENARIO;
    t.after(() => {
      if (previous !== undefined) process.env.ONTOMATO_SKILL_SCENARIO = previous;
    });
    const fetch = t.mock.method(globalThis, "fetch", async () => Response.json({ agents: [] }));
    t.mock.method(console, "log", () => {});
    await client.agentChannelCommand({ ontologyUrl: "http://ontology.test" }, ["list"], { tk: "external-credential" });
    assert.equal(fetch.mock.calls[0].arguments[0], "http://ontology.test/platform/agent-channel/commands");
    assert.deepEqual(JSON.parse(fetch.mock.calls[0].arguments[1].body), { op: "list" });
  });
}
