import path from "node:path";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { dashboardCardPrimaryKey, type DashboardDetail } from "@ontomato/contracts/dashboard";
import { panelFormDescriptionSchema, panelRecordListSchema, panelRecordSchema } from "@ontomato/contracts/panel-projection";
import {
  CREATE_DASHBOARD,
  CREATE_DASHBOARD_GROUP,
  DASHBOARD,
  DASHBOARD_CARD,
  DELETE_DASHBOARD,
  DELETE_DASHBOARD_CARD,
  DELETE_DASHBOARD_GROUP,
  METRIC_VIEW,
  RENAME_DASHBOARD,
  RENAME_DASHBOARD_CARD,
  RENAME_DASHBOARD_GROUP,
  SAVE_DASHBOARD_LAYOUT,
} from "@ontomato/contracts/platform-object-types";
import { CHART_SOURCE_IN_USE } from "@ontomato/contracts/product-panels";
import { installContentLayout } from "../../../content/layout";
import { configureI18n } from "../../../i18n";
import { en, enLocaleMeta } from "../../../i18n/locales/en";
import { HttpError } from "../../../utils/errors";
import type { PanelOperationHost, PanelWriteServerOperation } from "../../product-panels/server-operations";

const mocks = vi.hoisted(() => ({
  listDashboards: vi.fn(),
  getDashboard: vi.fn(),
  createDashboard: vi.fn(),
  saveDashboard: vi.fn(),
  deleteDashboard: vi.fn(),
  findChartReferences: vi.fn(),
  metricDescribe: vi.fn(),
  metricExecute: vi.fn(),
  metricForm: vi.fn(),
  metricParameters: vi.fn(),
  validateDrawing: vi.fn(),
  readFavoriteKeySet: vi.fn(),
}));

vi.mock("../../charts/import", () => ({ prepareChartImport: vi.fn() }));
vi.mock("../create-from-analysis", () => ({ resolveDashboardDatasets: vi.fn() }));
vi.mock("../../platform-home/service", async importOriginal => {
  const actual = await importOriginal<typeof import("../../platform-home/service")>();
  return {
    ...actual,
    readFavoriteKeySet: mocks.readFavoriteKeySet,
  };
});

vi.mock("../../../infrastructure/postgres-transaction", () => ({
  transaction: async <T>(fn: (client: unknown) => Promise<T>) => fn({}),
}));

vi.mock("../store", () => ({
  listDashboards: mocks.listDashboards,
  getDashboard: mocks.getDashboard,
  createDashboard: mocks.createDashboard,
  saveDashboard: mocks.saveDashboard,
  deleteDashboard: mocks.deleteDashboard,
}));

vi.mock("../metric-client", () => ({
  DashboardMetricClient: class {
    describe = mocks.metricDescribe;
    execute = mocks.metricExecute;
    form = mocks.metricForm;
    parameters = mocks.metricParameters;
  },
}));

vi.mock("../validation", () => ({
  validateDashboardChartDrawing: mocks.validateDrawing,
  validatePersonalDashboardMetrics: vi.fn(),
}));

import { installDashboardChartProjectionReferences } from "../projection-references";
import { createDashboardCardOwnerReadAdapter, createDashboardReadAdapter } from "../panel-reads";
import { dashboardServerOperations } from "../panel-operations";

let panelServerOperationLabel: typeof import("../../product-panels/server-operations").panelServerOperationLabel;
let registeredPanelOperation: typeof import("../../product-panels/server-operations").registeredPanelOperation;

beforeAll(async () => {
  installContentLayout({
    runtimeRoot: process.cwd(),
    publicSkillsRoot: path.resolve("skills"),
    prompts: [],
    runtimeResources: [],
  });
  configureI18n({
    defaultLocale: "en",
    appTextLocale: "en",
    languageSwitchEnabled: true,
    packs: {
      en: { messages: en, ...enLocaleMeta },
    },
  });
  const mod = await import("../../product-panels/server-operations");
  panelServerOperationLabel = mod.panelServerOperationLabel;
  registeredPanelOperation = mod.registeredPanelOperation;
});

const owner = { userId: "owner-1", domainId: "domain-1" };
const credentials = {
  userId: "owner-1",
  token: "tok",
  locale: "en",
  headers: {},
} as unknown as PanelOperationHost["executor"]["credentials"];

const host: PanelOperationHost = {
  initiator: { owner, credentials },
  executor: { owner, credentials },
  locale: "en",
  request: vi.fn(),
  requestWorkbench: vi.fn(),
};

function sampleDashboard(): DashboardDetail {
  return {
    id: "dash-1",
    ownerId: "owner-1",
    name: "Operations Board",
    createdAt: 1_700_000_000_000,
    updatedAt: 1_700_000_100_000,
    groups: [
      {
        id: "g-1",
        title: "Overview",
        metrics: [
          {
            id: "m-card-1",
            name: "Active Orders",
            query: { kind: "metric", metricId: "mv-orders", parameters: { region: "APAC" } },
            valueField: "total",
            unit: "orders",
            layout: { colSpan: 3, rowSpan: 1 },
          },
        ],
        charts: [
          {
            id: "c-card-1",
            name: "Daily Trend",
            query: { kind: "metric", metricId: "mv-trend", parameters: { region: "APAC" } },
            chartFile: {
              name: "trend.chart.json",
              content: {
                chartType: "bar",
                dataset: [{ id: "metric", source: [] }],
                series: [{ type: "bar", encode: { x: "day", y: "amount" } }],
                ontomato: { chartType: "bar" },
              } as never,
            },
            layout: { colSpan: 6, rowSpan: 2 },
          },
        ],
      },
      {
        id: "g-empty",
        title: "Empty Section",
        metrics: [],
        charts: [],
      },
    ],
  };
}

function findOperation(id: string) {
  const op = dashboardServerOperations.find(entry => entry.handlerRef === id);
  if (!op) throw new Error(`Missing operation ${id}`);
  return op as PanelWriteServerOperation & {
    execute(host: PanelOperationHost, target: unknown, input: Record<string, unknown>, intentId: string): ReturnType<PanelWriteServerOperation["execute"]>;
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  installDashboardChartProjectionReferences({
    find: mocks.findChartReferences,
    remove: vi.fn(),
  });
  mocks.findChartReferences.mockResolvedValue([]);
  mocks.listDashboards.mockResolvedValue([
    { id: "dash-1", name: "Operations Board", createdAt: 1_700_000_000_000, updatedAt: 1_700_000_100_000 },
  ]);
  mocks.getDashboard.mockImplementation(async (ownerId: string, domainId: string, id: string) => {
    if (ownerId === "owner-1" && domainId === "domain-1" && id === "dash-1") return sampleDashboard();
    return null;
  });
  mocks.createDashboard.mockImplementation(async ({ name }: { name: string }) => ({
    id: "dash-new",
    ownerId: "owner-1",
    name,
    groups: [],
    createdAt: 1_700_000_200_000,
    updatedAt: 1_700_000_200_000,
  }));
  mocks.saveDashboard.mockResolvedValue(undefined);
  mocks.deleteDashboard.mockResolvedValue(undefined);
  mocks.validateDrawing.mockResolvedValue(undefined);
  mocks.metricDescribe.mockResolvedValue({
    id: "mv-orders",
    revision: "rev-7",
    status: "PUBLISHED",
    name: "Order Count",
    parameterDefs: [],
    outputColumns: [{ key: "total", label: "Total", type: "NUMBER" }],
    sourceObjectTypes: ["Order"],
  });
  mocks.metricExecute.mockResolvedValue({
    columns: [{ key: "total", label: "Total", type: "NUMBER" }],
    rows: [{ total: 42 }],
    truncation: null,
  });
  mocks.metricForm.mockResolvedValue({
    revision: "rev-7",
    fields: [
      {
        key: "region",
        label: "Region",
        type: "select",
        required: true,
        defaultValue: "APAC",
        help: "Target region",
        refreshOnChange: false,
        options: [
          { value: "APAC", label: "APAC", description: null, disabled: false, disabledReason: null },
          { value: "EMEA", label: "EMEA", description: null, disabled: false, disabledReason: null },
        ],
      },
      {
        key: "lockedTenant",
        label: "Tenant",
        type: "text",
        required: false,
        defaultValue: "t-1",
        help: null,
        multiline: false,
        placeholder: null,
        maxLength: 50,
      },
    ],
    values: { region: "APAC", lockedTenant: "t-1" },
    readOnly: ["lockedTenant"],
  });
  mocks.metricParameters.mockResolvedValue({
    revision: "rev-7",
    parameters: { region: "EMEA" },
    errors: [],
  });
  mocks.readFavoriteKeySet.mockResolvedValue(new Set());
});

describe("dashboard panel server operations", () => {
  it("registers all 10 dashboard and card operations with valid localized labels", () => {
    const ids = [
      CREATE_DASHBOARD,
      RENAME_DASHBOARD,
      DELETE_DASHBOARD,
      SAVE_DASHBOARD_LAYOUT,
      CREATE_DASHBOARD_GROUP,
      RENAME_DASHBOARD_GROUP,
      DELETE_DASHBOARD_GROUP,
      RENAME_DASHBOARD_CARD,
      DELETE_DASHBOARD_CARD,
      `${DASHBOARD_CARD}.save`,
    ];
    for (const id of ids) {
      const reg = registeredPanelOperation(id);
      expect(reg, `operation ${id} must be registered`).toBeDefined();
      expect(panelServerOperationLabel(reg!.handler, "en")).toBeTruthy();
    }
  });

  it("creates, renames, saves layout atomically with name, and inserts groups at insertIndex", async () => {
    const createOp = findOperation(CREATE_DASHBOARD);
    const created = await createOp.execute(host, null as never, { name: "New Board" }, "intent-1");
    expect(created).toMatchObject({
      kind: "success",
      created: { objectType: DASHBOARD, primaryKey: "dash-new" },
    });

    const createGroupOp = findOperation(CREATE_DASHBOARD_GROUP);
    const added = await createGroupOp.execute(
      host,
      { kind: "object", objectType: DASHBOARD, primaryKey: "dash-1" },
      { title: "Top Section", insertIndex: 0 },
      "intent-2",
    );
    expect(added.kind).toBe("success");
    const savedAfterGroup = mocks.saveDashboard.mock.calls.at(-1)?.[2] as DashboardDetail;
    expect(savedAfterGroup.groups[0]?.title).toBe("Top Section");

    const saveLayoutOp = findOperation(SAVE_DASHBOARD_LAYOUT);
    const saved = await saveLayoutOp.execute(
      host,
      { kind: "object", objectType: DASHBOARD, primaryKey: "dash-1" },
      {
        name: "Renamed Board",
        groups: [
          {
            id: "g-1",
            title: "Overview Updated",
            charts: [{ id: "c-card-1", layout: { colSpan: 12, rowSpan: 2 } }],
            metrics: [{ id: "m-card-1", layout: { colSpan: 4, rowSpan: 1 } }],
          },
        ],
      },
      "intent-3",
    );
    expect(saved.kind).toBe("success");
    const savedLayoutBoard = mocks.saveDashboard.mock.calls.at(-1)?.[2] as DashboardDetail;
    expect(savedLayoutBoard.name).toBe("Renamed Board");
    expect(savedLayoutBoard.groups[0]?.charts[0]?.layout).toEqual({ colSpan: 12, rowSpan: 2 });

    const patched = await saveLayoutOp.execute(
      host,
      { kind: "object", objectType: DASHBOARD, primaryKey: "dash-1" },
      {
        groupRenames: { "g-1": "Executive Overview" },
        itemRenames: { [dashboardCardPrimaryKey({ dashboardId: "dash-1", cardId: "m-card-1" })]: "Total ARR" },
      },
      "intent-3b",
    );
    expect(patched.kind).toBe("success");
    const patchedBoard = mocks.saveDashboard.mock.calls.at(-1)?.[2] as DashboardDetail;
    expect(patchedBoard.groups[0]?.title).toBe("Executive Overview");
    expect(patchedBoard.groups[0]?.metrics[0]?.name).toBe("Total ARR");
  });

  it("inspects delete impact and refuses deletion when a chart card is referenced by a projection", async () => {
    const deleteBoardOp = findOperation(DELETE_DASHBOARD);
    const impact = await deleteBoardOp.inspectImpact!.inspect(host, [
      { target: { kind: "object", objectType: DASHBOARD, primaryKey: "dash-1" }, input: {} },
    ]);
    expect(impact?.total).toBe(2);
    expect(impact?.objects).toHaveLength(2);

    mocks.findChartReferences.mockResolvedValue(["metric-chart-abc"]);
    const refusedBoard = await deleteBoardOp.execute(
      host,
      { kind: "object", objectType: DASHBOARD, primaryKey: "dash-1" },
      {},
      "intent-4",
    );
    expect(refusedBoard).toMatchObject({
      kind: "refusal",
      code: CHART_SOURCE_IN_USE,
      details: { projectionIds: ["metric-chart-abc"] },
    });

    const cardKey = dashboardCardPrimaryKey({ dashboardId: "dash-1", cardId: "c-card-1" });
    const deleteCardOp = findOperation(DELETE_DASHBOARD_CARD);
    const refusedCard = await deleteCardOp.execute(
      host,
      { kind: "object", objectType: DASHBOARD_CARD, primaryKey: cardKey },
      {},
      "intent-5",
    );
    expect(refusedCard).toMatchObject({
      kind: "refusal",
      code: CHART_SOURCE_IN_USE,
    });
  });

  it("saves card parameters via form.save with string revision, excludes readOnly fields, and maps validation errors", async () => {
    const cardKey = dashboardCardPrimaryKey({ dashboardId: "dash-1", cardId: "m-card-1" });
    const saveParamsOp = findOperation(`${DASHBOARD_CARD}.save`);

    const saved = await saveParamsOp.execute(
      host,
      { kind: "object", objectType: DASHBOARD_CARD, primaryKey: cardKey },
      { values: { region: "EMEA", lockedTenant: "hacked" }, revision: "rev-7", submittedFields: ["/region", "/lockedTenant"] },
      "intent-6",
    );
    expect(saved).toMatchObject({
      kind: "success",
      data: { dashboardId: "dash-1", cardId: "m-card-1", revision: "rev-7" },
    });
    expect(mocks.metricParameters).toHaveBeenCalledWith(
      expect.objectContaining({ metricId: "mv-orders" }),
      "rev-7",
      { region: "EMEA" },
    );

    mocks.metricParameters.mockRejectedValueOnce(new HttpError(422, "Invalid metric parameters", "METRIC_PARAMETERS_INVALID", {
      errors: [{ field: "/values/region", code: "invalid_option", message: "Unknown region" }],
    }));
    const invalid = await saveParamsOp.execute(
      host,
      { kind: "object", objectType: DASHBOARD_CARD, primaryKey: cardKey },
      { values: { region: "MARS" }, revision: "rev-7" },
      "intent-7",
    );
    expect(invalid).toMatchObject({
      kind: "refusal",
      code: "METRIC_PARAMETERS_INVALID",
      errors: [{ field: "/region", code: "invalid_option", message: "Unknown region" }],
    });
  });
});
