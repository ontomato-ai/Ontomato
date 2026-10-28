import { removeWorkerFiles } from "../../../../../agent-runtime/src/worker";
import { beforeAll, afterAll, describe, it, expect } from "vitest";
import { createServer, type Server } from "node:http";
import { spawn, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { mkdtemp, readFile, mkdir, writeFile, cp } from "node:fs/promises";
import path from "node:path";
import pg from "pg";
import {
  datasetPayloadSchema,
  retrievalSnapshotSchema,
} from "@ontomato/contracts/data-retrieval";

const connection = process.env.RUNTIME_TEST_DATABASE_URL;
describe.skipIf(!connection)(
  "retrieval through real workbench/runtime/Python processes",
  () => {
    const directory = path.dirname(fileURLToPath(import.meta.url)),
      publicRoot = path.resolve(directory, "../../../../../..");
    const tsx = createRequire(
      path.join(publicRoot, "apps/workbench/package.json"),
    ).resolve("tsx");
    const database = `retrieval_${randomUUID().replaceAll("-", "")}`;
    let admin: pg.Pool,
      pool: pg.Pool,
      fake: Server,
      root: string,
      databaseUrl: string,
      host: ChildProcess,
      runtime: ChildProcess;
    let hostUrl = "",
      runtimeUrl = "",
      ontologyUrl = "",
      hostLog = "",
      runtimeLog = "";
    const stages = new Map<string, number>(),
      jobs = new Map<string, Record<string, any>>(),
      grants = new Map<
        string,
        { run: string; purpose: string; domain: string }
      >();
    const contexts: string[] = [];
    let formalExecutions = 0,
      qualityAdmissions = 0;
    const held = new Map<string, () => void>();
    const source = `# ontomato-python:2\nimport json\nfrom query_runtime import execute_dsl\nrows=execute_dsl({"problem":"Sales","answer":{"steps":[{"graph":{"patterns":[{"objects":[{"class":"/sales","variable":"s","idx":0}]}],"pattern_logic":"and"},"output":{"to_user":True,"fields":[{"variable":"s","field":"count","as":"count"}]}}]}})\nprint(json.dumps({"answer":[{"region":row["region"],"count":row["count"]*2} for row in rows]}))\n`;
    const refs = [
      {
        key: "region",
        className: "/sales",
        attrName: "region",
        asGroupBy: true,
        statCal: false,
      },
      {
        key: "count",
        className: "/sales",
        attrName: "count",
        asGroupBy: false,
        statCal: true,
      },
    ];
    const selfCheck = {
      scope: "current task",
      filters: "published defaults",
      grain: "region",
      denominator: "none",
      nullGroups: "preserved",
      comparisons: [],
    };
    async function freePort() {
      const s = createServer();
      await new Promise<void>((r) => s.listen(0, "127.0.0.1", r));
      const port = (s.address() as { port: number }).port;
      await new Promise<void>((r) => s.close(() => r()));
      return port;
    }
    async function launch(kind: "runtime" | "host") {
      const existing = kind === "runtime" ? runtimeUrl : hostUrl,
        port = existing ? Number(new URL(existing).port) : await freePort();
      if (kind === "runtime") runtimeUrl = `http://127.0.0.1:${port}`;
      else hostUrl = `http://127.0.0.1:${port}`;
      const child = spawn(
        process.execPath,
        [
          "--import",
          tsx,
          kind === "runtime"
            ? path.join(publicRoot, "apps/agent-runtime/src/index.ts")
            : path.join(directory, "host-process.ts"),
        ],
        {
          cwd: publicRoot,
          env: {
            ...process.env,
            NODE_ENV: "test",
            DATABASE_URL: databaseUrl,
            PG_SCHEMA: "public",
            DATA_QUERY_BASE_URL: ontologyUrl,
            PORT: String(port),
            RETRIEVAL_TEST_ROOT: path.join(root, "host"),
            OBSERVE_BACKEND_NODES: "",
            BACKEND_NODES: "",
            MCP_SERVER_URL: "",
            AGENT_RUNTIME_MCP_SERVERS: "[]",
            DATA_QUERY_API_KEY: "",
            HTTP_PROXY: "",
            HTTPS_PROXY: "",
            ALL_PROXY: "",
            NO_PROXY: "127.0.0.1,localhost",
            AGENT_RUNTIME_DATABASE_URL: databaseUrl,
            AGENT_RUNTIME_SCHEMA: "runtime",
            AGENT_RUNTIME_ROOT: path.join(root, "runtime"),
            AGENT_RUNTIME_MODEL_CONFIG_URL: ontologyUrl,
            ONTOMATO_MODEL_RUNTIME_TOKEN: "fixture-runtime-token",
            AGENT_RUNTIME_PORT: String(port),
            AGENT_RUNTIME_HOSTS: JSON.stringify([
              {
                id: "workbench",
                token: "fixture-host-secret",
                providers: ["workbench", "ontology"],
                publishProviders: ["workbench"],
              },
              {
                id: "ontology",
                token: "fixture-ontology-secret",
                providers: ["ontology"],
                publishProviders: ["ontology"],
              },
            ]),
            AGENT_RUNTIME_URL: runtimeUrl,
            AGENT_RUNTIME_SERVICE_TOKEN: "fixture-host-secret",
            AGENT_RUNTIME_CALLBACK_URL: hostUrl,
            ONTOMATO_QUERY_SERVICE_TOKEN: "fixture-query-secret",
          },
          stdio: ["ignore", "pipe", "pipe"],
        },
      );
      if (kind === "runtime") runtime = child;
      else host = child;
      await new Promise<void>((resolve, reject) => {
        let log = "";
        const timer = setTimeout(
          () => reject(new Error(`${kind} startup: ${log}`)),
          25000,
        );
        const consume = (chunk: Buffer) => {
          log += chunk;
          if (kind === "runtime") runtimeLog += chunk;
          else hostLog += chunk;
          if (
            log.includes(
              kind === "runtime"
                ? "Agent runtime listening"
                : "RETRIEVAL_TEST_READY",
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
          reject(new Error(`${kind} exited ${code}: ${log}`));
        });
      });
    }
    async function stop(
      child: ChildProcess | undefined,
      signal: "SIGTERM" | "SIGKILL" = "SIGTERM",
    ) {
      if (child && child.exitCode === null && child.signalCode === null) {
        const closed = new Promise<void>((r) => child.once("exit", () => r()));
        child.kill(signal);
        const timeout = setTimeout(() => child.kill("SIGKILL"), 2000);
        await closed;
        clearTimeout(timeout);
      }
    }
    async function runtimeApi(endpoint: string, body?: unknown, key?: string) {
      const response = await fetch(runtimeUrl + endpoint, {
        method: body === undefined ? "GET" : "POST",
        headers: {
          authorization: "Bearer fixture-ontology-secret",
          "x-domain-id": "domain-a",
          "x-correlation-id": "fixture-formal",
          "content-type": "application/json",
          ...(key ? { "idempotency-key": key } : {}),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(JSON.stringify(result));
      return result;
    }
    async function api(
      endpoint: string,
      body?: unknown,
      key?: string,
      token = "fixture-a",
      extra: Record<string, string> = {},
    ) {
      const response = await fetch(hostUrl + "/api/retrievals" + endpoint, {
        method: body === undefined ? "GET" : "POST",
        headers: {
          "content-type": "application/json",
          tk: token,
          ...extra,
          ...(key ? { "Idempotency-Key": key } : {}),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      return {
        status: response.status,
        body: response.status === 204 ? null : await response.json(),
      };
    }
    async function settle(id: string) {
      for (let n = 0; n < 300; n++) {
        const response = await api(`/${id}`);
        if (response.body.run?.status === "stopped")
          return retrievalSnapshotSchema.parse(response.body);
        await new Promise((r) => setTimeout(r, 30));
      }
      throw new Error(`Retrieval did not settle\n${hostLog}\n${runtimeLog}`);
    }
    async function registerOntology() {
      const files = await Promise.all(
        [
          "SKILL.md",
          "ontomato.mjs",
          "client.mjs",
          "application.yml",
          "python/query_runtime.py",
        ].map(async (name) => ({
          path: name,
          content: await readFile(
            path.join(publicRoot, "agent-skills/ontomato-analyst", name),
            "utf8",
          ),
        })),
      );
      await runtimeApi("/v1/skills", {
        skill: {
          namespace: { kind: "provider", provider: "ontology" },
          name: "ontomato-analyst",
        },
        files,
      });
    }
    async function formal(id: string, body: Record<string, any>) {
      formalExecutions++;
      const executionId = randomUUID(),
        token = "user-read:" + executionId;
      grants.set(token, {
        run: executionId,
        purpose: "user-read",
        domain: "domain-a",
      });
      await runtimeApi(
        "/v1/code-executions",
        {
          language: "python",
          files: [{ path: "program.py", content: body.recipe.code }],
          entry: "program.py",
          arguments: [],
          outputPaths: ["query-status.json"],
          environment: {
            values: { ONTOMATO_ONTOLOGY_URL: ontologyUrl },
            secrets: { ONTOMATO_QUERY_TK: token },
          },
          libraries: [
            {
              skill: {
                namespace: { kind: "provider", provider: "ontology" },
                name: "ontomato-analyst",
              },
              path: "python",
            },
          ],
          limits: { wallTimeMs: 5000 },
        },
        executionId,
      );
      let execution;
      for (let n = 0; n < 200; n++) {
        execution = await runtimeApi(`/v1/code-executions/${executionId}`);
        if (execution.status !== "running") break;
        await new Promise((r) => setTimeout(r, 20));
      }
      if (
        execution.status !== "stopped" ||
        execution.exitCode !== 0 ||
        execution.errorMessage
      )
        throw new Error(JSON.stringify(execution));
      const read = async (name: string) =>
        fetch(
          runtimeUrl + `/v1/code-executions/${executionId}/outputs/${name}`,
          {
            headers: {
              authorization: "Bearer fixture-ontology-secret",
              "x-domain-id": "domain-a",
              "x-correlation-id": "fixture-formal",
            },
          },
        ).then((r) => r.text());
      const rows = JSON.parse(await read("stdout")).answer,
        marker = JSON.parse(await read("query-status.json"));
      jobs.set(id, {
        id,
        status: "completed",
        result: {
          receiptId: id,
          executedAt: new Date().toISOString(),
          recipe: body.recipe,
          outKeyRefs: refs,
          columns: refs.map((r) => ({ key: r.key, label: r.key, type: null })),
          rows,
          truncation: marker.truncated ? marker : null,
        },
        error: null,
      });
    }
    beforeAll(async () => {
      root = await mkdtemp(
        path.join(publicRoot, "../notes", "retrieval-standard-"),
      );
      admin = new pg.Pool({ connectionString: connection });
      await admin.query(`CREATE DATABASE "${database}"`);
      const db = new URL(connection!);
      db.pathname = `/${database}`;
      databaseUrl = db.toString();
      pool = new pg.Pool({ connectionString: databaseUrl });
      fake = createServer(async (req, res) => {
        let text = "";
        for await (const chunk of req) text += chunk;
        const body = text ? JSON.parse(text) : {};
        const reply = (data: unknown, status = 200) => {
          res.writeHead(status, { "content-type": "application/json" });
          res.end(JSON.stringify(data));
        };
        try {
          if (req.url === "/businessConfig/getModelSettings")
            return reply({
              success: true,
              data: {
                agents: { coding: { model: "fixture" } },
                sealedApiKeys: {
                  fixture: ["enc:v1:mzjUpW4OVVjLMPmxcmMcyop5LFN8VSJ_7lUGPppYXDK_UDNjyKAlYAL7vVwOMOI"],
                },
                models: [
                  {
                    name: "fixture",
                    modelName: "fixture",
                    baseUrl: ontologyUrl + "/v1",
                    apiKeys: ["******1234"],
                    maxTokens: 4000,
                    contextWindow: 64000,
                    timeout: null,
                    maxRetries: null,
                    temperature: null,
                    topP: null,
                    customRequestParameters: null,
                  },
                ],
              },
            });
          if (req.url === "/ontology/query/overview")
            return reply({
              description: "Sales fixture",
              classes: [{ name: "/sales", description: null }],
            });
          if (req.url === "/ontology/query/knowledge/search")
            return reply({
              items: [
                {
                  id: "k1",
                  title: null,
                  text: "Preserve null regions",
                  modifiedAt: null,
                },
              ],
            });
          if (req.url === "/ontology/query/metrics/search")
            return reply({
              items: [
                {
                  id: "m1",
                  revision: "r1",
                  name: "Count",
                  description: null,
                  function: {
                    code: "# ontomato-python:2",
                    parameters: [
                      {
                        name: "date",
                        sample: null,
                        value: null,
                        classNames: null,
                      },
                    ],
                    returnDef: {
                      outKeyRefs: refs,
                      isVoid: null,
                      value: null,
                      classNames: null,
                    },
                  },
                },
              ],
              nextCursor: null,
            });
          if (req.url === "/internal/query-grants/exploration") {
            expect(req.headers["x-ontomato-query-service-token"]).toBe(
              "fixture-query-secret",
            );
            await registerOntology();
            const value = "explore:" + body.runtimeRunId;
            grants.set(value, {
              run: body.runtimeRunId,
              purpose: "exploration",
              domain: "domain-a",
            });
            return reply({
              credential: { kind: "bearer", value },
              expiresAt: body.expiresAt,
            });
          }
          if (req.url === "/internal/query-grants/revoke")
            return reply({ revoked: true });
          if (req.url === "/ontology/query/execute-dsl") {
            expect(Object.keys(body)).toEqual(["dsl"]);
            const grant = grants.get(String(req.headers.tk));
            expect(grant?.run).toBe(req.headers["x-ontomato-run-id"]);
            if (!grant) return reply({ error: { message: "No grant" } }, 401);
            return reply({
              data: [
                {
                  answer:
                    grant.purpose === "exploration"
                      ? [
                          { region: null, count: 99 },
                          { region: "A", count: 7 },
                        ]
                      : [{ region: "A", count: 7 }],
                  ...(grant.purpose === "exploration"
                    ? {
                        truncated: true,
                        rowLimit: 1000,
                        truncationHint: "Exploration source is partial",
                      }
                    : {}),
                },
              ],
              dsl: body.dsl,
            });
          }
          if (req.url === "/ontology/query/outputs") {
            expect(req.headers.tk).toBe("fixture-a");
            if (!jobs.has(body.submissionId)) {
              jobs.set(body.submissionId, {
                id: body.submissionId,
                status: "running",
                result: null,
                error: null,
              });
              void formal(body.submissionId, body).catch((error) =>
                jobs.set(body.submissionId, {
                  id: body.submissionId,
                  status: "failed",
                  error: { message: error.message },
                }),
              );
            }
            return reply(jobs.get(body.submissionId), 202);
          }
          if (req.url?.startsWith("/ontology/query/outputs/")) {
            const id = req.url.split("/")[4]!;
            if (req.url.endsWith("/cancel"))
              jobs.set(id, {
                id,
                status: "cancelled",
                error: { message: "cancelled" },
              });
            return reply(
              jobs.get(id) ?? { error: { message: "missing" } },
              jobs.has(id) ? 200 : 404,
            );
          }
          if (req.url === "/query-quality-checks") {
            if (!jobs.has(body.id)) {
              qualityAdmissions++;
              jobs.set(body.id, {
                id: body.id,
                status: "running",
                result: null,
              });
              setTimeout(
                () =>
                  jobs.set(body.id, {
                    id: body.id,
                    status: "completed",
                    result: {
                      programDescriptions: [
                        { summary: "Counts", meaning: "Read then double" },
                      ],
                      score: 85,
                      conclusion: "Consistent",
                      fittedQuestion: "Double sales",
                    },
                  }),
                700,
              );
            }
            return reply(jobs.get(body.id), 202);
          }
          if (req.url?.startsWith("/query-quality-checks/"))
            return reply(jobs.get(req.url.split("/")[2]!) ?? {});
          if (req.url === "/v1/chat/completions") {
            const run = String(req.headers["x-correlation-id"]),
              stage = stages.get(run) ?? 0;
            stages.set(run, stage + 1);
            contexts.push(text);
            const users = body.messages.filter((m: any) => m.role === "user");
            const raw = users.at(-1)?.content;
            const context = JSON.parse(
              typeof raw === "string" ? raw : raw[0].text,
            );
            if (context.question.includes("hold") && stage === 0)
              await new Promise<void>((resolve) =>
                held.set(context.question, resolve),
              );
            let name: string | undefined, args: unknown;
            const resumed = Boolean(context.answer),
              need = context.question.includes("clarify") && !resumed;
            const step = resumed ? stage + 1 : stage;
            if (step === 0) {
              name = "write";
              args = { path: "work/answer.py", content: source };
            } else if (step === 1) {
              name = "bash";
              args = { command: "python3 work/answer.py" };
            } else if (step === 2 && !need) {
              name = "write";
              args = {
                path: "work/recipe.json",
                content: JSON.stringify({
                  recipe: {
                    kind: "python",
                    code: source,
                    sha256: (await import("node:crypto"))
                      .createHash("sha256")
                      .update(source)
                      .digest("hex"),
                  },
                  title: "Sales",
                  question: "Double sales",
                  outKeyRefs: refs,
                  assumptions: [],
                  metricUses: [
                    {
                      id: "m1",
                      revision: "r1",
                      use: "not_used",
                      reason: "Different calculation",
                    },
                  ],
                  selfCheck,
                  decisionIds: (context.decisions ?? []).map((d: any) => d.id),
                }),
              };
            } else if (step === 3 && !need) {
              name = "bash";
              args = {
                command:
                  "node skills/data-retrieval/scripts/dataset.mjs @work/recipe.json outputs/result.dataset.json",
              };
            }
            if (!name && context.question.startsWith("finish during outage"))
              await new Promise<void>((resolve) =>
                held.set(context.question, resolve),
              );
            res.writeHead(200, { "content-type": "text/event-stream" });
            const frame = (delta: unknown, finish: unknown = null) =>
              res.write(
                `data: ${JSON.stringify({ id: "fixture", object: "chat.completion.chunk", model: "fixture", choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`,
              );
            if (name) {
              frame({
                role: "assistant",
                tool_calls: [
                  {
                    index: 0,
                    id: randomUUID(),
                    type: "function",
                    function: { name, arguments: JSON.stringify(args) },
                  },
                ],
              });
              frame({}, "tool_calls");
            } else {
              frame({
                role: "assistant",
                content: need
                  ? "Which period? Time affects this calculation."
                  : "Done [dataset](outputs/result.dataset.json)",
              });
              frame({}, "stop");
            }
            res.end("data: [DONE]\n\n");
            return;
          }
          reply(
            { error: { message: "Unknown fixture route: " + req.url } },
            404,
          );
        } catch (error) {
          reply(
            {
              error: {
                message: error instanceof Error ? error.message : String(error),
              },
            },
            500,
          );
        }
      });
      await new Promise<void>((r) => fake.listen(0, "127.0.0.1", r));
      ontologyUrl = `http://127.0.0.1:${(fake.address() as { port: number }).port}`;
      await launch("runtime");
      await launch("host");
    }, 40000);
    afterAll(async () => {
      for (const release of held.values()) release();
      await stop(host);
      await stop(runtime);
      fake?.closeAllConnections();
      await new Promise<void>((r) => fake?.close(() => r()));
      await pool?.end();
      if (admin) {
        await admin.query(`DROP DATABASE IF EXISTS "${database}" WITH (FORCE)`);
        await admin.end();
      }
      if (root) await removeWorkerFiles(root);
    }, 20000);
    it("reruns Python with user authorization, returns immutable data and completes before quality checking", async () => {
      const key = randomUUID(),
        body = {
          question: "Double sales",
          interaction: "resumable",
          userQuotes: [],
          previousDatasetIds: [],
        };
      const first = await api("/", body, key);
      expect(first.status, JSON.stringify(first.body)).toBe(202);
      expect((await api("/", body, key)).body.id).toBe(first.body.id);
      expect(
        (await api("/", { ...body, question: "changed" }, key)).status,
      ).toBe(409);
      const done = await settle(first.body.id);
      expect(done.run, hostLog + runtimeLog).toMatchObject({
        status: "stopped",
        stopReason: "stop",
      });
      expect(formalExecutions).toBe(1);
      const data = await api(
        `/${done.id}/datasets/${done.datasetArtifactIds[0]}`,
      );
      expect(data.status).toBe(200);
      const payload = datasetPayloadSchema.parse(data.body.payload);
      expect(payload.rows).toEqual([{ region: "A", count: 14 }]);
      expect(payload.truncation).toBeNull();
      expect(
        (await api(`/${done.id}`, undefined, undefined, "fixture-b")).status,
      ).toBe(404);
      expect(
        (await api(`/${done.id}`, undefined, undefined, "fixture-other-domain"))
          .status,
      ).toBe(404);
      expect(contexts.join("\n")).toContain('\\"sample\\":null');
      expect(contexts.join("\n")).not.toContain("explore:");
      for (let n = 0; n < 100; n++) {
        const result = await api(`/${done.id}`);
        if (result.body.qualityCheck) {
          expect(result.body.qualityCheck.status).toBe("completed");
          break;
        }
        await new Promise((r) => setTimeout(r, 30));
      }
      expect(qualityAdmissions).toBe(1);
    }, 20000);
    it("pauses without a reply, resumes the same session with retained code, rejects stale replies ", async () => {
      const first = await api(
        "/",
        { question: "clarify period" },
        randomUUID(),
      );
      const paused = await settle(first.body.id);
      expect(paused.run?.stopReason).toBe("stop");
      expect(JSON.stringify(paused.messages)).toContain("Which period?");
      expect(paused.datasetArtifactIds).toEqual([]);
      const answer = {
          expectedRunId: paused.runtimeRunId,
          expectedDecisionRevision: paused.decisionRevision,
          message: "Current period",
        },
        key = randomUUID();
      const resumed = await api(`/${paused.id}/answers`, answer, key);
      expect(resumed.status).toBe(202);
      expect(resumed.body.runtimeSessionId).toBe(paused.runtimeSessionId);
      expect(resumed.body.runtimeRunId).not.toBe(paused.runtimeRunId);
      expect((await api(`/${paused.id}/answers`, answer, key)).status).toBe(
        202,
      );
      expect(
        (await api(`/${paused.id}/answers`, answer, randomUUID())).status,
      ).toBe(409);
      const done = await settle(paused.id);
      expect(done.run, JSON.stringify(done)).toMatchObject({
        status: "stopped",
        stopReason: "stop",
      });
      const oldArtifact = done.datasetArtifactIds[0]!;
      const corrected = await api(
        `/${done.id}/answers`,
        {
          expectedRunId: done.runtimeRunId,
          expectedDecisionRevision: done.decisionRevision,
          message: "Previous year",
        },
        randomUUID(),
      );
      expect(corrected.status).toBe(202);
      const revised = await settle(done.id);
      expect(revised.run?.stopReason).toBe("stop");
      expect(revised.runtimeSessionId).toBe(done.runtimeSessionId);
      expect((await api(`/${done.id}/datasets/${oldArtifact}`)).status).toBe(
        200,
      );
      expect(contexts.some((text) => text.includes("Previous year"))).toBe(
        true,
      );
      const offline = await api(
        "/",
        { question: "clarify offline", interaction: "non_interactive" },
        randomUUID(),
      );
      const unanswered = await settle(offline.body.id);
      expect(unanswered.run?.stopReason).toBe("stop");
      expect(JSON.stringify(unanswered.messages)).toContain("Which period?");
      expect((await api(`/${unanswered.id}`)).body.runtimeRunId).toBe(
        unanswered.runtimeRunId,
      );
    }, 30000);
    it("runs an unchanged external dataset skill with user authority and closes predecessor gates", async () => {
      const workspace = path.join(root, "external");
      await mkdir(workspace, { recursive: true });
      await cp(
        path.join(
          publicRoot,
          "packages/workbench-server/resources/runtime-skills/data-retrieval",
        ),
        path.join(workspace, "skill"),
        { recursive: true },
      );
      const sourceHash = (await import("node:crypto"))
        .createHash("sha256")
        .update(source)
        .digest("hex");
      const recipe = {
        recipe: { kind: "python", code: source, sha256: sourceHash },
        title: "External",
        question: "Double sales",
        outKeyRefs: refs,
        assumptions: [],
        metricUses: [],
        selfCheck,
        decisionIds: [],
      };
      await writeFile(
        path.join(workspace, "recipe.json"),
        JSON.stringify(recipe),
      );
      const explored = [...grants.values()].filter(
        (g) => g.purpose === "exploration",
      ).length;
      const command = async (args: string[]) =>
        new Promise<string>((resolve, reject) => {
          const child = spawn(
            process.execPath,
            ["skill/scripts/dataset.mjs", ...args],
            {
              cwd: workspace,
              env: {
                PATH: process.env.PATH,
                ONTOMATO_WORKBENCH_URL: hostUrl,
                ONTOMATO_TK: "fixture-a",
              },
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
      await command(["@recipe.json", "outputs/external.dataset.json"]);
      const file = datasetPayloadSchema.parse(
        JSON.parse(
          await readFile(
            path.join(workspace, "outputs/external.dataset.json"),
            "utf8",
          ),
        ),
      );
      expect(file.rows).toEqual([{ region: "A", count: 14 }]);
      expect(
        [...grants.values()].filter((g) => g.purpose === "exploration"),
      ).toHaveLength(explored);
      const first = JSON.parse(
        await readFile(
          path.join(workspace, "work/.retrieval-run.json"),
          "utf8",
        ),
      );
      expect((await api(`/${first.id}`)).body).toMatchObject({
        runtimeSessionId: null,
        runtimeRunId: null,
        messages: [],
      });
      await writeFile(
        path.join(workspace, "question.json"),
        JSON.stringify({ question: "Double sales" }),
      );
      const second = JSON.parse(await command(["begin", "@question.json"]));
      expect(second.id).toBe(first.id);
      expect(second.runId).not.toBe(first.runId);
      expect(
        (
          await api(
            `/${first.id}/runs/${first.runId}/outputs`,
            recipe,
            randomUUID(),
            "fixture-a",
            { "X-Ontomato-Run-Id": first.runId },
          )
        ).status,
      ).toBe(409);
      await command(["close"]);
      expect(
        (
          await api(
            `/${second.id}/runs/${second.runId}/outputs`,
            recipe,
            randomUUID(),
            "fixture-a",
            { "X-Ontomato-Run-Id": second.runId },
          )
        ).status,
      ).toBe(409);
    }, 20000);
  },
);
