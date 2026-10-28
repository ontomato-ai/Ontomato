import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createServer, type Server } from "node:http";
import { spawn, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import pg from "pg";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import {
  runtimeRunSnapshotSchema,
  runtimeSessionStatusesResponseSchema,
} from "@ontomato/contracts/agent-runtime";

const database = process.env.RUNTIME_TEST_DATABASE_URL;
describe.skipIf(!database)("runtime real HTTP and PostgreSQL", () => {
  let fake: Server, child: ChildProcess, url: string, root: string;
  let modelUrl = "",
    logs = "",
    calls = 0,
    sideEffects = 0;
  let tree: { parent: number; child: number } | undefined;
  const modelInputs: string[] = [];
  let releaseFirstModel!: () => void;
  const firstModelReleased = new Promise<void>((resolve) => {
    releaseFirstModel = resolve;
  });
  const schema = `runtime_test_${randomUUID().replaceAll("-", "")}`;
  const hostToken = "fixture-host-service-secret";
  const headers = {
    authorization: `Bearer ${hostToken}`,
    "x-domain-id": "domain-a",
    "x-correlation-id": "fixture-correlation",
    "content-type": "application/json",
  };
  const skill = {
    namespace: { kind: "provider", provider: "workbench" },
    name: "test-tools",
    version: "1",
  };
  const script = `const input=JSON.parse(await new Response(process.stdin).text());
if(input.kind==='context') console.log(JSON.stringify({type:'context_result',systemContext:'Fresh context'}));
else { if(input.arguments.value==='hang'){ const {spawn}=await import('node:child_process'); const grandchild=spawn(process.execPath,['-e',"process.on('SIGTERM',()=>{});process.stdout.write('ready');setInterval(()=>{},1000)"],{stdio:['ignore','pipe','ignore']}); await new Promise(r=>grandchild.stdout.once('data',r)); await fetch(process.env.ONTOMATO_TARGET_URL+'/effect',{method:'POST',body:JSON.stringify({parent:process.pid,child:grandchild.pid})}); setInterval(()=>{},1000); await new Promise(()=>{}); } await fetch(process.env.ONTOMATO_TARGET_URL+'/effect',{method:'POST',headers:{'X-Correlation-Id':process.env.ONTOMATO_CORRELATION_ID}});
console.log(JSON.stringify({type:'progress',text:'working'}));
console.log(JSON.stringify({type:'result',text:'tool result',data:{hostSecretPresent:!!process.env.AGENT_RUNTIME_HOSTS},artifacts:[{content:{type:'test/opaque',payload:{value:input.arguments.value}},references:[]}]})); }`;
  async function api(
    endpoint: string,
    body?: unknown,
    extra: Record<string, string> = {},
  ) {
    const response = await fetch(url + endpoint, {
      method: body === undefined ? "GET" : "POST",
      headers: { ...headers, ...extra },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return {
      status: response.status,
      body: response.status === 204 ? undefined : await response.json(),
    };
  }
  const terminalLogs = () =>
    logs
      .split("\n")
      .filter((line) => line.startsWith("{"))
      .map((line) => JSON.parse(line))
      .filter((entry) => entry.event === "runtime_run_terminal");
  const input = () => ({
    language: "en",
    definition: {
      systemPrompt: "Runtime integration",
      modelRole: "knowledgeGovernance",
      skills: [skill],
      contextSkill: skill,
      builtinTools: { workspaceFiles: false, python: false },
      externalMcp: [],
      compaction: {
        systemPrompt: "Summarize",
        summarizePrompt: "Summarize",
        updatePrompt: "Update summary",
      },
    },
    input: { role: "user", content: "Run test", timestamp: 1 },
    privateContext: {
      modelCredential: { kind: "token", value: "fixture-user-secret" },
      skillBindings: [
        {
          skill,
          targetUrl: modelUrl,
          context: {},
          credential: { kind: "token", value: "fixture-user-secret" },
        },
      ],
    },
  });
  async function start() {
    logs = "";
    child = spawn(
      process.execPath,
      [
        "--import",
        createRequire(import.meta.url).resolve("tsx"),
        path.resolve(
          path.dirname(fileURLToPath(import.meta.url)),
          "../../../../apps/agent-runtime/src/index.ts",
        ),
      ],
      {
        cwd: path.resolve(
          path.dirname(fileURLToPath(import.meta.url)),
          "../../../..",
        ),
        env: {
          ...process.env,
          OBSERVE_BACKEND_NODES: "",
          BACKEND_NODES: "",
          MCP_SERVER_URL: "",
          AGENT_RUNTIME_MCP_SERVERS: "[]",
          DATA_QUERY_API_KEY: "",
          HTTP_PROXY: "",
          HTTPS_PROXY: "",
          ALL_PROXY: "",
          NO_PROXY: "127.0.0.1,localhost",
          AGENT_RUNTIME_DATABASE_URL: "",
          POSTGRES_HOST: new URL(database!).hostname,
          POSTGRES_PORT: new URL(database!).port,
          POSTGRES_USER: decodeURIComponent(new URL(database!).username),
          POSTGRES_PASSWORD: decodeURIComponent(new URL(database!).password),
          AGENT_RUNTIME_DATABASE: new URL(database!).pathname.slice(1),
          AGENT_RUNTIME_SCHEMA: schema,
          AGENT_RUNTIME_ROOT: root,
          AGENT_RUNTIME_MODEL_CONFIG_URL: modelUrl,
          AGENT_RUNTIME_PORT: "0",
          AGENT_RUNTIME_EVENT_BUFFER_SIZE: "8",
          AGENT_RUNTIME_HOSTS: JSON.stringify([
            {
              id: "host-a",
              token: hostToken,
              providers: ["workbench"],
              publishProviders: ["workbench"],
            },
            {
              id: "host-b",
              token: "fixture-other-host",
              providers: ["workbench"],
            },
          ]),
        },
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(
        () => reject(new Error(`Runtime not ready: ${logs}`)),
        15000,
      );
      child.stderr!.on("data", (chunk) => {
        logs += String(chunk);
      });
      child.stdout!.on("data", (chunk) => {
        logs += String(chunk);
        const match = logs.match(/Agent runtime listening on (\{[^\n]+\})/);
        if (match) {
          url = `http://127.0.0.1:${JSON.parse(match[1]!).port}`;
          clearTimeout(timeout);
          resolve();
        }
      });
      child.once("exit", (code) => {
        clearTimeout(timeout);
        reject(new Error(`Runtime exited ${code}: ${logs}`));
      });
    });
  }
  async function stop(signal: "SIGTERM" | "SIGKILL" = "SIGTERM") {
    if (child && child.exitCode === null && child.signalCode === null) {
      const done = new Promise<void>((resolve) =>
        child.once("exit", () => resolve()),
      );
      child.kill(signal);
      await done;
    }
  }
  async function settled(id: string) {
    let result;
    for (let i = 0; i < 200; i++) {
      result = await api(`/v1/runs/${id}`);
      if (result.body.run?.status !== "running") return result;
      await new Promise((r) => setTimeout(r, 30));
    }
    throw new Error(`Run did not settle: ${JSON.stringify(result)} ${logs}`);
  }
  beforeAll(async () => {
    root = await mkdtemp(path.join(tmpdir(), "ontomato-runtime-test-"));
    fake = createServer(async (req, res) => {
      if (req.url === "/businessConfig/getModelSettings") {
        res.setHeader("content-type", "application/json");
        res.end(
          JSON.stringify({
            success: true,
            data: {
              agents: { knowledgeGovernance: { model: "fixture" } },
              models: [
                {
                  name: "fixture",
                  modelName: "fixture-model",
                  baseUrl: `${modelUrl}/v1`,
                  apiKeys: ["fixture-model-secret"],
                  maxTokens: 4000,
                  contextWindow: 16000,
                  timeout: null,
                  maxRetries: null,
                  temperature: null,
                  topP: null,
                  customRequestParameters: null,
                },
              ],
            },
          }),
        );
        return;
      }
      if (req.url === "/effect") {
        sideEffects++;
        let text = "";
        for await (const chunk of req) text += chunk;
        if (text) tree = JSON.parse(text);
        res.end("ok");
        return;
      }
      if (req.url === "/v1/chat/completions") {
        calls++;
        let text = "";
        for await (const chunk of req) text += chunk;
        const request = JSON.parse(text);
        modelInputs.push(text);
        if (JSON.stringify(request.messages).includes("provider-error")) {
          res.writeHead(400, { "content-type": "application/json" });
          res.end(
            JSON.stringify({
              error: {
                message:
                  "fixture-model-secret fixture-user-secret FULL_PROVIDER_PAYLOAD",
              },
            }),
          );
          return;
        }
        res.writeHead(200, { "content-type": "text/event-stream" });
        const frame = (delta: unknown, finish_reason: unknown = null) =>
          res.write(
            `data: ${JSON.stringify({ id: "fixture", object: "chat.completion.chunk", model: "fixture-model", choices: [{ index: 0, delta, finish_reason }] })}\n\n`,
          );
        if (JSON.stringify(request.messages).includes("stream-many")) {
          frame({ role: "assistant" });
          await new Promise((r) => setTimeout(r, 150));
          for (let i = 0; i < 30; i++) {
            frame({ content: "x".repeat(1000) });
            await new Promise((r) => setTimeout(r, 30));
          }
          frame({}, "stop");
          res.end("data: [DONE]\n\n");
          return;
        }
        await firstModelReleased;
        if (request.messages.some((m: { role: string }) => m.role === "tool")) {
          frame({ role: "assistant", content: "Saved result" });
          frame({}, "stop");
        } else {
          frame({
            role: "assistant",
            tool_calls: [
              {
                index: 0,
                id: "call-1",
                type: "function",
                function: {
                  name: "echo",
                  arguments: JSON.stringify({
                    value: JSON.stringify(request.messages).includes("hang")
                      ? "hang"
                      : "one",
                  }),
                },
              },
            ],
          });
          frame({}, "tool_calls");
        }
        res.end("data: [DONE]\n\n");
        return;
      }
      res.writeHead(404);
      res.end();
    });
    await new Promise<void>((resolve) => fake.listen(0, "127.0.0.1", resolve));
    modelUrl = `http://127.0.0.1:${(fake.address() as { port: number }).port}`;
    await start();
  }, 20000);
  afterAll(async () => {
    releaseFirstModel();
    await stop();
    await new Promise<void>((resolve) => fake?.close(() => resolve()));
    if (root) await rm(root, { recursive: true, force: true });
    if (database) {
      const pool = new pg.Pool({ connectionString: database });
      await pool.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      await pool.end();
    }
  }, 20000);
  it("executes a pinned skill through a process, saves opaque artifacts, and never repeats an admission", async () => {
    const pkg = {
      skill,
      files: [
        {
          path: "SKILL.md",
          content:
            "---\nname: test-tools\ndescription: Integration tools\nmetadata:\n  ontomato-runtime-manifest: runtime.json\n---\nUse echo.",
        },
        {
          path: "runtime.json",
          content: JSON.stringify({
            version: "1",
            contextEntry: "run.mjs",
            tools: [
              {
                name: "echo",
                description: "Echo",
                entry: "run.mjs",
                inputSchema: {
                  type: "object",
                  properties: { value: { type: "string" } },
                  required: ["value"],
                },
              },
            ],
          }),
        },
        { path: "run.mjs", content: script },
      ],
    };
    expect((await api("/v1/skills", pkg)).status).toBe(201);
    expect((await api("/v1/skills", pkg)).status).toBe(201);
    expect(
      (
        await api("/v1/skills", {
          ...pkg,
          files: pkg.files.map((f) =>
            f.path === "run.mjs" ? { ...f, content: f.content + "\n" } : f,
          ),
        })
      ).status,
    ).toBe(409);
    const sessionId = randomUUID(),
      runId = randomUUID();
    expect(
      (await api("/v1/sessions", {}, { "idempotency-key": sessionId })).status,
    ).toBe(201);
    const body = input();
    const proxy = createServer(async (req, res) => {
      const chunks: Buffer[] = [];
      for await (const c of req) chunks.push(c);
      const upstream = await fetch(url + req.url, {
        method: "POST",
        headers: { ...headers, "idempotency-key": runId },
        body: Buffer.concat(chunks),
      });
      await upstream.arrayBuffer();
      res.destroy();
    });
    await new Promise<void>((r) => proxy.listen(0, "127.0.0.1", r));
    await expect(
      fetch(
        `http://127.0.0.1:${(proxy.address() as { port: number }).port}/v1/sessions/${sessionId}/runs`,
        { method: "POST", headers, body: JSON.stringify(body) },
      ),
    ).rejects.toThrow();
    await new Promise<void>((r) => proxy.close(() => r()));
    expect(
      (
        await api(`/v1/sessions/${sessionId}/runs`, body, {
          "idempotency-key": runId,
        })
      ).body.replayed,
    ).toBe(true);
    const before = await api(`/v1/runs/${runId}`);
    const live = await fetch(
      `${url}/v1/runs/${runId}/events?afterSeq=${before.body.cursor.seq}&streamId=${before.body.cursor.streamId}`,
      { headers },
    );
    const liveBody = live.text();
    releaseFirstModel();
    const done = await settled(runId);
    expect(done.body.run.status, JSON.stringify(done.body)).toBe("completed");
    const snapshot = runtimeRunSnapshotSchema.parse(done.body);
    const liveFrames = (await liveBody)
      .split("\n")
      .filter((line) => line.startsWith("data: "))
      .map((line) => JSON.parse(line.slice(6)));
    const liveResult = liveFrames.find(
      (frame) =>
        frame.type === "event" &&
        frame.envelope.event.type === "tool_execution_end",
    );
    expect(liveResult.envelope.event.result.details.artifactIds).toEqual(
      snapshot.artifacts.map((artifact) => artifact.id),
    );

    expect(snapshot.artifacts).toHaveLength(1);
    expect(snapshot.artifacts[0]!.content).toEqual({
      type: "test/opaque",
      payload: { value: "one" },
    });
    expect(snapshot.toolExecutions[0]!.result!.details.data).toEqual({
      hostSecretPresent: false,
    });
    expect(
      snapshot.messages.filter((m) => m.message.role === "user"),
    ).toHaveLength(1);
    expect(
      snapshot.messages.find((m) => m.message.role === "toolResult")!.message,
    ).toMatchObject({ details: { artifactIds: [snapshot.artifacts[0]!.id] } });
    expect(
      (await api(`/v1/artifacts/${snapshot.artifacts[0]!.id}`)).body,
    ).toEqual(snapshot.artifacts[0]);
    const foreignHeaders: Record<string, string>[] = [
      { "x-domain-id": "domain-b" },
      { authorization: "Bearer fixture-other-host" },
    ];
    for (const other of foreignHeaders) {
      expect(
        (
          await api(
            `/v1/artifacts/${snapshot.artifacts[0]!.id}`,
            undefined,
            other,
          )
        ).status,
      ).toBe(404);
      expect(
        (await api(`/v1/sessions/${sessionId}`, undefined, other)).status,
      ).toBe(404);
      expect((await api(`/v1/runs/${runId}/cancel`, {}, other)).status).toBe(
        404,
      );
    }
    const count = calls;
    expect(
      (
        await api(`/v1/sessions/${sessionId}/runs`, body, {
          "idempotency-key": runId,
        })
      ).body.replayed,
    ).toBe(true);
    expect(calls).toBe(count);
    expect(sideEffects).toBe(1);
    expect(
      (await api(`/v1/runs/${runId}`, undefined, { "x-domain-id": "domain-b" }))
        .status,
    ).toBe(404);
    expect(
      (
        await api(`/v1/runs/${runId}`, undefined, {
          authorization: "Bearer fixture-other-host",
        })
      ).status,
    ).toBe(404);
    await stop();
    await start();
    expect((await api(`/v1/runs/${runId}`)).body.artifacts).toEqual(
      snapshot.artifacts,
    );
    expect(logs).not.toContain("fixture-user-secret");
  }, 30000);
  it("logs a failed run once using metadata only and returns lightweight scoped statuses", async () => {
    const emptyId = randomUUID(),
      sessionId = randomUUID(),
      runId = randomUUID();
    for (const id of [emptyId, sessionId])
      await api("/v1/sessions", {}, { "idempotency-key": id });
    const body = input();
    body.input.content = "provider-error";
    await api(`/v1/sessions/${sessionId}/runs`, body, {
      "idempotency-key": runId,
    });
    expect((await settled(runId)).body.run.status).toBe("failed");
    const logged = terminalLogs().filter((entry) => entry.runId === runId);
    expect(logged).toEqual([
      {
        level: "error",
        event: "runtime_run_terminal",
        timestamp: expect.any(String),
        runId,
        correlationId: "fixture-correlation",
        status: "failed",
        errorCode: "RUN_FAILED",
      },
    ]);
    for (const secret of [
      hostToken,
      "fixture-user-secret",
      "fixture-model-secret",
      "FULL_PROVIDER_PAYLOAD",
    ])
      expect(logs).not.toContain(secret);
    const statuses = await api("/v1/sessions/status", {
      sessionIds: [sessionId, emptyId],
    });
    expect(statuses.status).toBe(200);
    const response = runtimeSessionStatusesResponseSchema.parse(statuses.body);
    expect(response.sessions.map((item) => item.session.id)).toEqual([
      sessionId,
      emptyId,
    ]);
    expect(response.sessions[0]!.latestRun).toEqual({
      id: runId,
      status: "failed",
      error: { code: "RUN_FAILED" },
    });
    expect(response.sessions[1]!.latestRun).toBeNull();
    expect(JSON.stringify(statuses.body)).not.toMatch(
      /messages|definition|artifacts|FULL_PROVIDER_PAYLOAD/,
    );
    expect((await api("/v1/sessions/status", { sessionIds: [] })).body).toEqual(
      { sessions: [] },
    );
    for (const other of [
      { "x-domain-id": "domain-b" },
      { authorization: "Bearer fixture-other-host" },
    ] as Record<string, string>[])
      expect(
        (await api("/v1/sessions/status", { sessionIds: [sessionId] }, other))
          .status,
      ).toBe(404);
    expect(
      (
        await api("/v1/sessions/status", {
          sessionIds: [sessionId, randomUUID()],
        })
      ).status,
    ).toBe(404);
    expect(
      (await api("/v1/sessions/status", { sessionIds: ["invalid"] })).status,
    ).toBe(400);
  }, 15000);

  it("cancels the whole process tree and recovers unknown outcomes without replay", async () => {
    const begin = async () => {
      const sessionId = randomUUID(),
        runId = randomUUID();
      await api("/v1/sessions", {}, { "idempotency-key": sessionId });
      const body = input();
      body.input.content = "hang";
      tree = undefined;
      await api(`/v1/sessions/${sessionId}/runs`, body, {
        "idempotency-key": runId,
      });
      for (let i = 0; i < 200 && !tree; i++)
        await new Promise((r) => setTimeout(r, 20));
      expect(tree).toBeTruthy();
      const statuses = await api("/v1/sessions/status", {
        sessionIds: [sessionId],
      });
      expect(statuses.body.sessions[0].session.activeRunId).toBe(runId);
      expect(statuses.body.sessions[0].latestRun).toEqual({
        id: runId,
        status: "running",
        error: null,
      });
      return { sessionId, runId, body, tree: tree! };
    };
    const alive = (pid: number) => {
      try {
        process.kill(pid, 0);
        return true;
      } catch {
        return false;
      }
    };
    const cancelled = await begin();
    expect(
      (await api(`/v1/runs/${cancelled.runId}/cancel`, {})).body.run.status,
    ).toBe("cancelled");
    for (
      let i = 0;
      i < 100 && (alive(cancelled.tree.parent) || alive(cancelled.tree.child));
      i++
    )
      await new Promise((r) => setTimeout(r, 20));
    expect(alive(cancelled.tree.parent)).toBe(false);
    expect(alive(cancelled.tree.child)).toBe(false);
    const crashed = await begin(),
      effects = sideEffects;
    await stop("SIGKILL");
    await start();
    const recovered = await api(`/v1/runs/${crashed.runId}`);
    expect(recovered.body.run.status).toBe("interrupted");
    expect(terminalLogs()).toEqual([
      {
        level: "error",
        event: "runtime_run_terminal",
        timestamp: expect.any(String),
        runId: crashed.runId,
        correlationId: "fixture-correlation",
        status: "interrupted",
        errorCode: "RUNTIME_INTERRUPTED",
      },
    ]);
    expect(recovered.body.toolExecutions[0].status).toBe("unknown");
    expect(
      (
        await api(`/v1/sessions/${crashed.sessionId}/runs`, crashed.body, {
          "idempotency-key": crashed.runId,
        })
      ).body.replayed,
    ).toBe(true);
    const next = randomUUID(),
      body = input();
    body.input.content = "Continue with saved facts";
    await api(`/v1/sessions/${crashed.sessionId}/runs`, body, {
      "idempotency-key": next,
    });
    expect((await settled(next)).body.run.status).toBe("completed");
    expect(sideEffects).toBe(effects);
    expect(modelInputs.at(-1)).toContain("outcome is unknown");
    for (
      let i = 0;
      i < 100 && (alive(crashed.tree.parent) || alive(crashed.tree.child));
      i++
    )
      await new Promise((r) => setTimeout(r, 20));
    expect(alive(crashed.tree.parent)).toBe(false);
    expect(alive(crashed.tree.child)).toBe(false);
  }, 30000);

  it("streams linear-size deltas and joins a consistent partial snapshot to its live tail", async () => {
    const sessionId = randomUUID(),
      runId = randomUUID();
    await api("/v1/sessions", {}, { "idempotency-key": sessionId });
    const body = input();
    body.input.content = "stream-many";
    await api(`/v1/sessions/${sessionId}/runs`, body, {
      "idempotency-key": runId,
    });
    let snapshot = await api(`/v1/runs/${runId}`);
    for (let i = 0; i < 100; i++) {
      snapshot = await api(`/v1/runs/${runId}`);
      if (
        snapshot.body.pendingMessages.some(
          (m: any) =>
            m.message.role === "assistant" &&
            m.message.content.some(
              (p: any) => p.type === "text" && p.text.length,
            ),
        )
      )
        break;
      await new Promise((r) => setTimeout(r, 10));
    }
    const cursor = snapshot.body.cursor;
    const oldTail = await fetch(
      `${url}/v1/runs/${runId}/events?afterSeq=0&streamId=${cursor.streamId}`,
      { headers },
    );
    expect(await oldTail.text()).toContain("snapshot_required");
    const response = await fetch(
      `${url}/v1/runs/${runId}/events?afterSeq=${cursor.seq}&streamId=${cursor.streamId}`,
      { headers },
    );
    const frames = (await response.text())
      .split("\n")
      .filter((l) => l.startsWith("data: "))
      .map((l) => JSON.parse(l.slice(6)));
    expect(frames.every((f) => f.type === "event")).toBe(true);
    const updates = frames.filter(
      (f) => f.envelope.event.type === "message_update",
    );
    expect(
      updates.every(
        (f) =>
          !("message" in f.envelope.event) &&
          !("partial" in f.envelope.event.assistantMessageEvent),
      ),
    ).toBe(true);
    const prefix = snapshot.body.pendingMessages
      .flatMap((m: any) =>
        m.message.role === "assistant" ? m.message.content : [],
      )
      .filter((p: any) => p.type === "text")
      .map((p: any) => p.text)
      .join("");
    const tail = updates
      .map((f) => f.envelope.event.assistantMessageEvent)
      .filter((e) => e.type === "text_delta")
      .map((e) => e.delta)
      .join("");
    const done = await settled(runId);
    const final = done.body.messages
      .filter((m: any) => m.message.role === "assistant")
      .at(-1).message.content[0].text;
    expect(prefix + tail).toBe(final);
    expect(final).toHaveLength(30000);
    expect(
      updates.reduce((bytes, f) => bytes + JSON.stringify(f).length, 0),
    ).toBeLessThan(60000);
    const lost = await fetch(
      `${url}/v1/runs/${runId}/events?afterSeq=0&streamId=${cursor.streamId}`,
      { headers },
    );
    expect(await lost.text()).toContain("snapshot_required");
  }, 15000);
  it("executes Python once, keeps null-shaped outputs, scopes receipts and interrupts code without replay", async () => {
    const request = (code: string) => ({
      language: "python",
      files: [{ path: "program.py", content: code }],
      entry: "program.py",
      arguments: [],
      outputPaths: [],
      binding: {
        targetUrl: null,
        credential: { kind: "none" },
        context: {},
        libraries: [],
        limits: { wallTimeMs: 5000 },
      },
    });
    const finish = async (id: string) => {
      for (let attempt = 0; attempt < 200; attempt++) {
        const response = await api(`/v1/code-executions/${id}`);
        if (response.body.status !== "running") return response.body;
        await new Promise((r) => setTimeout(r, 20));
      }
      throw new Error("Code execution did not settle");
    };
    const closedSession = randomUUID(),
      closedRun = randomUUID();
    await api("/v1/sessions", {}, { "idempotency-key": closedSession });
    expect(
      (
        await api(
          `/v1/sessions/${closedSession}/run-intents/${closedRun}/cancel`,
          {},
        )
      ).status,
    ).toBe(204);
    expect(
      (
        await api(`/v1/sessions/${closedSession}/runs`, input(), {
          "idempotency-key": closedRun,
        })
      ).status,
    ).toBe(410);
    const closed = randomUUID();
    expect(
      (await api(`/v1/code-execution-intents/${closed}/cancel`, {})).status,
    ).toBe(204);
    expect(
      (
        await api("/v1/code-executions", request("print('must not run')"), {
          "idempotency-key": closed,
        })
      ).status,
    ).toBe(410);
    const id = randomUUID(),
      before = sideEffects;
    const body = request(
      `import json,urllib.request\nurllib.request.urlopen(urllib.request.Request(${JSON.stringify(modelUrl + "/effect")}, data=b'',method='POST')).read()\nprint(json.dumps({'answer':[{'a':None,'b':False,'c':0}]}))\n`.replaceAll(
        "\\n",
        "\n",
      ),
    );
    expect(
      (await api("/v1/code-executions", body, { "idempotency-key": id }))
        .status,
    ).toBe(202);
    expect(
      (await api("/v1/code-executions", body, { "idempotency-key": id })).body
        .replayed,
    ).toBe(true);
    const done = await finish(id);
    expect(done.status, JSON.stringify(done)).toBe("completed");
    const stdout = await fetch(
      `${url}/v1/code-executions/${id}/outputs/stdout`,
      { headers },
    ).then((r) => r.text());
    expect(JSON.parse(stdout)).toEqual({
      answer: [{ a: null, b: false, c: 0 }],
    });
    expect(sideEffects).toBe(before + 1);
    expect(
      (
        await api(`/v1/code-executions/${id}`, undefined, {
          "x-domain-id": "other-domain",
        })
      ).status,
    ).toBe(404);
    expect(
      (
        await api(`/v1/code-executions/${id}`, undefined, {
          authorization: "Bearer fixture-other-host",
        })
      ).status,
    ).toBe(404);
    expect(
      (await api("/v1/sessions", {}, { "idempotency-key": id })).status,
    ).toBe(409);
    expect(
      (
        await api("/v1/code-executions", request("print('changed')"), {
          "idempotency-key": id,
        })
      ).status,
    ).toBe(409);
    const secretId = randomUUID(),
      secret = request(
        "import os,json,sys\nprint(json.loads(os.environ['ONTOMATO_CREDENTIAL_JSON'])['value'])\nsys.exit(1)",
      );
    secret.binding.credential = {
      kind: "bearer",
      value: "scoped-fixture-secret",
    } as never;
    await api("/v1/code-executions", secret, { "idempotency-key": secretId });
    const rejected = await finish(secretId);
    expect(rejected.status).toBe("failed");
    expect(rejected.error.code).toBe("CODE_SECRET_OUTPUT");
    expect(rejected.outputs).toEqual([]);
    const timeoutId = randomUUID(),
      timeout = request("import time\ntime.sleep(30)");
    timeout.binding.limits.wallTimeMs = 100;
    await api("/v1/code-executions", timeout, { "idempotency-key": timeoutId });
    expect((await finish(timeoutId)).error.code).toBe("CODE_TIMEOUT");
    const code = request(
      `import os,json,subprocess,sys,time,urllib.request\nchild=subprocess.Popen([sys.executable,'-c','import time;time.sleep(300)'])\nbody=json.dumps({'parent':os.getpid(),'child':child.pid}).encode()\nurllib.request.urlopen(urllib.request.Request(${JSON.stringify(modelUrl + "/effect")},data=body,method='POST')).read()\ntime.sleep(300)\n`.replaceAll(
        "\\n",
        "\n",
      ),
    );
    const begin = async () => {
      tree = undefined;
      const key = randomUUID();
      await api("/v1/code-executions", code, { "idempotency-key": key });
      for (let i = 0; i < 200 && !tree; i++)
        await new Promise((r) => setTimeout(r, 20));
      expect(tree).toBeTruthy();
      return { key, pids: [tree!.parent, tree!.child] };
    };
    const alive = (pid: number) => {
      try {
        process.kill(pid, 0);
        return true;
      } catch {
        return false;
      }
    };
    const cancelled = await begin();
    expect(
      (await api(`/v1/code-executions/${cancelled.key}/cancel`, {})).body
        .status,
    ).toBe("cancelled");
    for (let i = 0; i < 100 && cancelled.pids.some(alive); i++)
      await new Promise((r) => setTimeout(r, 20));
    expect(cancelled.pids.some(alive)).toBe(false);
    const crashed = await begin(),
      effects = sideEffects;
    await stop("SIGKILL");
    await start();
    expect((await api(`/v1/code-executions/${crashed.key}`)).body.status).toBe(
      "interrupted",
    );
    expect(
      (
        await api("/v1/code-executions", code, {
          "idempotency-key": crashed.key,
        })
      ).body.replayed,
    ).toBe(true);
    expect(sideEffects).toBe(effects);
    for (let i = 0; i < 100 && crashed.pids.some(alive); i++)
      await new Promise((r) => setTimeout(r, 20));
    expect(crashed.pids.some(alive)).toBe(false);
  }, 20000);
});
