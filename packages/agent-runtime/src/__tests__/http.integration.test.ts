import {
  runtimeEnvironmentSchema,
  runtimeIdentityEnvironment,
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
import { codeLimitsSchema } from "@ontomato/contracts/agent-runtime-code";
const database = process.env.RUNTIME_TEST_DATABASE_URL;
const repo = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../..",
);
const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));
describe.skipIf(!database)("standard runtime real HTTP/PG/processes", () => {
  let fake: Server,
    child: ChildProcess,
    url = "",
    base = "",
    root = "",
    logs = "",
    modelCalls = 0,
    hold = false;
  const mcpCalls: string[] = [];
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
  const input = (text: string, externalMcp: {id: string}[] = []) => ({
    language: "en",
    input: { role: "user", content: text, timestamp: Date.now() },
    definition: {
      systemPrompt: "Use standard skills",
      modelRole: "coding",
      skills: [skill],
      externalMcp,
      sandbox: {
        limits: codeLimitsSchema.parse({
          memoryBytes: 16 * 1024 ** 3,
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
    for (let i = 0; i < 400; i++) {
      const r = await api(`/v1/runs/${id}`);
      if (r.body.run.status === "stopped")
        return runtimeRunSnapshotSchema.parse(r.body);
      await pause(25);
    }
    throw new Error("Did not stop: " + logs);
  }
  async function session() {
    const id = randomUUID();
    expect(
      (await api("/v1/sessions", {}, { "idempotency-key": id })).status,
    ).toBe(201);
    return id;
  }
  async function run(s: string, text: string, externalMcp: {id: string}[] = []) {
    const id = randomUUID(),
      request = input(text, externalMcp);
    expect(
      (await api(`/v1/sessions/${s}/runs`, request, { "idempotency-key": id }))
        .status,
    ).toBe(202);
    return { id, request };
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
      if (last.role === "tool") {
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
      models: [{ name: "fixture", modelName: "deepseek-chat", baseUrl: base + "/v1",
        apiKeys: ["sk-fixture-key-1234"], maxTokens: 4096, contextWindow: 16000 }],
      agents: { query: null, coding: null, general: null, diagnosis: null, knowledgeGovernance: null },
    }, {}, "PUT");
    expect(saved.status).toBe(200);

    expect(
      (
        await api("/v1/skills", {
          skill,
          files: [
            {
              path: "SKILL.md",
              content:
                "---\nname: fixture-skill\ndescription: Write a fixture file\n---\nRead scripts/run.mjs and execute it with bash.\n",
            },
            {
              path: "scripts/run.mjs",
              content:
                "import {writeFile} from 'node:fs/promises'; await writeFile('outputs/result.txt', JSON.stringify({value:0,flag:false,empty:null,env:!!process.env.ONTOMATO_TK})); console.log('done');",
            },
          ],
        })
      ).status,
    ).toBe(201);
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
    const s = await session(),
      first = await run(s, "create"),
      done = await settle(first.id);
    expect(done.run.stopReason, logs).toBe("stop");
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
    expect(prompt).not.toContain("Read scripts/run.mjs and execute");
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
  // Killing and restarting the runtime is the slowest case here; its own settlement
  // polling budget already exceeds vitest's default, so the limit is explicit.
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
  }, 60000);
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
    let result: any;
    for (let i = 0; i < 200; i++) {
      result = (await api(`/v1/code-executions/${id}`)).body;
      if (result.status === "stopped") break;
      await pause(25);
    }
    expect(result.errorMessage, logs).toBeNull();
    expect(result.exitCode).toBe(0);
    expect(
      result.outputs.some((o: any) => o.name === "stdout" && o.sha256),
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
});
