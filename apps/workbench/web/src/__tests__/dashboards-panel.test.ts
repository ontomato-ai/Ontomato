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
  chartTruncation?: { truncated: true; rowLimit: number; truncationHint: string } | null;
  metricTruncation?: { truncated: true; rowLimit: number; truncationHint: string } | null;
} = {}) {
  const state = options.state ?? initialBoardState();
  const dispatched: Array<{ operationId: string; call: PanelOperationCall }> = [];
  const reads: ProductPanelReadRequest[] = [];
  let pageController: { fillForm?: (req: Record<string, unknown>) => Promise<unknown> } | null = null;

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
          {
            path: dashboardsUse.path,
            component: PanelApplicationRoute,
            props: {
              applicationId: appId,
              registerPageController: (controller: { fillForm?: (req: Record<string, unknown>) => Promise<unknown> }) => {
                pageController = controller;
                return () => {
                  if (pageController === controller) pageController = null;
                };
              },
            },
          },
          { path: "/ontology/assets/metrics/detail", component: { render: () => h("div", { "data-testid": "metric-detail-route" }, "Metric detail") } },
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
              truncation: options.chartTruncation ?? null,
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
            truncation: options.metricTruncation ?? null,
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
      if ((member === "cardMetricSource" || member === "cardMetricOpen") && dataName === "record") {
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
              parameters: {
                kind: "json",
                value: {
                  year: "2026",
                  region: "East",
                },
              },
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
  return { router, element: mounted.element, reads, dispatched, state, getPageController: () => pageController };
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

    // Empty group "Pipeline" is rendered with the restored group-empty guidance and highlight copy.
    const groups = [...element.querySelectorAll<HTMLElement>(".sdk-grouped-grid-group")];
    expect(groups.map((g) => g.getAttribute("data-group-id"))).toEqual(["g1", "g2"]);
    expect(groups[1]!.textContent).toContain("No charts in this group yet");
    expect(groups[1]!.textContent).toContain("Add to dashboard");

    // D-05: topbar has no extra Add group or Refresh all toolbar, and createBoard uses the default button style.
    expect(element.querySelector('[data-action="add-group"]')).toBeNull();
    expect(element.querySelector('[data-action="refresh-all"]')).toBeNull();
    const createBtn = element.querySelector<HTMLButtonElement>('[data-member="createBoard"] button')!;
    expect(createBtn).not.toBeNull();
    expect(createBtn.classList.contains("el-button--primary")).toBe(false);
    expect(createBtn.classList.contains("is-plain")).toBe(false);
    expect(createBtn.classList.contains("el-button--small")).toBe(false);

    // D-09: groups are non-collapsible and use a single overflow dropdown trigger instead of 3 exposed icon buttons.
    expect(element.querySelector(".sdk-grouped-grid-collapse-btn")).toBeNull();
    expect(groups[0]!.querySelector('[data-action="group-menu"]')).not.toBeNull();
    expect(groups[0]!.querySelector('[data-action="rename-group"]')).toBeNull();

    // No saveLayout fired on initial load.
    expect(dispatched.filter((item) => item.operationId.endsWith("saveLayout"))).toHaveLength(0);

    // Clicking createBoard opens its input dialog and selects the newly created dashboard after submit.
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

    // User drags group g2 before g1 -> debounced 400ms before invoking dashboards.saveLayout silently.
    const groups = [...element.querySelectorAll<HTMLElement>(".sdk-grouped-grid-group")];
    const handle = groups[1]!.querySelector<HTMLElement>('[data-testid="grouped-grid-group-handle"]')!;
    handle.dispatchEvent(new Event("dragstart", { bubbles: true }));
    groups[0]!.dispatchEvent(new Event("dragover", { bubbles: true, cancelable: true }));
    groups[0]!.dispatchEvent(new Event("drop", { bubbles: true, cancelable: true }));

    // Immediately after drop, debounce timer has not fired yet.
    expect(dispatched.filter((item) => item.operationId.endsWith("boardGrid.saveLayout"))).toHaveLength(0);

    await vi.waitFor(() => {
      expect(dispatched.some((item) => item.operationId.endsWith("boardGrid.saveLayout"))).toBe(true);
    }, { timeout: 1500 });

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

  it("opens group overflow menu with Add group above and dispatches createGroup with insertIndex", async () => {
    const { element, dispatched } = await openDashboardsPanel();

    await vi.waitFor(() => {
      expect(element.querySelectorAll(".sdk-grouped-grid-group").length).toBe(2);
    });

    const groups = [...element.querySelectorAll<HTMLElement>(".sdk-grouped-grid-group")];
    groups[1]!.querySelector<HTMLButtonElement>('[data-action="group-menu"]')!.click();
    await flush();

    const addAboveItems = [...document.querySelectorAll<HTMLElement>('[data-action="add-group-above"]')];
    expect(addAboveItems.length).toBeGreaterThanOrEqual(2);
    addAboveItems[1]!.click();
    await flush();

    const input = document.querySelector<HTMLInputElement>("#db-group-title-input")!;
    expect(input).not.toBeNull();
    input.value = "Margins";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    await flush();

    const confirmBtn = document.querySelector<HTMLButtonElement>(".el-dialog__footer .el-button--primary")!;
    confirmBtn.click();

    await vi.waitFor(() => {
      expect(dispatched.some((item) => item.operationId.endsWith("boardGrid.createGroup"))).toBe(true);
    });
    expect(dispatched.find((item) => item.operationId.endsWith("boardGrid.createGroup"))!.call.input).toEqual({
      title: "Margins",
      insertIndex: 1,
    });
  });

  it("opens Parameters from chart card funnel and Metric Source from metric card overflow menu with card-named dialog titles and Close footer", async () => {
    const { element } = await openDashboardsPanel();

    await vi.waitFor(() => {
      expect(element.querySelector('[data-primary-key="d1/c1"]')).not.toBeNull();
      expect(element.querySelector('[data-primary-key="d1/m1"]')).not.toBeNull();
      expect(element.querySelector(".mock-echart")).not.toBeNull();
    });

    const chartCardEl = element.querySelector<HTMLElement>('[data-primary-key="d1/c1"]')!;
    const metricCardEl = element.querySelector<HTMLElement>('[data-primary-key="d1/m1"]')!;

    // D-13: chart card header only exposes the Filter parameters icon (no single-card refresh or metric-source icon);
    // metric card header renders no inline icon actions.
    expect(chartCardEl.querySelector('[data-action="refresh-card"]')).toBeNull();
    expect(chartCardEl.querySelector('[data-action="card-metric-source"]')).toBeNull();
    expect(chartCardEl.querySelector('[data-action="card-parameters"]')).not.toBeNull();
    expect(metricCardEl.querySelector(".db-card-actions")).toBeNull();

    // Clicking Parameters on the chart card opens ObjectForm with the card name in the dialog title.
    chartCardEl.querySelector<HTMLButtonElement>('[data-action="card-parameters"]')!.click();
    await vi.waitFor(() => {
      expect(document.body.textContent).toContain("Revenue by Region · Edit parameters");
      expect(document.body.textContent).toContain("Fiscal year");
    });

    // Opening Metric Source from the metric card's overflow menu shows the card name in the title and a Close button.
    const metricMoreBtn = metricCardEl.querySelector<HTMLButtonElement>(".sdk-object-list-action-more-btn")!;
    expect(metricMoreBtn).not.toBeNull();
    metricMoreBtn.click();
    await flush();

    const sourceMenuItem = document.querySelector<HTMLElement>('[data-local-action="metricSource"]')!;
    expect(sourceMenuItem).not.toBeNull();
    sourceMenuItem.click();
    await vi.waitFor(() => {
      expect(document.body.textContent).toContain("Total Revenue · Metric source");
      expect(document.body.textContent).toContain("Revenue Metric");
      expect(document.body.textContent).toContain("Published");
    });

    const closeBtn = document.querySelector<HTMLButtonElement>('[data-action="close-metric-source"]')!;
    expect(closeBtn).not.toBeNull();
    closeBtn.click();
    await vi.waitFor(() => {
      expect(document.querySelector('[data-action="close-metric-source"]')).toBeNull();
    });
  });

  it("renders centered icon empty state for a dashboard with no groups and supports creating the first group with 50-char limit", async () => {
    const state = initialBoardState();
    state.groupsByBoard.d2 = [];
    const { element } = await openDashboardsPanel({
      initialPath: "/dashboards?dashboardId=d2",
      state,
    });

    await vi.waitFor(() => {
      const empty = element.querySelector<HTMLElement>('[data-testid="dashboard-groups-empty"]');
      expect(empty).not.toBeNull();
      expect(empty!.querySelector(".db-empty-icon")?.textContent).toContain("📊");
      const btn = empty!.querySelector<HTMLButtonElement>('[data-action="create-first-group"]')!;
      expect(btn.classList.contains("el-button--large")).toBe(true);
    });

    element.querySelector<HTMLButtonElement>('[data-action="create-first-group"]')!.click();
    await vi.waitFor(() => {
      const input = document.querySelector<HTMLInputElement>("#db-group-title-input");
      expect(input).not.toBeNull();
      expect(input!.getAttribute("maxlength")).toBe("50");
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

  it("wires pack-1 canvas surfaces, 12/24 section tracks, bare KPI card, chart table/zoom, truncation icon, and Open metric button", async () => {
    const state = initialBoardState();
    state.groupsByBoard.d1[1]!.title = "";
    const { element, router } = await openDashboardsPanel({
      state,
      chartTruncation: { truncated: true, rowLimit: 500, truncationHint: "Showing first 500 rows" },
      metricTruncation: { truncated: true, rowLimit: 500, truncationHint: "Truncated metric sample" },
    });

    await vi.waitFor(() => {
      expect(element.querySelector(".sdk-grouped-grid.is-group-surface-card.is-controls-hover")).not.toBeNull();
      expect(element.querySelector(".sdk-metric-card-group.is-surface-bare.is-value-large")).not.toBeNull();
      expect(element.querySelectorAll('[data-testid="card-truncation-warning"]').length).toBe(2);
    });

    // D-07 / D-10 / D-12 / D-18: section columns, row heights, resize axes, dividers, localized empty group title, keyboard focus
    const tracks = [...element.querySelectorAll<HTMLElement>(".sdk-grouped-grid-track")];
    expect(tracks[0]?.style.getPropertyValue("--gg-columns")).toBe("12");
    expect(tracks[0]?.style.getPropertyValue("--gg-row-height")).toBe("102px");
    expect(tracks[1]?.style.getPropertyValue("--gg-columns")).toBe("24");
    expect(tracks[1]?.style.getPropertyValue("--gg-row-height")).toBe("360px");

    const groupTitles = [...element.querySelectorAll<HTMLElement>(".sdk-grouped-grid-group-title")].map((el) => el.textContent?.trim());
    expect(groupTitles).toEqual(["Revenue", "Untitled group"]);

    const metricCardEl = element.querySelector<HTMLElement>('[data-primary-key="d1/m1"]')!;
    const chartCardEl = element.querySelector<HTMLElement>('[data-primary-key="d1/c1"]')!;
    expect(metricCardEl.getAttribute("tabindex")).toBe("0");
    expect(metricCardEl.querySelector(".sdk-grouped-grid-item-header")?.classList.contains("is-divider-none")).toBe(true);
    expect(metricCardEl.querySelector('[data-testid="grouped-grid-resize-handle"]')?.classList.contains("is-axis-horizontal")).toBe(true);
    expect(metricCardEl.querySelector(".sdk-metric-card-label")).toBeNull();
    expect(chartCardEl.querySelector(".sdk-grouped-grid-item-header")?.classList.contains("is-divider-line")).toBe(true);
    expect(chartCardEl.querySelector('[data-testid="grouped-grid-resize-handle"]')?.classList.contains("is-axis-both")).toBe(true);

    // D-14 / D-15: toggle chart to formatted data table, open Metric Source from table footer, and open fullscreen zoom modal
    chartCardEl.querySelector<HTMLButtonElement>('[data-action="card-toggle-view"]')!.click();
    await vi.waitFor(() => {
      expect(chartCardEl.querySelector('[data-testid="metric-chart-data-overlay"]')).not.toBeNull();
      expect(chartCardEl.querySelector('[data-action="table-metric-source"]')).not.toBeNull();
    });

    chartCardEl.querySelector<HTMLButtonElement>('[data-action="card-zoom"]')!.click();
    await vi.waitFor(() => {
      expect(document.querySelector('[data-testid="metric-chart-zoom-modal"]')).not.toBeNull();
    });
    document.querySelector<HTMLButtonElement>('[data-testid="metric-chart-zoom-close"]')!.click();
    await vi.waitFor(() => {
      expect(document.querySelector('[data-testid="metric-chart-zoom-modal"]')).toBeNull();
    });

    // D-25: open Metric Source from table footer and click ObjectRefCard primary "Open metric" button
    chartCardEl.querySelector<HTMLButtonElement>('[data-action="table-metric-source"]')!.click();
    await vi.waitFor(() => {
      expect(document.querySelector(".sdk-object-ref-button.is-primary")).not.toBeNull();
    });
    const openMetricBtn = document.querySelector<HTMLButtonElement>(".sdk-object-ref-button.is-primary")!;
    expect(openMetricBtn.textContent?.trim()).toBe("Open metric");
    openMetricBtn.click();
    await vi.waitFor(() => {
      expect(router.currentRoute.value.fullPath).toBe("/ontology/assets/metrics/detail?selected=mv-rev");
    });
  });

  it("supports whole-board unsaved draft preview with edit lock, chart fileOverride, and saveLayout persistence (D-26)", async () => {
    const { element, dispatched, getPageController } = await openDashboardsPanel();

    await vi.waitFor(() => {
      expect(element.querySelector('[data-primary-key="d1/c1"]')).not.toBeNull();
      expect(element.querySelector(".mock-echart")).not.toBeNull();
      expect(getPageController()?.fillForm).toBeDefined();
    });

    expect(element.querySelector('[data-testid="grouped-grid-draft-bar"]')).toBeNull();

    const lineChartContent = {
      ...sampleChartFile.content,
      series: [{ id: "s0", type: "line", datasetId: "metric", encode: { x: "region", y: "revenue" } }],
    };

    const fillResult = await getPageController()!.fillForm!({
      member: "boardGrid",
      values: {
        summary: "Previewing 1 chart update",
        groupRenames: { g1: "Revenue Q4" },
        itemRenames: { "d1/c1": "Regional Sales" },
        itemOverrides: {
          "d1/c1": {
            fileOverride: lineChartContent,
          },
        },
      },
    });
    expect(fillResult).toMatchObject({ ok: true });

    await vi.waitFor(() => {
      expect(element.querySelector('[data-testid="grouped-grid-draft-bar"]')?.textContent).toContain("Previewing 1 chart update");
      expect(element.querySelector(".sdk-grouped-grid.is-locked")).not.toBeNull();
      expect(element.querySelector<HTMLButtonElement>('[data-action="group-menu"]')?.disabled).toBe(true);
      expect(element.querySelector<HTMLButtonElement>('[data-action="card-parameters"]')?.disabled).toBe(true);
      expect(element.querySelector('[data-primary-key="d1/c1"]')?.classList.contains("is-draft-modified")).toBe(true);
      expect(element.querySelector<HTMLElement>(".mock-echart")?.dataset.seriesType).toBe("line");
    });

    element.querySelector<HTMLButtonElement>('[data-testid="grouped-grid-draft-save"]')!.click();
    await vi.waitFor(() => {
      expect(dispatched.some((item) => item.operationId.endsWith("boardGrid.saveLayout"))).toBe(true);
      expect(element.querySelector('[data-testid="grouped-grid-draft-bar"]')).toBeNull();
    });

    const saveCall = dispatched.find((item) => item.operationId.endsWith("boardGrid.saveLayout"))!.call;
    expect(saveCall.input).toEqual({
      groups: [
        {
          id: "g1",
          title: "Revenue Q4",
          metrics: [{ id: "m1", layout: { colSpan: 3, rowSpan: 1 } }],
          charts: [
            {
              id: "c1",
              name: "Regional Sales",
              layout: { colSpan: 6, rowSpan: 2 },
              chartFile: {
                name: "c1.chart.json",
                content: lineChartContent,
              },
            },
          ],
        },
        {
          id: "g2",
          title: "Pipeline",
          metrics: [],
          charts: [],
        },
      ],
    });
  });

  it("wires pack-2 pill tabs with inline rename, parameter change summary, card rename prefill, and bordered key-value metric source (D-03/04/06/22/23/24)", async () => {
    const { element, dispatched } = await openDashboardsPanel();

    await vi.waitFor(() => {
      expect(element.querySelector(".sdk-object-list-tabs-bar.is-pill")).not.toBeNull();
      expect(element.querySelector('[data-primary-key="d1/c1"]')).not.toBeNull();
    });

    // D-03 / D-06: pill tab strip + in-place inline rename via row action without opening OperationInputDialog
    const firstTab = element.querySelectorAll<HTMLElement>('[role="tab"]')[0]!;
    firstTab.querySelector<HTMLButtonElement>(".sdk-object-list-action-more-btn")!.click();
    await vi.waitFor(() => {
      const renameItem = [...document.querySelectorAll<HTMLElement>(".el-dropdown-menu__item")].find(
        (item) => item.textContent?.trim() === "Rename",
      );
      expect(renameItem).toBeDefined();
      renameItem!.click();
    });

    await vi.waitFor(() => {
      const renameInput = element.querySelector<HTMLInputElement>('[data-testid="object-list-tab-rename-input"]');
      expect(renameInput).not.toBeNull();
      expect(renameInput!.value).toBe("Executive Overview");
    });

    const renameInput = element.querySelector<HTMLInputElement>('[data-testid="object-list-tab-rename-input"]')!;
    renameInput.value = "Q4 Executive Overview";
    renameInput.dispatchEvent(new Event("input", { bubbles: true }));
    renameInput.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));

    await vi.waitFor(() => {
      const renameCall = dispatched.find((item) => item.operationId.endsWith("boardTabs.rename"));
      expect(renameCall).toBeDefined();
      expect(renameCall!.call.input).toEqual({ name: "Q4 Executive Overview" });
      expect(element.querySelector('[data-testid="object-list-tab-rename-input"]')).toBeNull();
    });

    // D-23: card rename row action opens OperationInputDialog prefilled with the current card's name
    const chartCardEl = element.querySelector<HTMLElement>('[data-primary-key="d1/c1"]')!;
    const beforeDropdownCount = document.querySelectorAll(".el-dropdown-menu__item").length;
    chartCardEl.querySelector<HTMLButtonElement>(".sdk-object-list-action-more-btn")!.click();
    await vi.waitFor(() => {
      const visibleMenus = [...document.querySelectorAll<HTMLElement>(".el-dropdown__popper")].filter(
        (popper) => popper.getAttribute("aria-hidden") !== "true" && popper.style.display !== "none",
      );
      const visibleRename = visibleMenus
        .flatMap((popper) => [...popper.querySelectorAll<HTMLElement>(".el-dropdown-menu__item")])
        .find((item) => item.textContent?.trim() === "Rename");
      expect(visibleRename ?? (document.querySelectorAll(".el-dropdown-menu__item").length > beforeDropdownCount ? "mounted" : null)).toBeTruthy();
      expect(visibleRename).toBeDefined();
      visibleRename!.click();
    });

    await vi.waitFor(() => {
      const nameInput = document.querySelector<HTMLInputElement>('[data-input-field="name"] input');
      expect(nameInput).not.toBeNull();
      expect(nameInput!.value).toBe("Revenue by Region");
    });
    const cancelBtn = [...document.querySelectorAll<HTMLButtonElement>(".sdk-operation-input-dialog .el-button")].find(
      (btn) => btn.textContent?.trim() === "Cancel",
    );
    cancelBtn?.click();

    // D-22: card parameter form shows before/after change summary when edited
    chartCardEl.querySelector<HTMLButtonElement>('[data-action="card-parameters"]')!.click();
    await vi.waitFor(() => {
      const input = document.querySelector<HTMLInputElement>(".db-form-wrap input");
      expect(input).not.toBeNull();
      expect(input!.value).toBe("2026");
    });
    const yearInput = document.querySelector<HTMLInputElement>(".db-form-wrap input")!;
    yearInput.value = "2027";
    yearInput.dispatchEvent(new Event("input", { bubbles: true }));

    await vi.waitFor(() => {
      const summary = document.querySelector<HTMLElement>('[data-testid="object-form-change-summary"]');
      expect(summary).not.toBeNull();
      expect(summary!.textContent).toContain("Fiscal year");
      expect(summary!.textContent).toContain("2026");
      expect(summary!.textContent).toContain("2027");
    });

    // Close parameter dialog
    document.querySelector<HTMLButtonElement>(".el-dialog__headerbtn")?.click();

    // D-24: metric source dialog renders 1-column bordered summary with aligned 2-column key-value parameters <dl>
    chartCardEl.querySelector<HTMLButtonElement>('[data-action="card-toggle-view"]')!.click();
    await vi.waitFor(() => {
      expect(chartCardEl.querySelector('[data-action="table-metric-source"]')).not.toBeNull();
    });
    chartCardEl.querySelector<HTMLButtonElement>('[data-action="table-metric-source"]')!.click();

    await vi.waitFor(() => {
      const list = document.querySelector<HTMLElement>(".sdk-object-summary-list.is-bordered");
      expect(list).not.toBeNull();
      expect(list!.classList.contains("is-multi-col")).toBe(false);
      const kv = list!.querySelector<HTMLElement>(".sdk-object-summary-kv");
      expect(kv).not.toBeNull();
      const dts = [...kv!.querySelectorAll("dt")].map((el) => el.textContent?.trim());
      const dds = [...kv!.querySelectorAll("dd")].map((el) => el.textContent?.trim());
      expect(dts).toEqual(["year", "region"]);
      expect(dds).toEqual(["2026", "East"]);
    });
  });
});
