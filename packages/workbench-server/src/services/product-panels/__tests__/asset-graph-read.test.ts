import { afterEach, beforeAll, expect, it, vi } from "vitest";
import { OBJECT_TYPE } from "@ontomato/contracts/platform-object-types";
import type { ProductProjection } from "@ontomato/contracts/product-panels";
import { configureI18n } from "../../../i18n";
import { en, enLocaleMeta } from "../../../i18n/locales/en";
import type { CurrentProductRow } from "../../../infrastructure/product-current";
import type { JavaPanelRead } from "../java-panel-reads";
import { readResolvedPanelOwner } from "../data-reads";

const mocks = vi.hoisted(() => ({ definitions: vi.fn(), mappings: vi.fn(), post: vi.fn() }));
vi.mock("../current", async original => ({
  ...await original<typeof import("../current")>(), readCurrentDefinitionRows: mocks.definitions,
}));
vi.mock("../../assistant/store", async original => {
  const actual = await original<typeof import("../../assistant/store")>();
  return { ...actual, assistantStore: { ...actual.assistantStore, agents: async () => [] } };
});
vi.mock("../object-detail", async original => ({
  ...await original<typeof import("../object-detail")>(), listObjectDetailPanelMappings: mocks.mappings,
}));
vi.mock("../../../infrastructure/postgres", async original => ({
  ...await original<typeof import("../../../infrastructure/postgres")>(), getPostgresPool: () => ({}),
}));
vi.mock("../../../utils/backend-client", async original => ({
  ...await original<typeof import("../../../utils/backend-client")>(), backendPost: mocks.post,
}));

beforeAll(() => configureI18n({
  defaultLocale: "en", appTextLocale: "en", languageSwitchEnabled: false, packs: { en: { ...enLocaleMeta, messages: en } },
}));

afterEach(() => { vi.unstubAllEnvs(); });

it("uses the same single graph owner with a stored caller and keeps the ID of a refused metric", async () => {
  vi.stubEnv("ONTOMATO_QUERY_SERVICE_TOKEN", "graph-test-service");
  const owner = { domainId: "test-domain", userId: "executor" };
  const now = new Date("2026-11-26");
  const order = { source: { type: { kind: "ObjectType", id: "Order" } }, read: "query", params: {} };
  const row = (id: string, definition: object): CurrentProductRow => ({
    id, domainId: owner.domainId, ownerId: owner.userId, revision: 1, createdAt: now, updatedAt: now,
    definition: { visibility: "domain", name: id, description: "", ...definition },
  });
  const projection = {
    componentId: "@ontomato/sdk:MetricChart", inputs: {}, outputs: {}, config: {}, data: { rows: order },
    operations: { approve: { operation: { kind: "Action", id: "approve" } } },
  };
  const panel = row("orders", { content: { html: "<div />" }, manifest: { state: {}, members: {
    inScope: { target: { projectionId: "orders-view" } },
    outOfScope: { target: { projectionId: "payroll-view" } },
  } } });
  const inScope = row("orders-view", { ...projection, metricId: "orders-total" });
  const outOfScope = row("payroll-view", { ...projection, metricId: "payroll-total" });
  const disconnected = row("disconnected", { ...projection, metricId: "unrelated-metric", data: {}, operations: {} });
  const obsolete = row("obsolete", { ...projection, metricId: "never-requested", data: {
    grants: { source: { type: { kind: "PlatformObjectType", id: "platform:Application" } }, read: "grants", params: {} },
  } });
  mocks.definitions.mockImplementation(async (domain, kind) => {
    expect(domain).toBe(owner.domainId);
    return kind === "panel" ? [panel] : [inScope, outOfScope, disconnected, obsolete];
  });
  mocks.mappings.mockResolvedValue([{ className: "NotMounted", panelId: "unregistered" }]);
  const scopeHeader = "X-Ontomato-Retrieval-Caller-Id";
  const ready = (payload: unknown) => ({ status: "ready", payload });
  mocks.post.mockImplementation(async (_endpoint, url: string, body, options) => {
    expect(new URL(url, "http://data-engine.test").pathname).toBe("/internal/workbench-panel-reads");
    const headers = new Headers(options.headers);
    expect(headers.get("X-API-Key")).toBe("executor-key");
    expect(body.viewer).toEqual(owner);
    expect(body.reads).toHaveLength(1);
    expect(body.reads[0].visibleKinds).toBeUndefined();
    expect(body.reads[0].call).toEqual({
      type: OBJECT_TYPE, name: "productGraph", parameters: {
        panelIds: ["orders"], projectionIds: ["orders-view", "payroll-view", "disconnected"],
        objectTypes: ["Order"], actions: ["approve"], metrics: ["orders-total", "payroll-total"],
      },
    });
    const range = ready({ fixed: false, all: true, objectIds: [], authorId: null });
    const scope = headers.get(scopeHeader);
    if (scope !== null) expect(scope).toBe("stored-caller");
    return { text: JSON.stringify({ viewer: owner, results: [ready({
      panels: range, projections: range,
      applications: ready([{ id: "app", names: { en: "Application" }, panelIds: ["orders"], defaultAgentIds: [], canMaintain: true }]),
      authorization: ready({
        entries: [], rolePolicies: [{ policyId: "policy", roleId: "role", kind: "OBJECT" }],
        policyGrants: [{ policyId: "policy", targetKind: "APPLICATION", targetKey: "app", verb: "EDIT" }],
      }),
      objectTypes: { Order: ready("Orders") }, actions: { approve: ready("Approve") },
      metrics: {
        "orders-total": ready("Orders total"),
        "payroll-total": scope ? { status: "forbidden", error: "Source outside scope" } : ready("Payroll total"),
      },
    })] }) };
  });

  const path: JavaPanelRead = {
    source: { kind: "registered", applicationId: "app", useId: "graph" },
    registration: { panelId: "orders", framePanelId: "frame", inputs: {} }, uses: [],
  };
  const read = (caller?: string) => readResolvedPanelOwner(
    { owner, viewer: { apiKey: "executor-key", locale: "en", headers: caller ? { [scopeHeader]: "ignored-header" } : {} } },
    { kind: "platform", typeId: OBJECT_TYPE, method: "productGraph" }, {}, {} as ProductProjection, path, caller,
  );
  const ordinary = await read();
  const scoped = await read("stored-caller");
  expect(mocks.post).toHaveBeenCalledTimes(2);
  for (const [reply, payrollLabel] of [[ordinary, "Payroll total"], [scoped, "payroll-total"]] as const) {
    expect(reply).toMatchObject({ fields: { graph: { value: {
      nodes: expect.arrayContaining([
        expect.objectContaining({ id: "metric:orders-total", name: "Orders total" }),
        expect.objectContaining({ id: "metric:payroll-total", name: payrollLabel }),
        expect.objectContaining({ id: "object-type:Order", name: "Orders" }),
        expect.objectContaining({ id: "action:approve", name: "Approve" }),
      ]),
      edges: expect.arrayContaining([
        { source: "asset:app", target: "asset:orders", relation: "navigates", storage: "product-index" },
        { source: "policy:policy", target: "asset:app", relation: "edit", storage: "governance" },
        { source: "grant:role:role", target: "policy:policy", relation: "uses-policy", storage: "governance" },
      ]),
    } } } });
  }
});
