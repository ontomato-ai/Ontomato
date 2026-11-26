import type { ObjectDecisionRequest } from "../../product-governance/authorization";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import {
  type CreatePanelHumanOperationIntentRequest,
  type PanelOperationIntent,
} from "@ontomato/contracts/panel-agent";
import {
  AGENT_DEFINITION, APPLICATION, BUSINESS_KNOWLEDGE, GENERATE_USER_API_KEY, PRODUCT_PANEL,
  REGENERATE_USER_API_KEY, REMOVE_USER, REVOKE_USER_API_KEY, TRIGGER, USER,
} from "@ontomato/contracts/platform-object-types";
import type { PanelRecord } from "@ontomato/contracts/panel-projection";
import { panelRowOperationKey } from "@ontomato/contracts/panel-projection";
import type { ApplicationPanelUse, ProductPanel, ProductProjection } from "@ontomato/contracts/product-panels";
import { runtimeJsonObjectSchema } from "@ontomato/contracts/agent-runtime-values";
import type { RuntimeRun } from "@ontomato/contracts/agent-runtime";
import { components as sdkComponents } from "../../../../../apps-sdk/src/catalogue";
import { configureI18n } from "../../../i18n";
import { en, enLocaleMeta } from "../../../i18n/locales/en";
import { HttpError } from "../../../utils/errors";
import type { CurrentProductKind, CurrentProductRow } from "../../../infrastructure/product-current";
import * as serverOperations from "../server-operations";

const mocks = vi.hoisted(() => ({
  query: vi.fn(),
  backendGet: vi.fn(),
  backendPost: vi.fn(),
  run: vi.fn(),
  session: vi.fn(),
  request: vi.fn(),
  resolve: vi.fn(),
  pages: vi.fn(),
  resolveMember: vi.fn(),
  loadedMember: vi.fn(),
  restore: vi.fn(),
  sessionActor: vi.fn(),
  notify: vi.fn(),
  findProduct: vi.fn(),
  listScheduledTasks: vi.fn(),
  queryKnowledge: vi.fn(),
  usedPanels: vi.fn(),
  readCatalogue: vi.fn(),
}));

vi.mock("../../../infrastructure/postgres", () => ({
  getPostgresPool: () => ({ query: mocks.query }),
  qualifiedTable: (name: string) => name,
}));
vi.mock("../../../infrastructure/product-current", () => ({
  findCurrentProduct: mocks.findProduct,
  currentProductRecord: (row: CurrentProductRow, editable: boolean) => ({
    ...row.definition,
    id: row.id,
    domainId: row.domainId,
    ownerId: row.ownerId,
    revision: row.revision,
    editable,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  }),
}));
vi.mock("../../product-governance/authorization", async original => ({
  ...await original<typeof import("../../product-governance/authorization")>(),
  requireObject: async (request: ObjectDecisionRequest) => {
    if (!("target" in request) || request.verb !== "USE" ||
      !products.has(`${request.target.kind.toLowerCase()}:${request.target.id}`))
      throw new HttpError(403, "Product access denied", "OBJECT_FORBIDDEN");
  },
  decideObjects: async (requests: ObjectDecisionRequest[]) => requests.map((request) => {
    if (!("target" in request)) throw new Error("Unexpected create decision");
    const row = products.get(`${request.target.kind.toLowerCase()}:${request.target.id}`);
    expect(request).toMatchObject({ ownerFacts: { ownerId: row?.ownerId, state: "PUBLISHED" } });
    return request.verb === "USE" ? { allowed: true } : { allowed: false, code: "FORBIDDEN", reason: "Read only" };
  }),
}));
vi.mock("../../../config/environment", () => ({
  environment: { agentRuntime: () => ({ callbackUrl: "http://workbench.test" }) },
}));
vi.mock("../../../config/application", () => ({
  config: { dataQuery: { baseUrl: "http://owner.test" } },
}));
vi.mock("../../../infrastructure/agent-runtime/client", () => ({
  RuntimeClient: class {
    run = mocks.run;
    session = mocks.session;
    request = mocks.request;
  },
}));
vi.mock("../../assistant/store", () => ({ assistantStore: { turn: async () => ({}) } }));
vi.mock("../../assistant/execution-setting", () => ({ resolveAgentExecution: mocks.resolve }));
vi.mock("../../assistant/skills", () => ({
  readAssistantSkillView: mocks.pages,
  resolvePageSkillSource: mocks.resolveMember,
  loadedPageSkillVersion: mocks.loadedMember,
}));
vi.mock("../../../utils/backend-client", async importOriginal => ({
  ...await importOriginal<typeof import("../../../utils/backend-client")>(),
  backendGet: mocks.backendGet,
  backendPost: mocks.backendPost,
  buildBackendHeaders: (token?: string, _x?: unknown, _l?: unknown, key?: string, headers?: Record<string, string>) => ({
    ...headers, ...(token ? { tk: token } : {}), ...(key ? { "X-API-Key": key } : {}),
  }),
}));
vi.mock("../../agent-host/caller", () => ({
  restoreAgentCaller: mocks.restore,
  readAgentSessionActor: mocks.sessionActor,
}));
vi.mock("../../agent-host/presentation", () => ({ publishObjectChanged: mocks.notify }));
vi.mock("../../scheduling/panel-reads", () => ({
  createScheduledTaskReadAdapter: (viewer: unknown) => ({
    list: () => mocks.listScheduledTasks(viewer),
  }),
}));
vi.mock("../../business-knowledge/panel-reads", () => ({
  createBusinessKnowledgeReadAdapter: (viewer: unknown) => ({
    query: (params: Record<string, unknown>) => mocks.queryKnowledge(viewer, params),
    counts: vi.fn(),
    record: vi.fn(),
    form: vi.fn(),
  }),
}));
vi.mock("../application-catalogue", async importOriginal => {
  const actual = await importOriginal<typeof import("../application-catalogue")>();
  return {
    ...actual,
    createApplicationReadAdapter: () => ({
      usedPanels: (primaryKey: string) => mocks.usedPanels(primaryKey),
    }),
  };
});
vi.mock("../component-catalogue", async importOriginal => {
  const actual = await importOriginal<typeof import("../component-catalogue")>();
  return {
    ...actual,
    readPanelComponentCatalogue: mocks.readCatalogue,
    readProjectionComponent: async (componentId: string) => {
      const cat = await mocks.readCatalogue();
      return cat.components.get(componentId);
    },
  };
});

import {
  dispatchHumanPanelOperation, prepareHumanPanelOperation,
  readPanelOperation,
} from "../operations";
import { readProductPanelData } from "../data-reads";

configureI18n({
  defaultLocale: "en",
  appTextLocale: "en",
  languageSwitchEnabled: true,
  packs: {
    en: {
      ...enLocaleMeta,
      messages: {
        ...en,
        "test.deleteRow": "Delete item",
        "test.revokeGrant": "Revoke grant",
        "test.archive": "Archive item",
        "test.inspectTask": "Inspect task",
        "test.deletePanel": "Delete panel",
        "test.detachPanel": "Detach panel",
      },
    },
  },
});

const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const owner = { domainId: "d", userId: "U" };
const credentials = { token: "U-token", locale: "en" };
const session = { providerId: "workbench", sessionId: uuid(1) };
const rootSession = { providerId: "ontology", sessionId: uuid(2) };
const skill = { namespace: { kind: "domain" as const, domainId: "d" }, name: "row-ops-skill" };

const now = new Date("2026-11-22T00:00:00.000Z");
type FixtureProduct = { kind: CurrentProductKind; row: CurrentProductRow };
function productRow(kind: CurrentProductKind, id: string, definition: Record<string, unknown>): FixtureProduct {
  return {
    kind,
    row: {
      id,
      domainId: "d",
      ownerId: "U",
      revision: 1,
      definition,
      createdAt: now,
      updatedAt: now,
    },
  };
}

function makePanel(id: string, manifest: ProductPanel["manifest"]): FixtureProduct {
  return productRow("panel", id, {
    name: id,
    description: `${id} panel`,
    visibility: "domain",
    manifest,
    content: { html: "<main></main>", module: "export default {};" },
  });
}

function makeProjection(
  id: string,
  def: Partial<Pick<ProductProjection, "outputs" | "config">> & Omit<ProductProjection, "id" | "domainId" | "ownerId" | "revision" | "editable" | "createdAt" | "updatedAt" | "name" | "description" | "visibility" | "outputs" | "config">,
): FixtureProduct {
  return productRow("projection", id, {
    name: id,
    description: `${id} projection`,
    visibility: "domain",
    outputs: {},
    config: {},
    ...def,
  });
}

let intents: Map<string, PanelOperationIntent>;
let automatic: boolean;
let currentRun: RuntimeRun;
let humanAnswer: Record<string, unknown> | null;
let products: Map<string, CurrentProductRow>;
let currentUse: ApplicationPanelUse;
let currentFramePanelId: string | undefined;

let storageVersion = 0;
function setProduct({ kind, row }: FixtureProduct) {
  products.set(`${kind}:${row.id}`, { ...row, storageVersion: String(++storageVersion) });
}

function registerMockOp(map: Record<string, serverOperations.PanelServerOperation>) {
  return vi.spyOn(serverOperations, "registeredPanelOperation").mockImplementation(id => {
    const handler = map[id];
    if (!handler) return undefined;
    return {
      handler,
      declaration: serverOperations.operationDeclaration(handler),
      targetType: handler.targetType,
    };
  });
}

beforeEach(() => {
  vi.resetAllMocks();
  intents = new Map();
  automatic = false;
  humanAnswer = null;
  products = new Map();
  currentFramePanelId = undefined;
  currentUse = {
    id: "tasks",
    pageKey: "tasks",
    path: "/applications/A/tasks",
    panelId: "P",
  };
  currentRun = {
    id: uuid(3),
    sessionId: session.sessionId,
    status: "running",
    executionUserId: null,
    channel: {
      agent: { providerId: "workbench", agentId: "agent" },
      actor: { id: uuid(4), domainId: "d" },
      authority: { classNames: [], executionKind: "live" },
      root: { session: rootSession, runId: uuid(10) },
      requestedBy: null,
      userRecipient: { session: rootSession, actor: { id: uuid(4), domainId: "d" } },
    },
    resolvedSkills: [{ skill, digest: `sha256:${"a".repeat(64)}` }],
  } as unknown as RuntimeRun;

  mocks.run.mockImplementation(async () => ({ run: currentRun }));
  mocks.resolve.mockImplementation(async () => ({ credentials }));
  mocks.findProduct.mockImplementation(async (_domainId: string, kind: CurrentProductKind, id: string) =>
    products.get(`${kind}:${id}`) ?? null);
  mocks.readCatalogue.mockResolvedValue({
    version: "1.0.0",
    digest: "sha256:test",
    components: new Map(sdkComponents.map(component => {
      const packageName = component.module.split("/", component.module.startsWith("@") ? 2 : 1).join("/");
      return [`${packageName}:${component.componentId}`, component];
    })),
  });
  mocks.backendGet.mockImplementation(async (_name: string, url: string) => {
    const registered = url.includes("/platform/applications/registered-entry");
    if (registered || url.includes("/platform/applications/resolve-entry")) {
      return {
        text: JSON.stringify({
          success: true,
          data: {
            applicationId: "A",
            use: currentUse,
            ...(currentFramePanelId && { framePanelId: currentFramePanelId }),
            ...(!registered && { menu: { singleEntry: true, groups: [], panelUses: [] } }),
          },
        }),
      };
    }
    throw new HttpError(404, `Unexpected backend GET: ${url}`, "NOT_FOUND");
  });
  mocks.pages.mockResolvedValue({ resolveSource: mocks.resolveMember });
  mocks.resolveMember.mockResolvedValue(skill);
  mocks.loadedMember.mockImplementation((ref: unknown, loaded: RuntimeRun["resolvedSkills"]) =>
    loaded.find(entry => JSON.stringify(entry.skill) === JSON.stringify(ref)) ?? null);
  mocks.restore.mockResolvedValue({ owner });
  mocks.session.mockImplementation(async () => ({ messages: humanAnswer ? [{ message: humanAnswer }] : [] }));
  mocks.request.mockImplementation(async (path: string, _method: string, body?: { source?: unknown }, questionId?: string) => {
    if (path === "/v1/channel/user-questions") {
      return {
        questionId: questionId ?? uuid(99),
        source: body?.source,
        recipient: { session: rootSession, actor: { id: uuid(4), domainId: "d" } },
      };
    }
    throw new Error(`Unexpected runtime request: ${path}`);
  });
  mocks.query.mockImplementation(async (sql: string, args: unknown[]) => {
    if (sql.startsWith("SELECT confirm_before")) {
      return { rows: automatic ? [{ confirm_before_execute: false }] : [] };
    }
    if (sql.startsWith("SELECT intent")) {
      const id = String(args[sql.startsWith("SELECT intent,owner_id") ? 1 : 2]);
      return { rows: intents.has(id) ? [{ intent: structuredClone(intents.get(id)), owner_id: owner.userId }] : [] };
    }
    if (sql.startsWith("INSERT INTO panel_operation_intents")) {
      const id = String(args[1]);
      if (!intents.has(id)) intents.set(id, structuredClone(args[4] as PanelOperationIntent));
      return { rows: [] };
    }
    if (sql.includes("AND intent->>'dispatched'='false'")) {
      const id = String(args[2]);
      const existing = intents.get(id);
      if (!existing || existing.dispatched) return { rowCount: 0, rows: [] };
      intents.set(id, structuredClone(args[3] as PanelOperationIntent));
      return { rowCount: 1, rows: [{ id }] };
    }
    if (sql.includes("jsonb_set")) {
      const id = String(args[2]);
      const existing = intents.get(id);
      if (existing) intents.set(id, { ...existing, outcome: JSON.parse(String(args[3])) });
      return { rowCount: 1, rows: [] };
    }
    return { rows: [] };
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("list row-scoped operations, batch availability, and server-pinned injection", () => {
  it("returns batch per-row operation availability alongside list data without N+1 requests", async () => {
    const unavailableBatch = vi.fn(async (_host, targets: readonly { target: { primaryKey: string }; rowKey: string }[]) => {
      const map = new Map<string, { reason: string }>();
      for (const entry of targets) {
        if (entry.target.primaryKey === "task-2") {
          map.set(entry.rowKey, { reason: "Built-in schedule cannot be deleted" });
        }
      }
      return map;
    });
    const unavailableSingle = vi.fn(async (_host, target: { primaryKey: string } | null) =>
      target!.primaryKey === "app-1" ? { reason: "Application is archived" } : undefined);

    const deleteTaskOp: serverOperations.PanelWriteServerOperation = {
      effect: "write",
      kind: "action",
      handlerRef: "schedules.deleteTask",
      labelKey: "test.deleteRow",
      binding: { kind: "PlatformOperation", id: "schedules.deleteTask" },
      targetType: TRIGGER,
      targetInput: "task",
      targetSchema: z.object({ kind: z.literal("object"), objectType: z.literal(TRIGGER), primaryKey: z.string() }),
      inputSchema: z.object({}).strict(),
      resultSchema: z.object({ deleted: z.boolean() }).strict(),
      batch: false,
      targetLabel: async (_host, target) => `Task:${target.primaryKey}`,
      unavailableBatch,
      execute: async () => ({ kind: "success", data: { deleted: true } }),
    };

    const revokeGrantOp: serverOperations.PanelWriteServerOperation = {
      effect: "write",
      kind: "action",
      handlerRef: "applications.revokeGrant",
      labelKey: "test.revokeGrant",
      binding: { kind: "PlatformOperation", id: "applications.revokeGrant" },
      targetType: APPLICATION,
      targetInput: "application",
      targetSchema: z.object({ kind: z.literal("object"), objectType: z.literal(APPLICATION), primaryKey: z.string() }),
      inputSchema: z.object({ taskId: z.string() }).strict(),
      resultSchema: z.object({ revoked: z.boolean() }).strict(),
      batch: false,
      targetLabel: async (_host, target) => `App:${target.primaryKey}`,
      unavailable: unavailableSingle,
      execute: async () => ({ kind: "success", data: { revoked: true } }),
    };

    registerMockOp({
      "schedules.deleteTask": deleteTaskOp,
      "applications.revokeGrant": revokeGrantOp,
    });

    const rows: PanelRecord[] = [
      { primaryKey: "task-1", className: TRIGGER, label: "Daily Sync", fields: { schedule: "0 0 * * *" } },
      { primaryKey: "task-2", className: TRIGGER, label: "System GC", fields: { schedule: "0 3 * * *" } },
      { primaryKey: "task-3", className: TRIGGER, label: "Weekly Report", fields: { schedule: "0 9 * * 1" } },
    ];
    mocks.listScheduledTasks.mockResolvedValue(rows);

    setProduct(makeProjection("list-proj", {
      componentId: "@ontomato/sdk:ObjectList",
      inputs: {
        app: { kind: "object", objectType: APPLICATION },
      },
      data: {
        rows: {
          source: { type: { kind: "PlatformObjectType", id: TRIGGER } },
          read: "list",
          params: {},
        },
      },
      operations: {
        remove: {
          operation: { kind: "PlatformOperation", id: "schedules.deleteTask" },
          target: { row: true },
        },
        revoke: {
          operation: { kind: "PlatformOperation", id: "applications.revokeGrant" },
          target: { input: "app" },
          params: { taskId: { rowField: "primaryKey" } },
        },
      },
    }));

    setProduct(makePanel("P", {
      state: {
        app: { type: { kind: "object", objectType: APPLICATION }, default: null, personal: false, deepLink: false, external: true },
      },
      members: {
        tasks: {
          target: { projectionId: "list-proj" },
          inputs: { app: { state: "app" } },
        },
      },
    }));

    const res = await readProductPanelData(owner, credentials, {
      source: { kind: "registered", applicationId: "A", useId: "tasks" },
      memberPath: [{ member: "tasks" }],
      dataName: "rows",
      inputs: { app: { className: APPLICATION, primaryKey: "app-1" } },
    });

    expect(res.status).toBe("ready");
    if (res.status !== "ready") throw new Error("expected ready");
    // unavailableBatch called once for all 3 rows, not 3 times.
    expect(unavailableBatch).toHaveBeenCalledTimes(1);
    // Shared outer target `app-1` deduplicated: called once across all 3 rows, not 3 times.
    expect(unavailableSingle).toHaveBeenCalledTimes(1);

    const k1 = panelRowOperationKey(rows[0]!, TRIGGER);
    const k2 = panelRowOperationKey(rows[1]!, TRIGGER);
    const k3 = panelRowOperationKey(rows[2]!, TRIGGER);
    expect(res.rowOperations).toEqual({
      [k1]: {
        remove: { available: true },
        revoke: { available: false, unavailable: { reason: "Application is archived" } },
      },
      [k2]: {
        remove: { available: false, unavailable: { reason: "Built-in schedule cannot be deleted" } },
        revoke: { available: false, unavailable: { reason: "Application is archived" } },
      },
      [k3]: {
        remove: { available: true },
        revoke: { available: false, unavailable: { reason: "Application is archived" } },
      },
    });
  });

  it.each([[2], [20]])("bounds RPCs for a member page of %i rows", async size => {
    setProduct(makeProjection("members-list", {
      componentId: "@ontomato/sdk:ObjectList",
      inputs: {},
      data: { rows: { source: { type: { kind: "PlatformObjectType", id: USER } }, read: "query", params: {} } },
      operations: {
        remove: { operation: { kind: "PlatformOperation", id: REMOVE_USER }, target: { row: true } },
        issue: { operation: { kind: "PlatformOperation", id: GENERATE_USER_API_KEY }, target: { row: true } },
        regenerate: { operation: { kind: "PlatformOperation", id: REGENERATE_USER_API_KEY }, target: { row: true } },
        revoke: { operation: { kind: "PlatformOperation", id: REVOKE_USER_API_KEY }, target: { row: true } },
      },
    }));
    setProduct(makePanel("P", { state: {}, members: { members: { target: { projectionId: "members-list" } } } }));
    const rows = Array.from({ length: size }, (_, i) => ({ primaryKey: `member-${i}`, label: `Member ${i}`, fields: {} }));
    mocks.backendPost.mockImplementation(async (_name: string, url: string) => {
      if (!url.endsWith("/panel/governance/users/query")) throw new Error(`Unexpected RPC: ${url}`);
      return { text: JSON.stringify({ success: true, data: { rows, total: size } }) };
    });
    const availabilityRpc = vi.fn(async (url: string) => {
      if (!/\/panel\/governance\/users\/(remove\/batch\/unavailable|api-key\/rows\/unavailable)$/.test(url)) throw new Error(`Unexpected RPC: ${url}`);
      return Response.json({ success: true, data: {} });
    });
    vi.stubGlobal("fetch", availabilityRpc);

    const res = await readProductPanelData(owner, credentials, {
      source: { kind: "registered", applicationId: "A", useId: "tasks" },
      memberPath: [{ member: "members" }], dataName: "rows", inputs: {},
    });

    expect(res).toMatchObject({ status: "ready", value: { rows, total: size } });
    expect(mocks.backendGet.mock.calls.length).toBeLessThanOrEqual(1);
    expect(mocks.backendPost.mock.calls.length).toBeLessThanOrEqual(1);
    // Round 2 #4: the four row operations each resolve the whole page in one batch owner read.
    expect(availabilityRpc.mock.calls.length).toBeLessThanOrEqual(4);
  });

  it("executes row-scoped operations on human and agent channels and rejects wrong target class", async () => {
    const executed: Array<{ target: unknown; input: unknown }> = [];
    const deleteTaskOp: serverOperations.PanelWriteServerOperation = {
      effect: "write",
      kind: "action",
      handlerRef: "schedules.deleteTask",
      labelKey: "test.deleteRow",
      binding: { kind: "PlatformOperation", id: "schedules.deleteTask" },
      targetType: TRIGGER,
      targetInput: "task",
      targetSchema: z.object({ kind: z.literal("object"), objectType: z.literal(TRIGGER), primaryKey: z.string() }),
      inputSchema: z.object({ note: z.string().optional(), source: z.string() }).strict(),
      resultSchema: z.object({ deleted: z.boolean() }).strict(),
      batch: false,
      targetLabel: async (_host, target) => `Task:${target.primaryKey}`,
      execute: async (_host, target, input) => {
        executed.push({ target, input });
        return { kind: "success", data: { deleted: true } };
      },
    };
    registerMockOp({ "schedules.deleteTask": deleteTaskOp });

    setProduct(makeProjection("list-proj", {
      componentId: "@ontomato/sdk:ObjectList",
      inputs: {},
      data: {
        rows: {
          source: { type: { kind: "PlatformObjectType", id: TRIGGER } },
          read: "list",
          params: {},
        },
      },
      operations: {
        remove: {
          operation: { kind: "PlatformOperation", id: "schedules.deleteTask" },
          target: { row: true },
          params: {
            note: { rowField: "schedule" },
            source: { literal: "list-action-column" },
          },
        },
      },
    }));

    setProduct(makePanel("P", {
      state: {},
      members: {
        tasks: { target: { projectionId: "list-proj" } },
      },
    }));

    // 1. Human channel succeeds; server injects literal param `source`.
    const humanReq: CreatePanelHumanOperationIntentRequest = {
      applicationId: "A",
      useId: "tasks",
      operationId: "tasks.remove",
      call: {
        target: { kind: "object", objectType: TRIGGER, primaryKey: "task-2" },
        input: { note: "0 3 * * *" },
      },
    };
    const prepared = await prepareHumanPanelOperation(owner, credentials, humanReq);
    expect(prepared.intentId).toBeTruthy();
    const dispatched = await dispatchHumanPanelOperation(owner, credentials, prepared.intentId);
    expect(dispatched.kind).toBe("dispatched");
    if (dispatched.kind === "dispatched") expect(dispatched.outcome?.kind).toBe("success");
    expect(executed).toEqual([
      {
        target: { kind: "object", objectType: TRIGGER, primaryKey: "task-2" },
        input: { note: "0 3 * * *", source: "list-action-column" },
      },
    ]);

    // 2. Rejects tampered literal param on human channel.
    await expect(prepareHumanPanelOperation(owner, credentials, {
      applicationId: "A",
      useId: "tasks",
      operationId: "tasks.remove",
      call: {
        target: { kind: "object", objectType: TRIGGER, primaryKey: "task-2" },
        input: { note: "0 3 * * *", source: "tampered" },
      },
    })).rejects.toMatchObject({ code: "OPERATION_PARAM_MISMATCH" });

    // 3. Rejects mismatched objectType for target: { row: true }.
    await expect(prepareHumanPanelOperation(owner, credentials, {
      applicationId: "A",
      useId: "tasks",
      operationId: "tasks.remove",
      call: {
        target: { kind: "object", objectType: BUSINESS_KNOWLEDGE, primaryKey: "bk-1" },
        input: { note: "0 3 * * *" },
      },
    })).rejects.toMatchObject({ code: "TARGET_ID_MISMATCH" });

    // 4. Agent channel succeeds with confirmation and server-injected literal param.
    const agentIntent = await prepareHumanPanelOperation(owner, credentials, {
      agentRun: { runId: currentRun.id, sessionId: currentRun.sessionId, toolCallId: "remove-task" },
      applicationId: "A",
      useId: "tasks",
      operationId: "tasks.remove",
      call: {
        target: { kind: "object", objectType: TRIGGER, primaryKey: "task-1" },
        input: { note: "0 0 * * *" },
      },
    });
    expect(intents.get(agentIntent.intentId)?.source.kind).toBe("agent-page");
    const agentDone = await dispatchHumanPanelOperation(owner, credentials, agentIntent.intentId);
    expect(agentDone.kind).toBe("dispatched");
    if (agentDone.kind === "dispatched") expect(agentDone.outcome?.kind).toBe("success");
    expect(executed[1]).toEqual({
      target: { kind: "object", objectType: TRIGGER, primaryKey: "task-1" },
      input: { note: "0 0 * * *", source: "list-action-column" },
    });
  });

  it("enforces entry-pinned and nested-panel-pinned targets and bound params server-side against client tampering", async () => {
    const executed: Array<{ target: unknown; input: unknown }> = [];
    const revokeOp: serverOperations.PanelWriteServerOperation = {
      effect: "write",
      kind: "action",
      handlerRef: "applications.revokeGrant",
      labelKey: "test.revokeGrant",
      binding: { kind: "PlatformOperation", id: "applications.revokeGrant" },
      targetType: APPLICATION,
      targetInput: "application",
      targetSchema: z.object({ kind: z.literal("object"), objectType: z.literal(APPLICATION), primaryKey: z.string() }),
      inputSchema: z.object({ scope: z.string(), rowId: z.string(), fixedTag: z.string() }).strict(),
      resultSchema: z.object({ ok: z.boolean() }).strict(),
      batch: false,
      targetLabel: async (_host, target) => `App:${target.primaryKey}`,
      execute: async (_host, target, input) => {
        executed.push({ target, input });
        return { kind: "success", data: { ok: true } };
      },
    };
    registerMockOp({ "applications.revokeGrant": revokeOp });

    // Entry pins `app` and `scope` as server-verified literals.
    currentUse = {
      id: "tasks",
      pageKey: "tasks",
      path: "/applications/A/tasks",
      panelId: "P",
      inputs: {
        pinnedApp: { literal: { className: APPLICATION, primaryKey: "app-pinned" } },
        pinnedScope: { literal: "tenant-prod" },
      },
    };

    setProduct(makeProjection("child-list", {
      componentId: "@ontomato/sdk:ObjectList",
      inputs: {
        app: { kind: "object", objectType: APPLICATION },
        scope: { kind: "scalar", type: "string" },
      },
      data: {
        rows: {
          source: { type: { kind: "PlatformObjectType", id: TRIGGER } },
          read: "list",
          params: {},
        },
      },
      operations: {
        revoke: {
          operation: { kind: "PlatformOperation", id: "applications.revokeGrant" },
          target: { input: "app" },
          params: {
            scope: { input: "scope" },
            rowId: { rowField: "primaryKey" },
            fixedTag: { literal: "server-only" },
          },
        },
      },
    }));

    setProduct(makePanel("CHILD", {
      state: {
        childApp: { type: { kind: "object", objectType: APPLICATION }, default: null, personal: false, deepLink: false, external: true },
        childScope: { type: { kind: "scalar", type: "string" }, default: null, personal: false, deepLink: false, external: true },
      },
      members: {
        rows: {
          target: { projectionId: "child-list" },
          inputs: {
            app: { state: "childApp" },
            scope: { state: "childScope" },
          },
        },
      },
    }));

    setProduct(makePanel("P", {
      state: {
        pinnedApp: { type: { kind: "object", objectType: APPLICATION }, default: null, personal: false, deepLink: false, external: true },
        pinnedScope: { type: { kind: "scalar", type: "string" }, default: null, personal: false, deepLink: false, external: true },
      },
      members: {
        nested: {
          target: { panelId: "CHILD" },
          inputs: {
            childApp: { state: "pinnedApp" },
            childScope: { state: "pinnedScope" },
          },
        },
      },
    }));

    // 1. Tampering with pinned outer target is rejected.
    await expect(prepareHumanPanelOperation(owner, credentials, {
      applicationId: "A",
      useId: "tasks",
      memberPath: [{ member: "nested" }, { member: "rows" }],
      operationId: "nested.rows.revoke",
      call: {
        target: { kind: "object", objectType: APPLICATION, primaryKey: "app-other" },
        input: { rowId: "row-1" },
      },
    })).rejects.toMatchObject({ code: "TARGET_ID_MISMATCH" });

    // 2. Tampering with entry-pinned bound param `scope` is rejected.
    await expect(prepareHumanPanelOperation(owner, credentials, {
      applicationId: "A",
      useId: "tasks",
      memberPath: [{ member: "nested" }, { member: "rows" }],
      operationId: "nested.rows.revoke",
      call: {
        target: { kind: "object", objectType: APPLICATION, primaryKey: "app-pinned" },
        input: { scope: "evil-scope", rowId: "row-1" },
      },
    })).rejects.toMatchObject({ code: "OPERATION_PARAM_MISMATCH" });

    // 3. Valid request has pinned `scope` and literal `fixedTag` automatically injected server-side.
    const prepared = await prepareHumanPanelOperation(owner, credentials, {
      applicationId: "A",
      useId: "tasks",
      memberPath: [{ member: "nested" }, { member: "rows" }],
      operationId: "nested.rows.revoke",
      call: {
        target: { kind: "object", objectType: APPLICATION, primaryKey: "app-pinned" },
        input: { rowId: "row-1" },
      },
    });
    expect(prepared.intentId).toBeTruthy();
    const done = await dispatchHumanPanelOperation(owner, credentials, prepared.intentId);
    expect(done.kind).toBe("dispatched");
    if (done.kind === "dispatched") expect(done.outcome?.kind).toBe("success");
    expect(executed).toEqual([
      {
        target: { kind: "object", objectType: APPLICATION, primaryKey: "app-pinned" },
        input: { scope: "tenant-prod", rowId: "row-1", fixedTag: "server-only" },
      },
    ]);
  });

  it("admits row reads without a selection and requires a concrete target with server-bound parameters", async () => {
    const readOp: serverOperations.PanelReadServerOperation = {
      effect: "read",
      kind: "action",
      batch: false,
      handlerRef: "schedules.inspectTask",
      labelKey: "test.inspectTask",
      binding: { kind: "PlatformOperation", id: "schedules.inspectTask" },
      target: { source: "input", input: "task" },
      targetType: TRIGGER,
      targetSchema: z.object({ kind: z.literal("object"), objectType: z.literal(TRIGGER), primaryKey: z.string() }),
      inputSchema: z.object({ fixedTag: z.string(), env: z.string(), taskId: z.string(), detail: z.string().optional() }).strict(),
      resultSchema: z.object({ kind: z.literal("json"), value: runtimeJsonObjectSchema }),
      execute: async (_host, call) => ({ kind: "json", value: call.input }),
    };
    registerMockOp({ "schedules.inspectTask": readOp });

    setProduct(makeProjection("list-read-op", {
      componentId: "@ontomato/sdk:ObjectList",
      inputs: {
        env: { kind: "scalar", type: "string" },
      },
      data: {
        rows: {
          source: { type: { kind: "PlatformObjectType", id: TRIGGER } },
          read: "list",
          params: {},
        },
      },
      operations: {
        inspect: {
          operation: { kind: "PlatformOperation", id: "schedules.inspectTask" },
          target: { row: true },
          params: {
            fixedTag: { literal: "server-literal" },
            env: { input: "env" },
            taskId: { row: "primaryKey" },
          },
        },
      },
    }));

    setProduct(makePanel("P", {
      state: {},
      members: {
        tasks: {
          target: { projectionId: "list-read-op" },
          inputs: { env: { literal: "prod" } },
        },
      },
    }));

    await expect(readProductPanelData(owner, credentials, {
      source: { kind: "registered", applicationId: "A", useId: "tasks" },
      memberPath: [{ member: "tasks" }],
      operations: true,
      inputs: {},
    })).resolves.toMatchObject({
      status: "ready",
      value: { inspect: { effect: "read", target: { source: "row" } } },
    });

    await expect(readPanelOperation(owner, credentials, {
      applicationId: "A",
      useId: "tasks",
      operationId: "tasks.inspect",
      call: { input: {} },
    })).rejects.toBeInstanceOf(z.ZodError);

    // Tampering with literal param is rejected.
    await expect(readPanelOperation(owner, credentials, {
      applicationId: "A",
      useId: "tasks",
      operationId: "tasks.inspect",
      call: {
        target: { kind: "object", objectType: TRIGGER, primaryKey: "task-7" },
        input: { fixedTag: "tampered", detail: "full" },
      },
    })).rejects.toMatchObject({ code: "OPERATION_PARAM_MISMATCH" });

    // Tampering with pinned input param is rejected.
    await expect(readPanelOperation(owner, credentials, {
      applicationId: "A",
      useId: "tasks",
      operationId: "tasks.inspect",
      call: {
        target: { kind: "object", objectType: TRIGGER, primaryKey: "task-7" },
        input: { env: "staging", detail: "full" },
      },
    })).rejects.toMatchObject({ code: "OPERATION_PARAM_MISMATCH" });

    // Tampering with row primaryKey param under target: { row: true } is rejected.
    await expect(readPanelOperation(owner, credentials, {
      applicationId: "A",
      useId: "tasks",
      operationId: "tasks.inspect",
      call: {
        target: { kind: "object", objectType: TRIGGER, primaryKey: "task-7" },
        input: { taskId: "task-other", detail: "full" },
      },
    })).rejects.toMatchObject({ code: "OPERATION_PARAM_MISMATCH" });

    // Valid call receives all bound params injected server-side alongside editable `detail`.
    const res = await readPanelOperation(owner, credentials, {
      applicationId: "A",
      useId: "tasks",
      operationId: "tasks.inspect",
      call: {
        target: { kind: "object", objectType: TRIGGER, primaryKey: "task-7" },
        input: { detail: "full" },
      },
    });
    expect(res).toEqual({
      kind: "json",
      value: {
        fixedTag: "server-literal",
        env: "prod",
        taskId: "task-7",
        detail: "full",
      },
    });
  });

  it("aligns server rowOperations keys and row targets with read declaration rowType for cross-type rows without className", async () => {
    const observedBatchTargets: Array<{ rowKey: string; target: { objectType: string; primaryKey: string } }> = [];
    const unavailableBatch = vi.fn(async (
      _host,
      targets: readonly { target: { objectType: string; primaryKey: string }; rowKey: string }[],
    ) => {
      observedBatchTargets.push(...targets);
      const map = new Map<string, { reason: string }>();
      for (const entry of targets) {
        if (entry.target.primaryKey === "panel-builtin") {
          map.set(entry.rowKey, { reason: "Built-in panel cannot be deleted" });
        }
      }
      return map;
    });
    const observedParentTargets: Array<{ objectType: string; primaryKey: string }> = [];
    const unavailableParent = vi.fn(async (_host, target: { objectType: string; primaryKey: string } | null) => {
      observedParentTargets.push(target!);
      return target!.primaryKey === "app-1" ? { reason: "Application is locked" } : undefined;
    });

    const deletePanelOp: serverOperations.PanelWriteServerOperation = {
      effect: "write",
      kind: "action",
      handlerRef: "productPanels.delete",
      labelKey: "test.deletePanel",
      binding: { kind: "PlatformOperation", id: "productPanels.delete" },
      targetType: PRODUCT_PANEL,
      targetInput: "panel",
      targetSchema: z.object({ kind: z.literal("object"), objectType: z.literal(PRODUCT_PANEL), primaryKey: z.string() }),
      inputSchema: z.object({}).strict(),
      resultSchema: z.object({ deleted: z.boolean() }).strict(),
      batch: false,
      targetLabel: async (_host, target) => `Panel:${target.primaryKey}`,
      unavailableBatch,
      execute: async () => ({ kind: "success", data: { deleted: true } }),
    };

    const detachPanelOp: serverOperations.PanelWriteServerOperation = {
      effect: "write",
      kind: "action",
      handlerRef: "applications.detachPanel",
      labelKey: "test.detachPanel",
      binding: { kind: "PlatformOperation", id: "applications.detachPanel" },
      targetType: APPLICATION,
      targetInput: "application",
      targetSchema: z.object({ kind: z.literal("object"), objectType: z.literal(APPLICATION), primaryKey: z.string() }),
      inputSchema: z.object({ panelId: z.string() }).strict(),
      resultSchema: z.object({ detached: z.boolean() }).strict(),
      batch: false,
      targetLabel: async (_host, target) => `App:${target.primaryKey}`,
      unavailable: unavailableParent,
      execute: async () => ({ kind: "success", data: { detached: true } }),
    };

    registerMockOp({
      "productPanels.delete": deletePanelOp,
      "applications.detachPanel": detachPanelOp,
    });

    // Cross-type `platform:Application.usedPanels` declares `rowType: platform:ProductPanel`.
    // First two rows intentionally omit `className`; third row carries an explicit `className`.
    const rows: PanelRecord[] = [
      { primaryKey: "panel-custom", label: "Custom Panel", fields: {} },
      { primaryKey: "panel-builtin", label: "Built-in Panel", fields: {} },
      { primaryKey: "panel-explicit", className: PRODUCT_PANEL, label: "Explicit Panel", fields: {} },
    ];
    mocks.usedPanels.mockResolvedValue(rows);

    setProduct(makeProjection("used-panels-proj", {
      componentId: "@ontomato/sdk:ObjectList",
      inputs: {
        app: { kind: "object", objectType: APPLICATION },
      },
      data: {
        rows: {
          source: { object: { input: "app" } },
          read: "usedPanels",
          params: {},
        },
      },
      operations: {
        deletePanel: {
          operation: { kind: "PlatformOperation", id: "productPanels.delete" },
          target: { row: true },
        },
        detachPanel: {
          operation: { kind: "PlatformOperation", id: "applications.detachPanel" },
          target: { input: "app" },
          params: { panelId: { row: "primaryKey" } },
        },
      },
    }));

    setProduct(makePanel("P", {
      state: {
        app: { type: { kind: "object", objectType: APPLICATION }, default: null, personal: false, deepLink: false, external: true },
      },
      members: {
        panels: {
          target: { projectionId: "used-panels-proj" },
          inputs: { app: { state: "app" } },
        },
      },
    }));

    const res = await readProductPanelData(owner, credentials, {
      source: { kind: "registered", applicationId: "A", useId: "tasks" },
      memberPath: [{ member: "panels" }],
      dataName: "rows",
      inputs: { app: { className: APPLICATION, primaryKey: "app-1" } },
    });

    expect(res.status).toBe("ready");
    if (res.status !== "ready") throw new Error("expected ready");

    // Row-targeted availability checks receive `objectType: PRODUCT_PANEL` (from `rowType`), not parent `APPLICATION`.
    expect(observedBatchTargets.map(entry => ({
      rowKey: entry.rowKey,
      objectType: entry.target.objectType,
      primaryKey: entry.target.primaryKey,
    }))).toEqual([
      { rowKey: panelRowOperationKey(rows[0]!, PRODUCT_PANEL), objectType: PRODUCT_PANEL, primaryKey: "panel-custom" },
      { rowKey: panelRowOperationKey(rows[1]!, PRODUCT_PANEL), objectType: PRODUCT_PANEL, primaryKey: "panel-builtin" },
      { rowKey: panelRowOperationKey(rows[2]!, PRODUCT_PANEL), objectType: PRODUCT_PANEL, primaryKey: "panel-explicit" },
    ]);

    // Parent-targeted availability check still resolves `objectType: APPLICATION` (deduplicated once).
    expect(observedParentTargets).toEqual([{ kind: "object", objectType: APPLICATION, primaryKey: "app-1" }]);

    // Server keys match frontend `panelRowOperationKey(row, rowType)` exactly, preserving disabled reasons.
    const kCustom = panelRowOperationKey(rows[0]!, PRODUCT_PANEL);
    const kBuiltin = panelRowOperationKey(rows[1]!, PRODUCT_PANEL);
    const kExplicit = panelRowOperationKey(rows[2]!, PRODUCT_PANEL);
    expect(res.rowOperations).toEqual({
      [kCustom]: {
        deletePanel: { available: true },
        detachPanel: { available: false, unavailable: { reason: "Application is locked" } },
      },
      [kBuiltin]: {
        deletePanel: { available: false, unavailable: { reason: "Built-in panel cannot be deleted" } },
        detachPanel: { available: false, unavailable: { reason: "Application is locked" } },
      },
      [kExplicit]: {
        deletePanel: { available: true },
        detachPanel: { available: false, unavailable: { reason: "Application is locked" } },
      },
    });
    // Must not emit stale parent-type keys.
    expect(res.rowOperations?.[panelRowOperationKey(rows[1]!, APPLICATION)]).toBeUndefined();
  });

  it("evaluates declarative multi-target row operations across heterogeneous row classNames and skips disallowed types", async () => {
    const rows: PanelRecord[] = [
      { primaryKey: "app-1", className: APPLICATION, label: "Dashboards", fields: { name: "Dashboards" } },
      { primaryKey: "agent-1", className: AGENT_DEFINITION, label: "Analyst", fields: { name: "Analyst" } },
      { primaryKey: "panel-1", className: PRODUCT_PANEL, label: "Custom Panel", fields: { name: "Custom Panel" } },
    ];
    mocks.usedPanels.mockResolvedValueOnce(rows);

    const observedTargets: Array<{ objectType: string; primaryKey: string }> = [];
    const multiTargetOp: serverOperations.PanelWriteServerOperation = {
      handlerRef: "favorites.add",
      binding: { kind: "PlatformOperation", id: "favorites.add" },
      kind: "action",
      effect: "write",
      targetInput: "target",
      targetTypes: { platformTypes: [APPLICATION, AGENT_DEFINITION] },
      targetSchema: z.object({ kind: z.literal("object"), objectType: z.string(), primaryKey: z.string() }),
      inputSchema: z.object({}).strict(),
      resultSchema: z.object({ pinned: z.boolean() }).strict(),
      batch: false,
      targetLabel: async (_host, target) => target.primaryKey,
      unavailableBatch: async (_host, targets) => {
        const out = new Map<string, { reason: string } | undefined>();
        for (const item of targets) {
          observedTargets.push({ objectType: item.target.objectType, primaryKey: item.target.primaryKey });
          out.set(item.rowKey, item.target.primaryKey === "agent-1" ? { reason: "Already pinned" } : undefined);
        }
        return out;
      },
      execute: async () => ({ kind: "success", data: { pinned: true } }),
    };

    registerMockOp({ "favorites.add": multiTargetOp });

    setProduct(makeProjection("hetero-proj", {
      componentId: "@ontomato/sdk:ObjectList",
      inputs: { app: { kind: "object", objectType: APPLICATION } },
      data: {
        rows: {
          source: { object: { input: "app" } },
          read: "usedPanels",
          params: {},
        },
      },
      operations: {
        pin: {
          operation: { kind: "PlatformOperation", id: "favorites.add" },
          target: { row: true },
        },
      },
    }));

    setProduct(makePanel("P", {
      state: {
        app: { type: { kind: "object", objectType: APPLICATION }, default: null, personal: false, deepLink: false, external: true },
      },
      members: {
        items: {
          target: { projectionId: "hetero-proj" },
          inputs: { app: { state: "app" } },
        },
      },
    }));

    const res = await readProductPanelData(owner, credentials, {
      source: { kind: "registered", applicationId: "A", useId: "tasks" },
      memberPath: [{ member: "items" }],
      dataName: "rows",
      inputs: { app: { className: APPLICATION, primaryKey: "app-1" } },
    });

    expect(res.status).toBe("ready");
    if (res.status !== "ready") throw new Error("expected ready");

    // Only rows whose className matches `targetTypes` are sent to `unavailableBatch`.
    expect(observedTargets).toEqual([
      { objectType: APPLICATION, primaryKey: "app-1" },
      { objectType: AGENT_DEFINITION, primaryKey: "agent-1" },
    ]);

    const kApp = panelRowOperationKey(rows[0]!, PRODUCT_PANEL);
    const kAgent = panelRowOperationKey(rows[1]!, PRODUCT_PANEL);
    const kPanel = panelRowOperationKey(rows[2]!, PRODUCT_PANEL);
    expect(res.rowOperations).toEqual({
      [kApp]: { pin: { available: true } },
      [kAgent]: { pin: { available: false, unavailable: { reason: "Already pinned" } } },
      [kPanel]: { pin: { available: false } },
    });
  });
});
