import { HarnessRegistry } from "../adapters/registry";
import { piPlugin } from "../adapters/pi";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import type { Duplex } from "node:stream";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { expect, it } from "vitest";
import { codeLimitsSchema } from "@ontomato/contracts/agent-runtime-code";
import { runtimeRunSnapshotSchema, type RuntimeStartRunRequest } from "@ontomato/contracts/agent-runtime";
import { runtimeSessionHistorySchema } from "@ontomato/contracts/session-history";
import { ModelGatewayClient } from "../gateway-client";
import { AgentRuntime } from "../runtime";
import type { SessionEngineSandboxFactory } from "../session-engines";
import { RuntimeStore } from "../store";

const database = process.env.RUNTIME_TEST_DATABASE_URL;
if (!database) throw new Error("Set RUNTIME_TEST_DATABASE_URL to a disposable PostgreSQL database");

const program = fileURLToPath(new URL("../adapters/pi/import.mjs", import.meta.url));
const host = { id: "fixture", token: "host-token", providers: [] };
const scope = { hostId: host.id, domainId: "fixture-domain" };

it("runs real PI through the runtime, relays a skill callback and resumes the same persisted native session", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "session-engine-test-"));
  const schema = "session_engine_" + randomUUID().replaceAll("-", "");
  const admin = new pg.Pool({ connectionString: database });
  const launches: { callback: string; credential: string; workspace: string }[] = [];
  const modelRequests: string[] = [];
  const businessRequests: { path?: string; runId: unknown; credential: unknown; tk: unknown }[] = [];
  const leases = new Set<string>();
  const command = `node -e 'const fs=require("node:fs");fetch(process.env.ONTOMATO_WORKBENCH_URL+"/probe",{method:"POST",headers:{"content-type":"application/json","X-Ontomato-Callback-Credential":process.env.ONTOMATO_EXECUTION_CALLBACK,"X-Ontomato-Run-Id":"forged","tk":"untrusted"},body:"{}"}).then(async r=>{if(!r.ok)throw Error(r.status);fs.writeFileSync("outputs/probe.txt",await r.text())})'`;
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
    } else if (req.url === "/v1/chat/completions" && leases.has(req.headers.authorization?.slice(7) ?? "")) {
      modelRequests.push(raw);
      const { messages } = JSON.parse(raw) as { messages: { role: string; content: unknown }[] };
      const callTool = messages.length > 0 && messages.at(-1)?.role === "user" && !raw.includes("fixture-call");
      res.writeHead(200, { "Content-Type": "text/event-stream" });
      const frame = (delta: unknown, finish_reason: string | null = null) => {
        res.write("data: " + JSON.stringify({ id: "reply", created: 1, object: "chat.completion.chunk",
          choices: [{ index: 0, delta, finish_reason }] }) + "\n\n");
      };
      frame(callTool
        ? { role: "assistant", tool_calls: [{ index: 0, id: "fixture-call", type: "function",
            function: { name: "bash", arguments: JSON.stringify({ command }) } }] }
        : { role: "assistant", content: "The answer" });
      frame({}, callTool ? "tool_calls" : "stop");
      res.end("data: [DONE]\n\n");
    } else if (req.url?.endsWith("/workbench/probe")) {
      businessRequests.push({ path: req.url, runId: req.headers["x-ontomato-run-id"],
        credential: req.headers["x-ontomato-callback-credential"], tk: req.headers.tk });
      res.writeHead(200, { "Content-Type": "text/plain" }).end("Saved by the skill");
    } else {
      res.writeHead(404).end();
    }
  });
  gateway.listen(0, "127.0.0.1");
  await once(gateway, "listening");
  const base = `http://127.0.0.1:${(gateway.address() as AddressInfo).port}`;

  const sandbox: SessionEngineSandboxFactory = async ({ sessionDirectory, callback }) => {
    const workspace = path.join(sessionDirectory, "workspace"), state = path.join(sessionDirectory, "native");
    await Promise.all([mkdir(path.join(workspace, "outputs"), { recursive: true }), mkdir(state, { recursive: true })]);
    let kill: (() => void) | undefined;
    let exited: Promise<number | null> | undefined;
    return {
      directories: { workspace, state, skills: [] }, hostWorkspace: workspace, hostState: state,
      gatewayBaseUrl: base + "/v1", callbackBaseUrl: `http://${callback.host}:${callback.port}`,
      spawn(_command, _args, env) {
        expect(env.ONTOMATO_TK).toBe(env.ONTOMATO_EXECUTION_CALLBACK);
        expect(env).not.toHaveProperty("ONTOMATO_API_KEY");
        expect(env).not.toHaveProperty("ONTOMATO_RUN_ID");
        expect(env.ONTOMATO_EXECUTION_CALLBACK).not.toBe("wbc1.fixture");
        launches.push({ callback: env.ONTOMATO_WORKBENCH_URL!, credential: env.ONTOMATO_EXECUTION_CALLBACK!, workspace });
        const child = spawn(process.execPath, [program], {
          cwd: workspace, env: { PATH: process.env.PATH, TMPDIR: workspace, ...env },
          stdio: ["pipe", "pipe", "pipe", "pipe"],
        });
        kill = () => { child.kill(); };
        exited = new Promise((resolve, reject) => { child.once("error", reject); child.once("close", resolve); });
        return { stdin: child.stdin, stdout: child.stdout, stderr: child.stderr, channel: child.stdio[3] as Duplex, kill, exited };
      },
      async stop() { kill?.(); await exited; },
    };
  };
  const createRuntime = () => new AgentRuntime({
    store: new RuntimeStore(database!, schema), root, hosts: [host],
    modelRuntimeToken: "fixture-runtime-token",
    gateway: new ModelGatewayClient(base, base),
    modelSeed: { modelName: "fixture-model", baseUrl: base + "/v1", apiKey: "fixture-upstream-key" },
    worker: { development: true, python: "python3" },
    engineRegistry: new HarnessRegistry([piPlugin]),
    openEngineSandbox: sandbox,
  });
  const sessionId = randomUUID();
  let runtime = createRuntime();
  async function run(text: string, engine?: string, targetSession = sessionId) {
    const id = randomUUID();
    const request: RuntimeStartRunRequest = {
      input: { role: "user", content: text, timestamp: Date.now() },
      language: "en", environment: { values: {}, secrets: { ONTOMATO_TK: "host-only-credential" } },
      definition: {
        ...(engine ? { engine } : {}), systemPrompt: "Use the fixture tool when requested.",
        modelId: null, skills: [], externalMcp: [], sandbox: { limits: codeLimitsSchema.parse({}) },
      },
      businessCallbacks: { workbench: { baseUrl: `${base}/api/assistant/executions/${id}/workbench`, credential: "wbc1.fixture" } },
    };
    await runtime.start(host, scope, targetSession, id, id, request);
    const stopped = await runtime.runStatus(scope, id, { timeoutMs: 15000, signal: new AbortController().signal });
    expect(stopped.stopReason, stopped.errorMessage ?? "").toBe("stop");
    const snapshot = runtimeRunSnapshotSchema.parse(await runtime.snapshot(scope, id));
    expect(snapshot.messages.find(message => message.id === stopped.answerMessageId)?.message.role).toBe("assistant");
    expect(snapshot.messages.filter(message => message.message.role === "user")).toMatchObject([
      { contextSeq: expect.any(Number), message: { content: text } },
    ]);
    return snapshot;
  }

  try {
    await runtime.initialize();
    await runtime.store.createSession(scope, sessionId);
    const first = await run("First user message");
    const binding = await runtime.store.sessionEngine(scope, sessionId);
    expect(binding).toMatchObject({ engine: "pi", engineRef: expect.any(String) });
    const tool = first.toolExecutions.find(call => call.toolName === "bash");
    expect(tool).toMatchObject({ status: "completed", result: { details: { artifactIds: [first.artifacts[0].id] } } });
    expect(businessRequests).toEqual([{
      path: `/api/assistant/executions/${first.run.id}/workbench/probe`,
      runId: first.run.id, credential: "wbc1.fixture", tk: undefined,
    }]);
    const launched = launches[0];
    const idle = await fetch(launched.callback + "/probe", { headers: { "X-Ontomato-Callback-Credential": launched.credential } });
    expect(idle.status).toBe(409);
    expect(await readFile(path.join(launched.workspace, "outputs", "probe.txt"), "utf8")).toBe("Saved by the skill");

    await run("Second user message", "uninstalled");
    expect(launches).toHaveLength(1);
    expect(modelRequests.at(-1)).toContain("First user message");
    await runtime.close();
    expect(leases.size).toBe(0);
    runtime = createRuntime();
    await runtime.initialize();
    await run("After restart", "uninstalled");
    expect(await runtime.store.sessionEngine(scope, sessionId)).toEqual(binding);
    expect(launches).toHaveLength(2);
    expect(launches[1].credential).not.toBe(launched.credential);
    expect(modelRequests.at(-1)).toContain("Second user message");
    const history = runtimeSessionHistorySchema.parse(await runtime.history(scope, sessionId, {}));
    expect(history.messages.filter(message => message.message.role === "user")).toHaveLength(3);
    await runtime.deleteSession(scope, sessionId);
    expect(leases.size).toBe(0);
    await expect(readFile(path.join(launched.workspace, "outputs", "probe.txt"))).rejects.toMatchObject({ code: "ENOENT" });

    const legacySession = randomUUID(), legacyRun = randomUUID();
    const legacyInput = { role: "user", content: "The original legacy question", timestamp: Date.now() } as const;
    await runtime.store.createSession(scope, legacySession);
    const legacy = await runtime.store.admit(scope, {
      ...first.run, id: legacyRun, sessionId: legacySession, status: "running",
      finishedAt: null, stopReason: null, errorMessage: null, answerMessageId: null,
    }, "legacy-fixture", legacyInput, "pi");
    await runtime.store.append(scope, legacyRun, {
      type: "message_end", messageId: legacy.inputId!, messageSeq: 0, contextSeq: null, message: legacyInput,
    }, true);
    await runtime.store.finish(scope, legacyRun, "aborted", "Legacy run was cancelled");
    const keys = [scope.hostId, scope.domainId];
    await runtime.store.pool.query(
      `UPDATE ${runtime.store.table("sessions")} SET engine=NULL WHERE host_id=$1 AND domain_id=$2 AND id=$3`,
      [...keys, legacySession],
    );
    const oldCompaction = { systemPrompt: "Old system", summarizePrompt: "Old summary", updatePrompt: "Old update" };
    await runtime.store.pool.query(
      `UPDATE ${runtime.store.table("runs")} SET run=jsonb_set(run,'{definition,compaction}',$4) WHERE host_id=$1 AND domain_id=$2 AND id=$3`,
      [...keys, legacyRun, oldCompaction],
    );
    await runtime.store.pool.query(
      `INSERT INTO ${runtime.store.table("compactions")} (host_id,domain_id,session_id,covered_seq,summary) VALUES($1,$2,$3,1,$4)`,
      [...keys, legacySession, "Previously summarized context"],
    );

    const historical = runtimeRunSnapshotSchema.parse(await runtime.snapshot(scope, legacyRun));
    expect(historical.run.definition).not.toHaveProperty("compaction");
    const stored = await runtime.store.pool.query(
      `SELECT run->'definition'->'compaction' AS compaction FROM ${runtime.store.table("runs")} WHERE host_id=$1 AND domain_id=$2 AND id=$3`,
      [...keys, legacyRun],
    );
    expect(stored.rows[0].compaction).toEqual(oldCompaction);
    await run("Continue the legacy thread", "uninstalled", legacySession);
    expect(await runtime.store.sessionEngine(scope, legacySession)).toMatchObject({ engine: "pi", engineRef: expect.any(String) });
    expect(modelRequests.at(-1)).toContain("Previously summarized context");

    const recoverySession = randomUUID(), recoveryRun = randomUUID();
    const input = { role: "user", content: "Unconfirmed opening input", timestamp: Date.now() } as const;
    await runtime.store.createSession(scope, recoverySession);
    await runtime.store.admit(scope, {
      ...first.run, id: recoveryRun, sessionId: recoverySession, status: "running",
      finishedAt: null, stopReason: null, errorMessage: null, answerMessageId: null,
    }, "restart-fixture", input, "pi");
    await runtime.store.append(scope, recoveryRun, {
      type: "tool_execution_start", toolCallId: "unfinished", toolName: "external_tool", args: {},
    });
    await runtime.store.append(scope, recoveryRun, {
      type: "run_detail", detail: { key: "warn", category: "diagnostic", scope: "run", ref: null,
        level: "warning", action: null, text: "An engine warning" },
    });
    const usage = { last: { input: 10, output: 2, cacheRead: 0, cacheWrite: 0, totalTokens: 12 },
      total: null, turn: null, messageId: null };
    await runtime.store.append(scope, recoveryRun, { type: "usage_updated", usage });
    await runtime.store.recover();

    const recovered = runtimeRunSnapshotSchema.parse(await runtime.snapshot(scope, recoveryRun));
    expect(recovered.run).toMatchObject({ stopReason: "aborted", errorMessage: expect.stringContaining("send it again") });
    expect(recovered.messages).toEqual(expect.arrayContaining([
      expect.objectContaining({ contextSeq: null, message: input }),
      expect.objectContaining({ message: expect.objectContaining({ role: "toolResult", outcome: "unknown" }) }),
    ]));
    expect(recovered.toolExecutions).toContainEqual(expect.objectContaining({ toolCallId: "unfinished", status: "unknown" }));
    expect(recovered.details?.[0]?.detail).toMatchObject({ key: "warn" });
    expect(recovered.usageUpdate).toEqual(usage);
    const recoveredHistory = runtimeSessionHistorySchema.parse(await runtime.history(scope, recoverySession, {}));
    expect(recoveredHistory.latestRun?.details).toEqual(recovered.details);
    expect(recoveredHistory.latestRun?.usageUpdate).toEqual(usage);
  } finally {
    await runtime.close();
    gateway.closeAllConnections();
    await new Promise<void>(resolve => gateway.close(() => resolve()));
    await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    await admin.end();
    await rm(root, { recursive: true, force: true });
  }
}, 30000);
