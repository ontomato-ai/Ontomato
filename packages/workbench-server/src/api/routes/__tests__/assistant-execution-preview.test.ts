import express from "express";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, beforeEach, expect, it, vi } from "vitest";
import { EXECUTION_CONTEXT_HEADER, previewExecutionContextHeader } from "@ontomato/contracts/execution-context";

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

const run = "11111111-1111-4111-8111-111111111111";
const intent = "8f5df4a4-e30b-48cb-831a-33b759144f76";
const reached: { owner: "java" | "praxis"; method: string; path: string; marker: string | null }[] = [];
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
    reached.push({ owner: name, method: req.method, path: req.path, marker: req.header(EXECUTION_CONTEXT_HEADER) ?? null });
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

/** What reached an owner for one callback request of the run: method, path below the owner, and its marker. */
async function callback(path: string, method = "POST", headers: Record<string, string> = {}) {
  reached.length = 0;
  const token = callbackCredential({
    scope: { purpose: "execution", capability: executionCallbackPurpose.parse(path.split("/")[0]) },
    runId: run, expiresAt: Date.now() + 60000, token: "initiator-token", apiKey: "",
  }).value;
  const response = await fetch(`${proxy}/api/assistant/executions/${run}/${path}`, {
    method, headers: { "content-type": "application/json", "X-Ontomato-Callback-Credential": token, "X-Ontomato-Run-Id": run, ...headers },
    ...(method === "GET" ? {} : { body: "{}" }),
  });
  expect(response.status, `${method} ${path}: ${await response.clone().text()}`).toBeLessThan(300);
  return reached.map(({ owner, method, path, marker }) => `${owner} ${method} ${path} ${marker ?? "-"}`);
}

const marked = previewExecutionContextHeader;

it("carries a preview run's identity to every running entry, however the request spells its path", async () => {
  expect(await callback("ontology/action/execute")).toEqual([`java POST /action/execute ${marked}`]);
  expect(await callback("ontology/action/execute?trace=1")).toEqual([`java POST /action/execute ${marked}`]);
  expect(await callback("ontology/action/execute/")).toEqual([`java POST /action/execute/ ${marked}`]);
  expect(await callback("ontology/action/%65xecute")).toEqual([`java POST /action/%65xecute ${marked}`]);
  expect(await callback("ontology/writeFunctionOperation/insert")).toEqual([`java POST /writeFunctionOperation/insert ${marked}`]);
  expect(await callback("ontology/vectorResource/upload")).toEqual([`java POST /vectorResource/upload ${marked}`]);
  expect(await callback("ontology/platform/triggers/trigger-1/runs")).toEqual([`java POST /platform/triggers/trigger-1/runs ${marked}`]);
  // Through the workbench: Praxis's run start, and a dispatched panel operation's Action, in any letter case Node routes.
  expect(await callback("workbench/api/praxis/runs")).toEqual([`praxis POST /runs ${marked}`]);
  expect(await callback("workbench/API/Praxis/runs")).toEqual([`praxis POST /runs ${marked}`]);
  expect(await callback(`workbench/api/panel-operations/intents/${intent}/dispatch`)).toEqual([`java POST /action/execute ${marked}`]);
  expect(await callback(`workbench/api/Panel-Operations/intents/${intent}/dispatch/`)).toEqual([`java POST /action/execute ${marked}`]);
});

it("leaves a preview run's reads, building and other workflow calls unmarked, and drops what the caller said about them", async () => {
  expect(await callback("ontology/ontology/query/execute-dsl", "POST", { [EXECUTION_CONTEXT_HEADER]: marked }))
    .toEqual(["java POST /ontology/query/execute-dsl -"]);
  expect(await callback("ontology/writeFunctionOperation/query")).toEqual(["java POST /writeFunctionOperation/query -"]);
  expect(await callback("ontology/action/execute", "GET")).toEqual(["java GET /action/execute -"]);
  expect(await callback("ontology/action/trial")).toEqual(["java POST /action/trial -"]);
  expect(await callback("ontology/function/save", "POST", { [EXECUTION_CONTEXT_HEADER]: '{"kind":"live"}' }))
    .toEqual(["java POST /function/save -"]);
  expect(await callback("ontology/platform/triggers")).toEqual(["java POST /platform/triggers -"]);
  expect(await callback("workbench/api/praxis/runs", "GET")).toEqual(["praxis GET /runs -"]);
  expect(await callback("workbench/api/praxis/runs/r-1/tick")).toEqual(["praxis POST /runs/r-1/tick -"]);
});

it("refuses a caller's different identity at a running entry, and marks nothing for a live run", async () => {
  const token = callbackCredential({
    scope: { purpose: "execution", capability: "ontology" }, runId: run, expiresAt: Date.now() + 60000, token: "initiator-token", apiKey: "",
  }).value;
  const refused = await fetch(`${proxy}/api/assistant/executions/${run}/ontology/action/execute`, {
    method: "POST", headers: { "content-type": "application/json", "X-Ontomato-Callback-Credential": token, "X-Ontomato-Run-Id": run,
      [EXECUTION_CONTEXT_HEADER]: '{"kind":"live"}' }, body: "{}",
  });
  expect(refused.status).toBe(403);
  expect(reached).toEqual([]);
  state.kind = "live";
  expect(await callback("ontology/action/execute")).toEqual(["java POST /action/execute -"]);
  expect(await callback("workbench/api/praxis/runs")).toEqual(["praxis POST /runs -"]);
  expect(await callback(`workbench/api/panel-operations/intents/${intent}/dispatch`)).toEqual(["java POST /action/execute -"]);
});
