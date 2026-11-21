import {
  runtimeEnvironmentSchema,
  runtimeIdentityEnvironment,
  runtimeRegisteredSkillSchema,
  type RuntimeSkillVersion,
} from "@ontomato/contracts/agent-runtime-skills";
import { removeWorkerFiles } from "../worker";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createServer, type Server } from "node:http";
import { spawn, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtemp, mkdir } from "node:fs/promises";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { runtimeRunSnapshotSchema } from "@ontomato/contracts/agent-runtime";
import { runtimeSessionRunFrameSchema, type RuntimeSessionRunFrame } from "@ontomato/contracts/agent-runtime-events";
import { codeExecutionSchema, codeLimitsSchema, codeExecutionVirtualAddressSpaceBytes } from "@ontomato/contracts/agent-runtime-code";
const database = process.env.RUNTIME_TEST_DATABASE_URL;
const repo = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../..",
);
const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));
// Moved out of the daily suite: it needs PostgreSQL and spawns real processes. A
// missing database fails here instead of turning the file green without running.
if (!database)
  throw new Error("Set RUNTIME_TEST_DATABASE_URL to a disposable PostgreSQL database");
describe("standard runtime real HTTP/PG/processes", () => {
  let fake: Server,
    child: ChildProcess,
    url = "",
    base = "",
    root = "",
    logs = "",
    modelCalls = 0,
    hold = false;
  const mcpCalls: string[] = [];
  const prepareCalls: any[] = [];
  const schema = "standard_" + randomUUID().replaceAll("-", ""),
    token = "fixture-host",
    inputs: any[] = [];
  const headers = {
    authorization: `Bearer ${token}`,
    "x-domain-id": "domain-a",
    "x-correlation-id": "fixture",
    "content-type": "application/json",
  };
  const skill = {
    namespace: { kind: "provider", provider: "workbench" },
    name: "fixture-skill",
  };
  const skillBody = "Read scripts/run.mjs and execute it with bash.";
  let skillVersion: RuntimeSkillVersion;
  async function api(
    route: string,
    body?: unknown,
    extra: Record<string, string> = {},
    method = body === undefined ? "GET" : "POST",
  ) {
    const r = await fetch(url + route, {
      method,
      headers: { ...headers, ...extra },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: r.status, body: r.status === 204 ? null : await r.json() };
  }
  const input = (text: string, externalMcp: {id: string}[] = [], toolCallPolicy?: {maxCalls: number; maxSameShape: number}) => ({
    language: "en",
    input: { role: "user", content: text, timestamp: Date.now() },
    definition: {
      systemPrompt: "Use standard skills",
      modelId: null,
      skills: [skillVersion],
      externalMcp,
      ...(toolCallPolicy ? { toolCallPolicy } : {}),
      sandbox: {
        limits: codeLimitsSchema.parse({
          memoryBytes: codeExecutionVirtualAddressSpaceBytes,
          wallTimeMs: 15000,
        }),
      },
      compaction: {
        systemPrompt: "COMPACT",
        summarizePrompt: "Summary",
        updatePrompt: "Update",
      },
    },
    environment: {
      values: { FIXTURE_URL: base },
      secrets: { ONTOMATO_TK: "fixture-tk" },
    },
  });
  async function startProcess() {
    logs = "";
    child = spawn(
      process.execPath,
      [
        "--import",
        createRequire(import.meta.url).resolve("tsx"),
        path.join(repo, "apps/agent-runtime/src/index.ts"),
      ],
      {
        cwd: repo,
        env: {
          ...process.env,
          NODE_ENV: "test",
          HTTP_PROXY: "",
          HTTPS_PROXY: "",
          ALL_PROXY: "",
          NO_PROXY: "127.0.0.1,localhost",
          AGENT_RUNTIME_DATABASE_URL: database!,
          AGENT_RUNTIME_SCHEMA: schema,
          AGENT_RUNTIME_ROOT: root,
          ONTOMATO_MODEL_RUNTIME_TOKEN: "fixture-runtime-token",
          AGENT_RUNTIME_PORT: "0",
          AGENT_RUNTIME_EVENT_BUFFER_SIZE: "4",
          AGENT_RUNTIME_HOSTS: JSON.stringify([
            {
              id: "a",
              token,
              providers: ["workbench"],
              publishProviders: ["workbench"],
            },
            { id: "b", token: "other-host", providers: ["workbench"] },
          ]),
          AGENT_CHANNEL_PROVIDERS: JSON.stringify([
            { id: "workbench", hostId: "a", url: base, token },
          ]),
        },
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(logs)), 15000);
      child.stderr!.on("data", (x) => (logs += x));
      child.stdout!.on("data", (x) => {
        logs += x;
        const m = logs.match(/Agent runtime listening on (\{[^\n]+\})/);
        if (m) {
          url = `http://127.0.0.1:${JSON.parse(m[1].replaceAll('\\"', '"')).port}`;
          clearTimeout(timer);
          resolve();
        }
      });
      child.once("exit", () => {
        clearTimeout(timer);
        reject(new Error(logs));
      });
    });
  }
  async function stop(signal: "SIGTERM" | "SIGKILL" = "SIGTERM") {
    if (child && child.exitCode === null && child.signalCode === null) {
      const end = new Promise<void>((r) => child.once("exit", () => r()));
      child.kill(signal);
      await end;
    }
  }
  async function settle(id: string) {
    const waited = await api(`/v1/runs/${id}/status?waitFor=stopped&timeoutMs=20000`);
    if (waited.body.run?.status !== "stopped") throw new Error("Did not stop: " + logs);
    return runtimeRunSnapshotSchema.parse((await api(`/v1/runs/${id}`)).body);
  }
  async function session() {
    const id = randomUUID();
    expect(
      (await api("/v1/sessions", {}, { "idempotency-key": id })).status,
    ).toBe(201);
    return id;
  }
  async function run(s: string, text: string, externalMcp: {id: string}[] = [], toolCallPolicy?: {maxCalls: number; maxSameShape: number}) {
    const id = randomUUID(),
      request = input(text, externalMcp, toolCallPolicy);
    expect(
      (await api(`/v1/sessions/${s}/runs`, request, { "idempotency-key": id }))
        .status,
    ).toBe(202);
    return { id, request };
  }
  /** A host-scoped lifecycle stream with ordered frame reads and a queue for quiet checks. */
  async function runEvents(extra: Record<string, string> = {}) {
    const controller = new AbortController();
    const response = await fetch(url + "/v1/sessions/run-events", {
      headers: { ...headers, ...extra },
      signal: controller.signal,
    });
    if (response.status !== 200)
      throw new Error(
        `run-events ${response.status}: ${await response.text()}`,
      );
    const frames: RuntimeSessionRunFrame[] = [],
      waiters: Array<(frame: RuntimeSessionRunFrame) => void> = [];
    const reader = response.body!.getReader(), decoder = new TextDecoder();
    let buffer = "";
    const ended = (async () => {
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          let newline: number;
          while ((newline = buffer.indexOf("\n")) >= 0) {
            const line = buffer.slice(0, newline).trimEnd();
            buffer = buffer.slice(newline + 1);
            if (!line.startsWith("data: ")) continue;
            const frame = runtimeSessionRunFrameSchema.parse(
              JSON.parse(line.slice(6)),
            );
            const waiter = waiters.shift();
            if (waiter) waiter(frame);
            else frames.push(frame);
          }
        }
      } catch {
        // Aborting this fixture is how a test closes the connection.
      }
    })();
    return {
      next: () => {
        const frame = frames.shift();
        return frame
          ? Promise.resolve(frame)
          : new Promise<RuntimeSessionRunFrame>((resolve) =>
              waiters.push(resolve),
            );
      },
      pending: () => [...frames],
      ended,
      close: () => controller.abort(),
    };
  }
  beforeAll(async () => {
    const notes = path.resolve(repo, "../notes");
    await mkdir(notes, { recursive: true });
    root = await mkdtemp(path.join(notes, "runtime-standard-"));
    fake = createServer(async (req, res) => {
      let raw = "";
      for await (const c of req) raw += c;
      if (req.url === "/mcp") {
        if (req.method !== "POST") { res.writeHead(405).end(); return; }
        const rpc = JSON.parse(raw);
        if (rpc.id === undefined) { res.writeHead(202).end(); return; }
        let result: unknown;
        if (rpc.method === "initialize") result = {
          protocolVersion: "2025-03-26", capabilities: { tools: {} }, serverInfo: { name: "fixture", version: "1" },
        };
        if (rpc.method === "tools/list") result = {
          tools: [{ name: rpc.params?.cursor ? "fixture_second" : "fixture_mcp", inputSchema: { type: "object", properties: {} } }],
          ...(rpc.params?.cursor ? {} : { nextCursor: "second" }),
        };
        if (rpc.method === "tools/call") {
          mcpCalls.push(String(req.headers.authorization));
          result = { content: [{ type: "text", text: "MCP fixture called" }] };
        }
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ jsonrpc: "2.0", id: rpc.id, result }));
        return;
      }
      if (req.url === "/list") {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ agents: [{ ref: { providerId: "workbench", agentId: "fixture-agent" }, name: "Fixture Agent", description: "Fixture" }] }));
        return;
      }
      if (req.url === "/prepare") {
        const body = JSON.parse(raw);
        prepareCalls.push(body);
        res.writeHead(200, { "content-type": "application/json" });
        if (body.requestedBy) {
          res.end(JSON.stringify({
            language: body.language,
            input: body.input,
            definition: {
              systemPrompt: "Child",
              modelId: null,
              skills: [],
              externalMcp: [],
              sandbox: { limits: codeLimitsSchema.parse({ memoryBytes: codeExecutionVirtualAddressSpaceBytes, wallTimeMs: 15000 }) },
              compaction: { systemPrompt: "COMPACT", summarizePrompt: "Summary", updatePrompt: "Update" },
            },
            environment: { values: {}, secrets: {} },
          }));
          return;
        }
        res.end(JSON.stringify(input(body.input.content)));
        return;
      }
      if (req.url === "/read") {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ settled: true, status: "completed", summary: "Done", process: { mode: "none" }, results: [], files: [] }));
        return;
      }
      if (req.url === "/settle" || req.url === "/cancel") {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ accepted: true }));
        return;
      }
      if (req.url !== "/v1/chat/completions") {
        res.end("ok");
        return;
      }
      const request = JSON.parse(raw);
      inputs.push(request);
      modelCalls++;
      if (hold) {
        req.on("close", () => res.end());
        return;
      }
      res.writeHead(200, { "content-type": "text/event-stream" });
      const frame = (delta: unknown, finish_reason: unknown = null) =>
        res.write(
          `data: ${JSON.stringify({ id: "fixture", object: "chat.completion.chunk", model: "deepseek-chat", choices: [{ index: 0, delta, finish_reason }] })}\n\n`,
        );
      const last = request.messages.at(-1),
        user = [...request.messages]
          .reverse()
          .find((m: any) => m.role === "user");
      const toolResults = request.messages.filter((m: any) => m.role === "tool").length;
      if (String(user.content).includes("vary") && toolResults < 4) {
        const command = `echo ${["alpha", "beta", "gamma", "delta"][toolResults]}`;
        frame({ role: "assistant", tool_calls: [{ index: 0, id: "vary-" + modelCalls, type: "function", function: { name: "bash", arguments: JSON.stringify({ command }) } }] });
        frame({}, "tool_calls");
      } else if (last.role === "tool" && !String(user.content).includes("loop")) {
        frame({
          role: "assistant",
          reasoning_content: "Checked the actual output.",
        });
        frame({ content: "Result [file](outputs/result.txt)" });
        frame({}, "stop");
      } else if (String(user.content).includes("MCP")) {
        if (request.tools.some((tool: any) => tool.function.name === "fixture_mcp")) {
          frame({ role: "assistant", tool_calls: [{ index: 0, id: "mcp-" + modelCalls, type: "function", function: { name: "fixture_mcp", arguments: "{}" } }] });
          frame({}, "tool_calls");
        } else { frame({ role: "assistant", content: "No external tools" }); frame({}, "stop"); }
      } else {
        const command = String(user.content).includes("overwrite")
          ? "printf changed > outputs/result.txt"
          : String(user.content).includes("hang")
            ? "sleep 60"
            : String(user.content).includes("loop")
              ? `printf ${modelCalls}`
              : String(user.content).includes("channel-script")
                ? "node -e 'import(\"node:fs/promises\").then(async({writeFile})=>{const r=await fetch(process.env.ONTOMATO_AGENT_COMMAND_URL,{method:\"POST\",headers:{\"content-type\":\"application/json\",\"X-Ontomato-Callback-Credential\":process.env.ONTOMATO_AGENT_CALLBACK,\"X-Ontomato-Run-Id\":process.env.ONTOMATO_RUN_ID},body:JSON.stringify({op:\"start\",agent:{providerId:\"workbench\",agentId:\"fixture-agent\"},message:\"Child question\"})});await writeFile(\"outputs/channel-env.json\",JSON.stringify({scenario:process.env.ONTOMATO_SKILL_SCENARIO,url:process.env.ONTOMATO_AGENT_COMMAND_URL,secret:process.env.ONTOMATO_AGENT_CALLBACK,runId:process.env.ONTOMATO_RUN_ID,status:r.status,body:await r.json()}));})'"
            : "node skills/fixture-skill/scripts/run.mjs";
        frame({
          role: "assistant",
          tool_calls: [
            {
              index: 0,
              id: "call-" + modelCalls,
              type: "function",
              function: {
                name: "bash",
                arguments: JSON.stringify({ command }),
              },
            },
          ],
        });
        frame({}, "tool_calls");
      }
      res.end("data: [DONE]\n\n");
    });
    await new Promise<void>((r) => fake.listen(0, "127.0.0.1", r));
    base = `http://127.0.0.1:${(fake.address() as any).port}`;
    await startProcess();
    const saved = await api("/v1/models/settings", {
      providers: { fixture: { api: "openai-completions", baseUrl: base + "/v1", apiKey: "sk-fixture-key-1234",
        models: [{ id: "deepseek-chat", type: "chat", maxTokens: 4096, contextWindow: 16000 }] } },
      defaultModelId: "fixture/deepseek-chat", embeddingModelId: null,
      retry: { provider: { timeoutMs: 300000, maxRetries: 3, maxRetryDelayMs: 60000 } },
    }, {}, "PUT");
    expect(saved.status).toBe(200);

    const published = await api("/v1/skills", {
      skill,
      files: [
        {
          path: "SKILL.md",
          content: "---\nname: fixture-skill\ndescription: Write a fixture file\n---\n" + skillBody + "\n",
        },
        {
          path: "scripts/run.mjs",
          content: "import {writeFile} from 'node:fs/promises'; await writeFile('outputs/result.txt', JSON.stringify({value:0,flag:false,empty:null,env:!!process.env.ONTOMATO_TK})); console.log('done');",
        },
      ],
    });
    expect(published.status).toBe(201);
    const { skill: ref, digest } = runtimeRegisteredSkillSchema.parse(published.body);
    skillVersion = { skill: ref, digest };
  });
  afterAll(async () => {
    await stop();
    fake?.closeAllConnections();
    await new Promise<void>((r) => fake?.close(() => r()));
    const pool = new pg.Pool({ connectionString: database });
    await pool.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    await pool.end();
    await removeWorkerFiles(root);
  });
  it("keeps scoped stable MCP selections across rename, masks edit responses and calls only selected services", async () => {
    const path = "/v1/mcp/services";
    const created = await api(path, { name: "Orders", url: base + "/mcp", headers: { Authorization: "fixture-secret", "X-Remove": "unused" } });
    expect(created.status).toBe(201);
    const service = created.body.service;
    expect(service.headers).toEqual({ authorization: "********", "x-remove": "********" });
    expect((await api(path)).body.services).toEqual([service]);
    expect((await api(path + "/names")).body).toEqual([{ id: service.id, name: "Orders" }]);
    const foreignScopes: Record<string, string>[] = [{ "x-domain-id": "other-domain" }, { authorization: "Bearer other-host" }];
    for (const extra of foreignScopes) {
      expect((await api(path, undefined, extra)).body).toEqual({ services: [] });
      expect((await api(`${path}/${service.id}/tools`, undefined, extra)).status).toBe(404);
    }
    const foreign = await api(path, { name: "Orders", url: base + "/mcp" }, { authorization: "Bearer other-host" });
    expect(foreign.status).toBe(201);
    expect(foreign.body.service.id).not.toBe(service.id);
    const renamed = await api(`${path}/${service.id}`, { name: "Orders renamed", url: base + "/mcp", headers: { authorization: null } }, {}, "PUT");
    expect(renamed.body.service).toEqual({ ...service, name: "Orders renamed", headers: { authorization: "********" } });
    expect((await api(`${path}/${service.id}/tools`)).body.tools.map((t: any) => t.name)).toEqual(["fixture_mcp", "fixture_second"]);
    const selected = [{ id: service.id }, { id: foreign.body.service.id }, { id: service.id }];
    const first = await run(await session(), "MCP selected", selected);
    expect((await settle(first.id)).run.stopReason, logs).toBe("stop");
    expect(mcpCalls).toEqual(["fixture-secret"]);
    expect(inputs.find((i) => i.tools?.some((t: any) => t.function.name === "fixture_mcp"))?.tools.map((t: any) => t.function.name)).toContain("fixture_second");
    const none = await run(await session(), "MCP unselected");
    expect((await settle(none.id)).run.stopReason).toBe("stop");
    expect(mcpCalls).toHaveLength(1);
    await api(`${path}/${service.id}`, { name: "Orders renamed", url: base + "/mcp", headers: { authorization: "rotated-secret" } }, {}, "PUT");
    const next = await run(await session(), "MCP next run", selected);
    expect((await settle(next.id)).run.stopReason).toBe("stop");
    expect(mcpCalls).toEqual(["fixture-secret", "rotated-secret"]);
    const snapshot = (await api(`/v1/runs/${first.id}`)).body;
    expect(JSON.stringify(snapshot)).not.toContain("fixture-secret");
    expect((await api(`/v1/sessions/${snapshot.run.sessionId}/runs`, first.request, { "idempotency-key": first.id })).body.replayed).toBe(true);
    expect(mcpCalls).toHaveLength(2);
    expect((await api(`${path}/${service.id}`, undefined, {}, "DELETE")).status).toBe(204);
    const replacement = await api(path, { name: "Orders renamed", url: base + "/mcp" });
    expect(replacement.body.service.id).not.toBe(service.id);
    const stale = await run(await session(), "MCP deleted selection", selected);
    expect((await settle(stale.id)).run.stopReason).toBe("stop");
    expect(mcpCalls).toHaveLength(2);
  });
  it("runs the ordinary skill via PI bash, preserves reasoning_content and immutable files", async () => {
    const replacement = await api("/v1/skills", {
      skill,
      files: [{ path: "SKILL.md", content: "---\nname: fixture-skill\ndescription: A different package\n---\n" }],
    });
    expect(replacement.status).toBe(201);
    const s = await session(),
      first = await run(s, "create"),
      done = await settle(first.id);
    expect(done.run.stopReason, logs).toBe("stop");
    expect(done.run.resolvedSkills[0].digest).toBe(skillVersion.digest);
    const changed = { ...first.request, definition: {
      ...first.request.definition,
      skills: [{ skill: skillVersion.skill, digest: replacement.body.digest }],
    }};
    expect((await api(`/v1/sessions/${s}/runs`, changed, { "idempotency-key": first.id })).status).toBe(409);
    const reply = await api(`/v1/runs/${first.id}/final-reply`);
    expect(reply.status).toBe(200);
    // The answer is the run's last assistant message, named by the run and its agent_end.
    const answer = done.messages.filter(({ message }) => message.role === "assistant").at(-1)!;
    expect(done.run.answerMessageId).toBe(answer.id);
    expect(reply.body).toEqual(answer.message);
    expect(done.artifacts).toHaveLength(1);
    expect(
      done.messages.some(
        (m) =>
          m.message.role === "assistant" &&
          m.message.content.some(
            (c) =>
              c.type === "thinking" && c.thinking.includes("actual output"),
          ),
      ),
    ).toBe(true);
    const a = done.artifacts[0],
      raw = await fetch(url + `/v1/artifacts/${a.id}/content`, { headers });
    expect(await raw.json()).toEqual({
      value: 0,
      flag: false,
      empty: null,
      env: true,
    });
    const second = await run(s, "overwrite");
    const next = await settle(second.id);
    expect(next.run.stopReason).toBe("stop");
    expect(next.artifacts[0].sha256).not.toBe(a.sha256);
    expect(
      await (
        await fetch(url + `/v1/artifacts/${a.id}/content`, { headers })
      ).json(),
    ).toEqual({ value: 0, flag: false, empty: null, env: true });
    expect(
      (await api(`/v1/runs/${first.id}/artifacts?path=outputs/result.txt`)).body
        .artifacts[0].id,
    ).toBe(a.id);
    const prompt = JSON.stringify(inputs[0]);
    expect(prompt).toContain("fixture-skill");
    expect(prompt).not.toContain(skillBody);
  });
  it("tells a waiting host when the run stops, and only then", async () => {
    const s = await session(),
      r = await run(s, "hang");
    const started = Date.now();
    const early = await api(`/v1/runs/${r.id}/status?waitFor=stopped&timeoutMs=300`);
    expect(early.body.run.status).toBe("running");
    expect(Date.now() - started).toBeGreaterThanOrEqual(250);
    const waiting = api(`/v1/runs/${r.id}/status?waitFor=stopped&timeoutMs=20000`);
    await pause(200);
    const cancelledAt = Date.now();
    await api(`/v1/runs/${r.id}/cancel`, {});
    const woke = await waiting;
    expect(woke.body.run.status).toBe("stopped");
    expect(woke.body.run.stopReason).toBe("aborted");
    expect(Date.now() - cancelledAt).toBeLessThan(5000);
    expect((await api(`/v1/runs/${r.id}/status`)).body.run.status).toBe("stopped");
  });
  it("announces committed session run starts and stops and stays silent for a rejected admission", async () => {
    const stream = await runEvents();
    try {
      expect(await stream.next()).toEqual({ type: "ready" });
      const s = await session(),
        first = await run(s, "create");
      expect(await stream.next()).toEqual({
        type: "run_started",
        sessionId: s,
        runId: first.id,
      });
      expect((await settle(first.id)).run.stopReason, logs).toBe("stop");
      expect(await stream.next()).toEqual({
        type: "run_stopped",
        sessionId: s,
        runId: first.id,
      });
      // A replayed admission is not a new run and must not announce itself again.
      const replayed = await api(`/v1/sessions/${s}/runs`, first.request, {
        "idempotency-key": first.id,
      });
      expect(replayed.body.replayed).toBe(true);
      await pause(150);
      expect(stream.pending()).toEqual([]);
      const blocked = await run(s, "hang");
      expect(await stream.next()).toEqual({
        type: "run_started",
        sessionId: s,
        runId: blocked.id,
      });
      // The second run is refused before admission, so no start frame may announce it.
      const rejected = await api(`/v1/sessions/${s}/runs`, input("rejected"), {
        "idempotency-key": randomUUID(),
      });
      expect(rejected.status).toBe(409);
      expect(
        (await api(`/v1/runs/${blocked.id}/cancel`, {})).body.run.stopReason,
      ).toBe("aborted");
      expect(await stream.next()).toEqual({
        type: "run_stopped",
        sessionId: s,
        runId: blocked.id,
      });
      await pause(150);
      expect(stream.pending()).toEqual([]);
    } finally {
      stream.close();
    }
  });
  it("returns 410 when submitting a channel run that was cancelled before admission", async () => {
    const sessionId = await session();
    const runId = randomUUID();
    const agent = { providerId: "workbench", agentId: "fixture-agent" };
    const actor = { id: randomUUID(), domainId: "domain-a" };
    const sessionRef = { providerId: agent.providerId, sessionId };
    expect((await api(`/v1/channel/sessions/${sessionId}/bind`, { agent, actor })).status).toBe(200);
    expect((await api(`/v1/sessions/${sessionId}/run-intents/${runId}/cancel`, {})).status).toBe(204);
    const request = {
      channel: {
        agent, actor, authority: { classNames: [], executionKind: "live" },
        requestedBy: null, root: { session: sessionRef, runId },
      },
      language: "en",
      input: { role: "user", content: "Do not admit this run", timestamp: Date.now() },
      credential: { token: "fixture-tk", apiKey: null },
    };
    const submit = () => api(`/v1/channel/sessions/${sessionId}/runs`, request, { "idempotency-key": runId });
    const closed = { status: 410, body: { error: { code: "RESOURCE_DELETED" } } };
    expect(await submit()).toMatchObject(closed);
    expect(await submit()).toMatchObject(closed);
  });

  it("notifies only the host and domain that admitted the run", async () => {
    const own = await runEvents(),
      otherDomain = await runEvents({ "x-domain-id": "domain-b" }),
      otherHost = await runEvents({ authorization: "Bearer other-host" });
    try {
      for (const stream of [own, otherDomain, otherHost])
        expect(await stream.next()).toEqual({ type: "ready" });
      const s = await session(),
        r = await run(s, "create");
      expect(await own.next()).toEqual({
        type: "run_started",
        sessionId: s,
        runId: r.id,
      });
      expect((await settle(r.id)).run.stopReason, logs).toBe("stop");
      expect(await own.next()).toEqual({
        type: "run_stopped",
        sessionId: s,
        runId: r.id,
      });
      await pause(150);
      expect(otherDomain.pending()).toEqual([]);
      expect(otherHost.pending()).toEqual([]);
    } finally {
      own.close();
      otherDomain.close();
      otherHost.close();
    }
  });
  it("answers a new connection with ready and never replays earlier notices", async () => {
    const s = await session(),
      r = await run(s, "create");
    expect((await settle(r.id)).run.stopReason, logs).toBe("stop");
    const stream = await runEvents();
    try {
      expect(await stream.next()).toEqual({ type: "ready" });
      await pause(150);
      expect(stream.pending()).toEqual([]);
    } finally {
      stream.close();
    }
  });
  it("drops lifecycle streams on restart and notifies only changes after the next ready", async () => {
    const before = await session();
    const stream = await runEvents();
    expect(await stream.next()).toEqual({ type: "ready" });
    const first = await run(before, "create");
    expect(await stream.next()).toEqual({
      type: "run_started",
      sessionId: before,
      runId: first.id,
    });
    expect((await settle(first.id)).run.stopReason, logs).toBe("stop");
    expect(await stream.next()).toEqual({
      type: "run_stopped",
      sessionId: before,
      runId: first.id,
    });
    await stop("SIGKILL");
    await stream.ended;
    await startProcess();
    const reconnected = await runEvents();
    try {
      expect(await reconnected.next()).toEqual({ type: "ready" });
      await pause(150);
      expect(reconnected.pending()).toEqual([]);
      const next = await run(before, "overwrite");
      expect(await reconnected.next()).toEqual({
        type: "run_started",
        sessionId: before,
        runId: next.id,
      });
      expect((await settle(next.id)).run.stopReason, logs).toBe("stop");
      expect(await reconnected.next()).toEqual({
        type: "run_stopped",
        sessionId: before,
        runId: next.id,
      });
    } finally {
      reconnected.close();
    }
  }, 20000);
  it("stops a run that repeats the same tool call shape, naming the limit", async () => {
    const s = await session(),
      r = await run(s, "loop", [], { maxCalls: 100, maxSameShape: 3 });
    const done = await settle(r.id);
    expect(done.run.stopReason, logs).toBe("aborted");
    expect(done.run.errorMessage).toContain("3 repeated bash calls");
    expect(done.toolExecutions).toHaveLength(3);
    // Calls whose arguments differ are not the same shape, whatever their number.
    const varied = await settle((await run(await session(), "vary", [], { maxCalls: 100, maxSameShape: 3 })).id);
    expect(varied.run.stopReason, logs).toBe("stop");
    expect(varied.toolExecutions).toHaveLength(4);
  });
  it("does not allow a caller to replace runtime identity variables", () => {
    for (const name of runtimeIdentityEnvironment) {
      expect(
        runtimeEnvironmentSchema.safeParse({
          values: { [name]: "override" },
          secrets: {},
        }).success,
      ).toBe(false);
      expect(
        runtimeEnvironmentSchema.safeParse({
          values: {},
          secrets: { [name]: "override" },
        }).success,
      ).toBe(false);
    }
  });
  it("cancels a real shell tree and recovers killed runtime work as aborted without replay", async () => {
    const s = await session(),
      r = await run(s, "hang");
    await pause(600);
    const cancelled = await api(`/v1/runs/${r.id}/cancel`, {});
    expect(cancelled.body.run.stopReason).toBe("aborted");
    hold = true;
    const pending = await run(s, "unanswered");
    await pause(200);
    const calls = modelCalls;
    await stop("SIGKILL");
    hold = false;
    await startProcess();
    const recovered = await settle(pending.id);
    expect(recovered.run.stopReason).toBe("aborted");
    expect(recovered.run.errorMessage).toContain("restarted");
    expect(modelCalls).toBe(calls);
    const next = await run(s, "overwrite");
    expect((await settle(next.id)).run.stopReason).toBe("stop");
  });
  async function stoppedCodeExecution(id: string) {
    for (let i = 0; i < 200; i++) {
      const result = codeExecutionSchema.parse((await api(`/v1/code-executions/${id}`)).body);
      if (result.status === "stopped") return result;
      await pause(25);
    }
    throw new Error("Code execution did not stop: " + logs);
  }
  it("executes standalone Python and keeps output bytes off PostgreSQL", async () => {
    const id = randomUUID(),
      body = {
        language: "python",
        files: [
          {
            path: "program.py",
            content:
              "import json\nprint(json.dumps({'value':0,'flag':False,'empty':None}))",
          },
        ],
        entry: "program.py",
        arguments: [],
        outputPaths: [],
        libraries: [],
        environment: { values: {}, secrets: {} },
        limits: codeLimitsSchema.parse({}),
      };
    expect(
      (await api("/v1/code-executions", body, { "idempotency-key": id }))
        .status,
    ).toBe(202);
    const result = await stoppedCodeExecution(id);
    expect(result.errorMessage, logs).toBeNull();
    expect(result.exitCode).toBe(0);
    expect(
      result.outputs.some((o) => o.name === "stdout" && o.sha256),
    ).toBe(true);
    expect(
      await (
        await fetch(url + `/v1/code-executions/${id}/outputs/stdout`, {
          headers,
        })
      ).json(),
    ).toEqual({ value: 0, flag: false, empty: null });
    expect(
      (await api("/v1/code-executions", body, { "idempotency-key": id })).body
        .replayed,
    ).toBe(true);
  });
  it("uses the published library version even after a replacement is published", async () => {
    const library = { namespace: { kind: "provider", provider: "workbench" }, name: "fixture-python-library" };
    async function publish(value: string) {
      const response = await api("/v1/skills", {
        skill: library,
        files: [
          { path: "SKILL.md", content: "---\nname: fixture-python-library\ndescription: Fixture Python library\n---\n" },
          { path: "python/pinned.py", content: `VALUE = ${JSON.stringify(value)}\n` },
        ],
      });
      expect(response.status).toBe(201);
      return runtimeRegisteredSkillSchema.parse(response.body).digest;
    }
    const digest = await publish("first version");
    const replacement = await publish("replacement");
    const id = randomUUID();
    const body = {
      language: "python",
      files: [{ path: "program.py", content: "from pinned import VALUE\nprint(VALUE)" }],
      entry: "program.py",
      arguments: [],
      outputPaths: [],
      libraries: [{ skill: library, digest, path: "python" }],
      environment: { values: {}, secrets: {} },
      limits: codeLimitsSchema.parse({}),
    };
    expect((await api("/v1/code-executions", body, { "idempotency-key": id })).status).toBe(202);
    const changed = { ...body, libraries: [{ ...body.libraries[0], digest: replacement }] };
    expect((await api("/v1/code-executions", changed, { "idempotency-key": id })).status).toBe(409);
    expect((await stoppedCodeExecution(id)).exitCode).toBe(0);
    const output = await fetch(url + `/v1/code-executions/${id}/outputs/stdout`, { headers });
    expect(output.status).toBe(200);
    expect(await output.text()).toBe("first version\n");
  });
  it("injects per-run channel credentials into worker bash and rejects late calls with 409 RUN_CLOSED", async () => {
    const sessionId = await session();
    const runId = randomUUID();
    const agent = { providerId: "workbench", agentId: "fixture-agent" };
    const actor = { id: randomUUID(), domainId: "domain-a" };
    const sessionRef = { providerId: agent.providerId, sessionId };
    expect((await api(`/v1/channel/sessions/${sessionId}/bind`, { agent, actor })).status).toBe(200);
    const admitted = await api(`/v1/channel/sessions/${sessionId}/runs`, {
      channel: {
        agent,
        actor,
        authority: { classNames: [], executionKind: "live" },
        requestedBy: null,
        root: { session: sessionRef, runId },
      },
      language: "en",
      input: { role: "user", content: "channel-script", timestamp: Date.now() },
      credential: { token: "fixture-tk", apiKey: null },
    }, { "idempotency-key": runId });
    expect(admitted.status).toBe(202);
    const done = await settle(runId);
    expect(done.run.stopReason, logs).toBe("stop");
    const envArtifact = done.artifacts.find((a) => a.path === "outputs/channel-env.json")!;
    const captured = await (await fetch(url + `/v1/artifacts/${envArtifact.id}/content`, { headers })).json();
    expect(captured.scenario).toBe("platform");
    expect(captured.status).toBe(200);
    expect(captured.body.taskId).toBeTruthy();
    const childPrepare = prepareCalls.find((call) => call.requestedBy?.runId === runId);
    expect(childPrepare?.root).toEqual({ session: sessionRef, runId });
    await settle(captured.body.taskId);
    const late = await fetch(captured.url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "X-Ontomato-Callback-Credential": captured.secret,
        "X-Ontomato-Run-Id": captured.runId,
      },
      body: JSON.stringify({ op: "list" }),
    });
    expect(late.status).toBe(409);
    expect(await late.json()).toMatchObject({ error: { code: "RUN_CLOSED" } });
  });
});
