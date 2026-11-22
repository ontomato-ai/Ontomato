import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import {
  isPanelHumanOperationIntent, type CreatePanelHumanOperationIntentRequest, type CreatePanelOperationIntentRequest,
  type PanelOperationIntent,
} from "@ontomato/contracts/panel-agent";
import { APPLICATION, BUSINESS_KNOWLEDGE, ONTOLOGY_TYPE, SCHEDULED_TASK } from "@ontomato/contracts/platform-object-types";
import type { PanelRecord } from "@ontomato/contracts/panel-projection";
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

function makeProjection(id: string, def: Omit<ProductProjection, "id" | "domainId" | "ownerId" | "revision" | "editable" | "createdAt" | "updatedAt" | "name" | "description" | "visibility">): FixtureProduct {
  return productRow("projection", id, {
    name: id,
    description: `${id} projection`,
    visibility: "domain",
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
    if (sql.startsWith("UPDATE panel_operation_intents SET intent=$4")) {
      const id = String(args[2]);
      const existing = intents.get(id);
      if (!existing || existing.dispatched) return { rowCount: 0, rows: [] };
      intents.set(id, structuredClone(args[3] as PanelOperationIntent));
      return { rowCount: 1, rows: [{ id }] };
    }
    if (sql.startsWith("UPDATE panel_operation_intents SET intent=jsonb_set")) {
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

describe("row-scoped operations server resolution, anti-tampering and isolation", () => {
  it("recomputes target on human & agent channels, rejects tampered target, and dispatches stably even if pagination shifts", async () => {
    const executed: Array<{ target: unknown; input: unknown }> = [];
    const inspected: Array<unknown> = [];
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
      targetLabel: async (_host, target) => `Task:${target.primaryKey}`,
      inspectImpact: {
        handlerRef: "schedules.deleteTask.inspect",
        inspect: async (_host, calls) => {
          inspected.push(calls);
          const pk = calls[0]!.target?.kind === "object" ? calls[0]!.target.primaryKey : "unknown";
          return { objects: [{ target: { objectType: SCHEDULED_TASK, primaryKey: pk }, label: `Task:${pk}` }], total: 1, summary: `Delete ${pk}` };
        },
      },
      execute: async (_host, target, input) => {
        executed.push({ target, input });
        return { kind: "success", data: { deleted: true } };
      },
    };
    registerMockOp({ "schedules.deleteTask": deleteTaskOp });

    const tasks: PanelRecord[] = [
      { primaryKey: "task-A", label: "Task A", fields: {} },
      { primaryKey: "task-B", label: "Task B", fields: {} },
    ];
    let listedTasks = tasks;
    mocks.listScheduledTasks.mockImplementation(async () => listedTasks);

    setProduct(makeProjection("list-proj", {
      componentId: "@ontomato/sdk:ObjectList",
      inputs: {},
      outputs: { selected: { kind: "object", objectType: SCHEDULED_TASK } },
      data: { rows: { source: { type: { kind: "PlatformObjectType", id: SCHEDULED_TASK } }, read: "list", params: {} } },
      config: {},
    }));
    setProduct(makeProjection("row-delete-proj", {
      componentId: "@ontomato/sdk:OperationButton",
      inputs: { task: { kind: "object", objectType: SCHEDULED_TASK } },
      outputs: {},
      data: {},
      operations: {
        deleteTask: {
          operation: { kind: "PlatformOperation", id: "schedules.deleteTask" },
          target: { input: "task" },
        },
      },
      config: { operation: "deleteTask" },
    }));
    setProduct(makePanel("P", {
      state: {
        selected: { type: { kind: "object", objectType: SCHEDULED_TASK }, personal: false, deepLink: true, external: false, default: null },
      },
      members: {
        tasks: { target: { projectionId: "list-proj" }, outputs: { selected: { state: "selected" } } },
        rowDelete: {
          target: { projectionId: "row-delete-proj" },
          listColumn: { slot: "tasks", column: "actions" },
          inputs: { task: { item: true } },
        },
      },
      commands: {},
    }));

    // 1. Human channel: omit call.target while selected is task-A, acting on row task-B.
    const humanReq: CreatePanelHumanOperationIntentRequest = {
      applicationId: "A",
      useId: "tasks",
      operationId: "rowDelete.deleteTask",
      memberPath: [{ member: "rowDelete", itemKey: "task-B" }],
      rowContext: { state: { selected: { className: SCHEDULED_TASK, primaryKey: "task-A" } } },
      call: { input: {} },
    };
    const prep = await prepareHumanPanelOperation(owner, credentials, humanReq);
    expect(prep.confirmation).toMatchObject({
      kind: "impact",
      impact: {
        summary: "Delete task-B",
        objects: [{ target: { objectType: SCHEDULED_TASK, primaryKey: "task-B" }, label: "Task:task-B" }],
      },
    });
    const storedHuman = intents.get(prep.intentId)!;
    expect("call" in storedHuman && storedHuman.call.target).toEqual({
      kind: "object", objectType: SCHEDULED_TASK, primaryKey: "task-B",
    });

    // Even if the list changes/empties before dispatch, dispatch executes the frozen intent without re-reading the list.
    listedTasks = [];
    const listReadsBeforeDispatch = mocks.listScheduledTasks.mock.calls.length;
    const dispatchedHuman = await dispatchHumanPanelOperation(owner, credentials, prep.intentId);
    expect(dispatchedHuman).toMatchObject({ kind: "dispatched", outcome: { kind: "success", data: { deleted: true } } });
    expect(mocks.listScheduledTasks.mock.calls.length).toBe(listReadsBeforeDispatch);
    expect(executed[0]!.target).toEqual({ kind: "object", objectType: SCHEDULED_TASK, primaryKey: "task-B" });
    listedTasks = tasks;

    // 2. Human channel: consistent call.target is accepted; tampered call.target (task-A instead of task-B) is rejected.
    const consistentPrep = await prepareHumanPanelOperation(owner, credentials, {
      ...humanReq,
      call: { target: { kind: "object", objectType: SCHEDULED_TASK, primaryKey: "task-B" }, input: {} },
    });
    expect(consistentPrep.intentId).toBeTruthy();

    await expect(prepareHumanPanelOperation(owner, credentials, {
      ...humanReq,
      call: { target: { kind: "object", objectType: SCHEDULED_TASK, primaryKey: "task-A" }, input: {} },
    })).rejects.toMatchObject({ status: 403, code: "TARGET_ID_MISMATCH" });

    // 3. Agent channel: omitted call.target recomputed, confirmation inspects task-B, dispatch succeeds, idempotent replay works after row removal.
    const agentIntentId = uuid(50);
    const agentReq: CreatePanelOperationIntentRequest = {
      intentId: agentIntentId,
      applicationId: "A",
      useId: "tasks",
      operationId: "rowDelete.deleteTask",
      memberPath: [{ member: "rowDelete", itemKey: "task-B" }],
      rowContext: { state: { selected: { className: SCHEDULED_TASK, primaryKey: "task-A" } } },
      call: { input: {} },
    };
    const agentPrep = await operatePanel(currentRun.id, agentReq);
    expect(agentPrep.kind).toBe("confirmation-required");
    expect(inspected.at(-1)).toEqual([
      { target: { kind: "object", objectType: SCHEDULED_TASK, primaryKey: "task-B" }, input: {} },
    ]);

    // Agent tampered target is rejected.
    await expect(operatePanel(currentRun.id, {
      ...agentReq,
      intentId: uuid(51),
      call: { target: { kind: "object", objectType: SCHEDULED_TASK, primaryKey: "task-A" }, input: {} },
    })).rejects.toMatchObject({ status: 403, code: "TARGET_ID_MISMATCH" });

    // Approve and dispatch agent intent.
    approveAgentIntent(agentIntentId);
    listedTasks = [];
    const agentReadsBeforeDispatch = mocks.listScheduledTasks.mock.calls.length;
    const agentDispatched = await dispatchPanel(owner, credentials, currentRun.id, agentIntentId);
    expect(agentDispatched).toMatchObject({ kind: "dispatched", outcome: { kind: "success", data: { deleted: true } } });
    expect(mocks.listScheduledTasks.mock.calls.length).toBe(agentReadsBeforeDispatch);

    // Idempotent retry with omitted target replays cleanly even though task-B is gone.
    expect(await operatePanel(currentRun.id, agentReq)).toMatchObject({ kind: "dispatched", intentId: agentIntentId });
    // Retry with altered target refuses as INTENT_CHANGED.
    await expect(operatePanel(currentRun.id, {
      ...agentReq,
      call: { target: { kind: "object", objectType: SCHEDULED_TASK, primaryKey: "task-A" }, input: {} },
    })).rejects.toMatchObject({ status: 409, code: "INTENT_CHANGED" });
  });

  it("matches heterogeneous list rows by {className, primaryKey} and prevents cross-class tampering", async () => {
    const executed: Array<{ target: unknown }> = [];
    const deleteTaskOp: serverOperations.PanelWriteServerOperation = {
      effect: "write",
      kind: "action",
      handlerRef: "schedules.deleteTask",
      labelKey: "test.deleteRow",
      binding: { kind: "PlatformOperation", id: "schedules.deleteTask" },
      targetType: SCHEDULED_TASK,
      targetInput: "item",
      targetSchema: z.object({ kind: z.literal("object"), objectType: z.literal(SCHEDULED_TASK), primaryKey: z.string() }),
      inputSchema: z.object({}).strict(),
      resultSchema: z.object({ ok: z.boolean() }).strict(),
      batch: false,
      targetLabel: async (_host, target) => target.primaryKey,
      execute: async (_host, target) => {
        executed.push({ target });
        return { kind: "success", data: { ok: true } };
      },
    };
    registerMockOp({ "schedules.deleteTask": deleteTaskOp });

    // Two rows with the SAME primaryKey but DIFFERENT className!
    mocks.readOntologyObjects.mockResolvedValue({
      type: SCHEDULED_TASK,
      layer: "capability",
      status: "ok",
      items: [
        { node: { className: APPLICATION, primaryKey: "shared-1" }, label: "App Shared" },
        { node: { className: SCHEDULED_TASK, primaryKey: "shared-1" }, label: "Task Shared" },
      ],
      total: 2,
      page: 1,
      pageSize: 20,
    });

    setProduct(makeProjection("hetero-list", {
      componentId: "@ontomato/sdk:ObjectList",
      inputs: { type: { kind: "scalar", type: "string" } },
      outputs: {},
      data: {
        objects: {
          source: { type: { kind: "PlatformObjectType", id: ONTOLOGY_TYPE } },
          read: "objects",
          params: { type: { input: "type" } },
        },
      },
      config: {},
    }));
    setProduct(makeProjection("hetero-delete", {
      componentId: "@ontomato/sdk:OperationButton",
      inputs: { item: { kind: "object-union", objectTypes: [SCHEDULED_TASK, APPLICATION] } },
      outputs: {},
      data: {},
      operations: {
        deleteTask: {
          operation: { kind: "PlatformOperation", id: "schedules.deleteTask" },
          target: { input: "item" },
        },
      },
      config: { operation: "deleteTask" },
    }));
    setProduct(makePanel("P", {
      state: {
        nodeType: { type: { kind: "scalar", type: "string" }, personal: false, deepLink: true, external: false, default: SCHEDULED_TASK },
      },
      members: {
        list: { target: { projectionId: "hetero-list" }, inputs: { type: { state: "nodeType" } } },
        rowDelete: {
          target: { projectionId: "hetero-delete" },
          listColumn: { slot: "list", column: "actions" },
          inputs: { item: { item: true } },
        },
      },
      commands: {},
    }));

    // Ambiguous scalar itemKey matches both classes -> 422.
    await expect(prepareHumanPanelOperation(owner, credentials, {
      applicationId: "A",
      useId: "tasks",
      operationId: "rowDelete.deleteTask",
      memberPath: [{ member: "rowDelete", itemKey: "shared-1" }],
      call: { input: {} },
    })).rejects.toMatchObject({ status: 422, code: "ROW_OPERATION_ROW_AMBIGUOUS" });

    // Typed PanelObjectRef itemKey matches the exact ScheduledTask row.
    const prep = await prepareHumanPanelOperation(owner, credentials, {
      applicationId: "A",
      useId: "tasks",
      operationId: "rowDelete.deleteTask",
      memberPath: [{ member: "rowDelete", itemKey: { className: SCHEDULED_TASK, primaryKey: "shared-1" } }],
      call: { input: {} },
    });
    const dispatched = await dispatchHumanPanelOperation(owner, credentials, prep.intentId);
    expect(dispatched).toMatchObject({ kind: "dispatched", outcome: { kind: "success", data: { ok: true } } });
    expect(executed[0]!.target).toEqual({ kind: "object", objectType: SCHEDULED_TASK, primaryKey: "shared-1" });

    // Cross-class target tampering rejected.
    await expect(prepareHumanPanelOperation(owner, credentials, {
      applicationId: "A",
      useId: "tasks",
      operationId: "rowDelete.deleteTask",
      memberPath: [{ member: "rowDelete", itemKey: { className: SCHEDULED_TASK, primaryKey: "shared-1" } }],
      call: { target: { kind: "object", objectType: APPLICATION, primaryKey: "shared-1" }, input: {} },
    })).rejects.toMatchObject({ status: 403, code: "TARGET_ID_MISMATCH" });
  });

  it("recomputes and injects operation.params from row inputs & literals, rejects tampering, and enforces row/batch boundaries", async () => {
    const executed: Array<{ target: unknown; input: unknown }> = [];
    const revokeOp: serverOperations.PanelWriteServerOperation = {
      effect: "write",
      kind: "action",
      handlerRef: "applications.revokeGrant",
      labelKey: "test.revokeGrant",
      binding: { kind: "PlatformOperation", id: "applications.revokeGrant" },
      targetType: APPLICATION,
      targetInput: "app",
      targetSchema: z.object({ kind: z.literal("object"), objectType: z.literal(APPLICATION), primaryKey: z.string() }),
      inputSchema: z.object({
        entryId: z.string(),
        principalId: z.string(),
        permission: z.string(),
        mode: z.literal("revoke"),
        reason: z.string().optional(),
      }).strict(),
      resultSchema: z.object({ revoked: z.boolean() }).strict(),
      batch: true,
      targetLabel: async (_host, target) => target.primaryKey,
      execute: async (_host, target, input) => {
        executed.push({ target, input });
        return { kind: "success", data: { revoked: true } };
      },
      executeBatch: async () => ({ kind: "success", data: { revoked: true } }),
    };
    const archiveOp: serverOperations.PanelWriteServerOperation = {
      effect: "write",
      kind: "action",
      handlerRef: "schedules.archive",
      labelKey: "test.archive",
      binding: { kind: "PlatformOperation", id: "schedules.archive" },
      targetType: SCHEDULED_TASK,
      targetInput: "task",
      targetSchema: z.object({ kind: z.literal("object"), objectType: z.literal(SCHEDULED_TASK), primaryKey: z.string() }),
      inputSchema: z.object({ mode: z.literal("soft") }).strict(),
      resultSchema: z.object({ ok: z.boolean() }).strict(),
      batch: false,
      targetLabel: async (_host, target) => target.primaryKey,
      execute: async (_host, target, input) => {
        executed.push({ target, input });
        return { kind: "success", data: { ok: true } };
      },
    };
    registerMockOp({
      "applications.revokeGrant": revokeOp,
      "schedules.archive": archiveOp,
    });

    mocks.listScheduledTasks.mockResolvedValue([
      { primaryKey: "grant-1", label: "Alice", fields: { principalId: "user-alice", permission: "use" } },
      { primaryKey: "grant-2", label: "Bob", fields: { principalId: "user-bob", permission: "edit" } },
      { primaryKey: "grant-missing", label: "Broken", fields: { principalId: "user-x" } },
    ]);

    setProduct(makeProjection("grants-list", {
      componentId: "@ontomato/sdk:ObjectList",
      inputs: {},
      outputs: {},
      data: { rows: { source: { type: { kind: "PlatformObjectType", id: SCHEDULED_TASK } }, read: "list", params: {} } },
      config: {},
    }));
    setProduct(makeProjection("revoke-btn", {
      componentId: "@ontomato/sdk:OperationButton",
      inputs: {
        app: { kind: "object", objectType: APPLICATION },
        entryId: { kind: "scalar", type: "string" },
        principalId: { kind: "scalar", type: "string" },
        permission: { kind: "scalar", type: "string" },
      },
      outputs: {},
      data: {},
      operations: {
        revokeGrant: {
          operation: { kind: "PlatformOperation", id: "applications.revokeGrant" },
          target: { input: "app" },
          params: {
            entryId: { input: "entryId" },
            principalId: { input: "principalId" },
            permission: { input: "permission" },
            mode: { literal: "revoke" },
          },
        },
      },
      config: { operation: "revokeGrant" },
    }));
    setProduct(makeProjection("plain-archive", {
      componentId: "@ontomato/sdk:OperationButton",
      inputs: { task: { kind: "object", objectType: SCHEDULED_TASK } },
      outputs: {},
      data: {},
      operations: {
        archive: {
          operation: { kind: "PlatformOperation", id: "schedules.archive" },
          target: { input: "task" },
          params: { mode: { literal: "soft" } },
        },
      },
      config: { operation: "archive" },
    }));
    setProduct(makePanel("P", {
      state: {
        app: { type: { kind: "object", objectType: APPLICATION }, personal: false, deepLink: true, external: false, default: null },
        task: { type: { kind: "object", objectType: SCHEDULED_TASK }, personal: false, deepLink: true, external: false, default: null },
      },
      members: {
        grants: { target: { projectionId: "grants-list" } },
        revoke: {
          target: { projectionId: "revoke-btn" },
          listColumn: { slot: "grants", column: "actions" },
          inputs: {
            app: { state: "app" },
            entryId: { item: "primaryKey" },
            principalId: { itemField: "principalId" },
            permission: { itemField: "permission" },
          },
        },
        plain: {
          target: { projectionId: "plain-archive" },
          inputs: { task: { state: "task" } },
        },
      },
      commands: {},
    }));

    const appRef = { className: APPLICATION, primaryKey: "app-42" };
    // Auto-inject all bound params while preserving unbound user input `reason`.
    const prep = await prepareHumanPanelOperation(owner, credentials, {
      applicationId: "A",
      useId: "tasks",
      operationId: "revoke.revokeGrant",
      memberPath: [{ member: "revoke", itemKey: "grant-2" }],
      rowContext: { state: { app: appRef } },
      call: { input: { reason: "Left team" } },
    });
    const stored = intents.get(prep.intentId)!;
    expect("call" in stored && stored.call).toEqual({
      target: { kind: "object", objectType: APPLICATION, primaryKey: "app-42" },
      input: {
        entryId: "grant-2",
        principalId: "user-bob",
        permission: "edit",
        mode: "revoke",
        reason: "Left team",
      },
    });
    await dispatchHumanPanelOperation(owner, credentials, prep.intentId);
    expect(executed[0]).toEqual({
      target: { kind: "object", objectType: APPLICATION, primaryKey: "app-42" },
      input: {
        entryId: "grant-2",
        principalId: "user-bob",
        permission: "edit",
        mode: "revoke",
        reason: "Left team",
      },
    });

    // Tampering bound param principalId (trying to revoke Alice while clicking Bob's row) -> 403.
    await expect(prepareHumanPanelOperation(owner, credentials, {
      applicationId: "A",
      useId: "tasks",
      operationId: "revoke.revokeGrant",
      memberPath: [{ member: "revoke", itemKey: "grant-2" }],
      rowContext: { state: { app: appRef } },
      call: { input: { principalId: "user-alice" } },
    })).rejects.toMatchObject({ status: 403, code: "OPERATION_PARAM_MISMATCH" });

    // Missing required itemField on row -> 422.
    await expect(prepareHumanPanelOperation(owner, credentials, {
      applicationId: "A",
      useId: "tasks",
      operationId: "revoke.revokeGrant",
      memberPath: [{ member: "revoke", itemKey: "grant-missing" }],
      rowContext: { state: { app: appRef } },
      call: { input: {} },
    })).rejects.toMatchObject({ status: 422, code: "ROW_OPERATION_INPUT_INVALID" });

    // Omitting itemKey on a row member whose params depend on row inputs -> 422.
    await expect(prepareHumanPanelOperation(owner, credentials, {
      applicationId: "A",
      useId: "tasks",
      operationId: "revoke.revokeGrant",
      call: { target: { kind: "object", objectType: APPLICATION, primaryKey: "app-42" }, input: {} },
    })).rejects.toMatchObject({ status: 422, code: "ROW_OPERATION_ITEM_KEY_REQUIRED" });

    // Passing itemKey on an ordinary (non-listColumn/listRowDetail) member -> 422.
    await expect(prepareHumanPanelOperation(owner, credentials, {
      applicationId: "A",
      useId: "tasks",
      operationId: "plain.archive",
      memberPath: [{ member: "plain", itemKey: "task-1" }],
      call: { input: {} },
    })).rejects.toMatchObject({ status: 422, code: "ROW_OPERATION_MEMBER_INVALID" });

    // Batch `calls` on a row operation (`memberPath` with `itemKey`) -> 422.
    await expect(prepareHumanPanelOperation(owner, credentials, {
      applicationId: "A",
      useId: "tasks",
      operationId: "revoke.revokeGrant",
      memberPath: [{ member: "revoke", itemKey: "grant-2" }],
      calls: [{ target: { kind: "object", objectType: APPLICATION, primaryKey: "app-42" }, input: {} }],
    })).rejects.toMatchObject({ status: 422, code: "ROW_OPERATION_BATCH_UNSUPPORTED" });

    // Non-row operation with literal operation.params: injects literal and rejects tampering.
    const plainPrep = await prepareHumanPanelOperation(owner, credentials, {
      applicationId: "A",
      useId: "tasks",
      operationId: "plain.archive",
      call: { target: { kind: "object", objectType: SCHEDULED_TASK, primaryKey: "t-1" }, input: {} },
    });
    await dispatchHumanPanelOperation(owner, credentials, plainPrep.intentId);
    expect(executed[1]!.input).toEqual({ mode: "soft" });

    await expect(prepareHumanPanelOperation(owner, credentials, {
      applicationId: "A",
      useId: "tasks",
      operationId: "plain.archive",
      call: { target: { kind: "object", objectType: SCHEDULED_TASK, primaryKey: "t-1" }, input: { mode: "hard" } },
    })).rejects.toMatchObject({ status: 403, code: "OPERATION_PARAM_MISMATCH" });
  });

  it("enforces entry.inputs > rowContext.state > defaults precedence including frameState and nested panels", async () => {
    const deleteKnowledgeOp: serverOperations.PanelWriteServerOperation = {
      effect: "write",
      kind: "action",
      handlerRef: "knowledge.deleteKnowledge",
      labelKey: "test.deleteRow",
      binding: { kind: "PlatformOperation", id: "knowledge.deleteKnowledge" },
      targetType: BUSINESS_KNOWLEDGE,
      targetInput: "item",
      targetSchema: z.object({ kind: z.literal("object"), objectType: z.literal(BUSINESS_KNOWLEDGE), primaryKey: z.string() }),
      inputSchema: z.object({}).strict(),
      resultSchema: z.object({ ok: z.boolean() }).strict(),
      batch: false,
      targetLabel: async (_host, target) => target.primaryKey,
      execute: async () => ({ kind: "success", data: { ok: true } }),
    };
    registerMockOp({ "knowledge.deleteKnowledge": deleteKnowledgeOp });

    const seenQueries: Array<Record<string, unknown>> = [];
    mocks.queryKnowledge.mockImplementation(async (_viewer: unknown, params: Record<string, unknown>) => {
      seenQueries.push(params);
      if (params.status === "pending") {
        return { rows: [{ primaryKey: "pending-kb-1", label: "Pending 1", fields: {} }] };
      }
      if (params.status === "approved") {
        return { rows: [{ primaryKey: "approved-kb-1", label: "Approved 1", fields: {} }] };
      }
      return { rows: [{ primaryKey: "rejected-kb-1", label: "Rejected 1", fields: {} }] };
    });

    setProduct(makeProjection("kb-list", {
      componentId: "@ontomato/sdk:ObjectList",
      inputs: { status: { kind: "scalar", type: "string" } },
      outputs: {},
      data: {
        rows: {
          source: { type: { kind: "PlatformObjectType", id: BUSINESS_KNOWLEDGE } },
          read: "query",
          params: { status: { input: "status" } },
        },
      },
      config: {},
    }));
    setProduct(makeProjection("kb-delete", {
      componentId: "@ontomato/sdk:OperationButton",
      inputs: { item: { kind: "object", objectType: BUSINESS_KNOWLEDGE } },
      outputs: {},
      data: {},
      operations: {
        deleteKnowledge: {
          operation: { kind: "PlatformOperation", id: "knowledge.deleteKnowledge" },
          target: { input: "item" },
        },
      },
      config: { operation: "deleteKnowledge" },
    }));
    setProduct(makePanel("ContentPanel", {
      state: {
        status: { type: { kind: "scalar", type: "string" }, personal: false, deepLink: true, external: true, default: "rejected" },
      },
      members: {
        list: { target: { projectionId: "kb-list" }, inputs: { status: { state: "status" } } },
        rowDelete: {
          target: { projectionId: "kb-delete" },
          listColumn: { slot: "list", column: "actions" },
          inputs: { item: { item: true } },
        },
      },
      commands: {},
    }));
    setProduct(makePanel("FramePanel", {
      state: {
        frameStatus: { type: { kind: "scalar", type: "string" }, personal: false, deepLink: true, external: true, default: "pending" },
      },
      members: {
        content: { target: { fromPlatform: "currentEntry", candidates: { rule: "applicationEntry" } } },
      },
      commands: {},
    }));
    setProduct(makePanel("OuterPanel", {
      state: {
        outerStatus: { type: { kind: "scalar", type: "string" }, personal: false, deepLink: true, external: true, default: "pending" },
      },
      members: {
        child: {
          target: { panelId: "ContentPanel" },
          inputs: { status: { state: "outerStatus" } },
        },
      },
      commands: {},
    }));

    // Case 1: entry.inputs literal controls status="pending"; attacker tries rowContext.state={status:"approved"} -> ignored!
    currentUse = {
      id: "kb",
      pageKey: "kb",
      path: "/applications/A/kb",
      panelId: "ContentPanel",
      access: { kind: "domain-member" },
      inputs: { status: { literal: "pending" } },
    };
    await expect(prepareHumanPanelOperation(owner, credentials, {
      applicationId: "A",
      useId: "kb",
      operationId: "rowDelete.deleteKnowledge",
      memberPath: [{ member: "rowDelete", itemKey: "approved-kb-1" }],
      rowContext: { state: { status: "approved" } },
      call: { input: {} },
    })).rejects.toMatchObject({ status: 404, code: "ROW_OPERATION_ROW_NOT_FOUND" });
    expect(seenQueries.at(-1)).toMatchObject({ status: "pending" });

    // Allowed runtimeParams (`search`, `size`) pass through; disallowed runtimeParams (`status`) rejected.
    const okWithSearch = await prepareHumanPanelOperation(owner, credentials, {
      applicationId: "A",
      useId: "kb",
      operationId: "rowDelete.deleteKnowledge",
      memberPath: [{ member: "rowDelete", itemKey: "pending-kb-1" }],
      rowContext: { state: { status: "approved" }, runtimeParams: { search: "Pending", size: 10 } },
      call: { input: {} },
    });
    expect(okWithSearch.intentId).toBeTruthy();
    expect(seenQueries.at(-1)).toEqual({ status: "pending", search: "Pending", size: 10 });

    await expect(prepareHumanPanelOperation(owner, credentials, {
      applicationId: "A",
      useId: "kb",
      operationId: "rowDelete.deleteKnowledge",
      memberPath: [{ member: "rowDelete", itemKey: "pending-kb-1" }],
      rowContext: { runtimeParams: { status: "approved" } },
      call: { input: {} },
    })).rejects.toMatchObject({ status: 400, code: "PANEL_RUNTIME_PARAMETER_UNKNOWN" });

    // Case 2: nested inside FramePanel with entry.inputs { status: { frameState: "frameStatus" } }.
    // rowContext.state MUST NOT override frameState!
    currentFramePanelId = "FramePanel";
    currentUse = {
      ...currentUse,
      inputs: { status: { frameState: "frameStatus" } },
    };
    const nestedPrep = await prepareHumanPanelOperation(owner, credentials, {
      applicationId: "A",
      useId: "kb",
      root: "frame",
      operationId: "content.rowDelete.deleteKnowledge",
      memberPath: [{ member: "content" }, { member: "rowDelete", itemKey: "approved-kb-1" }],
      rowContext: {
        frameState: { frameStatus: "approved" },
        state: { status: "rejected" },
      },
      call: { input: {} },
    });
    expect(nestedPrep.intentId).toBeTruthy();
    expect(seenQueries.at(-1)).toEqual({ status: "approved" });

    // When frameState is omitted, falls back to FramePanel's default ("pending"), NEVER rowContext.state ("approved")!
    await expect(prepareHumanPanelOperation(owner, credentials, {
      applicationId: "A",
      useId: "kb",
      root: "frame",
      operationId: "content.rowDelete.deleteKnowledge",
      memberPath: [{ member: "content" }, { member: "rowDelete", itemKey: "approved-kb-1" }],
      rowContext: {
        state: { status: "approved" },
      },
      call: { input: {} },
    })).rejects.toMatchObject({ status: 404, code: "ROW_OPERATION_ROW_NOT_FOUND" });
    expect(seenQueries.at(-1)).toEqual({ status: "pending" });

    // Case 3: OuterPanel -> ContentPanel via parent member inputs; rowContext.state cannot override parent-controlled input.
    currentFramePanelId = undefined;
    currentUse = {
      ...currentUse,
      panelId: "OuterPanel",
      inputs: { outerStatus: { literal: "pending" } },
    };
    await expect(prepareHumanPanelOperation(owner, credentials, {
      applicationId: "A",
      useId: "kb",
      operationId: "child.rowDelete.deleteKnowledge",
      memberPath: [{ member: "child" }, { member: "rowDelete", itemKey: "approved-kb-1" }],
      rowContext: { state: { status: "approved" } },
      call: { input: {} },
    })).rejects.toMatchObject({ status: 404, code: "ROW_OPERATION_ROW_NOT_FOUND" });
    expect(seenQueries.at(-1)).toEqual({ status: "pending" });
  });

  it("refuses when host list read is forbidden, refused, failed, unavailable, or missing the target row", async () => {
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
      resultSchema: z.object({ ok: z.boolean() }).strict(),
      batch: false,
      targetLabel: async (_host, target) => target.primaryKey,
      execute: async () => ({ kind: "success", data: { ok: true } }),
    };
    registerMockOp({ "schedules.deleteTask": deleteTaskOp });

    setProduct(makeProjection("obj-list", {
      componentId: "@ontomato/sdk:ObjectList",
      inputs: {},
      outputs: {},
      data: {
        objects: {
          source: { type: { kind: "PlatformObjectType", id: ONTOLOGY_TYPE } },
          read: "objects",
          params: { type: { literal: SCHEDULED_TASK } },
        },
      },
      config: {},
    }));
    setProduct(makeProjection("row-del", {
      componentId: "@ontomato/sdk:OperationButton",
      inputs: { task: { kind: "object", objectType: SCHEDULED_TASK } },
      outputs: {},
      data: {},
      operations: {
        deleteTask: {
          operation: { kind: "PlatformOperation", id: "schedules.deleteTask" },
          target: { input: "task" },
        },
      },
      config: { operation: "deleteTask" },
    }));
    setProduct(makePanel("P", {
      state: {},
      members: {
        list: { target: { projectionId: "obj-list" } },
        rowDelete: {
          target: { projectionId: "row-del" },
          listColumn: { slot: "list", column: "actions" },
          inputs: { task: { item: true } },
        },
      },
      commands: {},
    }));

    const baseReq: CreatePanelHumanOperationIntentRequest = {
      applicationId: "A",
      useId: "tasks",
      operationId: "rowDelete.deleteTask",
      memberPath: [{ member: "rowDelete", itemKey: { className: SCHEDULED_TASK, primaryKey: "task-missing" } }],
      call: { input: {} },
    };

    // status: "refused" -> 403
    mocks.readOntologyObjects.mockResolvedValueOnce({
      type: SCHEDULED_TASK, layer: "capability", status: "refused", reason: "No permission",
      items: [], total: 0, page: 1, pageSize: 20,
    });
    await expect(prepareHumanPanelOperation(owner, credentials, baseReq)).rejects.toMatchObject({ status: 403, code: "HOST_LIST_FORBIDDEN" });

    // status: "failed" -> 422
    mocks.readOntologyObjects.mockResolvedValueOnce({
      type: SCHEDULED_TASK, layer: "capability", status: "failed", reason: "Upstream error",
      items: [], total: 0, page: 1, pageSize: 20,
    });
    await expect(prepareHumanPanelOperation(owner, credentials, baseReq)).rejects.toMatchObject({ status: 422, code: "HOST_LIST_UNAVAILABLE" });

    // status: "unavailable" -> 422
    mocks.readOntologyObjects.mockResolvedValueOnce({
      type: SCHEDULED_TASK, layer: "capability", status: "unavailable", reason: "Service down",
      items: [], total: 0, page: 1, pageSize: 20,
    });
    await expect(prepareHumanPanelOperation(owner, credentials, baseReq)).rejects.toMatchObject({ status: 422, code: "HOST_LIST_UNAVAILABLE" });

    // adapter throws 403 -> 403
    mocks.readOntologyObjects.mockRejectedValueOnce(new HttpError(403, "Forbidden", "FORBIDDEN"));
    await expect(prepareHumanPanelOperation(owner, credentials, baseReq)).rejects.toMatchObject({ status: 403 });

    // host list has rows, but requested itemKey is absent -> 404 (never falls back to first row!)
    mocks.readOntologyObjects.mockResolvedValueOnce({
      type: SCHEDULED_TASK, layer: "capability", status: "ok",
      items: [{ node: { className: SCHEDULED_TASK, primaryKey: "task-first" }, label: "First" }],
      total: 1, page: 1, pageSize: 20,
    });
    await expect(prepareHumanPanelOperation(owner, credentials, baseReq)).rejects.toMatchObject({ status: 404, code: "ROW_OPERATION_ROW_NOT_FOUND" });
  });

  it("supports listRowDetail row operations with impact on row B while row A is selected, and rejects listColumn data reads", async () => {
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
      resultSchema: z.object({ ok: z.boolean() }).strict(),
      batch: false,
      targetLabel: async (_host, target) => `Label:${target.primaryKey}`,
      inspectImpact: {
        handlerRef: "schedules.deleteTask.inspect",
        inspect: async (_host, calls) => {
          const pk = calls[0]!.target?.kind === "object" ? calls[0]!.target.primaryKey : "none";
          return {
            objects: [{ target: { objectType: SCHEDULED_TASK, primaryKey: pk }, label: `Label:${pk}` }],
            total: 1,
            summary: `Impact for ${pk}`,
          };
        },
      },
      execute: async () => ({ kind: "success", data: { ok: true } }),
    };
    registerMockOp({ "schedules.deleteTask": deleteTaskOp });

    mocks.listScheduledTasks.mockResolvedValue([
      { primaryKey: "row-A", label: "Row A", fields: {} },
      { primaryKey: "row-B", label: "Row B", fields: {} },
    ]);

    setProduct(makeProjection("tasks-list", {
      componentId: "@ontomato/sdk:ObjectList",
      inputs: {},
      outputs: { selected: { kind: "object", objectType: SCHEDULED_TASK } },
      data: { rows: { source: { type: { kind: "PlatformObjectType", id: SCHEDULED_TASK } }, read: "list", params: {} } },
      config: {},
    }));
    // listRowDetail IS allowed to declare data (e.g. record) AND an operation.
    setProduct(makeProjection("row-detail-proj", {
      componentId: "@ontomato/sdk:ObjectSummary",
      inputs: { task: { kind: "object", objectType: SCHEDULED_TASK } },
      outputs: {},
      data: { record: { source: { object: { input: "task" } }, read: "record", params: {} } },
      operations: {
        deleteTask: {
          operation: { kind: "PlatformOperation", id: "schedules.deleteTask" },
          target: { input: "task" },
        },
      },
      config: {},
    }));
    // Bad listColumn projection declaring independent data -> must be rejected at runtime too!
    setProduct(makeProjection("bad-col-proj", {
      componentId: "@ontomato/sdk:ObjectSummary",
      inputs: { task: { kind: "object", objectType: SCHEDULED_TASK } },
      outputs: {},
      data: { record: { source: { object: { input: "task" } }, read: "record", params: {} } },
      operations: {
        deleteTask: {
          operation: { kind: "PlatformOperation", id: "schedules.deleteTask" },
          target: { input: "task" },
        },
      },
      config: {},
    }));
    setProduct(makePanel("P", {
      state: {
        selected: { type: { kind: "object", objectType: SCHEDULED_TASK }, personal: false, deepLink: true, external: false, default: null },
      },
      members: {
        tasks: { target: { projectionId: "tasks-list" }, outputs: { selected: { state: "selected" } } },
        detail: {
          target: { projectionId: "row-detail-proj" },
          listRowDetail: { slot: "tasks" },
          inputs: { task: { item: true } },
        },
        badCol: {
          target: { projectionId: "bad-col-proj" },
          listColumn: { slot: "tasks", column: "actions" },
          inputs: { task: { item: true } },
        },
      },
      commands: {},
    }));

    // listRowDetail row operation while panel has row-A selected -> impact shows row-B!
    const prep = await prepareHumanPanelOperation(owner, credentials, {
      applicationId: "A",
      useId: "tasks",
      operationId: "detail.deleteTask",
      memberPath: [{ member: "detail", itemKey: "row-B" }],
      rowContext: { state: { selected: { className: SCHEDULED_TASK, primaryKey: "row-A" } } },
      call: { input: {} },
    });
    expect(prep.confirmation).toMatchObject({
      kind: "impact",
      impact: {
        summary: "Impact for row-B",
        objects: [{ target: { objectType: SCHEDULED_TASK, primaryKey: "row-B" }, label: "Label:row-B" }],
      },
    });

    // listColumn declaring data is refused at both readProductPanelData and prepareHumanPanelOperation!
    const readAttempt = await readProductPanelData(owner, credentials, {
      source: { kind: "registered", applicationId: "A", useId: "tasks" },
      memberPath: [{ member: "badCol" }],
      dataName: "record",
      inputs: { task: { className: SCHEDULED_TASK, primaryKey: "row-B" } },
    });
    expect(readAttempt).toMatchObject({ status: "error", message: expect.stringContaining("listColumn") });

    await expect(prepareHumanPanelOperation(owner, credentials, {
      applicationId: "A",
      useId: "tasks",
      operationId: "badCol.deleteTask",
      memberPath: [{ member: "badCol", itemKey: "row-B" }],
      call: { input: {} },
    })).rejects.toMatchObject({ status: 422, code: "LIST_COLUMN_DATA_FORBIDDEN" });
  });
});
