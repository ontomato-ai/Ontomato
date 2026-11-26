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
import { ModelGatewayProcess } from "../gateway-process";
import { RuntimeModelSettings } from "../model-settings";
import { AgentRuntime } from "../runtime";
import type { SessionEngineSandboxFactory } from "../session-engines";
import { RuntimeStore } from "../store";

const database = process.env.RUNTIME_TEST_DATABASE_URL;
const binary = process.env.ONTO_TEST_CODEX;
if (!database || !binary) throw new Error("Set RUNTIME_TEST_DATABASE_URL and ONTO_TEST_CODEX for the native Codex test");
const launcher = fileURLToPath(new URL("../adapters/codex/launch.mjs", import.meta.url));
const host = { id: "fixture", token: "fixture-host", providers: [] };
const scope = { hostId: host.id, domainId: "fixture-domain" };

function reply(res: ServerResponse, n: number, model: string) {
  const item = {
    type: "message", id: `msg_${n}`, role: "assistant", status: "completed", phase: "final_answer",
    content: [{ type: "output_text", text: `Answer ${n}`, annotations: [] }],
  };
  const response = { id: `resp_${n}`, object: "response", created_at: 1, model, status: "in_progress", output: [] };
  const event = (type: string, data: object) =>
    res.write(`event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`);
  res.writeHead(200, { "Content-Type": "text/event-stream" });
  event("response.created", { response });
  event("response.output_item.added", { output_index: 0, item: { ...item, status: "in_progress" } });
  event("response.output_text.delta", { output_index: 0, content_index: 0, item_id: item.id, delta: `Answer ${n}` });
  event("response.output_item.done", { output_index: 0, item });
  event("response.completed", { response: {
    ...response, status: "completed", output: [item], usage: {
      input_tokens: 14, output_tokens: 5, total_tokens: 19,
      input_tokens_details: { cached_tokens: 0 }, output_tokens_details: { reasoning_tokens: 0 },
    },
  } });
  res.end();
}

it("uses the runtime session owner, Responses lease across a Codex process restart", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "codex-engine-test-"));
  const schema = "codex_engine_" + randomUUID().replaceAll("-", "");
  const admin = new pg.Pool({ connectionString: database });
  const engineLeases: string[] = [];
  const upstreamAuthorization: (string | undefined)[] = [];
  const modelRequests: { model: string; input: unknown[]; tools?: { name: string }[] }[] = [];
  const logs: string[] = [];
  const upstream = createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const raw = Buffer.concat(chunks).toString();
    if (req.url === "/v1/responses") {
      upstreamAuthorization.push(req.headers.authorization);
      const body = JSON.parse(raw);
      modelRequests.push(body);
      const n = modelRequests.length;
      reply(res, n, body.model);
    } else {
      res.writeHead(404).end();
    }
  });
  upstream.listen(0, "127.0.0.1");
  await once(upstream, "listening");
  const base = `http://127.0.0.1:${(upstream.address() as AddressInfo).port}`;
  const gateway = await ModelGatewayProcess.start("python3");
  const { controlUrl, dataUrl } = gateway.addresses;
  const sandbox: SessionEngineSandboxFactory = async ({ sessionDirectory, callback }) => {
    const workspace = path.join(sessionDirectory, "workspace");
    const state = path.join(sessionDirectory, "native");
    await Promise.all([mkdir(path.join(workspace, "outputs"), { recursive: true }), mkdir(state, { recursive: true })]);
    let stop = async () => {};
    return {
      directories: { workspace, state, skills: [] }, hostWorkspace: workspace, hostState: state,
      gatewayBaseUrl: dataUrl + "/v1", callbackBaseUrl: `http://${callback.host}:${callback.port}`,
      spawn(_command, args, env) {
        engineLeases.push(env.CODEX_GATEWAY_TOKEN);
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
    modelRuntimeToken: "fixture-runtime-token", gateway: new ModelGatewayClient(controlUrl, dataUrl),
    worker: { development: true, python: "python3" }, openEngineSandbox: sandbox,
  });
  const sessionId = randomUUID();
  let runtime = createRuntime();

  async function run(content: string, engine: string) {
    const id = randomUUID();
    const request: RuntimeStartRunRequest = {
      input: { role: "user", content, timestamp: Date.now() }, language: "en",
      definition: {
        engine, systemPrompt: "Answer the user.", modelId: null, skills: [], externalMcp: [],
        sandbox: { limits: codeLimitsSchema.parse({}) }, toolSurface: "product",
      },
    };
    await runtime.start(host, scope, sessionId, id, id, request);
    const stopped = await runtime.runStatus(scope, id, { timeoutMs: 25000, signal: new AbortController().signal });
    expect(stopped.stopReason, [stopped.errorMessage, ...logs].join("\n")).toBe("stop");
    const snapshot = runtimeRunSnapshotSchema.parse(await runtime.snapshot(scope, id));
    expect(snapshot.messages.find(message => message.id === stopped.answerMessageId)?.message.role).toBe("assistant");
    expect(snapshot.messages.filter(message => message.message.role === "user")).toMatchObject([
      { contextSeq: expect.any(Number), message: { content } },
    ]);
    expect(snapshot.usageUpdate?.last.totalTokens).toBe(19);
  }

  try {
    await runtime.initialize();
    await new RuntimeModelSettings(runtime.store, "fixture-runtime-token").save(scope.domainId, {
      connections: { native: { provider: "openai", apiBase: base + "/v1", apiKey: "host-only-upstream-key" } },
      models: { "fixture-model": { type: "chat", connection: "native", model: "gpt-5.5", maxRetries: 0 } },
      defaultModel: "fixture-model", embeddingModel: null,
    });
    await runtime.store.createSession(scope, sessionId);
    await run("First Codex input", "codex");
    const binding = await runtime.store.sessionEngine(scope, sessionId);
    expect(binding).toEqual({ engine: "codex", engineRef: expect.any(String) });
    await runtime.close();
    const revoked = await fetch(dataUrl + "/v1/responses", {
      method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer " + engineLeases[0] },
      body: JSON.stringify({ model: "fixture-model" }),
    });
    expect(revoked.status).toBe(401);
    runtime = createRuntime();
    await runtime.initialize();
    await run("Codex input after restart", "pi");
    expect(await runtime.store.sessionEngine(scope, sessionId)).toEqual(binding);
    expect(modelRequests).toHaveLength(2);
    expect(modelRequests.every(request => request.model === "gpt-5.5")).toBe(true);
    expect(upstreamAuthorization).toEqual(Array.from({ length: 2 }, () => "Bearer host-only-upstream-key"));
    expect(engineLeases).toHaveLength(2);
    expect(engineLeases[1]).not.toBe(engineLeases[0]);
    expect(modelRequests.map(request => (request.tools ?? []).map(tool => tool.name)))
      .toEqual(Array.from({ length: 2 }, () => []));
    expect(JSON.stringify(modelRequests[1].input)).toContain("First Codex input");
    expect(JSON.stringify(modelRequests)).not.toContain("host-only-upstream-key");
  } finally {
    await runtime.close();
    await gateway.stop();
    upstream.closeAllConnections();
    await new Promise<void>(resolve => upstream.close(() => resolve()));
    await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    await admin.end();
    await rm(root, { recursive: true, force: true });
  }
}, 90000);
