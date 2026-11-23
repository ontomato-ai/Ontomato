import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { isPanelHumanOperationIntent, type PanelOperationIntent } from "@ontomato/contracts/panel-agent";
import { EXECUTE_OBJECT_ACTION } from "@ontomato/contracts/platform-object-types";
import type { RuntimeRun } from "@ontomato/contracts/agent-runtime";
import { configureI18n } from "../../../i18n";
import { en, enLocaleMeta } from "../../../i18n/locales/en";

const mocks = vi.hoisted(() => ({
  query: vi.fn(),
  backendGet: vi.fn(),
  backendPost: vi.fn(),
  run: vi.fn(),
  session: vi.fn(),
  request: vi.fn(),
  resolve: vi.fn(),
  panel: vi.fn(),
  projection: vi.fn(),
  pages: vi.fn(),
  resolveMember: vi.fn(),
  loadedMember: vi.fn(),
  restore: vi.fn(),
  sessionActor: vi.fn(),
  notify: vi.fn(),
}));

vi.mock("../../../infrastructure/postgres", () => ({
  getPostgresPool: () => ({ query: mocks.query }),
  qualifiedTable: (name: string) => name,
}));
vi.mock("../../../config/application", () => ({ config: { dataQuery: { baseUrl: "http://owner.test" } } }));
vi.mock("../../../config/environment", () => ({
  environment: { agentRuntime: () => ({ callbackUrl: "http://workbench.test" }) },
}));
vi.mock("../../../infrastructure/agent-runtime/client", () => ({
  RuntimeClient: class {
    run = mocks.run;
    session = mocks.session;
    request = mocks.request;
  },
}));
vi.mock("../../assistant/execution-setting", () => ({ resolveAgentExecution: mocks.resolve }));
vi.mock("../../assistant/store", () => ({ assistantStore: { turn: async () => ({}) } }));
vi.mock("../../assistant/skills", () => ({
  readAssistantSkillView: mocks.pages,
  resolvePageSkillSource: mocks.resolveMember,
  loadedPageSkillVersion: mocks.loadedMember,
}));
vi.mock("../../agent-host/caller", () => ({
  restoreAgentCaller: mocks.restore,
  readAgentSessionActor: mocks.sessionActor,
}));
vi.mock("../../agent-host/presentation", () => ({ publishObjectChanged: mocks.notify }));
vi.mock("../../../utils/backend-client", () => ({
  backendGet: mocks.backendGet,
  backendPost: mocks.backendPost,
  buildBackendHeaders: (token?: string, _x?: unknown, _l?: unknown, key?: string, headers?: object) => ({
    ...headers,
    ...(token ? { tk: token } : {}),
    ...(key ? { "X-API-Key": key } : {}),
  }),
}));
vi.mock("../current", () => ({
  readCurrentPanelRecord: mocks.panel,
  async requireDirectPanelMember(_o: unknown, _c: unknown, panel: { manifest: { members: Record<string, { target: { projectionId: string } }> } }, slot: string) {
    const member = panel.manifest.members[slot]!;
    const projection = await mocks.projection(member.target.projectionId);
    return { member, projection };
  },
}));
vi.mock("../application-use", () => ({
  requirePanelUseEntry: async () => ({
    use: {
      id: "orders-use",
      panelId: "panel-orders",
      pageKey: "orders",
      path: "/applications/app-1/orders",
      access: { kind: "domain-member" as const },
    },
    framePanelId: undefined,
  }),
}));

import { panelOperationTargetCheck, readPanelTypeTable } from "../type-table";
import { declaredDirectOperation, readAdmittedProjectionOperations } from "../direct-operations";
import { panelOperationStore } from "../operation-store";
import {
  dispatchHumanPanelOperation,
  dispatchPanel,
  invalidateFormConfirmations,
  operatePanel,
  prepareHumanPanelOperation,
} from "../operations";

configureI18n({
  defaultLocale: "en",
  appTextLocale: "en",
  languageSwitchEnabled: true,
  packs: { en: { ...enLocaleMeta, messages: en } },
});

const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const owner = { domainId: "d", userId: "U" };
const credentials = { token: "U-token", locale: "en" };
const codeHash = "a".repeat(64);
const root = { providerId: "web", sessionId: uuid(1) };
const skill = { namespace: { kind: "domain" as const, domainId: "d" }, name: "orders-panel" };

const createOrderAction = {
  id: "create-order",
  name: "Create order",
  status: "PUBLISHED",
  codeHash,
  target: null,
  definition: { affects: ["Order", "AuditLog"] },
  function: {
    name: "create_order",
    parameters: [
      { name: "customer", type: "TYPE_STRING", description: "Customer name" },
      { name: "amount", type: "TYPE_NUMBER", description: null },
    ],
  },
};

const approveOrderAction = {
  id: "approve-order",
  name: "Approve order",
  status: "PUBLISHED",
  codeHash: "b".repeat(64),
  target: { className: "Order", keyParameter: "order_id" },
  definition: { affects: ["Order"] },
  function: {
    name: "approve_order",
    parameters: [
      { name: "order_id", type: "TYPE_STRING", description: "Order ID" },
      { name: "note", type: "TYPE_STRING", description: null },
    ],
  },
};

const orderFormProjection = {
  id: "proj-order-form",
  name: "Order create form",
  description: "",
  visibility: "domain" as const,
  componentId: "@ontomato/sdk:ObjectForm",
  inputs: {},
  outputs: {},
  config: {},
  data: {
    createForm: {
      source: { type: { kind: "ObjectType" as const, id: "Order" } },
      read: "createForm",
      params: {},
    },
  },
  operations: {
    save: { operation: { kind: "Action" as const, id: "create-order" } },
  },
};

const orderPanel = {
  id: "panel-orders",
  name: "Orders",
  description: "",
  visibility: "domain" as const,
  manifest: {
    state: {},
    members: {
      orderForm: { target: { projectionId: "proj-order-form" } },
    },
  },
};

const use = {
  id: "orders-use",
  panelId: "panel-orders",
  pageKey: "orders",
  path: "/applications/app-1/orders",
  access: { kind: "domain-member" as const },
};

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("type table and registration check for targetless customer Actions", () => {
  it("exposes targetless Actions once in top-level operations with affects without duplicating across objectTypes", async () => {
    mocks.backendGet.mockImplementation(async (_name, url) => {
      if (String(url).includes("/ontology/model/object-types")) {
        return {
          text: JSON.stringify([
            {
              className: "Order", showName: "Order", classDesc: "",
              attributeCount: 2, businessKeyCount: 1, relationshipCount: 0,
              primaryKey: { status: "present", name: "order_id" },
            },
            {
              className: "AuditLog", showName: "Audit Log", classDesc: "",
              attributeCount: 1, businessKeyCount: 0, relationshipCount: 0,
              primaryKey: { status: "present", name: "log_id" },
            },
          ]),
        };
      }
      throw new Error(`Unexpected GET ${url}`);
    });
    mocks.backendPost.mockImplementation(async (_name, url) => {
      if (String(url).endsWith("/action/queryList")) {
        return {
          text: JSON.stringify({ success: true, data: [createOrderAction, approveOrderAction] }),
        };
      }
      throw new Error(`Unexpected POST ${url}`);
    });

    const table = await readPanelTypeTable(owner, credentials);

    // Targetless Action lives once in top-level `operations` with `affects`, not duplicated in `objectTypes`.
    expect(table.operations).toEqual([
      expect.objectContaining({
        id: "create-order",
        kind: "action",
        effect: "write",
        target: { source: "none" },
        affects: ["Order", "AuditLog"],
      }),
    ]);
    expect(table.objectTypes.Order?.operations?.map(op => op.id)).toEqual(["approve-order"]);
    expect(table.objectTypes.AuditLog?.operations).toBeUndefined();

    // Target check admits targetless Action without target on both ObjectForm and OperationButton.
    const check = panelOperationTargetCheck(owner, credentials);
    expect(await check({
      inputs: {},
      data: orderFormProjection.data,
      operations: { save: { operation: { kind: "Action", id: "create-order" } } },
    }, {})).toBeUndefined();

    // Binding a targetless Action WITH a target is rejected.
    expect(await check({
      inputs: { target: { kind: "object", objectType: "Order" } },
      data: {},
      operations: { save: { operation: { kind: "Action", id: "create-order" }, target: { input: "target" } } },
    }, { inputs: { target: { state: "selected" } } })).toBe("operation 'save' takes no target");

    // Binding a targeted Action WITHOUT a target is still rejected.
    expect(await check({
      inputs: {},
      data: {},
      operations: { approve: { operation: { kind: "Action", id: "approve-order" } } },
    }, {})).toBe("operation 'approve' takes a target of type 'Order'");
  });
});

describe("admitting targetless customer Actions in direct-operations", () => {
  it("admits targetless Actions with empty /action/form parameters and snapshot omitting action.object", async () => {
    const sent: { url: string; body: unknown }[] = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string, init: NonNullable<Parameters<typeof fetch>[1]>) => {
      const body = JSON.parse(String(init.body));
      sent.push({ url, body });
      if (url.endsWith("/action/queryById")) return Response.json({ success: true, data: createOrderAction });
      if (url.endsWith("/action/form")) {
        return Response.json({
          success: true,
          data: {
            fields: [
              { key: "customer", label: "Customer", required: true, defaultValue: null, help: null, type: "text", multiline: false, placeholder: null, maxLength: 200 },
              { key: "amount", label: "Amount", required: true, defaultValue: null, help: null, type: "text", multiline: false, placeholder: null, maxLength: 200 },
            ],
            values: { customer: "", amount: "" },
            errors: [],
            parameters: null,
          },
        });
      }
      throw new Error(`Unexpected fetch ${url}`);
    }));

    const admittedMap = await readAdmittedProjectionOperations(
      { owner, credentials },
      { panel: orderPanel as never, projection: orderFormProjection as never, member: orderPanel.manifest.members.orderForm, slot: "orderForm" },
      {},
    );
    expect(admittedMap.save).toMatchObject({
      kind: "action",
      handlerRef: EXECUTE_OBJECT_ACTION,
      label: "Create order",
      target: { source: "none" },
    });
    expect(sent.at(-1)?.body).toEqual({
      id: "create-order",
      parameters: {},
      readOnlyParameters: [],
    });

    mocks.projection.mockResolvedValue(orderFormProjection);
    const direct = await declaredDirectOperation(
      owner,
      credentials,
      use as never,
      orderPanel as never,
      "orderForm.save",
      null,
    );
    expect(direct.effect).toBe("write");
    if (direct.effect === "write") {
      expect(direct.fixedTarget).toBeNull();
      expect(direct.operation.action).toEqual({
        actionId: "create-order",
        codeHash,
        affects: ["Order", "AuditLog"],
      });
      expect(direct.operation.action?.object).toBeUndefined();
    }
  });
});

describe("operation-store invalidation SQL for form-bound customer Actions", () => {
  it("matches both form.save and actions.execute for object edits and targetless/draft creates", async () => {
    mocks.query.mockResolvedValue({ rowCount: 1 });
    const reason = { code: "FORM_CONFIRMATION_STALE", message: "Stale" };

    await panelOperationStore.invalidatePendingFormSaves(
      owner,
      { rootSession: root, targetType: "Order", primaryKey: "ord-1", slot: "orderForm" },
      reason,
    );
    const [editSql, editParams] = mocks.query.mock.calls[0]!;
    expect(editSql).toContain("intent->'operation'->>'kind'='form.save' OR intent->'operation'->>'handlerRef'='actions.execute'");
    expect(editSql).toContain("intent->'call'->'target'->>'kind'='object'");
    expect(editParams).toContain("Order");
    expect(editParams).toContain("ord-1");

    mocks.query.mockClear();
    await panelOperationStore.invalidatePendingFormSaves(
      owner,
      { rootSession: root, targetType: "Order", primaryKey: null, slot: "orderForm" },
      reason,
    );
    const [draftSql, draftParams] = mocks.query.mock.calls[0]!;
    expect(draftSql).toContain("intent->'operation'->>'kind'='form.save'");
    expect(draftSql).toContain("intent->'operation'->>'handlerRef'='actions.execute'");
    expect(draftSql).toContain("jsonb_typeof(intent->'call'->'target')='null'");
    expect(draftSql).toContain("intent->'operation'->>'slot'=");
    expect(draftSql).toContain("intent->'operation'->'action'->'affects' ?");
    expect(draftParams).toContain("orderForm");
    expect(draftParams).toContain("Order");
  });
});

describe("end-to-end targetless Action confirmation, dispatch, and stale invalidation", () => {
  let intents: Map<string, PanelOperationIntent>;
  let humanAnswer: object | null;

  beforeEach(() => {
    intents = new Map();
    humanAnswer = null;
    mocks.panel.mockResolvedValue(orderPanel);
    mocks.projection.mockResolvedValue(orderFormProjection);
    mocks.pages.mockResolvedValue({ byId: new Map() });
    mocks.resolveMember.mockResolvedValue(skill);
    mocks.loadedMember.mockImplementation((ref, loaded: RuntimeRun["resolvedSkills"]) =>
      loaded.find(entry => JSON.stringify(entry.skill) === JSON.stringify(ref)) ?? null);
    mocks.resolve.mockResolvedValue({ executionUserId: null, credentials });
    mocks.restore.mockResolvedValue({ owner });
    mocks.run.mockResolvedValue({
      run: {
        id: uuid(2),
        sessionId: uuid(3),
        status: "running",
        executionUserId: null,
        resolvedSkills: [{ skill, version: "1" }],
        channel: {
          agent: { providerId: "web" },
          userRecipient: { session: root },
          authority: { executionKind: "live" },
        },
      },
    });
    mocks.session.mockImplementation(async () => ({ messages: humanAnswer ? [{ message: humanAnswer }] : [] }));
    mocks.request.mockImplementation(async (path: string, _method: string, body: { source: unknown }) =>
      path === "/v1/channel/user-questions"
        ? {
            questionId: uuid(10),
            source: body.source,
            recipient: { session: root, actor: { id: uuid(4), domainId: "d" } },
          }
        : {
            questionId: uuid(10),
            answerId: uuid(11),
            source: { kind: "user" },
            respondent: { id: uuid(12), domainId: "d" },
            recipientSession: root,
            selectedOption: 1,
            text: "Execute",
          });
    mocks.query.mockImplementation(async (sql: string, args: unknown[]) => {
      const id = String(args[sql.startsWith("SELECT intent,owner_id") ? 1 : 2]);
      if (sql.startsWith("SELECT confirm_before")) return { rows: [] };
      if (sql.startsWith("SELECT intent")) {
        return { rows: intents.has(id) ? [{ intent: structuredClone(intents.get(id)), owner_id: owner.userId }] : [] };
      }
      if (sql.startsWith("INSERT INTO panel_operation_intents")) {
        if (!intents.has(String(args[1]))) intents.set(String(args[1]), structuredClone(args[4] as PanelOperationIntent));
        return { rows: [] };
      }
      if (sql.includes("jsonb_set(intent,'{invalidated}'")) {
        const reason = JSON.parse(String(args[2]));
        let count = 0;
        for (const [k, v] of intents.entries()) {
          if (v.dispatched || isPanelHumanOperationIntent(v) || v.invalidated || !("call" in v)) continue;
          const isTargetlessAction = v.operation.handlerRef === EXECUTE_OBJECT_ACTION && v.call.target === null;
          if (!isTargetlessAction) continue;
          const matchesSlot = args.includes(v.operation.slot);
          const matchesAction = v.binding && args.includes(v.binding.id);
          const matchesAffects = (v.operation.action?.affects ?? []).some(type =>
            args.includes(type) || args.some(arg => Array.isArray(arg) && arg.includes(type)));
          if (!matchesSlot && !matchesAction && !matchesAffects) continue;
          intents.set(k, { ...v, invalidated: reason });
          count++;
        }
        return { rowCount: count };
      }
      if (sql.includes("AND intent->>'dispatched'='false'")) {
        const value = intents.get(id)!;
        if (value.dispatched) return { rowCount: 0 };
        intents.set(id, structuredClone(args[3] as PanelOperationIntent));
        return { rowCount: 1 };
      }
      if (sql.includes("jsonb_set")) {
        intents.get(id)!.outcome = JSON.parse(String(args[3]));
        return { rowCount: 1 };
      }
      throw new Error(sql);
    });
    vi.stubGlobal("fetch", vi.fn(async (url: string, init: NonNullable<Parameters<typeof fetch>[1]>) => {
      if (url.endsWith("/action/queryById")) return Response.json({ success: true, data: createOrderAction });
      if (url.endsWith("/action/form")) {
        const body = JSON.parse(String(init.body));
        const values = body.values ?? { customer: "", amount: "" };
        return Response.json({
          success: true,
          data: {
            fields: [
              { key: "customer", label: "Customer", required: true, defaultValue: null, help: null, type: "text", multiline: false, placeholder: null, maxLength: 200 },
              { key: "amount", label: "Amount", required: true, defaultValue: null, help: null, type: "text", multiline: false, placeholder: null, maxLength: 200 },
            ],
            values: { customer: values.customer ?? "", amount: values.amount ?? "" },
            errors: [],
            parameters: body.values ? { customer: values.customer, amount: Number(values.amount) } : null,
          },
        });
      }
      if (url.endsWith("/action/execute")) {
        return Response.json({
          success: true,
          data: { result: "{\"created\":true}", error: null, spendTime: 4, affects: ["Order", "AuditLog"], partialQuery: null },
        });
      }
      throw new Error(`Unexpected fetch ${url}`);
    }));
  });

  it("prompts with action name and input parameters, freezes without action.object, and dispatches with affected.objectTypes", async () => {
    const intentId = uuid(20);
    const response = await operatePanel(owner, credentials, uuid(2), {
      intentId,
      applicationId: "app-1",
      useId: "orders-use",
      operationId: "orderForm.save",
      call: { target: null, input: { values: { customer: "ACME", amount: "42" } } },
    }, "Alice");

    expect(response.kind).toBe("confirmation-required");
    const questionBody = mocks.request.mock.calls[0]?.[2] as { message: string };
    expect(questionBody.message).toContain("Create order");
    expect(questionBody.message).toContain("customer: ACME, amount: 42");
    expect(intents.get(intentId)?.operation.action).toEqual({
      actionId: "create-order",
      codeHash,
      affects: ["Order", "AuditLog"],
    });

    const storedQuestionId = (intents.get(intentId) as { questionId: string }).questionId;
    humanAnswer = { role: "notification", kind: "agent-answer", source: { kind: "user" }, replyTo: storedQuestionId, answerId: uuid(11) };

    const dispatched = await dispatchPanel(owner, credentials, uuid(2), intentId);
    expect(dispatched).toEqual({
      kind: "dispatched",
      intentId,
      outcome: {
        kind: "success",
        data: { result: "{\"created\":true}", affects: ["Order", "AuditLog"] },
        affected: { objects: [], objectTypes: ["Order", "AuditLog"] },
      },
    });
    expect(mocks.notify).toHaveBeenCalledWith({
      domainId: "d",
      initiator: "U",
      rootSession: root,
      target: null,
      affected: { objects: [], objectTypes: ["Order", "AuditLog"] },
    });
  });

  it("invalidates a pending targetless Action confirmation when the user edits or directly saves the create form", async () => {
    const intentId = uuid(21);
    const response = await operatePanel(owner, credentials, uuid(2), {
      intentId,
      applicationId: "app-1",
      useId: "orders-use",
      operationId: "orderForm.save",
      call: { target: null, input: { values: { customer: "ACME", amount: "42" } } },
    }, "Alice");
    expect(response.kind).toBe("confirmation-required");

    expect(await invalidateFormConfirmations(owner, {
      rootSession: root,
      target: { kind: "draft", objectType: "Order", slot: "orderForm" },
    })).toEqual({ invalidated: 1 });

    const storedQuestionId = (intents.get(intentId) as { questionId: string }).questionId;
    humanAnswer = { role: "notification", kind: "agent-answer", source: { kind: "user" }, replyTo: storedQuestionId, answerId: uuid(11) };
    expect(await dispatchPanel(owner, credentials, uuid(2), intentId)).toMatchObject({
      kind: "not-dispatched",
      code: "FORM_CONFIRMATION_STALE",
    });

    // Also verify direct human save invalidates a fresh pending confirmation on the same form.
    const intentId2 = uuid(22);
    const response2 = await operatePanel(owner, credentials, uuid(2), {
      intentId: intentId2,
      applicationId: "app-1",
      useId: "orders-use",
      operationId: "orderForm.save",
      call: { target: null, input: { values: { customer: "Beta", amount: "10" } } },
    }, "Alice");
    expect(response2.kind).toBe("confirmation-required");

    const humanPrep = await prepareHumanPanelOperation(owner, credentials, {
      applicationId: "app-1",
      useId: "orders-use",
      operationId: "orderForm.save",
      call: { target: null, input: { values: { customer: "Human", amount: "99" } } },
    });
    const humanDone = await dispatchHumanPanelOperation(owner, credentials, humanPrep.intentId);
    expect(humanDone).toMatchObject({ kind: "dispatched", outcome: { kind: "success" } });

    const storedQuestionId2 = (intents.get(intentId2) as { questionId: string }).questionId;
    humanAnswer = { role: "notification", kind: "agent-answer", source: { kind: "user" }, replyTo: storedQuestionId2, answerId: uuid(11) };
    expect(await dispatchPanel(owner, credentials, uuid(2), intentId2)).toMatchObject({
      kind: "not-dispatched",
      code: "FORM_CONFIRMATION_STALE",
    });
  });
});
