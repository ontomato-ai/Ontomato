import { removeWorkerFiles } from "../../../../../agent-runtime/src/worker";
import { beforeAll, afterAll, describe, expect, it } from "vitest";
import { createServer, type Server } from "node:http";
import { spawn, type ChildProcess } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { randomUUID, createHash } from "node:crypto";
import { mkdtemp, readFile, mkdir, cp } from "node:fs/promises";
import path from "node:path";
import pg from "pg";
import { governanceSessionSchema } from "@ontomato/contracts/knowledge-governance";

const connection = process.env.RUNTIME_TEST_DATABASE_URL;
describe.skipIf(!connection)(
  "governance through independent HTTP processes",
  () => {
    const database = `governance_${randomUUID().replaceAll("-", "")}`;
    let pool: pg.Pool,
      admin: pg.Pool,
      model: Server,
      root: string,
      runtime: ChildProcess,
      host: ChildProcess;
    let runtimeUrl = "",
      hostUrl = "",
      modelUrl = "",
      databaseUrl = "",
      runtimeLog = "",
      hostLog = "",
      compactions = 0;
    const stages = new Map<string, number>(),
      observed: string[] = [],
      contexts: string[] = [];
    let stall = false,
      arrived = 0;
    const releases: Array<() => void> = [];
    let firstModel!: () => void, releaseModel!: () => void;
    const modelArrived = new Promise<void>((resolve) => {
      firstModel = resolve;
    });
    const modelRelease = new Promise<void>((resolve) => {
      releaseModel = resolve;
    });
    const sourceId = createHash("sha256")
      .update("knowledge:k1")
      .digest("hex")
      .slice(0, 20);
    const plan = [
      ["read_knowledge", {}],
      ["read_ontology", {}],
      ["search_history", { query: "Sales" }],
      ["read_history", { threadId: "fixture-history" }],
      ["collect_turn_artifacts", { turnKey: "turn.fixture-history.0" }],
      [
        "read_evidence",
        { turnKey: "turn.fixture-history.0", path: "manifest.json" },
      ],
      ["read_work_record", {}],
      [
        "update_work_record",
        {
          summary: "Reviewed knowledge",
          notes: "Read the saved originals",
          reviewedKnowledgeIds: ["k1"],
          issues: [
            {
              id: "issue-1",
              title: "Review",
              category: "knowledge",
              status: "proposed",
              problem: "Verify meaning",
              before: "Original",
              after: "Suggested meaning",
              basis: "Read original",
              sourceIds: [sourceId],
            },
          ],
        },
      ],
    ] as const;
    const directory = path.dirname(fileURLToPath(import.meta.url)),
      publicRoot = path.resolve(directory, "../../../../../..");
    const tsx = createRequire(
      path.join(publicRoot, "apps/workbench/package.json"),
    ).resolve("tsx");
    async function freePort() {
      const s = createServer();
      await new Promise<void>((r) => s.listen(0, "127.0.0.1", r));
      const port = (s.address() as { port: number }).port;
      await new Promise<void>((r) => s.close(() => r()));
      return port;
    }
    async function launch(kind: "runtime" | "host") {
      const port =
        kind === "runtime"
          ? runtimeUrl
            ? Number(new URL(runtimeUrl).port)
            : await freePort()
          : hostUrl
            ? Number(new URL(hostUrl).port)
            : await freePort();
      if (kind === "runtime") runtimeUrl = `http://127.0.0.1:${port}`;
      else hostUrl = `http://127.0.0.1:${port}`;
      const script =
        kind === "runtime"
          ? path.join(publicRoot, "apps/agent-runtime/src/index.ts")
          : path.join(directory, "host-process.ts");
      const child = spawn(process.execPath, ["--import", tsx, script], {
        cwd: publicRoot,
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
          DATABASE_URL: databaseUrl,
          PG_SCHEMA: "public",
          DATA_QUERY_BASE_URL: modelUrl,
          PORT: String(port),
          GOVERNANCE_TEST_ROOT: path.join(root, "host"),
          OBSERVE_TRACE_WORKSPACE_ROOT: path.join(root, "traces"),
          AGENT_RUNTIME_DATABASE_URL: databaseUrl,
          AGENT_RUNTIME_SCHEMA: "runtime",
          AGENT_RUNTIME_ROOT: path.join(root, "runtime"),
          AGENT_RUNTIME_MODEL_CONFIG_URL: modelUrl,
          AGENT_RUNTIME_PORT: String(port),
          AGENT_RUNTIME_HOSTS: JSON.stringify([
            {
              id: "workbench",
              token: "fixture-host-secret",
              providers: ["workbench"],
              publishProviders: ["workbench"],
            },
          ]),
          AGENT_RUNTIME_URL: runtimeUrl,
          AGENT_RUNTIME_SERVICE_TOKEN: "fixture-host-secret",
          AGENT_RUNTIME_CALLBACK_URL: hostUrl,
        },
        stdio: ["ignore", "pipe", "pipe"],
      });
      if (kind === "runtime") runtime = child;
      else host = child;
      await new Promise<void>((resolve, reject) => {
        let text = "";
        const timer = setTimeout(
          () => reject(new Error(`${kind} startup timed out: ${text}`)),
          20000,
        );
        const consume = (chunk: Buffer) => {
          text += chunk.toString();
          if (kind === "runtime") runtimeLog += chunk.toString();
          else hostLog += chunk.toString();
          if (
            text.includes(
              kind === "runtime"
                ? "Agent runtime listening"
                : "GOVERNANCE_TEST_READY",
            )
          ) {
            clearTimeout(timer);
            resolve();
          }
        };
        child.stdout!.on("data", consume);
        child.stderr!.on("data", consume);
        child.once("exit", (code) => {
          clearTimeout(timer);
          reject(new Error(`${kind} exited ${code}: ${text}`));
        });
      });
    }
    async function stop(
      child: ChildProcess | undefined,
      signal: "SIGTERM" | "SIGKILL" = "SIGTERM",
    ) {
      if (child && child.exitCode === null && child.signalCode === null) {
        const done = new Promise<void>((r) => child.once("exit", () => r()));
        child.kill(signal);
        await done;
      }
    }
    async function request(
      pathname: string,
      body?: unknown,
      headers: Record<string, string> = {},
    ) {
      const r = await fetch(`${hostUrl}/api/knowledge-governance${pathname}`, {
        method: body === undefined ? "GET" : "POST",
        headers: { "content-type": "application/json", ...headers },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      return {
        status: r.status,
        body: r.status === 204 ? null : await r.json(),
      };
    }
    beforeAll(async () => {
      root = await mkdtemp(
        path.join(publicRoot, "../notes", "governance-standard-"),
      );
      admin = new pg.Pool({ connectionString: connection });
      await admin.query(`CREATE DATABASE "${database}"`);
      const url = new URL(connection!);
      url.pathname = `/${database}`;
      databaseUrl = url.toString();
      pool = new pg.Pool({ connectionString: databaseUrl });
      model = createServer(async (req, res) => {
        const reply = (data: unknown) => {
          res.setHeader("content-type", "application/json");
          res.end(JSON.stringify({ success: true, data }));
        };
        if (req.url === "/businessConfig/getModelSettings") {
          reply({
            agents: { knowledgeGovernance: { model: "fixture" } },
            models: [
              {
                name: "fixture",
                modelName: "fixture-model",
                baseUrl: `${modelUrl}/v1`,
                apiKeys: ["fixture-model-secret"],
                maxTokens: 4000,
                contextWindow: 5000,
                timeout: null,
                maxRetries: null,
                temperature: null,
                topP: null,
                customRequestParameters: null,
              },
            ],
          });
          return;
        }
        if (req.url === "/admin/getBussinessKnowledge") {
          observed.push(`knowledge:${req.headers["x-correlation-id"]}`);
          reply([
            {
              knowledgeID: "k1",
              knowledgeTitle: "Sales policy",
              knowledgeText: "Original sales knowledge. ".repeat(200),
            },
          ]);
          return;
        }
        if (req.url === "/admin/getSchema") {
          observed.push(`ontology:${req.headers["x-correlation-id"]}`);
          reply({
            classDefs: [{ name: "Sales", description: "Sales records" }],
            relationshipDefs: {},
            datasetDesc: "Fixture",
          });
          return;
        }
        if (req.url === "/v1/chat/completions") {
          let raw = "";
          for await (const chunk of req) raw += chunk;
          const body = JSON.parse(raw);
          res.writeHead(200, { "content-type": "text/event-stream" });
          const frame = (delta: unknown, reason: unknown = null) =>
            res.write(
              `data: ${JSON.stringify({ id: "fixture", object: "chat.completion.chunk", model: "fixture-model", choices: [{ index: 0, delta, finish_reason: reason }] })}\n\n`,
            );
          if (!body.tools?.length) {
            compactions++;
            frame({
              role: "assistant",
              content:
                "Read the work record for saved sources and progress. Original evidence remains available.",
            });
            frame({}, "stop");
          } else {
            const correlation = String(req.headers["x-correlation-id"]),
              stage = stages.get(correlation) ?? 0;
            stages.set(correlation, stage + 1);
            contexts.push(
              String(
                body.messages.find((m: { role: string }) => m.role === "system")
                  ?.content,
              ),
            );
            if (stage === 0) {
              firstModel();
              await modelRelease;
            }
            if (stall) {
              arrived++;
              await new Promise<void>((resolve) => {
                releases.push(resolve);
                res.once("close", resolve);
              });
              if (res.destroyed) return;
            }
            await new Promise((r) => setTimeout(r, 70));
            const step = plan[stage];
            if (step) {
              observed.push(step[0]);
              frame({
                role: "assistant",
                tool_calls: [
                  {
                    index: 0,
                    id: `call-${stage}`,
                    type: "function",
                    function: {
                      name: "bash",
                      arguments: JSON.stringify({
                        command: `node skills/knowledge-governance/scripts/governance.mjs ${step[0].replaceAll("_", "-")} '${JSON.stringify(step[1]).replaceAll("'", "'\\''")}'`,
                      }),
                    },
                  },
                ],
              });
              frame({}, "tool_calls");
            } else {
              frame({
                role: "assistant",
                content:
                  "Review saved; human confirmation does not change production knowledge.",
              });
              frame({}, "stop");
            }
          }
          res.end("data: [DONE]\n\n");
          return;
        }
        // The fixture turn has no backend query/model session; diagnostics may record empty remote logs.
        reply([]);
      });
      await new Promise<void>((r) => model.listen(0, "127.0.0.1", r));
      modelUrl = `http://127.0.0.1:${(model.address() as { port: number }).port}`;
      await launch("runtime");
      await launch("host");
      await pool.query(
        "INSERT INTO thread_metadata(thread_id,user_id,domain_id,title,last_request_seq) VALUES('fixture-history','another-domain-user','default','Sales question',0)",
      );
      await pool.query(
        "INSERT INTO turn_runs(thread_id,request_seq,status,source,display_message,started_at,ended_at) VALUES('fixture-history',0,'completed','chat','Sales total?',now()-interval '1 minute',now())",
      );
    }, 40000);
    afterAll(async () => {
      releaseModel();
      for (const release of releases) release();
      await stop(host);
      await stop(runtime);
      if (model) await new Promise<void>((r) => model.close(() => r()));
      if (pool) await pool.end();
      if (admin) {
        await admin.query(`DROP DATABASE IF EXISTS "${database}" WITH (FORCE)`);
        await admin.end();
      }
      if (root) await removeWorkerFiles(root);
    }, 20000);
    it("runs all eight tools, restores after host restart and preserves the work through compaction", async () => {
      const started = await request("/", {
        message: "Check current-domain sales knowledge",
      });
      expect(started.status, JSON.stringify(started.body) + hostLog).toBe(201);
      const id = started.body.id,
        runId = started.body.activeTurnId;
      expect(runId).toBeTruthy();
      await modelArrived;
      const runningList = await request("/");
      expect(runningList.status).toBe(200);
      expect(
        runningList.body.find((row: { id: string }) => row.id === id).status,
      ).toBe("running");
      await stop(host, "SIGKILL");
      await launch("host");
      releaseModel();
      let view = started.body;
      for (let i = 0; i < 300; i++) {
        const read = await request(`/${id}`);
        expect(read.status, JSON.stringify(read.body)).toBe(200);
        view = read.body;
        if (view.status !== "running") break;
        await new Promise((r) => setTimeout(r, 40));
      }
      expect(view.status, JSON.stringify(view) + hostLog + runtimeLog).toBe(
        "idle",
      );
      governanceSessionSchema.parse(view);
      const completedList = await request("/");
      expect(completedList.status).toBe(200);
      expect(
        completedList.body.find((row: { id: string }) => row.id === id).status,
      ).toBe("idle");
      expect(
        observed.filter((name) => plan.some(([tool]) => tool === name)),
      ).toEqual(plan.map(([name]) => name));
      expect(view.work.summary).toBe("Reviewed knowledge");
      expect(view.work.reviewedKnowledgeIds).toEqual(["k1"]);
      expect(view.work.issues).toHaveLength(1);
      expect(
        view.work.sources.some((s: { id: string }) => s.id === sourceId),
      ).toBe(true);
      expect(contexts.at(-1)).toContain("knowledge-governance");
      expect(compactions).toBeGreaterThan(0);
      expect(observed.find((s) => s.startsWith("knowledge:"))).not.toBe(
        "knowledge:undefined",
      );
      const source = await request(`/${id}/sources/${sourceId}?offset=0`);
      expect(source.body.page.items[0].text).toContain(
        "Original sales knowledge",
      );
      const historyResults = view.messages
        .flatMap(
          (m: { segments?: Array<{ type: string; isError?: boolean }> }) =>
            m.segments ?? [],
        )
        .filter((s: { type: string }) => s.type === "tool_call");
      expect(historyResults).toHaveLength(8);
      expect(
        historyResults.every((r: { isError?: boolean }) => !r.isError),
        JSON.stringify(historyResults),
      ).toBe(true);
      const manifest = JSON.parse(
        await readFile(
          path.join(root, "traces/turn.fixture-history.0/manifest.json"),
          "utf8",
        ),
      );
      expect(manifest.status).toBe("completed");
      const identity = {
        "X-Ontomato-Session-Id": id,
        "X-Ontomato-Run-Id": runId,
      };
      const late = await request(
        `/${id}/runs/${runId}/actions/update_work_record`,
        { summary: "pollution" },
        identity,
      );
      expect(late.status).toBe(409);
      expect(late.body.code).toBe("GOVERNANCE_RUN_CLOSED");
      expect((await request(`/${id}`)).body.work.summary).toBe(
        "Reviewed knowledge",
      );
      await stop(runtime);
      await launch("runtime");
      expect((await request(`/${id}`)).body.messages).toEqual(view.messages);
      stall = true;
      const next = await request(`/${id}/messages`, {
        message: "Continue review",
      });
      expect(next.status).toBe(200);
      const nextRun = next.body.activeTurnId;
      expect(nextRun).not.toBe(runId);
      expect(
        (
          await request(
            `/${id}/runs/${runId}/actions/update_work_record`,
            { summary: "old run pollution" },
            identity,
          )
        ).status,
      ).toBe(409);
      expect((await request(`/${id}`)).body.work.summary).toBe(
        "Reviewed knowledge",
      );
      for (let i = 0; i < 100 && !arrived; i++)
        await new Promise((r) => setTimeout(r, 20));
      expect(arrived).toBeGreaterThan(0);
      expect((await request(`/${id}/stop`, {})).status).toBe(200);
      expect(
        (
          await request(
            `/${id}/runs/${nextRun}/actions/update_work_record`,
            { summary: "cancelled run pollution" },
            { ...identity, "X-Ontomato-Run-Id": nextRun },
          )
        ).status,
      ).toBe(409);
      const cancelled = await request(`/${id}`);
      expect(cancelled.body.status).toBe("stopped");
      expect(cancelled.body.work.summary).toBe("Reviewed knowledge");
      expect(
        (await pool.query("SELECT COUNT(*)::int AS n FROM runtime.compactions"))
          .rows[0].n,
      ).toBeGreaterThan(0);
    }, 40000);
    it("runs unchanged external governance scripts and refuses writes after begin replaces the gate", async () => {
      const workspace = path.join(root, "external");
      await mkdir(workspace, { recursive: true });
      await cp(
        path.join(
          publicRoot,
          "packages/workbench-server/resources/runtime-skills/knowledge-governance",
        ),
        path.join(workspace, "skill"),
        { recursive: true },
      );
      const command = async (args: string[]) =>
        new Promise<string>((resolve, reject) => {
          const child = spawn(
            process.execPath,
            ["skill/scripts/governance.mjs", ...args],
            {
              cwd: workspace,
              env: { PATH: process.env.PATH, ONTOMATO_WORKBENCH_URL: hostUrl },
              stdio: ["ignore", "pipe", "pipe"],
            },
          );
          let out = "",
            err = "";
          child.stdout.on("data", (c) => (out += c));
          child.stderr.on("data", (c) => (err += c));
          child.once("error", reject);
          child.once("close", (code) =>
            code === 0 ? resolve(out) : reject(new Error(err)),
          );
        });
      const knowledge = JSON.parse(await command(["read-knowledge", "{}"]));
      expect(knowledge.items[0].sourceId).toBe(sourceId);
      await command([
        "update-work-record",
        JSON.stringify({ summary: "External review" }),
      ]);
      const first = JSON.parse(
        await readFile(
          path.join(workspace, "work/.governance-run.json"),
          "utf8",
        ),
      );
      expect((await request(`/${first.id}`)).body.work.summary).toBe(
        "External review",
      );
      const second = JSON.parse(
        await command(["begin", JSON.stringify({ message: "Continue" })]),
      );
      expect(second.id).toBe(first.id);
      const denied = await request(
        `/${first.id}/runs/${first.runId}/actions/update_work_record`,
        { summary: "late" },
        {
          "X-Ontomato-Run-Id": first.runId,
          "X-Ontomato-Session-Id": first.sessionId,
        },
      );
      expect(denied.status).toBe(409);
      await command(["close"]);
      const after = await request(
        `/${second.id}/runs/${second.runId}/actions/update_work_record`,
        { summary: "late" },
        {
          "X-Ontomato-Run-Id": second.runId,
          "X-Ontomato-Session-Id": second.sessionId,
        },
      );
      expect(after.status).toBe(409);
    }, 20000);
  },
);
