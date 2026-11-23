import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import {
  isPanelHumanOperationIntent, type CreatePanelHumanOperationIntentRequest, type CreatePanelOperationIntentRequest,
  type PanelOperationIntent,
} from "@ontomato/contracts/panel-agent";
import { APPLICATION, BUSINESS_KNOWLEDGE, SCHEDULED_TASK } from "@ontomato/contracts/platform-object-types";
import type { PanelRecord } from "@ontomato/contracts/panel-projection";
import { panelRowOperationKey } from "@ontomato/contracts/panel-projection";
import type { ApplicationPanelUse, ProductPanel, ProductProjection } from "@ontomato/contracts/product-panels";
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
  requireGrant: vi.fn(),
  grantedIds: vi.fn(),
  findProduct: vi.fn(),
  listScheduledTasks: vi.fn(),
  queryKnowledge: vi.fn(),
  readOntologyObjects: vi.fn(),
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
vi.mock("../../product-governance/grants", () => ({
  requireProductGrant: mocks.requireGrant,
  grantedProductIds: mocks.grantedIds,
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
vi.mock("../../platform-ontology/panel-reads", () => ({
  createPlatformOntologyReadAdapter: (owner: unknown, viewer: unknown) => ({
    objects: (params: Record<string, unknown>) => mocks.readOntologyObjects(owner, viewer, params),
  }),
}));
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
  dispatchHumanPanelOperation, dispatchPanel, operatePanel as realOperatePanel, prepareHumanPanelOperation,
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
const operatePanel = (
  runId: string,
  input: CreatePanelOperationIntentRequest,
) => realOperatePanel(owner, credentials, runId, input, "Alice");

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

function setProduct({ kind, row }: FixtureProduct) {
  products.set(`${kind}:${row.id}`, row);
}

function approveAgentIntent(intentId: string) {
  const intent = intents.get(intentId)!;
  if (isPanelHumanOperationIntent(intent)) throw new Error("Expected agent intent");
  humanAnswer = {
    role: "notification",
    kind: "agent-answer",
    replyTo: intent.questionId,
    source: { kind: "user" },
    answerId: uuid(11),
  };
}

function registerMockOp(map: Record<string, serverOperations.PanelServerOperation>) {
  return vi.spyOn(serverOperations, "registeredPanelOperation").mockImplementation(id => {
    const handler = map[id];
    if (!handler) return undefined;
    return {
      handler,
      declaration: serverOperations.operationDeclaration(handler),
      targetType: handler.effect === "write" ? handler.targetType : undefined,
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
    access: { kind: "domain-member" },
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
  mocks.requireGrant.mockResolvedValue(undefined);
  mocks.grantedIds.mockResolvedValue([]);
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
    if (url.includes("/platform/applications/resolve-entry")) {
      return {
        text: JSON.stringify({
          success: true,
          data: {
            applicationId: "A",
            use: currentUse,
            ...(currentFramePanelId && { framePanelId: currentFramePanelId }),
            menu: { groups: [], panelUses: [] },
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
    const intent = [...intents.values()].find(item => !isPanelHumanOperationIntent(item));
    return {
      questionId: intent && !isPanelHumanOperationIntent(intent) ? intent.questionId : uuid(99),
      answerId: uuid(11),
      source: { kind: "user" },
      respondent: { id: uuid(12), domainId: "d" },
      recipientSession: rootSession,
      selectedOption: 1,
      text: "Execute",
    };
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
    const unavailableSingle = vi.fn(async (_host, target: { primaryKey: string }) =>
      target.primaryKey === "app-1" ? { reason: "Application is archived" } : undefined);

    const deleteTaskOp: serverOperations.PanelWriteServerOperation = {
      effect: "write",
      kind: "action",
      handlerRef: "schedules.deleteTask",
      labelKey: "test.deleteRow",
      binding: { kind: "PlatformOperation", id: "schedules.deleteTask" },
      targetType: SCHEDULED_TASK,
      targetInput: "task",
      targetSchema: z.object({ kind: z.literal("object"), objectType: z.literal(SCHEDULED_TASK), primaryKey: z.string() }),
      inputSchema: z.object({}).strict(),
      resultSchema: z.object({ deleted: z.boolean() }).strict(),
      batch: false,
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
      unavailable: unavailableSingle,
      execute: async () => ({ kind: "success", data: { revoked: true } }),
    };

    registerMockOp({
      "schedules.deleteTask": deleteTaskOp,
      "applications.revokeGrant": revokeGrantOp,
    });

    const rows: PanelRecord[] = [
      { primaryKey: "task-1", className: SCHEDULED_TASK, label: "Daily Sync", fields: { schedule: "0 0 * * *" } },
      { primaryKey: "task-2", className: SCHEDULED_TASK, label: "System GC", fields: { schedule: "0 3 * * *" } },
      { primaryKey: "task-3", className: SCHEDULED_TASK, label: "Weekly Report", fields: { schedule: "0 9 * * 1" } },
    ];
    mocks.listScheduledTasks.mockResolvedValue(rows);

    setProduct(makeProjection("list-proj", {
      componentId: "@ontomato/sdk:ObjectList",
      inputs: {
        app: { kind: "object", objectType: APPLICATION },
      },
      data: {
        rows: {
          source: { type: { kind: "PlatformObjectType", id: SCHEDULED_TASK } },
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
        app: { type: { kind: "object", objectType: APPLICATION }, default: null },
      },
      members: {
        tasks: {
          target: { projectionId: "list-proj" },
          inputs: { app: { state: "app" } },
        },
      },
    }));

    const res = await readProductPanelData(owner, credentials, {
      source: { kind: "application", applicationId: "A", useId: "tasks" },
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

    const k1 = panelRowOperationKey(rows[0]!, SCHEDULED_TASK);
    const k2 = panelRowOperationKey(rows[1]!, SCHEDULED_TASK);
    const k3 = panelRowOperationKey(rows[2]!, SCHEDULED_TASK);
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

  it("executes row-scoped operations on human and agent channels and rejects wrong target class", async () => {
    const executed: Array<{ target: unknown; input: unknown }> = [];
    const deleteTaskOp: serverOperations.PanelWriteServerOperation = {
      effect: "write",
      kind: "action",
      handlerRef: "schedules.deleteTask",
      labelKey: "test.deleteRow",
      binding: { kind: "PlatformOperation", id: "schedules.deleteTask" },
      targetType: SCHEDULED_TASK,
      targetInput: "task",
      targetSchema: z.object({ kind: z.literal("object"), objectType: z.literal(SCHEDULED_TASK), primaryKey: z.string() }),
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
          source: { type: { kind: "PlatformObjectType", id: SCHEDULED_TASK } },
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
      intentId: uuid(101),
      applicationId: "A",
      useId: "tasks",
      operationId: "tasks.remove",
      call: {
        target: { kind: "object", objectType: SCHEDULED_TASK, primaryKey: "task-2" },
        input: { note: "0 3 * * *" },
      },
    };
    const prepared = await prepareHumanPanelOperation(owner, credentials, humanReq);
    expect(prepared.intentId).toBeTruthy();
    const dispatched = await dispatchHumanPanelOperation(owner, credentials, prepared.intentId);
    expect(dispatched.kind).toBe("dispatched");
    if (dispatched.kind === "dispatched") expect(dispatched.outcome.kind).toBe("success");
    expect(executed).toEqual([
      {
        target: { kind: "object", objectType: SCHEDULED_TASK, primaryKey: "task-2" },
        input: { note: "0 3 * * *", source: "list-action-column" },
      },
    ]);

    // 2. Rejects tampered literal param on human channel.
    await expect(prepareHumanPanelOperation(owner, credentials, {
      ...humanReq,
      intentId: uuid(102),
      call: {
        target: { kind: "object", objectType: SCHEDULED_TASK, primaryKey: "task-2" },
        input: { note: "0 3 * * *", source: "tampered" },
      },
    })).rejects.toMatchObject({ code: "OPERATION_PARAM_MISMATCH" });

    // 3. Rejects mismatched objectType for target: { row: true }.
    await expect(prepareHumanPanelOperation(owner, credentials, {
      ...humanReq,
      intentId: uuid(103),
      call: {
        target: { kind: "object", objectType: BUSINESS_KNOWLEDGE, primaryKey: "bk-1" },
        input: { note: "0 3 * * *" },
      },
    })).rejects.toMatchObject({ code: "TARGET_ID_MISMATCH" });

    // 4. Agent channel succeeds with confirmation and server-injected literal param.
    const agentIntent = await operatePanel(currentRun.id, {
      intentId: uuid(104),
      applicationId: "A",
      useId: "tasks",
      operationId: "tasks.remove",
      call: {
        target: { kind: "object", objectType: SCHEDULED_TASK, primaryKey: "task-1" },
        input: { note: "0 0 * * *" },
      },
    });
    expect(agentIntent.kind).toBe("confirmation-required");
    approveAgentIntent(uuid(104));
    const agentDone = await dispatchPanel(owner, credentials, currentRun.id, uuid(104));
    expect(agentDone.kind).toBe("dispatched");
    if (agentDone.kind === "dispatched") expect(agentDone.outcome?.kind).toBe("success");
    expect(executed[1]).toEqual({
      target: { kind: "object", objectType: SCHEDULED_TASK, primaryKey: "task-1" },
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
      access: { kind: "domain-member" },
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
          source: { type: { kind: "PlatformObjectType", id: SCHEDULED_TASK } },
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
        childApp: { type: { kind: "object", objectType: APPLICATION }, default: null },
        childScope: { type: { kind: "scalar", type: "string" }, default: null },
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
        pinnedApp: { type: { kind: "object", objectType: APPLICATION }, default: null },
        pinnedScope: { type: { kind: "scalar", type: "string" }, default: null },
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
      intentId: uuid(201),
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
      intentId: uuid(202),
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
      intentId: uuid(203),
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
    if (done.kind === "dispatched") expect(done.outcome.kind).toBe("success");
    expect(executed).toEqual([
      {
        target: { kind: "object", objectType: APPLICATION, primaryKey: "app-pinned" },
        input: { scope: "tenant-prod", rowId: "row-1", fixedTag: "server-only" },
      },
    ]);
  });
});
