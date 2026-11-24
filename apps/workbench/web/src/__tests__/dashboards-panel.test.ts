/* eslint-disable vue/one-component-per-file */
import { afterEach, describe, expect, it, vi } from "vitest";
import { defineComponent, h } from "vue";
import { createMemoryHistory, createRouter, RouterView } from "vue-router";
import { appsSdkComponentCatalogEntrySchema } from "@ontomato/contracts/apps-sdk";
import { dashboardCardPrimaryKey, dashboardChartFileSchema } from "@ontomato/contracts/dashboard";
import { expandPanelAuthoringMember } from "@ontomato/contracts/panel-authoring-expansion";
import { panelAuthoringManifestSchema } from "@ontomato/contracts/panel-authoring";
import { definePanel, type PanelOperationCall } from "@ontomato/contracts/panel-manifest";
import type { ProductPanelReadRequest } from "@ontomato/contracts/panel-host";
import { currentPanelRecordSchema, type ProductProjection } from "@ontomato/contracts/product-panels";
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
  platformObjectTypes,
} from "@ontomato/contracts/platform-object-types";
import { platformTypeTableEntrySchema } from "@ontomato/contracts/platform-type-table";
import { components } from "../../../../../packages/apps-sdk/src/catalogue";
import { useApplicationCatalog } from "../../../../../packages/platform-web/src/catalog";
import PanelApplicationRoute from "../../../../../packages/platform-web/src/pages/PanelApplicationRoute.vue";
import panelSource from "../../../../../packages/platform-shell/resources/builtin-panels/dashboards/panel.json";
import panelHtml from "../../../../../packages/platform-shell/resources/builtin-panels/dashboards/panel.html?raw";
import panelModule from "../../../../../packages/platform-shell/resources/builtin-panels/dashboards/panel.mjs?raw";
import {
  humanIntents,
  installPlatform,
  leaveFrame,
  mountPlatformPage,
  nothingAt,
  panelAnswer,
  panelRecord,
  panelSnapshot,
  panelUse,
  type Sent,
} from "./panel-frame";

vi.mock("../../../../../packages/foundation-ui/src/chart/EChart.vue", () => ({
  default: defineComponent({
    props: ["option"],
    setup: (props) => () =>
      h("div", {
        class: "mock-echart",
        "data-series-type": String(props.option?.series?.[0]?.type ?? ""),
      }),
  }),
}));

const appId = "dashboards";
const dashboardsUse = panelUse(
  "dashboards-main",
  "dashboards",
  "builtin-product-dashboards",
  "/dashboards",
);

const FORM_SAVE_OPS = new Set([`${DASHBOARD_CARD}.save`]);
const TARGETLESS_OPS = new Set([CREATE_DASHBOARD]);
const DASHBOARD_TARGET_OPS = new Set([
  RENAME_DASHBOARD,
  DELETE_DASHBOARD,
  SAVE_DASHBOARD_LAYOUT,
  CREATE_DASHBOARD_GROUP,
  RENAME_DASHBOARD_GROUP,
  DELETE_DASHBOARD_GROUP,
]);
const CARD_TARGET_OPS = new Set([RENAME_DASHBOARD_CARD, DELETE_DASHBOARD_CARD]);

const objectTypes = Object.fromEntries(
  Object.entries(platformObjectTypes).map(([type, entry]) => [
    type,
    platformTypeTableEntrySchema.parse({
      ...entry,
      operations: entry.operations?.map((id) => ({
        id,
        kind: FORM_SAVE_OPS.has(id) ? "form.save" : "action",
        effect: "write",
        batch: false,
        inputSchema: {},
        target: TARGETLESS_OPS.has(id)
          ? { source: "none" }
          : DASHBOARD_TARGET_OPS.has(id)
            ? { source: "input", input: "dashboard" }
            : CARD_TARGET_OPS.has(id)
              ? { source: "input", input: "card" }
              : { source: "input", input: "target" },
      })),
    }),
  ]),
);

const catalogue = components.map((component) =>
  appsSdkComponentCatalogEntrySchema.parse({
    ...component,
    ...(component.componentId === "OperationButton"
      ? { config: [{ name: "operation", type: "string", required: true, description: "Operation" }] }
      : {}),
    ports: { props: [], events: [], slots: [] },
  }),
);

function buildDashboardsPanel() {
  const { members: authoring, ...manifest } = panelAuthoringManifestSchema.parse(panelSource.manifest);
  const projections = new Map<string, ProductProjection>();
  const members = Object.fromEntries(
    Object.entries(authoring).map(([memberName, definition]) => {
      if (!("component" in definition)) throw new Error(`Expected authored projection for ${memberName}`);
      const { projection, placement } = expandPanelAuthoringMember(memberName, definition, {
        state: manifest.state,
        typeTable: { objectTypes },
        components: catalogue,
      });
      projections.set(definition.id!, {
        ...projection,
        id: definition.id!,
        name: memberName,
        description: memberName,
        visibility: "platform",
        domainId: null,
        ownerId: null,
        editable: false,
        revision: 1,
        createdAt: "2026-11-25T00:00:00.000Z",
        updatedAt: "2026-11-25T00:00:00.000Z",
      });
      return [memberName, { ...placement, target: { projectionId: definition.id! } }];
    }),
  );
  const panel = currentPanelRecordSchema.parse({
    ...panelRecord("builtin-product-dashboards", "Dashboards", definePanel({ ...manifest, members })),
    visibility: "platform",
    domainId: null,
    ownerId: null,
    editable: false,
    content: {
      html: panelHtml,
      module: panelModule,
      messages: panelSource.content.messages,
    },
  });
  return { panel, projections };
}

const builtPanel = buildDashboardsPanel();

const sampleChartFile = dashboardChartFileSchema.parse({
  name: "revenue.chart.json",
  content: {
    dataset: [{ id: "metric", dimensions: ["region", "revenue"], source: [] }],
    xAxis: { type: "category" },
    yAxis: { type: "value" },
    series: [{ id: "s0", type: "bar", datasetId: "metric", encode: { x: "region", y: "revenue" } }],
    ontomato: { display: { formats: { revenue: { kind: "number" } } } },
  },
});

let unmount = () => {};
afterEach(async () => {
  unmount();
  unmount = () => {};
  useApplicationCatalog().applications.value = [];
  await leaveFrame();
  vi.restoreAllMocks();
});

async function flush() {
  await Promise.resolve();
  await new Promise((resolve) => setTimeout(resolve, 25));
}

function defaultAdmittedOperations(member: string, inputs: Record<string, unknown> = {}) {
  if (member === "createBoard") {
    return {
      create: {
        kind: "action",
        handlerRef: CREATE_DASHBOARD,
        label: "Create dashboard",
        effect: "write",
        target: { source: "none" },
        inputSchema: {
          type: "object",
          properties: { name: { type: "string", title: "Dashboard name", minLength: 1 } },
          required: ["name"],
        },
        resultSchema: {},
        batch: false,
      },
    };
  }
  if (member === "boardTabs") {
    return {
      rename: {
        kind: "action",
        handlerRef: RENAME_DASHBOARD,
        label: "Rename dashboard",
        effect: "write",
        target: { source: "row" },
        inputSchema: {
          type: "object",
          properties: { name: { type: "string", title: "Dashboard name", minLength: 1 } },
          required: ["name"],
        },
        resultSchema: {},
        batch: false,
      },
      remove: {
        kind: "action",
        handlerRef: DELETE_DASHBOARD,
        label: "Delete dashboard",
        effect: "write",
        target: { source: "row" },
        inputSchema: {},
        resultSchema: {},
        batch: false,
      },
    };
  }
  if (member === "boardGrid") {
    const hasBoard = Boolean(inputs.dashboard && typeof inputs.dashboard === "object");
    return {
      renameCard: {
        kind: "action",
        handlerRef: RENAME_DASHBOARD_CARD,
        label: "Rename card",
        effect: "write",
        target: { source: "row" },
        inputSchema: {
          type: "object",
          properties: { name: { type: "string", title: "Card name", minLength: 1 } },
          required: ["name"],
        },
        resultSchema: {},
        batch: false,
      },
      deleteCard: {
        kind: "action",
        handlerRef: DELETE_DASHBOARD_CARD,
        label: "Delete card",
        effect: "write",
        target: { source: "row" },
        inputSchema: {},
        resultSchema: {},
        batch: false,
      },
      ...(hasBoard
        ? {
            saveLayout: {
              kind: "action",
              handlerRef: SAVE_DASHBOARD_LAYOUT,
              label: "Save layout",
              effect: "write",
              target: { source: "input", input: "dashboard" },
              inputSchema: {},
              resultSchema: {},
              batch: false,
            },
            createGroup: {
              kind: "action",
              handlerRef: CREATE_DASHBOARD_GROUP,
              label: "Create group",
              effect: "write",
              target: { source: "input", input: "dashboard" },
              inputSchema: {},
              resultSchema: {},
              batch: false,
            },
            renameGroup: {
              kind: "action",
              handlerRef: RENAME_DASHBOARD_GROUP,
              label: "Rename group",
              effect: "write",
              target: { source: "input", input: "dashboard" },
              inputSchema: {},
              resultSchema: {},
              batch: false,
            },
            deleteGroup: {
              kind: "action",
              handlerRef: DELETE_DASHBOARD_GROUP,
              label: "Delete group",
              effect: "write",
              target: { source: "input", input: "dashboard" },
              inputSchema: {},
              resultSchema: {},
              batch: false,
            },
            renameBoard: {
              kind: "action",
              handlerRef: RENAME_DASHBOARD,
              label: "Rename dashboard",
              effect: "write",
              target: { source: "input", input: "dashboard" },
              inputSchema: {},
              resultSchema: {},
              batch: false,
            },
          }
        : {}),
    };
  }
  if (member === "cardParamForm") {
    const hasCard = Boolean(inputs.target && typeof inputs.target === "object");
    return hasCard
      ? {
          save: {
            kind: "form.save",
            handlerRef: `${DASHBOARD_CARD}.save`,
            label: "Save card parameters",
            effect: "write",
            target: { source: "input", input: "target" },
            inputSchema: {},
            resultSchema: {},
            batch: false,
          },
        }
      : {};
  }
  return {};
}

interface MockBoardState {
  boards: Array<{ id: string; name: string }>;
  groupsByBoard: Record<string, Array<{ id: string; title: string; order: number }>>;
  cardsByBoard: Record<string, Array<{
    cardId: string;
    name: string;
    kind: "chart" | "metric";
    groupId: string;
    groupTitle: string;
    order: number;
    colSpan: number;
    rowSpan: number;
    valueField?: string;
    unit?: string;
  }>>;
}

function initialBoardState(): MockBoardState {
  return {
    boards: [
      { id: "d1", name: "Executive Overview" },
      { id: "d2", name: "Operations Weekly" },
    ],
    groupsByBoard: {
      d1: [
        { id: "g1", title: "Revenue", order: 0 },
        { id: "g2", title: "Pipeline", order: 1 },
      ],
      d2: [
        { id: "g3", title: "Throughput", order: 0 },
      ],
    },
    cardsByBoard: {
      d1: [
        { cardId: "m1", name: "Total Revenue", kind: "metric", groupId: "g1", groupTitle: "Revenue", order: 0, colSpan: 3, rowSpan: 1, valueField: "total", unit: "USD" },
        { cardId: "c1", name: "Revenue by Region", kind: "chart", groupId: "g1", groupTitle: "Revenue", order: 0, colSpan: 6, rowSpan: 2 },
      ],
      d2: [],
    },
  };
}

async function openDashboardsPanel(options: {
  initialPath?: string;
  state?: MockBoardState;
  onRead?: (request: ProductPanelReadRequest) => void;
  onOperation?: (operationId: string, call: PanelOperationCall) => Record<string, unknown> | undefined;
} = {}) {
  const state = options.state ?? initialBoardState();
  const dispatched: Array<{ operationId: string; call: PanelOperationCall }> = [];
  const reads: ProductPanelReadRequest[] = [];

  const opsHandler = humanIntents(
    (operationId, call) => {
      dispatched.push({ operationId, call });
      const custom = options.onOperation?.(operationId, call);
      if (custom) return custom as never;
      if (operationId.endsWith("createBoard.create")) {
        const name = String(call.input?.name ?? "New board");
        const id = "d-new";
        state.boards.push({ id, name });
        state.groupsByBoard[id] = [];
        state.cardsByBoard[id] = [];
        return {
          kind: "success",
          created: { objectType: DASHBOARD, primaryKey: id },
          data: { id, name },
          affected: { objects: [{ objectType: DASHBOARD, primaryKey: id }], objectTypes: [DASHBOARD] },
        };
      }
      return {
        kind: "success",
        data: {},
        affected: { objects: [], objectTypes: [DASHBOARD, DASHBOARD_CARD] },
      };
    },
    { source: "input", input: "dashboard" },
    { admitted: (member, inputs) => defaultAdmittedOperations(member, inputs) },
  );

  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      {
        path: "/",
        component: { render: () => h(RouterView) },
        children: [
          { path: dashboardsUse.path, component: PanelApplicationRoute, props: { applicationId: appId } },
        ],
      },
    ],
  });

  installPlatform(async (sent: Sent) => {
    const opsAnswer = opsHandler(sent);
    if (opsAnswer) return opsAnswer;

    const { path } = sent;
    if (path === "/api/data-query/platform/applications") {
      return Response.json({
        data: [{
          id: appId,
          kind: "native",
          rail: "top",
          category: "business",
          sort: 20,
          entry: { path: "/dashboards", renderer: "dashboards" },
          names: { en: "Dashboards" },
          descriptions: {},
          icon: "dashboards",
          panelUses: [dashboardsUse],
        }],
      });
    }
    if (path === "/api/data-query/platform/applications/resolve-entry") {
      return Response.json({
        data: { applicationId: appId, entry: { path: "/dashboards", renderer: "dashboards" }, use: dashboardsUse, menu: { groups: [], panelUses: [dashboardsUse] } },
      });
    }
    if (path === `/api/data-query/platform/applications/${appId}/panel-uses`) {
      return Response.json({
        data: { applicationId: appId, entry: { path: "/dashboards", renderer: "dashboards" }, panelUses: [dashboardsUse] },
      });
    }
    if (path === `/api/product-panels/${dashboardsUse.panelId}`) {
      return panelAnswer(builtPanel.panel, sent);
    }
    if (path === `/api/product-panels/${dashboardsUse.panelId}/snapshot`) {
      return panelSnapshot(builtPanel.panel, Object.fromEntries(builtPanel.projections), sent);
    }
    if (path.startsWith("/api/product-projections/")) {
      const id = decodeURIComponent(path.slice("/api/product-projections/".length));
      const projection = builtPanel.projections.get(id);
      if (projection) return Response.json({ projection });
    }
    if (path === "/api/product-panels/page-skill") {
      return Response.json({ pageKey: dashboardsUse.pageKey, applicationId: appId, useId: dashboardsUse.id, panelId: dashboardsUse.panelId, skills: [] });
    }
    if (path === "/api/product-panels/read") {
      const req = sent.body as ProductPanelReadRequest;
      reads.push(req);
      options.onRead?.(req);
      const member = req.memberPath.at(-1)!.member;
      const dataName = "dataName" in req ? req.dataName : undefined;
      if (member === "boardTabs" && dataName === "rows") {
        return Response.json({
          status: "ready",
          value: state.boards.map((board) => ({
            primaryKey: board.id,
            className: DASHBOARD,
            label: board.name,
            fields: { name: board.name },
          })),
        });
      }
      if (member === "boardGrid") {
        const boardId = (req.inputs?.target as { primaryKey?: string } | undefined)?.primaryKey ?? "";
        const board = state.boards.find((item) => item.id === boardId);
        if (!board) return Response.json({ status: "empty" });
        if (dataName === "record") {
          return Response.json({
            status: "ready",
            value: {
              primaryKey: board.id,
              className: DASHBOARD,
              label: board.name,
              fields: {
                name: board.name,
                groups: { kind: "json", value: state.groupsByBoard[board.id] ?? [] },
              },
            },
          });
        }
        if (dataName === "rows") {
          const cards = state.cardsByBoard[board.id] ?? [];
          return Response.json({
            status: "ready",
            value: cards.map((card) => ({
              primaryKey: dashboardCardPrimaryKey({ dashboardId: board.id, cardId: card.cardId }),
              className: DASHBOARD_CARD,
              label: card.name,
              fields: {
                cardId: card.cardId,
                dashboardId: board.id,
                name: card.name,
                kind: card.kind,
                groupId: card.groupId,
                groupTitle: card.groupTitle,
                order: card.order,
                colSpan: card.colSpan,
                rowSpan: card.rowSpan,
                ...(card.valueField ? { valueField: card.valueField } : {}),
                ...(card.unit ? { unit: card.unit } : {}),
              },
            })),
          });
        }
      }
      if (member === "chartCard") {
        if (dataName === "template") {
          return Response.json({
            status: "ready",
            value: { chartFile: sampleChartFile, parameters: { year: "2026" } },
          });
        }
        if (dataName === "result") {
          return Response.json({
            status: "ready",
            value: {
              columns: [
                { key: "region", label: "Region", type: "string" },
                { key: "revenue", label: "Revenue", type: "number" },
              ],
              rows: [{ region: "East", revenue: 120 }],
              truncation: null,
            },
          });
        }
      }
      if (member === "metricCard" && dataName === "result") {
        return Response.json({
          status: "ready",
          value: {
            columns: [{ key: "total", label: "Total", type: "number" }],
            rows: [{ total: 4200 }],
            truncation: null,
          },
        });
      }
      if (member === "cardParamForm" && dataName === "form") {
        return Response.json({
          status: "ready",
          value: {
            revision: "rev-1",
            values: { year: "2026" },
            fields: [
              {
                path: "/year",
                label: "Fiscal year",
                required: false,
                readOnly: false,
                valueSchema: { type: "string" },
                control: { kind: "text", multiline: false },
              },
            ],
            errors: [],
            save: { method: "POST", path: "/api/dashboards/save-card-parameters", bodySchema: {} },
          },
        });
      }
      if (member === "cardMetricSource" && dataName === "record") {
        const pk = (req.inputs?.target as { primaryKey?: string } | undefined)?.primaryKey ?? "d1/c1";
        return Response.json({
          status: "ready",
          value: {
            primaryKey: pk,
            className: DASHBOARD_CARD,
            label: "Revenue by Region",
            fields: {
              metric: { kind: "reference", className: METRIC_VIEW, primaryKey: "mv-rev", label: "Revenue Metric" },
              status: "Published",
              parameters: "year: 2026",
            },
            fieldLabels: {
              metric: "Metric view",
              status: "Status",
              parameters: "Parameters",
            },
          },
        });
      }
      return Response.json({ status: "empty" });
    }
    return nothingAt(sent);
  }, router);

  useApplicationCatalog().applications.value = [{
    id: appId,
    kind: "native",
    rail: "top",
    category: "business",
    sort: 20,
    entry: { path: "/dashboards", renderer: "dashboards" },
    entryAccess: ["domain-member"],
    scheduleAdapter: null,
    releaseId: null,
    names: { en: "Dashboards" },
    descriptions: {},
    icon: "dashboards",
    panelUses: [dashboardsUse],
  }];

  await router.push(options.initialPath ?? "/dashboards");
  await router.isReady();
  const mounted = mountPlatformPage(() => h(RouterView), router);
  unmount = () => {
    mounted.app.unmount();
    mounted.element.remove();
  };
  return { router, element: mounted.element, reads, dispatched, state };
}

describe("builtin-product-dashboards panel", () => {
  it("lists boards in tabs, renders groups including empty groups with independent chart/metric cards, and creates a board", async () => {
    const { element, dispatched } = await openDashboardsPanel();

    await vi.waitFor(() => {
      expect(element.querySelectorAll('[role="tab"]').length, element.innerHTML).toBe(2);
      expect(element.querySelectorAll(".sdk-grouped-grid-group").length, element.innerHTML).toBe(2);
      expect(element.querySelector(".mock-echart"), element.innerHTML).not.toBeNull();
      expect(element.textContent).toContain("4,200");
    }, { timeout: 4000 });

    // Empty group "Pipeline" is rendered with custom group-empty copy.
    const groups = [...element.querySelectorAll<HTMLElement>(".sdk-grouped-grid-group")];
    expect(groups.map((g) => g.getAttribute("data-group-id"))).toEqual(["g1", "g2"]);
    expect(groups[1]!.textContent).toContain("No cards in this group yet");

    // No saveLayout fired on initial load.
    expect(dispatched.filter((item) => item.operationId.endsWith("saveLayout"))).toHaveLength(0);

    // Clicking createBoard opens its input dialog and selects the newly created dashboard after submit.
    const createBtn = element.querySelector<HTMLButtonElement>('[data-member="createBoard"] button')!;
    expect(createBtn).not.toBeNull();
    createBtn.click();
    await flush();

    const nameInput = document.querySelector<HTMLInputElement>('.el-dialog input[type="text"], .el-dialog input')!;
    expect(nameInput).not.toBeNull();
    nameInput.value = "Finance Q4";
    nameInput.dispatchEvent(new Event("input", { bubbles: true }));
    await flush();

    const confirmBtn = document.querySelector<HTMLButtonElement>(".el-dialog__footer .el-button--primary")!;
    confirmBtn.click();
    await vi.waitFor(() => {
      expect(dispatched.some((item) => item.operationId.endsWith("createBoard.create"))).toBe(true);
    });
    expect(dispatched.find((item) => item.operationId.endsWith("createBoard.create"))!.call.input).toEqual({
      name: "Finance Q4",
    });
    await vi.waitFor(() => {
      const selectedTab = element.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]');
      expect(selectedTab?.textContent).toContain("Finance Q4");
    });
  });

  it("restores short deep-link /dashboards?dashboardId=d1&cardId=c1 without saving layout, and saves layout only on user drag/resize", async () => {
    const { element, dispatched } = await openDashboardsPanel({
      initialPath: "/dashboards?dashboardId=d1&cardId=c1",
    });

    await vi.waitFor(() => {
      const card = element.querySelector<HTMLElement>('[data-primary-key="d1/c1"]');
      expect(card?.classList.contains("is-selected")).toBe(true);
    });

    // Deep-link restore MUST NOT invoke saveLayout.
    expect(dispatched.filter((item) => item.operationId.endsWith("saveLayout"))).toHaveLength(0);

    // User drags group g2 before g1 -> immediately invokes dashboards.saveLayout with mapped card IDs.
    const groups = [...element.querySelectorAll<HTMLElement>(".sdk-grouped-grid-group")];
    const handle = groups[1]!.querySelector<HTMLElement>('[data-testid="grouped-grid-group-handle"]')!;
    handle.dispatchEvent(new Event("dragstart", { bubbles: true }));
    groups[0]!.dispatchEvent(new Event("dragover", { bubbles: true, cancelable: true }));
    groups[0]!.dispatchEvent(new Event("drop", { bubbles: true, cancelable: true }));

    await vi.waitFor(() => {
      expect(dispatched.some((item) => item.operationId.endsWith("boardGrid.saveLayout"))).toBe(true);
    });

    const saveCall = dispatched.find((item) => item.operationId.endsWith("boardGrid.saveLayout"))!.call;
    expect(saveCall.target).toEqual({ kind: "object", objectType: DASHBOARD, primaryKey: "d1" });
    expect(saveCall.input).toEqual({
      groups: [
        { id: "g2", title: "Pipeline", metrics: [], charts: [] },
        {
          id: "g1",
          title: "Revenue",
          metrics: [{ id: "m1", layout: { colSpan: 3, rowSpan: 1 } }],
          charts: [{ id: "c1", layout: { colSpan: 6, rowSpan: 2 } }],
        },
      ],
    });
  });

  it("opens Parameters (ObjectForm) and Metric Source (ObjectSummary) dialogs and refreshes a single card without reloading the board", async () => {
    const { element, reads } = await openDashboardsPanel();

    await vi.waitFor(() => {
      expect(element.querySelector('[data-primary-key="d1/c1"]')).not.toBeNull();
      expect(element.querySelector(".mock-echart")).not.toBeNull();
    });

    const chartCardEl = element.querySelector<HTMLElement>('[data-primary-key="d1/c1"]')!;

    // Single-card refresh only re-fetches chartCard data, NOT boardGrid or metricCard.
    const readsBefore = reads.length;
    chartCardEl.querySelector<HTMLButtonElement>('[data-action="refresh-card"]')!.click();
    await vi.waitFor(() => {
      const after = reads.slice(readsBefore);
      expect(after.some((req) => req.memberPath.at(-1)?.member === "chartCard" && "dataName" in req && req.dataName === "result")).toBe(true);
    });
    const refreshedMembers = new Set(reads.slice(readsBefore).map((req) => req.memberPath.at(-1)?.member));
    expect(refreshedMembers.has("chartCard")).toBe(true);
    expect(refreshedMembers.has("boardGrid")).toBe(false);
    expect(refreshedMembers.has("metricCard")).toBe(false);

    // Clicking Parameters opens ObjectForm for the selected card.
    chartCardEl.querySelector<HTMLButtonElement>('[data-action="card-parameters"]')!.click();
    await vi.waitFor(() => {
      expect(document.body.textContent).toContain("Fiscal year");
    });

    // Clicking Metric Source opens ObjectSummary with MetricView reference.
    chartCardEl.querySelector<HTMLButtonElement>('[data-action="card-metric-source"]')!.click();
    await vi.waitFor(() => {
      expect(document.body.textContent).toContain("Revenue Metric");
      expect(document.body.textContent).toContain("Published");
    });
  });

  it("clears selected card and dialog when switching to another dashboard tab", async () => {
    const { element, router } = await openDashboardsPanel({
      initialPath: "/dashboards?dashboardId=d1&cardId=c1",
    });

    await vi.waitFor(() => {
      const card = element.querySelector<HTMLElement>('[data-primary-key="d1/c1"]');
      expect(card?.classList.contains("is-selected")).toBe(true);
    });

    const tabs = [...element.querySelectorAll<HTMLElement>('[role="tab"]')];
    expect(tabs).toHaveLength(2);
    tabs[1]!.click();

    await vi.waitFor(() => {
      expect(tabs[1]!.getAttribute("aria-selected")).toBe("true");
      expect(router.currentRoute.value.fullPath).toContain("dashboardId=d2");
      expect(router.currentRoute.value.fullPath).not.toContain("cardId=");
    });
  });
});
