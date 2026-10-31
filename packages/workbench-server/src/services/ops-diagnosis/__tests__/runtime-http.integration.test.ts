import { removeWorkerFiles } from "../../../../../agent-runtime/src/worker";
import { beforeAll, afterAll, describe, expect, it } from "vitest";
import { createServer, type Server } from "node:http";
import { spawn, type ChildProcess } from "node:child_process";
import { createRequire } from "node:module";
import { randomUUID } from "node:crypto";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { DIAGNOSIS_AGENT_ID } from "@ontomato/contracts/ops-diagnosis";
import { agentHostRunSnapshotSchema } from "@ontomato/contracts/agent-host";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
const database = process.env.RUNTIME_TEST_DATABASE_URL;
const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../../../..");
const tsx = createRequire(path.join(repo, "apps/workbench/package.json")).resolve("tsx");
const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe.skipIf(!database)("diagnosis through real host/runtime/PG/skill processes", () => {
  let model: Server, host: ChildProcess, runtime: ChildProcess, root: string, hostUrl = "", runtimeUrl = "", modelUrl = "";
  const schema = `ops_${randomUUID().replaceAll("-", "")}`, children: ChildProcess[] = [];
  const pool = new pg.Pool({ connectionString: database });
  let logs = "", modelCalls = 0;
  async function freePort() { const s = createServer(); await new Promise<void>((r) => s.listen(0, "127.0.0.1", r)); const port = (s.address() as { port: number }).port; await new Promise<void>((r) => s.close(() => r())); return port; }
  async function launch(kind: "host" | "runtime") {
    const port = Number(new URL(kind === "host" ? hostUrl : runtimeUrl).port);
    const child = spawn(process.execPath, ["--import", tsx, kind === "runtime" ? path.join(repo, "apps/agent-runtime/src/index.ts") : path.join(repo, "packages/workbench-server/src/services/ops-diagnosis/__tests__/host-process.ts")], {
      cwd: repo, env: { ...process.env, NODE_ENV: "test", HTTP_PROXY: "", HTTPS_PROXY: "", ALL_PROXY: "", NO_PROXY: "127.0.0.1,localhost",
        DATABASE_URL: database, PG_SCHEMA: schema, OPS_TEST_ROOT: path.join(root, "host"), PORT: String(port), DATA_QUERY_BASE_URL: modelUrl, DATA_QUERY_API_KEY: "", MCP_SERVER_URL: "",
        OBSERVE_TRACE_WORKSPACE_ROOT: path.join(root, "traces"), AGENT_RUNTIME_DATABASE_URL: database, AGENT_RUNTIME_SCHEMA: schema + "_runtime", AGENT_RUNTIME_ROOT: path.join(root, "runtime"),
        ONTOMATO_MODEL_RUNTIME_TOKEN: "fixture-runtime-token", AGENT_RUNTIME_PORT: String(port),
        // The runtime owns conversation model settings: a complete LLM_* seed is the first
        // model library and assigns every role, which is what this fixture needs.
        LLM_BASE_URL: modelUrl + "/v1", LLM_API_KEY: "fixture-key", LLM_MODEL: "deepseek-chat",
        AGENT_RUNTIME_HOSTS: JSON.stringify([{ id: "workbench", token: "ops-runtime-fixture", providers: ["workbench"], publishProviders: ["workbench"] }]),
        AGENT_RUNTIME_URL: runtimeUrl, AGENT_RUNTIME_SERVICE_TOKEN: "ops-runtime-fixture", AGENT_RUNTIME_CALLBACK_URL: hostUrl,
      }, stdio: ["ignore", "pipe", "pipe"],
    });
    children.push(child);
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(logs.slice(-8000))), 20000);
      child.stderr!.on("data", (x) => logs += x);
      child.stdout!.on("data", (x) => { logs += x; if (String(x).includes(kind === "host" ? "OPS_TEST_READY" : "Agent runtime listening on")) { clearTimeout(timer); resolve(); } });
      child.once("exit", (code) => { clearTimeout(timer); reject(new Error(`Exited ${code}: ${logs.slice(-8000)}`)); });
    });
    return child;
  }
  async function stop(child: ChildProcess) { if (child.exitCode !== null) return; await new Promise<void>((resolve) => { child.once("exit", () => resolve()); child.kill("SIGTERM"); }); }
  async function api(route: string, body?: unknown, token = "alice:a", key?: string, method = body === undefined ? "GET" : "POST") {
    const response = await fetch(hostUrl + route, { method, headers: { tk: token, "Content-Type": "application/json", ...(key ? { "Idempotency-Key": key } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
    const text = await response.text(); let value: any; try { value = text ? JSON.parse(text) : null; } catch { value = text; }
    return { status: response.status, body: value };
  }
  async function stopped(session: string, run: string) {
    for (let i = 0; i < 150; i++) { const value = await api(`/api/observe/agent/sessions/${session}/runs/${run}`); if (value.body.run?.status === "stopped") return agentHostRunSnapshotSchema.parse(value.body); await pause(100); }
    throw new Error(logs.slice(-6000));
  }
  beforeAll(async () => {
    root = await mkdtemp(path.join(os.tmpdir(), "ops-diagnosis-test-"));
    model = createServer(async (req, res) => {
      let raw = ""; for await (const c of req) raw += c;
      if (req.url === "/v1/chat/completions") {
        modelCalls++; const input = JSON.parse(raw), last = input.messages.at(-1);
        res.writeHead(200, { "Content-Type": "text/event-stream" });
        const frame = (delta: unknown, finish_reason: unknown = null) => res.write(`data: ${JSON.stringify({ id: "fixture", object: "chat.completion.chunk", model: "deepseek-chat", choices: [{ index: 0, delta, finish_reason }] })}\n\n`);
        if (last.role === "tool") { frame({ role: "assistant", content: "Read service evidence; no remediation was executed." }); frame({}, "stop"); }
        else {
          const user = [...input.messages].reverse().find((m: any) => m.role === "user");
          const command = String(user?.content).includes("hold") ? "sleep 30" : `node skills/ops-diagnosis/scripts/ops.mjs logs '{"service":"workbench","limit":2}'`;
          frame({ role: "assistant", tool_calls: [{ index: 0, id: "call-" + modelCalls, type: "function", function: { name: "bash", arguments: JSON.stringify({ command }) } }] }); frame({}, "tool_calls");
        }
        res.end("data: [DONE]\n\n"); return;
      }
      res.writeHead(404, { "Content-Type": "application/json" }); res.end(JSON.stringify({ error: { code: "NOT_FOUND", message: "Fixture evidence unavailable" } }));
    });
    await new Promise<void>((r) => model.listen(0, "127.0.0.1", r)); modelUrl = `http://127.0.0.1:${(model.address() as { port: number }).port}`;
    runtimeUrl = `http://127.0.0.1:${await freePort()}`; hostUrl = `http://127.0.0.1:${await freePort()}`;
    runtime = await launch("runtime"); host = await launch("host");
  }, 60000);
  afterAll(async () => {
    for (const child of children.reverse()) await stop(child);
    if (model) { model.closeAllConnections(); await new Promise<void>((r) => model.close(() => r())); }
    await pool.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE; DROP SCHEMA IF EXISTS "${schema}_runtime" CASCADE`); await pool.end();
    if (root) await removeWorkerFiles(root);
  }, 30000);
  it("keeps sessions private, recovers matching admissions, runs the portable skill and rejects foreign IDs", async () => {
    const session = randomUUID(), run = randomUUID();
    expect((await api("/api/observe/agent/sessions", { agentId: DIAGNOSIS_AGENT_ID }, "alice:a", session)).status).toBe(201);
    expect((await api(`/api/observe/agent/sessions/${session}`, undefined, "bob:a")).status).toBe(404);
    expect((await api(`/api/observe/agent/sessions/${session}`, undefined, "alice:b")).status).toBe(404);
    expect((await api("/api/observe/agent/agents", undefined, "denied:a")).status).toBe(403);
    const started = await api(`/api/observe/agent/sessions/${session}/runs`, { message: "inspect logs" }, "alice:a", run); expect(started.status, JSON.stringify(started.body) + logs.split("\n").filter((line) => line.includes("ERROR")).join("\n").slice(-6000)).toBe(202);
    const final = await stopped(session, run); expect(final.run.stopReason, final.run.errorMessage ?? "").toBe("stop");
    const toolText = final.messages.filter((m) => m.message.role === "toolResult").map((m) => JSON.stringify(m.message.content)).join("\n");
    expect(toolText).toContain("workbench");
    expect(toolText).not.toContain("UNAUTHENTICATED");
    expect(final.messages.some((m) => m.message.role === "system")).toBe(false);
    expect(JSON.stringify(final)).not.toContain("ops-runtime-fixture"); expect(final.run.resolvedSkills.map((s) => s.skill.name)).toContain("ops-diagnosis");
    expect((await api(`/api/observe/agent/sessions/${session}/runs`, { message: "changed" }, "alice:a", run)).status).toBe(409);
    const count = modelCalls; await stop(host); host = await launch("host");
    expect((await api(`/api/observe/agent/sessions/${session}/runs`, { message: "inspect logs" }, "alice:a", run)).body.replayed).toBe(true); expect(modelCalls).toBe(count);
    const other = randomUUID(); await api("/api/observe/agent/sessions", { agentId: DIAGNOSIS_AGENT_ID }, "alice:a", other);
    expect((await api(`/api/observe/agent/sessions/${other}/runs/${run}/cancel`, {}, "alice:a")).status).toBe(404);
    // A second surface cannot claim this diagnosis UUID even with the same domain.
    const agents = await api("/api/assistant/agents");
    expect((await api("/api/assistant/sessions", { agentId: agents.body.agents[0].id }, "bob:a", session)).status).toBe(409);
    expect((await api(`/api/observe/evidence/runtime/workbench/sessions/${session}`, undefined, "bob:a")).status).toBe(404);
  }, 60000);
  it("closes pending admissions and cancels running work without a host loop", async () => {
    const session = randomUUID(), run = randomUUID(); await api("/api/observe/agent/sessions", { agentId: DIAGNOSIS_AGENT_ID }, "alice:a", session);
    expect((await api(`/api/observe/agent/sessions/${session}/runs/${run}/cancel`, {})).status).toBe(200);
    expect((await api(`/api/observe/agent/sessions/${session}/runs`, { message: "cancelled intent" }, "alice:a", run)).status).toBe(410);
    const active = randomUUID(); expect((await api(`/api/observe/agent/sessions/${session}/runs`, { message: "hold" }, "alice:a", active)).status).toBe(202);
    expect((await api(`/api/observe/agent/sessions/${session}`, undefined, "alice:a", undefined, "DELETE")).status).toBe(409);
    const cancelled = await api(`/api/observe/agent/sessions/${session}/runs/${active}/cancel`, {}); expect(cancelled.body.run.status).toBe("stopped"); expect(cancelled.body.run.stopReason).toBe("aborted");
  }, 30000);
  it("keeps MCP send/poll shapes and permits no extra tool", async () => {
    const client = new Client({ name: "ops-contract", version: "1" });
    try {
      await client.connect(new StreamableHTTPClientTransport(new URL(hostUrl + "/mcp/ops-agent"), { requestInit: { headers: { tk: "alice:a" } } }));
      expect((await client.listTools()).tools.map((t) => t.name)).toEqual(["send"]);
      const reply = await client.callTool({ name: "send", arguments: { message: "inspect MCP" } });
      const data = JSON.parse((reply.content as any[])[0].text); expect(data).toMatchObject({ status: "completed", answer: "Read service evidence; no remediation was executed." });
      const poll = await client.callTool({ name: "send", arguments: { sessionId: data.sessionId } }); expect(JSON.parse((poll.content as any[])[0].text)).toEqual(data);
    } finally { await client.close(); }
  }, 60000);
});
