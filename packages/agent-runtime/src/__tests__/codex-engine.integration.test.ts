import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { createServer, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import type { Duplex } from "node:stream";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { expect, it } from "vitest";
import { codeLimitsSchema } from "@ontomato/contracts/agent-runtime-code";
import { runtimeRunSnapshotSchema, type RuntimeStartRunRequest } from "@ontomato/contracts/agent-runtime";
import { createCodexPlugin } from "../adapters/codex";
import { HarnessRegistry } from "../adapters/registry";
import { ModelGatewayClient } from "../gateway-client";
import { AgentRuntime } from "../runtime";
import type { SessionEngineSandboxFactory } from "../session-engines";
import { RuntimeStore } from "../store";

const database = process.env.RUNTIME_TEST_DATABASE_URL;
const binary = process.env.ONTO_TEST_CODEX;
if (!database || !binary) throw new Error("Set RUNTIME_TEST_DATABASE_URL and ONTO_TEST_CODEX for the native Codex test");
const launcher = fileURLToPath(new URL("../adapters/codex/launch.mjs", import.meta.url));
const host = { id: "fixture", token: "fixture-host", providers: [] };
const scope = { hostId: host.id, domainId: "fixture-domain" };
const productRoot = "/api/product-assets/fixture/releases/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";

function reply(res: ServerResponse, n: number, model: string, call: string | null) {
  const item = call ? {
    type: "function_call", id: `fc_${n}`, call_id: call, name: "fixture_tool",
    arguments: '{"query":"fixture"}', status: "completed",
  } : {
    type: "message", id: `msg_${n}`, role: "assistant", status: "completed", phase: "final_answer",
    content: [{ type: "output_text", text: `Answer ${n}`, annotations: [] }],
  };
  const response = { id: `resp_${n}`, object: "response", created_at: 1, model, status: "in_progress", output: [] };
  const event = (type: string, data: object) =>
    res.write(`event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`);
  res.writeHead(200, { "Content-Type": "text/event-stream" });
  event("response.created", { response });
  event("response.output_item.added", { output_index: 0, item: { ...item, status: "in_progress" } });
  if (!call) event("response.output_text.delta", { output_index: 0, content_index: 0, item_id: item.id, delta: `Answer ${n}` });
  event("response.output_item.done", { output_index: 0, item });
  event("response.completed", { response: {
    ...response, status: "completed", output: [item], usage: {
      input_tokens: 14, output_tokens: 5, total_tokens: 19,
      input_tokens_details: { cached_tokens: 0 }, output_tokens_details: { reasoning_tokens: 0 },
    },
  } });
  res.end();
}

it("uses the runtime session owner, Responses lease and product tool callback across a Codex process restart", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "codex-engine-test-"));
  const schema = "codex_engine_" + randomUUID().replaceAll("-", "");
  const admin = new pg.Pool({ connectionString: database });
  const leases = new Set<string>();
  const modelRequests: { model: string; input: unknown[]; tools: { name: string }[] }[] = [];
  const toolRequests: { body: unknown; credential: string | string[] | undefined }[] = [];
  const logs: string[] = [];
  const gateway = createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const raw = Buffer.concat(chunks).toString();
    if (req.method === "POST" && req.url === "/leases") {
      const id = randomUUID();
      leases.add(id);
      res.end(JSON.stringify({ id, token: id }));
    } else if (req.method === "DELETE" && req.url?.startsWith("/leases/")) {
      leases.delete(req.url.slice("/leases/".length));
      res.writeHead(204).end();
    } else if (req.url === "/v1/responses" && leases.has(req.headers.authorization?.slice(7) ?? "")) {
      const body = JSON.parse(raw);
      modelRequests.push(body);
      const n = modelRequests.length;
      reply(res, n, body.model, n % 2 === 1 ? `fixture-call-${n}` : null);
    } else if (req.url === productRoot + "/tools/read") {
      toolRequests.push({ body: JSON.parse(raw), credential: req.headers.tk });
      res.writeHead(200, { "Content-Type": "application/json" }).end('{"total":42}');
    } else {
      res.writeHead(404).end();
    }
  });
  gateway.listen(0, "127.0.0.1");
  await once(gateway, "listening");
  const base = `http://127.0.0.1:${(gateway.address() as AddressInfo).port}`;
  const sandbox: SessionEngineSandboxFactory = async ({ sessionDirectory, callback }) => {
    const workspace = path.join(sessionDirectory, "workspace");
    const state = path.join(sessionDirectory, "native");
    await Promise.all([mkdir(path.join(workspace, "outputs"), { recursive: true }), mkdir(state, { recursive: true })]);
    let stop = async () => {};
    return {
      directories: { workspace, state, skills: [] }, hostWorkspace: workspace, hostState: state,
      gatewayBaseUrl: base + "/v1", callbackBaseUrl: `http://${callback.host}:${callback.port}`,
      spawn(_command, args, env) {
        const child = spawn(process.execPath, args, { cwd: workspace,
          env: { PATH: process.env.PATH, TMPDIR: workspace, ...env }, stdio: ["pipe", "pipe", "pipe", "pipe"] });
        child.stderr.setEncoding("utf8").on("data", (data: string) => logs.push(data));
        const exited = new Promise<number | null>((resolve, reject) => {
          child.once("error", reject); child.once("close", resolve);
        });
        stop = async () => { child.kill(); await exited; };
        return { stdin: child.stdin, stdout: child.stdout, stderr: child.stderr, channel: child.stdio[3] as Duplex,
          kill() { child.kill(); }, exited };
      },
      stop() { return stop(); },
    };
  };
  const registry = new HarnessRegistry([createCodexPlugin(binary, launcher)]);
  const createRuntime = () => new AgentRuntime({
    store: new RuntimeStore(database!, schema), root, hosts: [host], engineRegistry: registry,
    modelRuntimeToken: "fixture-runtime-token", gateway: new ModelGatewayClient(base, base),
    modelSeed: { modelName: "fixture-model", baseUrl: base + "/v1", apiKey: "host-only-upstream-key" },
    worker: { development: true, python: "python3" }, channelCommandBaseUrl: base, openEngineSandbox: sandbox,
  });
  const sessionId = randomUUID();
  let runtime = createRuntime();

  async function run(content: string, engine: string) {
    const id = randomUUID();
    const request: RuntimeStartRunRequest = {
      input: { role: "user", content, timestamp: Date.now() }, language: "en", environment: { values: {}, secrets: {} },
      definition: {
        engine, systemPrompt: "Use fixture_tool for the test.", modelId: null, skills: [], externalMcp: [],
        sandbox: { limits: codeLimitsSchema.parse({}) }, toolSurface: "product",
        productTools: [{
          name: "fixture_tool", description: "Read a test count", path: productRoot + "/tools/read",
          inputSchema: { type: "object", properties: { query: { type: "string" } }, required: ["query"], additionalProperties: false },
        }],
        compaction: { systemPrompt: "", summarizePrompt: "", updatePrompt: "" },
      },
      businessCallbacks: { product: { baseUrl: base + productRoot + "/tools", credential: "wbc1.fixture" } },
    };
    await runtime.start(host, scope, sessionId, id, id, request);
    const stopped = await runtime.runStatus(scope, id, { timeoutMs: 25000, signal: new AbortController().signal });
    expect(stopped.stopReason, [stopped.errorMessage, ...logs].join("\n")).toBe("stop");
    const snapshot = runtimeRunSnapshotSchema.parse(await runtime.snapshot(scope, id));
    expect(snapshot.messages.find(message => message.id === stopped.answerMessageId)?.message.role).toBe("assistant");
    expect(snapshot.messages.filter(message => message.message.role === "user")).toMatchObject([
      { contextSeq: expect.any(Number), message: { content } },
    ]);
    expect(snapshot.toolExecutions).toMatchObject([{ toolName: "fixture_tool", status: "completed" }]);
    expect(snapshot.usageUpdate?.last.totalTokens).toBe(19);
  }

  try {
    await runtime.initialize();
    await runtime.store.createSession(scope, sessionId);
    await run("First Codex input", "codex");
    const binding = await runtime.store.sessionEngine(scope, sessionId);
    expect(binding).toEqual({ engine: "codex", engineRef: expect.any(String) });
    await runtime.close();
    expect(leases.size).toBe(0);
    runtime = createRuntime();
    await runtime.initialize();
    await run("Codex input after restart", "pi");
    expect(await runtime.store.sessionEngine(scope, sessionId)).toEqual(binding);
    expect(modelRequests).toHaveLength(4);
    expect(modelRequests.every(request => request.model === "fixture-model")).toBe(true);
    expect(modelRequests.map(request => request.tools.map(tool => tool.name)))
      .toEqual(Array.from({ length: 4 }, () => ["fixture_tool"]));
    expect(JSON.stringify(modelRequests[2].input)).toContain("First Codex input");
    expect(JSON.stringify(modelRequests[2].input)).toContain('fixture-call-1');
    expect(JSON.stringify(modelRequests[2].input)).toContain('42');
    expect(JSON.stringify(modelRequests)).not.toContain("host-only-upstream-key");
    expect(toolRequests).toEqual(Array.from({ length: 2 }, () => ({
      body: { parameters: { query: "fixture" } }, credential: "wbc1.fixture",
    })));
  } finally {
    await runtime.close();
    gateway.closeAllConnections();
    await new Promise<void>(resolve => gateway.close(() => resolve()));
    await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    await admin.end();
    await rm(root, { recursive: true, force: true });
  }
}, 90000);
