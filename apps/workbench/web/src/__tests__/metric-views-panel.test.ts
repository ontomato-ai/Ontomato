import { afterEach, describe, expect, it, vi } from "vitest";
import { defineComponent, h } from "vue";
import { createMemoryHistory, createRouter, RouterView } from "vue-router";
import type { FormFillOutcome, FormFillRequestInput, PageActionOutcome, PageActionRequestInput } from "@ontomato/contracts/agent-presentation";
import type { RuntimeJsonValue } from "@ontomato/contracts/agent-runtime-values";
import { appsSdkComponentCatalogEntrySchema } from "@ontomato/contracts/apps-sdk";
import type { PageContext } from "@ontomato/contracts/page-context";
import { expandPanelAuthoringMember } from "@ontomato/contracts/panel-authoring-expansion";
import { panelAuthoringManifestSchema } from "@ontomato/contracts/panel-authoring";
import { panelAddress, type ProductPanelReadRequest } from "@ontomato/contracts/panel-host";
import { definePanel } from "@ontomato/contracts/panel-manifest";
import {
  DELETE_METRIC_VIEW,
  METRIC_VIEW,
  SET_METRIC_VIEW_STATUS,
  TEST_EXECUTE_METRIC_VIEW,
  TEST_METRIC_VIEW,
  platformObjectTypes,
} from "@ontomato/contracts/platform-object-types";
import { platformTypeTableEntrySchema } from "@ontomato/contracts/platform-type-table";
import type { ProductProjection } from "@ontomato/contracts/product-panels";
import { components } from "../../../../../packages/apps-sdk/src/catalogue";
import { provideUnsavedChanges } from "@ontomato/platform-shell";
import { useApplicationCatalog } from "../../../../../packages/platform-web/src/catalog";
import PanelApplicationRoute from "../../../../../packages/platform-web/src/pages/PanelApplicationRoute.vue";
import catalogSource from "../../../../../packages/ontology-manager/resources/builtin-panels/metric-views/panel.json";
import catalogHtml from "../../../../../packages/ontology-manager/resources/builtin-panels/metric-views/panel.html?raw";
import catalogModule from "../../../../../packages/ontology-manager/resources/builtin-panels/metric-views/panel.mjs?raw";
import detailSource from "../../../../../packages/ontology-manager/resources/builtin-panels/metric-view-detail/panel.json";
import detailHtml from "../../../../../packages/ontology-manager/resources/builtin-panels/metric-view-detail/panel.html?raw";
import detailModule from "../../../../../packages/ontology-manager/resources/builtin-panels/metric-view-detail/panel.mjs?raw";
import {
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

const APP_ID = "ontology";
const CATALOG_PATH = "/ontology/assets/metrics";
const DETAIL_PATH = "/ontology/assets/metrics/detail";
const AGENT_RUN = {
  sessionId: "11111111-1111-4111-8111-111111111111",
  runId: "22222222-2222-4222-8222-222222222222",
  toolCallId: "tool-call-1",
};

const catalogUse = panelUse(
  "ontology-metric-views",
  "metric-views",
  "builtin-product-ontology-metric-views",
  CATALOG_PATH,
);
const detailUse = panelUse(
  "ontology-metric-view-detail",
  "metric-view-detail",
  "builtin-product-ontology-metric-view-detail",
  DETAIL_PATH,
);

const metricViewTypeEntry = platformTypeTableEntrySchema.parse({
  ...platformObjectTypes[METRIC_VIEW],
  operations: [
    {
      id: `${METRIC_VIEW}.save`,
      kind: "form.save",
      effect: "write",
      batch: false,
      inputSchema: { type: "object" },
      target: { source: "draft" },
    },
    {
      id: DELETE_METRIC_VIEW,
      kind: "action",
      effect: "write",
      batch: false,
      inputSchema: { type: "object" },
      target: { source: "input", input: "metric" },
    },
    {
      id: SET_METRIC_VIEW_STATUS,
      kind: "action",
      effect: "write",
      batch: true,
      inputSchema: { type: "object" },
      target: { source: "input", input: "metric" },
    },
    {
      id: TEST_METRIC_VIEW,
      kind: "action",
      effect: "read",
      batch: false,
      inputSchema: { type: "object" },
      target: { source: "draft" },
    },
    {
      id: TEST_EXECUTE_METRIC_VIEW,
      kind: "action",
      effect: "read",
      batch: false,
      inputSchema: { type: "object" },
      target: { source: "draft" },
    },
  ],
});

const catalogue = components.map((component) =>
  appsSdkComponentCatalogEntrySchema.parse({
    ...component,
    ...(component.componentId === "OperationButton"
      ? { config: [{ name: "operation", type: "string", required: true, description: "Operation local name" }] }
      : {}),
    ports: { props: [], events: [], slots: [] },
  }),
);

const projections = new Map<string, ProductProjection>();

function buildPanel(
  panelId: string,
  name: string,
  source: { manifest: unknown; content: { messages: Record<string, Record<string, string>> } },
  html: string,
  module: string,
) {
  const { members: authoring, ...manifest } = panelAuthoringManifestSchema.parse(source.manifest);
  const members = Object.fromEntries(
    Object.entries(authoring).map(([memberName, definition]) => {
      if (!("component" in definition)) throw new Error(`Expected an authored projection for ${memberName}`);
      const { projection, placement } = expandPanelAuthoringMember(memberName, definition, {
        state: manifest.state,
        typeTable: { objectTypes: { [METRIC_VIEW]: metricViewTypeEntry } },
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
        createdAt: "2026-11-24T00:00:00Z",
        updatedAt: "2026-11-24T00:00:00Z",
      });
      return [memberName, { ...placement, target: { projectionId: definition.id! } }];
    }),
  );

  return {
    ...panelRecord(panelId, name, definePanel({ ...manifest, members })),
    visibility: "platform" as const,
    domainId: null,
    ownerId: null,
    editable: false as const,
    content: { html, module, messages: source.content.messages },
  };
}

const catalogPanel = buildPanel(
  catalogUse.panelId,
  "Metric Views",
  catalogSource,
  catalogHtml,
  catalogModule,
);
const detailPanel = buildPanel(
  detailUse.panelId,
  "Metric View Detail",
  detailSource,
  detailHtml,
  detailModule,
);
const panelsById = new Map([
  [catalogPanel.id, catalogPanel],
  [detailPanel.id, detailPanel],
]);

const metricRef = (primaryKey: string) => ({ className: METRIC_VIEW, primaryKey });

type DataReadRequest = Extract<ProductPanelReadRequest, { dataName: string }>;
type OpsReadRequest = Extract<ProductPanelReadRequest, { operations: true }>;

type PageControllerHandle = {
  applyState(patch: Readonly<Record<string, RuntimeJsonValue>>): void;
  fillForm?(request: FormFillRequestInput): Promise<FormFillOutcome>;
  executeAction?(request: PageActionRequestInput): Promise<PageActionOutcome>;
};

function metricRow(id: string, name: string, subtitle: string) {
  return {
    primaryKey: id,
    label: name,
    subtitle,
    fieldLabels: {
      function: "Function",
      origin: "Origin",
      status: "Status",
      createdBy: "Created by",
      reviewedBy: "Reviewed by",
      modified: "Updated",
    },
    fields: {
      function: `fn_${id}`,
      origin: "Custom",
      status: "PUBLISHED",
      createdBy: "Alice",
      reviewedBy: "Bob",
      modified: "2026-11-24T00:00:00Z",
    },
  };
}

function metricFormDescription(mode: "create" | "edit", key: string) {
  return {
    fields: [
      {
        path: "/name",
        label: "Name",
        required: true,
        readOnly: false,
        control: { kind: "text" },
        valueSchema: { type: "string" },
      },
      {
        path: "/bindings",
        label: "Parameter bindings",
        required: false,
        readOnly: false,
        control: {
          kind: "object-array",
          defaultItem: { name: "", parameters: {} },
          itemFields: [
            {
              path: "/name",
              label: "Binding name",
              required: false,
              readOnly: false,
              control: { kind: "text" },
              valueSchema: { type: "string" },
            },
          ],
        },
        valueSchema: { type: "array", items: { type: "object" } },
      },
    ],
    values: {
      name: mode === "create" ? "" : `Metric ${key}`,
      function: {
        queryPackage: {
          manifest: {
            parameterDefs: [
              { name: "year", type: "number", value: 2025, description: "Target year" },
              { name: "region", type: "string", value: "US", description: "Region code" },
            ],
          },
        },
      },
      bindings: [
        {
          id: "bind-q1",
          name: "Q1 Preset",
          parameters: { year: 2024, region: "EU" },
        },
      ],
    },
    errors: [],
    save: {
      method: mode === "create" ? "POST" : "PUT",
      path: `/api/data-query/metricView/${key || "create"}`,
      bodySchema: {},
    },
  };
}

function readTargetKey(body: DataReadRequest | OpsReadRequest): string {
  for (const value of Object.values(body.inputs ?? {})) {
    if (value && typeof value === "object" && "primaryKey" in value && typeof value.primaryKey === "string") {
      return value.primaryKey;
    }
  }
  return "";
}

async function waitFor(check: () => boolean, label: string | (() => string)): Promise<void> {
  for (let i = 0; i < 120; i += 1) {
    if (check()) return;
    await new Promise((resolve) => setTimeout(resolve, 15));
  }
  const desc = typeof label === "function" ? label() : label;
  throw new Error(`Timed out waiting for: ${desc}`);
}

async function clickMessageBoxButton(label: string) {
  await waitFor(
    () =>
      Array.from(document.body.querySelectorAll<HTMLButtonElement>(".el-message-box button")).some(
        (button) => button.textContent?.trim() === label,
      ),
    `message box button "${label}"`,
  );
  const button = Array.from(document.body.querySelectorAll<HTMLButtonElement>(".el-message-box button")).find(
    (entry) => entry.textContent?.trim() === label,
  )!;
  button.click();
}

function mountMetricViewsApp(initialAddress: string = CATALOG_PATH) {
  const reads: DataReadRequest[] = [];
  const opsReads: OpsReadRequest[] = [];
  const readOperations: string[] = [];
  const readCalls: Array<{ operationId: string; input: Record<string, unknown> }> = [];
  const dispatched: Array<{ operationId: string; targetPrimaryKey: string | null; input: Record<string, unknown> }> = [];
  let localConfirmSeq = 0;
  let intentSeq = 0;
  const preparedIntents = new Map<string, { operationId: string; targetPrimaryKey: string | null; input: Record<string, unknown> }>();
  let headerOverride: ((key: string) => Record<string, unknown>) | null = null;
  let deleteUnavailable: { reason: string } | null = null;
  let nextCreatedKey = "mv-created";
  let deleteOutcome: Record<string, unknown> = {
    kind: "success",
    message: "Metric view deleted",
    data: {},
    affected: {
      objects: [],
      removed: [{ objectType: METRIC_VIEW, primaryKey: "mv-1" }],
      objectTypes: [METRIC_VIEW],
    },
  };
  let leaveAnswer = true;
  const askedLeave = vi.fn(async () => leaveAnswer);
  let controller: PageControllerHandle | null = null;
  let latestContext: PageContext | null = null;

  const RouteHost = defineComponent({
    setup() {
      return () =>
        h(PanelApplicationRoute, {
          applicationId: APP_ID,
          registerPageController(next: PageControllerHandle) {
            controller = next;
            return () => {
              if (controller === next) controller = null;
            };
          },
          onContext(reported: PageContext) {
            latestContext = reported;
          },
        });
    },
  });

  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: CATALOG_PATH, component: RouteHost },
      { path: DETAIL_PATH, component: RouteHost },
    ],
  });

  installPlatform((request: Sent) => {
    const { path } = request;
    if (path === `/api/data-query/platform/applications/${APP_ID}/panel-uses`) {
      return Response.json({
        data: {
          applicationId: APP_ID,
          entry: { path: "/ontology", renderer: "panels" },
          panelUses: [catalogUse, detailUse],
        },
      });
    }
    if (path === "/api/panel-operations/local-confirmations") {
      localConfirmSeq += 1;
      const body = request.body as { operationLabel?: string } | null;
      return Response.json({
        intentId: `8f0c1a2e-6a0b-4f8e-9a51-0c6f3e2b1d0${localConfirmSeq}`,
        questionId: `9f0c1a2e-6a0b-4f8e-9a51-0c6f3e2b1d0${localConfirmSeq}`,
        label: body?.operationLabel ?? "Discard",
        autoMode: false,
      });
    }
    if (request.method === "POST" && path === "/api/panel-operations/intents") {
      intentSeq += 1;
      const body = request.body as {
        operationId: string;
        call?: { target?: { primaryKey?: string }; input?: Record<string, unknown> };
      };
      const intentId = `33333333-3333-4333-8333-33333333330${intentSeq}`;
      const targetPrimaryKey = body.call?.target?.primaryKey ?? null;
      preparedIntents.set(intentId, {
        operationId: body.operationId,
        targetPrimaryKey,
        input: body.call?.input ?? {},
      });
      return Response.json({
        intentId,
        operationId: body.operationId,
        label: body.operationId === "remove.delete" ? "Delete" : "Action",
        confirmation: { kind: "none" },
        autoMode: true,
      });
    }
    const intentRead = /^\/api\/panel-operation-intents\/([^/?]+)$/.exec(path);
    if (intentRead && request.method === "GET") {
      const entry = preparedIntents.get(intentRead[1]!);
      return Response.json({
        intentId: intentRead[1],
        operationId: entry?.operationId ?? "remove.delete",
        label: entry?.operationId === "remove.delete" ? "Delete" : "Action",
        confirmation: { kind: "none" },
        autoMode: true,
      });
    }
    const intentDispatch = /^\/api\/panel-operations\/intents\/([^/]+)\/dispatch$/.exec(path);
    if (intentDispatch && request.method === "POST") {
      const entry = preparedIntents.get(intentDispatch[1]!);
      dispatched.push({
        operationId: entry?.operationId ?? "",
        targetPrimaryKey: entry?.targetPrimaryKey ?? null,
        input: entry?.input ?? {},
      });
      if (entry?.operationId === "definition.save") {
        const isCreate = !entry.targetPrimaryKey;
        const savedKey = entry.targetPrimaryKey ?? nextCreatedKey;
        return Response.json({
          kind: "dispatched",
          intentId: intentDispatch[1],
          outcome: {
            kind: "success",
            message: "Metric view saved",
            data: {},
            ...(isCreate ? { created: { objectType: METRIC_VIEW, primaryKey: savedKey } } : {}),
            affected: {
              objects: [{ objectType: METRIC_VIEW, primaryKey: savedKey }],
              objectTypes: [METRIC_VIEW],
            },
          },
        });
      }
      if (entry?.operationId === "publishStatus.setStatus") {
        return Response.json({
          kind: "dispatched",
          intentId: intentDispatch[1],
          outcome: {
            kind: "batch",
            items: [{ objectType: METRIC_VIEW, primaryKey: "mv-1", kind: "success", message: "Updated" }],
          },
        });
      }
      return Response.json({
        kind: "dispatched",
        intentId: intentDispatch[1],
        outcome: deleteOutcome,
      });
    }
    if (/^\/api\/panel-operations\/local-confirmations\/[^/]+\/claim$/.test(path)) {
      return Response.json({ ok: true });
    }
    if (/^\/api\/panel-operations\/questions\/[^/]+\/cancel-if-pending$/.test(path)) {
      return Response.json({ cancelled: true });
    }
    if (path === "/api/panel-operations/read") {
      const body = request.body as { operationId?: string; call?: { input?: Record<string, unknown> } };
      if (typeof body.operationId === "string") {
        readOperations.push(body.operationId);
        readCalls.push({ operationId: body.operationId, input: body.call?.input ?? {} });
      }
      if (body.operationId === "testMarkdown.test") {
        return Response.json({ kind: "markdown", markdown: "# Metric Preview\n\nTotal: 42" });
      }
      if (body.operationId === "testJson.testExecute") {
        return Response.json({
          kind: "json",
          value: [{ total: 42 }],
          truncation: { rowLimit: 20000, hint: "Narrow the date filter" },
        });
      }
      return Response.json({ kind: "json", value: {} });
    }

    const panelMatch = /^\/api\/product-panels\/([^/]+)(\/snapshot)?$/.exec(path);
    if (panelMatch) {
      const panel = panelsById.get(panelMatch[1]!);
      if (panel) {
        return panelMatch[2]
          ? panelSnapshot(panel, Object.fromEntries(projections), request)
          : panelAnswer(panel, request);
      }
    }
    if (path.startsWith("/api/product-projections/")) {
      return Response.json({ projection: projections.get(path.split("/").at(-1)!) });
    }
    if (path === "/api/product-panels/read") {
      const body = request.body as ProductPanelReadRequest;
      const member = body.memberPath[0]?.member;
      if ("operations" in body) {
        opsReads.push(body);
        if (member === "definition") {
          return Response.json({
            status: "ready",
            value: {
              save: {
                kind: "form.save",
                handlerRef: `${METRIC_VIEW}.save`,
                label: "Save metric view",
                effect: "write",
                target: { source: "draft", slot: "definition" },
                inputSchema: {},
                resultSchema: {},
                batch: false,
              },
            },
          });
        }
        if (member === "testMarkdown") {
          return Response.json({
            status: "ready",
            value: {
              test: {
                kind: "action",
                handlerRef: TEST_METRIC_VIEW,
                label: "Test",
                effect: "read",
                target: { source: "draft", slot: "definition" },
                inputSchema: {},
                resultSchema: {},
                batch: false,
              },
            },
          });
        }
        if (member === "testJson") {
          return Response.json({
            status: "ready",
            value: {
              testExecute: {
                kind: "action",
                handlerRef: TEST_EXECUTE_METRIC_VIEW,
                label: "Test and return JSON",
                effect: "read",
                target: { source: "draft", slot: "definition" },
                inputSchema: {},
                resultSchema: {},
                batch: false,
              },
            },
          });
        }
        if (member === "publishStatus") {
          return Response.json({
            status: "ready",
            value: {
              setStatus: {
                kind: "action",
                handlerRef: SET_METRIC_VIEW_STATUS,
                label: "Update status",
                effect: "write",
                target: { source: "input", input: "metric" },
                inputSchema: {},
                resultSchema: {},
                batch: true,
              },
            },
          });
        }
        if (member === "remove") {
          const key = readTargetKey(body);
          if (!key) return Response.json({ status: "ready", value: {} });
          return Response.json({
            status: "ready",
            value: {
              delete: {
                kind: "action",
                handlerRef: DELETE_METRIC_VIEW,
                label: "Delete",
                effect: "write",
                target: { source: "input", input: "metric" },
                inputSchema: {},
                resultSchema: {},
                batch: false,
                ...(deleteUnavailable ? { unavailable: deleteUnavailable } : {}),
              },
            },
          });
        }
        return Response.json({ status: "ready", value: {} });
      }

      reads.push(body);
      if (member === "list") {
        return Response.json({
          status: "ready",
          value: {
            rows: [
              metricRow("mv-1", "Revenue", "Total net revenue"),
              metricRow("mv-2", "Active Users", "Daily active users"),
            ],
            total: 2,
          },
        });
      }
      if (member === "header") {
        const key = readTargetKey(body);
        if (!key) return Response.json({ status: "empty" });
        if (headerOverride) return Response.json(headerOverride(key));
        const label = key === "mv-1" ? "Revenue" : key === "mv-2" ? "Active Users" : `Metric ${key}`;
        return Response.json({
          status: "ready",
          value: {
            primaryKey: key,
            label,
            subtitle: "",
            fields: {},
            fieldLabels: {},
          },
        });
      }
      if (member === "definition") {
        if (body.dataName === "createForm") {
          return Response.json({ status: "ready", value: metricFormDescription("create", "") });
        }
        const key = readTargetKey(body);
        return Response.json({ status: "ready", value: metricFormDescription("edit", key) });
      }
      return Response.json({ status: "ready", value: {} });
    }
    return nothingAt(request);
  }, router);

  return {
    reads,
    opsReads,
    readOperations,
    readCalls,
    dispatched,
    router,
    askedLeave,
    setLeaveAnswer(next: boolean) {
      leaveAnswer = next;
    },
    setHeaderOverride(fn: ((key: string) => Record<string, unknown>) | null) {
      headerOverride = fn;
    },
    setDeleteUnavailable(next: { reason: string } | null) {
      deleteUnavailable = next;
    },
    setNextCreatedKey(next: string) {
      nextCreatedKey = next;
    },
    setDeleteOutcome(next: Record<string, unknown>) {
      deleteOutcome = next;
    },
    controller: () => controller,
    context: () => latestContext,
    async open() {
      useApplicationCatalog().applications.value = [
        {
          id: APP_ID,
          kind: "product",
          names: { en: "Ontology" },
          descriptions: {},
          icon: "ontology",
          rail: "apps",
          category: "build",
          sort: 0,
          entry: { path: "/ontology", renderer: "panels" },
          entryAccess: ["domain-member"],
          scheduleAdapter: null,
          releaseId: null,
          panelUses: [catalogUse, detailUse],
        },
      ];
      await router.push(initialAddress);
      return mountPlatformPage(
        () => h(defineComponent({
          setup() {
            const unsaved = provideUnsavedChanges(askedLeave);
            router.beforeEach((to) => unsaved.allows(to.path));
            return () => h(RouterView);
          },
        })),
        router,
      );
    },
  };
}

afterEach(() => {
  leaveFrame();
  useApplicationCatalog().applications.value = [];
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

describe("metric-views two-entry builtin panels", () => {
  it("renders full-width catalog with batch status, navigates to detail on row click, and navigates to create mode on New Metric View", async () => {
    const harness = mountMetricViewsApp(CATALOG_PATH);
    const mounted = await harness.open();
    try {
      await waitFor(
        () =>
          mounted.element.textContent?.includes("Revenue") === true
          && mounted.element.textContent?.includes("Active Users") === true
          && harness.controller() !== null,
        "initial metric views catalog",
      );

      // Catalog has a single PageHeader and never mounts detail projections.
      expect(mounted.element.querySelectorAll(".sdk-page-header")).toHaveLength(1);
      expect(harness.reads.some((r) => r.memberPath[0]?.member === "definition")).toBe(false);
      expect(harness.reads.some((r) => r.memberPath[0]?.member === "header")).toBe(false);

      // Checking a row reveals batch status selector & Update status OperationButton, and dispatches setStatus.
      const rowCheckboxes = Array.from(
        mounted.element.querySelectorAll<HTMLInputElement>("tbody input[type='checkbox']"),
      );
      expect(rowCheckboxes.length).toBeGreaterThan(0);
      rowCheckboxes[0]!.click();
      await waitFor(
        () => mounted.element.textContent?.includes("Update status") === true,
        "batch status controls revealed after checking a row",
      );
      const batchBtn = Array.from(mounted.element.querySelectorAll<HTMLButtonElement>("button")).find(
        (b) => b.textContent?.trim() === "Update status",
      );
      expect(batchBtn).toBeTruthy();
      batchBtn!.click();
      await waitFor(
        () => harness.dispatched.some((entry) => entry.operationId === "publishStatus.setStatus"),
        "batch publishStatus.setStatus dispatched",
      );

      // Clicking a row navigates to the dedicated non-menu detail entry with `?selected=mv-1`.
      const revenueRow = Array.from(mounted.element.querySelectorAll<HTMLTableRowElement>("tbody tr")).find((row) =>
        row.textContent?.includes("Revenue"),
      );
      expect(revenueRow).toBeTruthy();
      revenueRow!.click();
      await waitFor(
        () =>
          harness.router.currentRoute.value.path === DETAIL_PATH
          && harness.router.currentRoute.value.query.selected === "mv-1"
          && mounted.element.querySelector<HTMLInputElement>('[data-field="/name"] input')?.value === "Metric mv-1",
        "navigated to metric-view-detail for mv-1",
      );

      // Single <page-header> on detail entry with back button, ObjectHeader title, and no bottom ObjectForm action bar.
      expect(mounted.element.querySelectorAll(".mv-detail-page .sdk-page-header")).toHaveLength(1);
      expect(mounted.element.querySelector(".mv-detail-page .sdk-page-header")?.textContent).toContain("Revenue");
      expect(mounted.element.querySelector(".mv-detail-page .sdk-page-header-back")?.textContent?.trim()).toBe("Back to metric views");
      expect(mounted.element.querySelector(".mv-detail-page .sdk-owner-form-actions")).toBeNull();

      // Back navigates cleanly to catalog when clean.
      mounted.element.querySelector<HTMLButtonElement>(".mv-detail-page .sdk-page-header-back")!.click();
      await waitFor(
        () =>
          harness.router.currentRoute.value.path === CATALOG_PATH
          && mounted.element.querySelector(".mv-page")?.textContent?.includes("New Metric View") === true,
        "returned to catalog from clean detail",
      );

      // Clicking "New Metric View" in catalog header navigates to detail entry in create mode.
      const newBtn = Array.from(mounted.element.querySelectorAll<HTMLButtonElement>(".mv-page .sdk-page-header button")).find(
        (b) => b.textContent?.trim() === "New Metric View",
      );
      expect(newBtn).toBeTruthy();
      newBtn!.click();
      await waitFor(
        () =>
          harness.router.currentRoute.value.path === DETAIL_PATH
          && harness.router.currentRoute.value.query.mode === "create"
          && mounted.element.querySelector('[data-field="/name"] input') !== null,
        "navigated to detail entry in create mode",
      );
    } finally {
      mounted.app.unmount();
    }
  });

  it("wires single-row header Save/Discard controls, guards unsaved navigation, and preserves binding parameters", async () => {
    const harness = mountMetricViewsApp(panelAddress(DETAIL_PATH, { selected: "mv-1" }));
    const mounted = await harness.open();
    try {
      await waitFor(
        () =>
          mounted.element.querySelector<HTMLInputElement>('[data-field="/name"] input')?.value === "Metric mv-1"
          && mounted.element.textContent?.includes("Parameter bindings") === true
          && Array.from(mounted.element.querySelectorAll<HTMLInputElement>("input")).some((input) => input.value === "Q1 Preset"),
        "detail form and binding parameters rendered",
      );

      const saveBtn = () => mounted.element.querySelector<HTMLButtonElement>(".sdk-page-header button.sdk-page-header-action.primary")!;
      const discardBtn = () => mounted.element.querySelector<HTMLButtonElement>(".sdk-page-header button.sdk-page-header-action.secondary");
      const unsaved = () => mounted.element.querySelector(".sdk-page-header .sdk-page-header-unsaved")?.textContent?.trim() ?? null;
      const nameInput = () => mounted.element.querySelector<HTMLInputElement>('[data-field="/name"] input')!;

      // Clean state: Save disabled, no Discard button, no unsaved notice.
      expect(mounted.element.querySelectorAll(".sdk-page-header")).toHaveLength(1);
      expect(saveBtn().disabled).toBe(true);
      expect(discardBtn()).toBeNull();
      expect(unsaved()).toBeNull();

      // Edit ordinary /name field -> dirty state appears in page header.
      nameInput().value = "Revenue Updated";
      nameInput().dispatchEvent(new Event("input", { bubbles: true }));
      await waitFor(
        () => unsaved() === "Unsaved changes" && saveBtn().disabled === false && discardBtn() !== null,
        "header draft bar reflects dirty /name edit",
      );

      // Clicking Back while dirty opens unsaved-changes leave guard; rejecting keeps us on detail with edits intact.
      harness.setLeaveAnswer(false);
      mounted.element.querySelector<HTMLButtonElement>(".sdk-page-header-back")!.click();
      await waitFor(() => harness.askedLeave.mock.calls.length === 1, "unsaved leave guard asked on Back");
      expect(harness.router.currentRoute.value.path).toBe(DETAIL_PATH);
      expect(nameInput().value).toBe("Revenue Updated");

      // Clicking header Discard and confirming restores /name and clears dirty state.
      discardBtn()!.click();
      await clickMessageBoxButton("Discard");
      await waitFor(
        () => nameInput().value === "Metric mv-1" && saveBtn().disabled === true && discardBtn() === null && unsaved() === null,
        "header Discard restores /name and clears dirty state",
      );

      // Edit again and click Back -> confirming leave navigates back to catalog.
      nameInput().value = "Revenue Leaving";
      nameInput().dispatchEvent(new Event("input", { bubbles: true }));
      await waitFor(() => saveBtn().disabled === false, "form dirty before leaving");
      harness.setLeaveAnswer(true);
      mounted.element.querySelector<HTMLButtonElement>(".sdk-page-header-back")!.click();
      await waitFor(
        () => harness.askedLeave.mock.calls.length === 2 && harness.router.currentRoute.value.path === CATALOG_PATH,
        "confirmed leave returns to catalog",
      );
    } finally {
      mounted.app.unmount();
    }
  });

  it("supports create mode on detail entry: live title, save converges URL to ?selected=<id>, and discard returns to catalog", async () => {
    const harness = mountMetricViewsApp(panelAddress(DETAIL_PATH, { mode: "create" }));
    harness.setNextCreatedKey("mv-99");
    const mounted = await harness.open();
    try {
      await waitFor(
        () =>
          mounted.element.querySelector<HTMLInputElement>('[data-field="/name"] input')?.disabled === false
          && harness.controller() !== null
          && (harness.context()?.forms?.some((f) => f.member === "definition") ?? false),
        "create form mounted and writable on detail entry",
      );

      expect(mounted.element.querySelector(".mv-detail-title")?.textContent?.trim()).toBe("New Metric View");
      const removeWrap = mounted.element.querySelector<HTMLElement>(".mv-detail-remove");
      expect(removeWrap?.style.display).toBe("none");

      // Filling /name updates create title reactively and enables header Save.
      const filled = await harness.controller()!.fillForm!({ member: "definition", values: { "/name": "Draft GMV" } });
      expect(filled).toEqual(expect.objectContaining({ ok: true, filledFields: ["/name"] }));
      await waitFor(
        () => mounted.element.querySelector(".mv-detail-title")?.textContent?.trim() === "Draft GMV",
        "create title updates reactively from live draft",
      );

      // Clicking header Save persists the metric and converges URL to ?selected=mv-99 without mode.
      const saveBtn = mounted.element.querySelector<HTMLButtonElement>(".sdk-page-header button.sdk-page-header-action.primary")!;
      await waitFor(() => !saveBtn.disabled, "header Save enabled for create draft");
      saveBtn.click();
      await waitFor(
        () =>
          harness.router.currentRoute.value.path === DETAIL_PATH
          && harness.router.currentRoute.value.query.selected === "mv-99"
          && harness.router.currentRoute.value.query.mode === undefined
          && mounted.element.querySelector(".sdk-page-header")?.textContent?.includes("Metric mv-99") === true,
        "create save converged detail URL to selected=mv-99 and cleared mode",
      );

      // Open create mode again and discard via header Discard -> returns to catalog.
      await harness.router.push(panelAddress(DETAIL_PATH, { mode: "create" }));
      await waitFor(
        () =>
          mounted.element.querySelector(".mv-detail-title")?.textContent?.trim() === "New Metric View"
          && mounted.element.querySelector<HTMLInputElement>('[data-field="/name"] input')?.value === "",
        "re-entered create mode",
      );
      const nameInput = mounted.element.querySelector<HTMLInputElement>('[data-field="/name"] input')!;
      nameInput.value = "Discard Me";
      nameInput.dispatchEvent(new Event("input", { bubbles: true }));
      const discardBtn = () => mounted.element.querySelector<HTMLButtonElement>(".sdk-page-header button.sdk-page-header-action.secondary");
      await waitFor(() => discardBtn() !== null, "header Discard shown in create mode");
      discardBtn()!.click();
      await clickMessageBoxButton("Discard");
      await waitFor(
        () => harness.router.currentRoute.value.path === CATALOG_PATH,
        "discarding create draft navigates back to catalog",
      );
    } finally {
      mounted.app.unmount();
    }
  });

  it("renders in-place missing/error/forbidden/empty states without mounting definition, hides unavailable delete, and returns to catalog on delete success", async () => {
    // 1. Bare detail URL without selected or mode shows missing state without mounting definition.
    const missingHarness = mountMetricViewsApp(DETAIL_PATH);
    const missingMounted = await missingHarness.open();
    try {
      await waitFor(
        () => missingMounted.element.textContent?.includes("Metric view not found or deleted") === true,
        "bare detail shows missing state",
      );
      expect(missingHarness.reads.some((r) => r.memberPath[0]?.member === "definition")).toBe(false);
    } finally {
      missingMounted.app.unmount();
    }

    // 2. Selected metric transitions through error, forbidden, empty, unavailable delete, failed delete, and delete success.
    const harness = mountMetricViewsApp(panelAddress(DETAIL_PATH, { selected: "mv-1" }));
    const mounted = await harness.open();
    try {
      await waitFor(
        () =>
          mounted.element.querySelector(".sdk-page-header")?.textContent?.includes("Revenue") === true
          && mounted.element.querySelector<HTMLInputElement>('[data-field="/name"] input')?.value === "Metric mv-1",
        "selected metric detail ready",
      );

      // Error state renders in place with fallback title in header and unmounts definition.
      harness.setHeaderOverride(() => ({ status: "error", message: "Metric service temporarily unavailable" }));
      // Trigger refresh via error retry or instance refresh by reloading selection.
      await harness.router.push(panelAddress(DETAIL_PATH, { selected: "mv-2" }));
      await waitFor(
        () =>
          mounted.element.textContent?.includes("Metric service temporarily unavailable") === true
          && mounted.element.querySelector(".sdk-page-header")?.textContent?.includes("mv-2") === true
          && mounted.element.querySelector('[data-field="/name"] input') === null,
        "error state shown in place with fallback title and unmounted form",
      );

      // Forbidden state renders in place without mounting definition.
      harness.setHeaderOverride(() => ({ status: "forbidden", reason: "No permission" }));
      const retryBtn = Array.from(mounted.element.querySelectorAll<HTMLButtonElement>(".mv-state-box button")).find(
        (b) => b.textContent?.trim() === "Retry",
      );
      expect(retryBtn).toBeTruthy();
      retryBtn!.click();
      await waitFor(
        () =>
          mounted.element.textContent?.includes("You do not have permission to view this metric view.") === true
          && mounted.element.querySelector('[data-field="/name"] input') === null,
        "forbidden state shown in place",
      );

      // Empty (not found) state renders in place without mounting definition.
      harness.setHeaderOverride(() => ({ status: "empty" }));
      await harness.router.push(panelAddress(DETAIL_PATH, { selected: "mv-missing" }));
      await waitFor(
        () =>
          mounted.element.textContent?.includes("Metric view not found or deleted") === true
          && mounted.element.querySelector(".sdk-page-header")?.textContent?.includes("mv-missing") === true
          && mounted.element.querySelector('[data-field="/name"] input') === null,
        "empty state shown in place with fallback title and unmounted form",
      );

      // Restore healthy header for mv-1 with unavailable delete -> delete button hidden by hideWhenUnavailable.
      harness.setHeaderOverride(null);
      harness.setDeleteUnavailable({ reason: "System metric cannot be deleted" });
      await harness.router.push(panelAddress(DETAIL_PATH, { selected: "mv-1" }));
      await waitFor(
        () =>
          mounted.element.querySelector(".sdk-page-header")?.textContent?.includes("Revenue") === true
          && mounted.element.querySelector<HTMLInputElement>('[data-field="/name"] input')?.value === "Metric mv-1",
        "mv-1 ready with unavailable delete",
      );
      const deleteBtn = () =>
        Array.from(mounted.element.querySelectorAll<HTMLButtonElement>(".mv-detail-remove button")).find((b) =>
          b.textContent?.includes("Delete"),
        );
      expect(deleteBtn()).toBeUndefined();

      // Re-enable delete and test failed delete keeps user on detail page.
      harness.setDeleteUnavailable(null);
      await harness.router.push(panelAddress(DETAIL_PATH, { selected: "mv-2" }));
      await waitFor(() => Boolean(deleteBtn() && !deleteBtn()!.disabled), "delete button visible and enabled on mv-2");

      harness.setDeleteOutcome({ kind: "failed", message: "Metric is referenced by a dashboard" });
      deleteBtn()!.click();
      await waitFor(() => harness.dispatched.length === 1, "failed delete dispatched");
      expect(harness.router.currentRoute.value.path).toBe(DETAIL_PATH);
      expect(harness.router.currentRoute.value.query.selected).toBe("mv-2");

      // Successful delete with affected.removed (triggers synchronous letGo before @done) still navigates back to catalog.
      harness.setDeleteOutcome({
        kind: "success",
        message: "Metric view deleted",
        data: {},
        affected: {
          objects: [],
          removed: [{ objectType: METRIC_VIEW, primaryKey: "mv-2" }],
          objectTypes: [METRIC_VIEW],
        },
      });
      await waitFor(() => Boolean(deleteBtn() && !deleteBtn()!.disabled), "delete button ready for retry");
      deleteBtn()!.click();
      await waitFor(
        () =>
          harness.dispatched.length === 2
          && harness.router.currentRoute.value.path === CATALOG_PATH,
        "successful delete returned to catalog despite synchronous letGo",
      );
    } finally {
      mounted.app.unmount();
    }
  });

  it("runs online Markdown/JSON draft trials, preserves explicit parameters across binding toggles, and resets on reopen", async () => {
    const harness = mountMetricViewsApp(panelAddress(DETAIL_PATH, { selected: "mv-1" }));
    const mounted = await harness.open();
    try {
      await waitFor(
        () =>
          mounted.element.querySelector<HTMLInputElement>('[data-field="/name"] input')?.value === "Metric mv-1"
          && harness.controller() !== null,
        "metric detail ready",
      );

      // Trial projections stay unmounted while testOpen is false.
      expect(await harness.controller()!.executeAction!({ operation: "testMarkdown.test", agentRun: AGENT_RUN })).toMatchObject({
        ok: false,
        reason: "action_not_found",
      });
      expect(await harness.controller()!.executeAction!({ operation: "testJson.testExecute", agentRun: AGENT_RUN })).toMatchObject({
        ok: false,
        reason: "action_not_found",
      });

      const openTestBtn = () =>
        Array.from(mounted.element.querySelectorAll<HTMLButtonElement>(".sdk-page-header .mv-detail-actions button")).find(
          (b) => b.textContent?.trim() === "Test",
        );
      const findTrialButton = (member: "testMarkdown" | "testJson") =>
        document.body.querySelector<HTMLButtonElement>(`[data-member='${member}'] button`);
      const explicitInputs = () =>
        Array.from(document.body.querySelectorAll<HTMLInputElement>(".mv-test-params input"));

      // 1. Open dialog via header Test button: starts on explicit defaults (year: 2025, region: "US").
      expect(openTestBtn()).toBeTruthy();
      openTestBtn()!.click();
      await waitFor(
        () =>
          explicitInputs().length === 2
          && findTrialButton("testMarkdown")?.disabled === false
          && findTrialButton("testJson")?.disabled === false,
        "test dialog opened with explicit inputs and enabled trial projections",
      );
      expect(explicitInputs().map((i) => i.value)).toEqual(["2025", "\"US\""]);

      // Run both Markdown and JSON trials and verify rendered preview + truncation warning.
      findTrialButton("testMarkdown")!.click();
      await waitFor(
        () =>
          harness.readOperations.includes("testMarkdown.test")
          && document.body.querySelector("[data-member='testMarkdown']")?.textContent?.includes("Total: 42") === true,
        "Markdown trial renders preview",
      );
      expect(harness.readCalls.at(-1)).toMatchObject({
        operationId: "testMarkdown.test",
        input: { parameters: { year: 2025, region: "US" } },
      });

      findTrialButton("testJson")!.click();
      await waitFor(
        () =>
          harness.readOperations.includes("testJson.testExecute")
          && document.body.querySelector("[data-member='testJson']")?.textContent?.includes("\"total\": 42") === true
          && document.body.querySelector("[data-member='testJson']")?.textContent?.includes("20000") === true,
        "JSON trial renders JSON and truncation warning",
      );
      expect(harness.readCalls.at(-1)?.input).not.toHaveProperty("bindingId");

      // 2. Edit explicit year to 2028, toggle to binding:0, then toggle back to explicit: 2028 is preserved.
      explicitInputs()[0]!.value = "2028";
      explicitInputs()[0]!.dispatchEvent(new Event("input", { bubbles: true }));
      await waitFor(
        () => (harness.context()?.state?.testParameters as Record<string, unknown> | undefined)?.year === 2028,
        "explicit year edited to 2028",
      );

      harness.controller()!.applyState({ testSource: "binding:0" });
      await waitFor(
        () => (harness.context()?.state?.testParameters as Record<string, unknown> | undefined)?.year === 2024,
        "binding:0 selected and binding parameters populated",
      );

      harness.controller()!.applyState({ testSource: "explicit" });
      await waitFor(
        () =>
          explicitInputs().length === 2
          && explicitInputs()[0]!.value === "2028"
          && (harness.context()?.state?.testParameters as Record<string, unknown> | undefined)?.year === 2028,
        "switching back to explicit restores edited year without binding overwrite",
      );

      const callsBeforeExplicitRun = harness.readCalls.length;
      findTrialButton("testMarkdown")!.click();
      await waitFor(
        () => harness.readCalls.length > callsBeforeExplicitRun,
        "trial dispatched with restored explicit parameters",
      );
      expect(harness.readCalls.at(-1)).toMatchObject({
        operationId: "testMarkdown.test",
        input: { parameters: { year: 2028, region: "US" } },
      });

      // 3. Invalid JSON in explicit mode stays preserved across binding toggle and disables trials.
      explicitInputs()[0]!.value = "{bad";
      explicitInputs()[0]!.dispatchEvent(new Event("input", { bubbles: true }));
      await waitFor(
        () =>
          findTrialButton("testMarkdown")?.disabled === true
          && findTrialButton("testJson")?.disabled === true
          && document.body.textContent?.includes("Invalid JSON value for parameter year") === true,
        "invalid explicit input disables trials and shows error",
      );
      expect(await harness.controller()!.executeAction!({ operation: "testMarkdown.test", agentRun: AGENT_RUN })).toMatchObject({
        ok: false,
        reason: "action_unavailable",
      });

      harness.controller()!.applyState({ testSource: "binding:0" });
      await waitFor(
        () => findTrialButton("testMarkdown")?.disabled === false,
        "binding source re-enables trials",
      );
      harness.controller()!.applyState({ testSource: "explicit" });
      await waitFor(
        () =>
          explicitInputs()[0]?.value === "{bad"
          && findTrialButton("testMarkdown")?.disabled === true,
        "returning to explicit keeps invalid input and disabled state",
      );

      // 4. Close dialog from binding:0 + json tab and reopen on the same metric: resets to explicit, markdown, defaults.
      harness.controller()!.applyState({ testSource: "binding:0", testTab: "json" });
      await waitFor(
        () => harness.context()?.state?.testTab === "json" && harness.context()?.state?.testSource === "binding:0",
        "dialog switched to binding:0 and json tab before closing",
      );
      const closeBtn = Array.from(document.body.querySelectorAll<HTMLButtonElement>("button")).find(
        (b) => b.textContent?.trim() === "Close",
      );
      closeBtn!.click();
      await waitFor(
        () => document.body.querySelector("[data-member='testMarkdown']") === null,
        "dialog closed",
      );

      openTestBtn()!.click();
      await waitFor(
        () =>
          explicitInputs().length === 2
          && explicitInputs().map((i) => i.value).join(",") === "2025,\"US\""
          && harness.context()?.state?.testSource === "explicit"
          && harness.context()?.state?.testTab === "markdown"
          && findTrialButton("testMarkdown")?.disabled === false,
        "reopening test dialog on same metric resets source, tab, and explicit defaults",
      );

      // 5. Close, reopen directly on binding:0 via agent present, then switch to explicit: falls back to defaults.
      harness.controller()!.applyState({ testOpen: false });
      await waitFor(() => document.body.querySelector("[data-member='testMarkdown']") === null, "closed via state");
      harness.controller()!.applyState({ testOpen: true, testSource: "binding:0" });
      await waitFor(
        () => (harness.context()?.state?.testParameters as Record<string, unknown> | undefined)?.year === 2024,
        "reopened directly on binding:0",
      );
      harness.controller()!.applyState({ testSource: "explicit" });
      await waitFor(
        () =>
          explicitInputs().length === 2
          && explicitInputs().map((i) => i.value).join(",") === "2025,\"US\""
          && (harness.context()?.state?.testParameters as Record<string, unknown> | undefined)?.year === 2025,
        "switching from directly opened binding:0 to explicit uses parameter defaults",
      );

      // 6. Explicit agent override when switching back from binding:0 is respected.
      harness.controller()!.applyState({ testSource: "binding:0" });
      await waitFor(
        () => (harness.context()?.state?.testParameters as Record<string, unknown> | undefined)?.year === 2024,
        "back on binding:0",
      );
      harness.controller()!.applyState({ testSource: "explicit", testParameters: { year: 2030 } });
      await waitFor(
        () =>
          explicitInputs().length === 2
          && explicitInputs().map((i) => i.value).join(",") === "2030,\"US\""
          && (harness.context()?.state?.testParameters as Record<string, unknown> | undefined)?.year === 2030,
        "explicit agent testParameters patch overrides when switching from binding",
      );
    } finally {
      mounted.app.unmount();
    }
  });
});
