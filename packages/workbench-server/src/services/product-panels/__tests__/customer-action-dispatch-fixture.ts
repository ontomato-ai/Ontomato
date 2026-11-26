import { tmpdir } from "node:os";
import { afterEach, beforeEach, expect, vi } from "vitest";
import { type PanelOperationIntent } from "@ontomato/contracts/panel-agent";
import type { RuntimeRun } from "@ontomato/contracts/agent-runtime";
import { installContentLayout } from "../../../content/layout";
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
  restore: vi.fn(),
  sessionActor: vi.fn(),
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
}));
vi.mock("../../agent-host/caller", () => ({
  restoreAgentCaller: mocks.restore,
  readAgentSessionActor: mocks.sessionActor,
}));
vi.mock("../../../utils/request-identity", async (original) => ({
  ...await original<typeof import("../../../utils/request-identity")>(),
  requireDomainId: (request: { domainId: string }) => request.domainId,
}));
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
  requirePanelUseEntry: async (...[, ref]: Parameters<typeof import("../application-use").requirePanelUseEntry>) => ({
    applicationId: ref.applicationId,
    use: {
      id: "orders-use",
      panelId: "panel-orders",
      pageKey: "orders",
      path: "/applications/app-1/orders",
    },
    framePanelId: undefined,
  }),
}));

export { mocks };

configureI18n({
  defaultLocale: "en",
  appTextLocale: "en",
  languageSwitchEnabled: true,
  packs: { en: { ...enLocaleMeta, messages: en } },
});

export const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
export const owner = { domainId: "d", userId: "U" };
export const credentials = { token: "U-token", locale: "en" };
export const codeHash = "a".repeat(64);
export const root = { providerId: "workbench", sessionId: uuid(1) };
const skill = { namespace: { kind: "domain" as const, domainId: "d" }, name: "orders-panel" };

export const createOrderAction = {
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

export const approveOrderAction = {
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

export const orderFormProjection = {
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

export const orderPanel = {
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

export const use = {
  id: "orders-use",
  panelId: "panel-orders",
  pageKey: "orders",
  path: "/applications/app-1/orders",
};

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

/** Runtime, Action owner and intent storage boundaries for customer panel operation tests. */
export function customerActionDispatchFixture() {
  let intents: Map<string, PanelOperationIntent>;

  beforeEach(() => {
    intents = new Map();
    mocks.panel.mockResolvedValue(orderPanel);
    mocks.projection.mockResolvedValue(orderFormProjection);
    mocks.pages.mockResolvedValue({ byId: new Map() });
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
          agent: { providerId: "workbench" },
          userRecipient: { session: root },
          authority: { executionKind: "live" },
        },
      },
    });
    mocks.session.mockResolvedValue({ messages: [] });
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
        const value = intents.get(id)!;
        if (value.dispatched || value.invalidated) return { rowCount: 0, rows: [] };
        intents.set(id, { ...value, invalidated: JSON.parse(String(args[3])) });
        return { rowCount: 1, rows: [{ id }] };
      }
      if (sql.includes("AND intent->>'dispatched'='false'")) {
        expect(sql).toContain("AND intent->'invalidated' IS NULL");
        const value = intents.get(id)!;
        if (value.dispatched || value.invalidated) return { rowCount: 0 };
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

  return {
    intent: (id: string) => intents.get(id)!,
    invalidateAtClaim: (intentId: string) => {
      const query = mocks.query.getMockImplementation()!;
      mocks.query.mockImplementation(async (sql: string, args: unknown[]) => {
        if (sql.includes("AND intent->>'dispatched'='false'")) {
          const current = intents.get(intentId)!;
          intents.set(intentId, {
            ...current,
            invalidated: { code: "FORM_CONFIRMATION_STALE", message: "The form changed before claim." },
          });
        }
        return query(sql, args);
      });
      return () => mocks.query.mockImplementation(query);
    },
  };
}

/** Run the Express route with an authenticated request at the middleware boundary, without opening a port. */
export async function customerActionRequest(path: string, body: unknown) {
  installContentLayout({ runtimeRoot: tmpdir(), publicSkillsRoot: tmpdir(), prompts: [], runtimeResources: [] });
  const { panelOperationsRouter: router } = await import("../../../api/routes/product-panels");
  return new Promise<unknown>((resolve, reject) => {
    const request = {
      ...owner, ...credentials, userName: "Alice", header: () => undefined, method: "POST", url: path, body,
    };
    const response = {
      locals: {},
      json: resolve,
      set() { return this; },
      status(status: number) {
        return { json: (answer: unknown) => reject(new Error(`POST ${path}: ${status} ${JSON.stringify(answer)}`)) };
      },
    };
    router(request as unknown as Parameters<typeof router>[0], response as unknown as Parameters<typeof router>[1], (error?: unknown) => {
      reject(error ?? new Error(`No route matched POST ${path}`));
    });
  });
}
