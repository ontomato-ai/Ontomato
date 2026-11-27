import express from "express";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, beforeEach, expect, it, vi } from "vitest";
import { EXECUTION_CONTEXT_HEADER, previewExecutionContextHeader } from "@ontomato/contracts/execution-context";
import { AGENT_EXECUTION_HEADER } from "@ontomato/contracts/agent-runtime-business-callbacks";
import type { AgentHostService } from "../../../services/agent-host/types";
import type { AssistantCredentials } from "../../../platform/agent-runtime/runtime";

/**
 * A run's callback request end to end: the callback proxy, the workbench's own routes as they are mounted (Praxis and
 * the panel-operation dispatch, which carries out an operation with the operation host), and fake owners that record
 * the identity each request reached them with.
 */
const state = vi.hoisted(() => ({ java: "", workbench: "", kind: "preview" as "preview" | "live" }));
vi.mock("../../../services/assistant/execution", () => ({
  credentialsForRun: async () => ({
    run: { channel: { authority: { classNames: [], executionKind: state.kind } } },
    credentials: { token: "run-token", locale: "en" }, retrievalScopeId: null,
  }),
  runForOwner: async () => ({ status: "running", channel: { authority: { classNames: [], executionKind: state.kind } } }),
  ownedRun: async () => ({ turn: null, run: { status: "running", channel: { authority: { classNames: [], executionKind: state.kind } } } }),
}));
vi.mock("../../../services/assistant/store", () => ({ assistantStore: {} }));
vi.mock("../../../services/assistant/authoring", () => ({ executeAuthoring: vi.fn(), adoptAppBuilderDefinition: vi.fn() }));
vi.mock("../../../core/skills/registry/manager", () => ({ skillRegistryManager: {} }));
vi.mock("../../../config/environment", () => ({ environment: {
  agentRuntime: () => ({ token: "test-callback-secret", callbackUrl: state.workbench, queryServiceToken: "host-service" }),
  queryBase: () => state.java, queryTimeout: () => 30000, queryKey: () => "",
} }));
vi.mock("../../../config/application", () => ({ config: { dataQuery: { get baseUrl() { return state.java; } } } }));
vi.mock("../../../utils/request-identity", async original => ({
  ...await original<typeof import("../../../utils/request-identity")>(), requireDomainId: (req: { domainId: string }) => req.domainId,
}));
// The dispatch carries the stored operation out through the operation host, as the real one does.
vi.mock("../../../services/product-panels/operations", async original => {
  const { operationHost } = await import("../../../services/product-panels/operation-host");
  return {
    ...await original<typeof import("../../../services/product-panels/operations")>(),
    dispatchHumanPanelOperation: async (owner: { domainId: string; userId: string }, credentials: object, intentId: string) => {
      await operationHost({ owner, credentials }).request("/api/data-query/action/execute", { method: "POST", body: "{}" });
      return { kind: "dispatched", intentId, outcome: null };
    },
  };
});

const { assistantExecutionMountPath, assistantExecutionRouter, assistantOwnerCallbackPath } = await import("../assistant-execution");
const { callbackCredential, unwrapCallbackCredential, executionCallbackPurpose } = await import("../../../services/agent-runtime/callback-credential");
const { createPraxisRouter } = await import("../praxis");
const { panelOperationsRouter } = await import("../product-panels");
const { createAgentHostRouter } = await import("../agent-host");

const run = "11111111-1111-4111-8111-111111111111";
const intent = "8f5df4a4-e30b-48cb-831a-33b759144f76";
const reached: { owner: "java" | "praxis"; method: string; path: string; marker: string | null; execution: string | null }[] = [];
const opened = vi.fn(async () => ({ session: {}, replayed: false }));
const servers: Server[] = [];
let proxy = "";

async function listen(app: express.Express) {
  const server = app.listen(0, "127.0.0.1");
  servers.push(server);
  await new Promise<void>(resolve => server.once("listening", resolve));
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

function owner(name: "java" | "praxis") {
  const app = express();
  app.use((req, res) => {
    reached.push({ owner: name, method: req.method, path: req.path, marker: req.header(EXECUTION_CONTEXT_HEADER) ?? null,
      execution: req.header(AGENT_EXECUTION_HEADER) ?? null });
    res.json({ success: true });
  });
  return listen(app);
}

beforeAll(async () => {
  state.java = await owner("java");
  const praxis = await owner("praxis");
  const workbench = express();
  workbench.use(express.json());
  workbench.use((req, _res, next) => {
    Object.assign(req, { userId: "U", domainId: "domain", roles: ["user"], token: req.header("tk"), apiKey: "", locale: "en" });
    next();
  });
  workbench.use("/api/praxis", createPraxisRouter(praxis));
  workbench.use("/api", panelOperationsRouter);
  const conversations = { create: opened, send: opened } as unknown as AgentHostService<[AssistantCredentials]>;
  workbench.use("/api/assistant", createAgentHostRouter(conversations));
  workbench.use("/api/observe/agent", createAgentHostRouter(conversations));
  state.workbench = await listen(workbench);
  const callbacks = express();
  callbacks.all(assistantExecutionMountPath + assistantOwnerCallbackPath, express.raw({ type: () => true }));
  callbacks.use(express.json());
  callbacks.use(unwrapCallbackCredential);
  callbacks.use((req, _res, next) => { Object.assign(req, { userId: "U", domainId: "domain", token: req.header("tk"), locale: "en" }); next(); });
  callbacks.use(assistantExecutionMountPath, assistantExecutionRouter);
  proxy = await listen(callbacks);
});
afterAll(async () => {
  await Promise.all(servers.map(server => new Promise<void>(resolve => { server.closeAllConnections(); server.close(() => resolve()); })));
});
beforeEach(() => { reached.length = 0; state.kind = "preview"; });

/** One callback request of the run, through the proxy. */
async function send(path: string, method = "POST", headers: Record<string, string> = {}) {
  reached.length = 0;
  const token = callbackCredential({
    scope: { purpose: "execution", capability: executionCallbackPurpose.parse(path.split("/")[0]) },
    runId: run, expiresAt: Date.now() + 60000, token: "initiator-token", apiKey: "",
  }).value;
  return fetch(`${proxy}/api/assistant/executions/${run}/${path}`, {
    method, headers: { "content-type": "application/json", "X-Ontomato-Callback-Credential": token, "X-Ontomato-Run-Id": run, ...headers },
    ...(method === "GET" ? {} : { body: "{}" }),
  });
}

/** What reached an owner for one callback request of the run: method, path below the owner, and its marker. */
async function callback(path: string, method = "POST", headers: Record<string, string> = {}) {
  const response = await send(path, method, headers);
  expect(response.status, `${method} ${path}: ${await response.clone().text()}`).toBeLessThan(300);
  return reached.map(({ owner, method, path, marker }) => `${owner} ${method} ${path} ${marker ?? "-"}`);
}

const marked = previewExecutionContextHeader;

it("carries a preview run's identity on every callback request, however the request spells its path", async () => {
  expect(await callback("ontology/action/execute")).toEqual([`java POST /action/execute ${marked}`]);
  expect(await callback("ontology/action/execute?trace=1")).toEqual([`java POST /action/execute ${marked}`]);
  expect(await callback("ontology/action/execute/")).toEqual([`java POST /action/execute/ ${marked}`]);
  expect(await callback("ontology/action/%65xecute")).toEqual([`java POST /action/%65xecute ${marked}`]);
  expect(await callback("ontology/writeFunctionOperation/insert")).toEqual([`java POST /writeFunctionOperation/insert ${marked}`]);
  expect(await callback("ontology/vectorResource/upload")).toEqual([`java POST /vectorResource/upload ${marked}`]);
  expect(await callback("ontology/platform/triggers/trigger-1/runs")).toEqual([`java POST /platform/triggers/trigger-1/runs ${marked}`]);
  expect(await callback("ontology/platform/agent-channel/commands")).toEqual([`java POST /platform/agent-channel/commands ${marked}`]);
  expect(await callback("ontology/ontology/ai/sessions/s-1/runs")).toEqual([`java POST /ontology/ai/sessions/s-1/runs ${marked}`]);
  // Through the workbench: every Praxis entry that starts, advances or changes a formal run, in any letter case Node
  // routes, and a dispatched panel operation's Action.
  for (const entry of ["runs", "runs/r-1/tick", "runs/r-1/acts-on", "runs/r-1/case/submit", "runs/r-1/case/fill",
    "runs/r-1/case/close", "steps/s-1/decide", "steps/s-1/assign"])
    expect(await callback(`workbench/api/praxis/${entry}`)).toEqual([`praxis POST /${entry} ${marked}`]);
  expect(await callback("workbench/API/Praxis/runs")).toEqual([`praxis POST /runs ${marked}`]);
  expect(await callback(`workbench/api/panel-operations/intents/${intent}/dispatch`)).toEqual([`java POST /action/execute ${marked}`]);
  expect(await callback(`workbench/api/Panel-Operations/intents/${intent}/dispatch/`)).toEqual([`java POST /action/execute ${marked}`]);
});

it("carries the same identity on reads, building and other workflow calls, ignoring what the caller supplied", async () => {
  expect(await callback("ontology/ontology/query/execute-dsl", "POST", { [EXECUTION_CONTEXT_HEADER]: marked }))
    .toEqual([`java POST /ontology/query/execute-dsl ${marked}`]);
  expect(await callback("ontology/writeFunctionOperation/query")).toEqual([`java POST /writeFunctionOperation/query ${marked}`]);
  expect(await callback("ontology/action/execute", "GET")).toEqual([`java GET /action/execute ${marked}`]);
  expect(await callback("ontology/action/trial")).toEqual([`java POST /action/trial ${marked}`]);
  expect(await callback("ontology/function/save", "POST", { [EXECUTION_CONTEXT_HEADER]: '{"kind":"live"}' }))
    .toEqual([`java POST /function/save ${marked}`]);
  expect(await callback("ontology/platform/triggers")).toEqual([`java POST /platform/triggers ${marked}`]);
  for (const read of ["runs", "runs/r-1", "runs/r-1/case", "inbox", "subjects", "steps/s-1/candidates", "workflows/w-1/template"])
    expect(await callback(`workbench/api/praxis/${read}`, "GET")).toEqual([`praxis GET /${read} ${marked}`]);
});
it("ignores a caller's stated identity and marks nothing for a live run", async () => {
  expect(await callback("ontology/action/execute", "POST", { [EXECUTION_CONTEXT_HEADER]: '{"kind":"live"}' }))
    .toEqual([`java POST /action/execute ${marked}`]);
  state.kind = "live";
  expect(await callback("ontology/action/execute")).toEqual(["java POST /action/execute -"]);
  expect(await callback("workbench/api/praxis/runs")).toEqual(["praxis POST /runs -"]);
  expect(await callback("workbench/api/praxis/steps/s-1/decide")).toEqual(["praxis POST /steps/s-1/decide -"]);
  expect(await callback(`workbench/api/panel-operations/intents/${intent}/dispatch`)).toEqual(["java POST /action/execute -"]);
});
it("keeps a run from acting as its user at agent entries: they see the run's callback, and conversations refuse it", async () => {
  // DataRAG refuses its external agent entry and a new conversation for a request carrying the run's execution header,
  // which the proxy always sets: a run cannot drop or replace it.
  const attempts: Record<string, string>[] = [{}, { [AGENT_EXECUTION_HEADER]: "" }, { [AGENT_EXECUTION_HEADER]: "another-run" }];
  for (const headers of attempts) {
    for (const path of ["ontology/platform/agent-channel/commands", "ontology/ontology/ai/sessions", `ontology/ontology/ai/sessions/${intent}/runs`]) {
      await callback(path, "POST", headers);
      expect(reached.map(entry => entry.execution), path).toEqual([run]);
    }
  }
  // The workbench's own new top-level conversations refuse it before opening anything.
  for (const path of ["workbench/api/assistant/sessions", "workbench/api/observe/agent/sessions",
    `workbench/api/assistant/sessions/${intent}/runs`, `workbench/api/observe/agent/sessions/${intent}/runs`]) {
    const response = await send(path, "POST", { "Idempotency-Key": intent });
    expect(response.status, path).toBe(403);
    expect(await response.json()).toMatchObject({ error: { code: "FORBIDDEN", message: "A run starts agents through its own agent channel" } });
  }
  expect(opened).not.toHaveBeenCalled();
});
