import { afterEach, describe, expect, it, vi } from "vitest";
import { defineComponent, h } from "vue";
import { createMemoryHistory, createRouter } from "vue-router";
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
import { useApplicationCatalog } from "../../../../../packages/platform-web/src/catalog";
import PanelApplicationRoute from "../../../../../packages/platform-web/src/pages/PanelApplicationRoute.vue";
import source from "../../../../../packages/ontology-manager/resources/builtin-panels/metric-views/panel.json";
import html from "../../../../../packages/ontology-manager/resources/builtin-panels/metric-views/panel.html?raw";
import module from "../../../../../packages/ontology-manager/resources/builtin-panels/metric-views/panel.mjs?raw";
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
const ENTRY_PATH = "/ontology/metric-views";
const AGENT_RUN = {
  sessionId: "11111111-1111-4111-8111-111111111111",
  runId: "22222222-2222-4222-8222-222222222222",
  toolCallId: "tool-call-1",
};

const use = panelUse(
  "ontology-metric-views",
  "metric-views",
  "builtin-product-ontology-metric-views",
  ENTRY_PATH,
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

const { members: authoring, ...manifest } = panelAuthoringManifestSchema.parse(source.manifest);
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
const members = Object.fromEntries(
  Object.entries(authoring).map(([name, definition]) => {
    if (!("component" in definition)) throw new Error(`Expected an authored projection for ${name}`);
    const { projection, placement } = expandPanelAuthoringMember(name, definition, {
      state: manifest.state,
      typeTable: { objectTypes: { [METRIC_VIEW]: metricViewTypeEntry } },
      components: catalogue,
    });
    projections.set(definition.id!, {
      ...projection,
      id: definition.id!,
      name,
      description: name,
      visibility: "platform",
      domainId: null,
      ownerId: null,
      editable: false,
      revision: 1,
      createdAt: "2026-11-24T00:00:00Z",
      updatedAt: "2026-11-24T00:00:00Z",
    });
    return [name, { ...placement, target: { projectionId: definition.id! } }];
  }),
);

const metricViewsPanel = {
  ...panelRecord(use.panelId, "Metric Views", definePanel({ ...manifest, members })),
  visibility: "platform" as const,
  domainId: null,
  ownerId: null,
  editable: false as const,
  content: { html, module, messages: source.content.messages },
};

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
    ],
    values: {
      name: mode === "create" ? "" : `Metric ${key}`,
      function: { parameters: [] },
      bindings: [],
    },
    errors: [],
    save: {
      method: mode === "create" ? "POST" : "PUT",
      path: `/api/data-query/metricView/${key || "create"}`,
      bodySchema: {},
      draftOperation: mode === "create" ? "create" : "save",
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
  for (let i = 0; i < 100; i += 1) {
    if (check()) return;
    await new Promise((resolve) => setTimeout(resolve, 15));
  }
  const desc = typeof label === "function" ? label() : label;
  throw new Error(`Timed out waiting for: ${desc}`);
}

function mountMetricViews(initialState: Record<string, unknown> = {}) {
  const reads: DataReadRequest[] = [];
  const opsReads: OpsReadRequest[] = [];
  const readOperations: string[] = [];
  const dispatched: Array<{ operationId: string; targetPrimaryKey: string | null }> = [];
  let localConfirmSeq = 0;
  let intentSeq = 0;
  const preparedIntents = new Map<string, { operationId: string; targetPrimaryKey: string | null }>();
  let headerOverride: ((key: string) => Record<string, unknown>) | null = null;
  let deleteOutcome: Record<string, unknown> = {
    kind: "success",
    message: "Metric view deleted",
    data: {},
    affected: {
      objects: [{ objectType: METRIC_VIEW, primaryKey: "mv-1" }],
      objectTypes: [METRIC_VIEW],
    },
  };
  let controller: PageControllerHandle | null = null;
  let latestContext: PageContext | null = null;

  const router = createRouter({
    history: createMemoryHistory(),
    routes: [{ path: use.path, component: { template: "<div />" } }],
  });

  installPlatform((request: Sent) => {
    const { path } = request;
    if (path === `/api/data-query/platform/applications/${APP_ID}/panel-uses`) {
      return Response.json({
        data: { applicationId: APP_ID, entry: { path: "/ontology", renderer: "panels" }, panelUses: [use] },
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
      const body = request.body as { operationId: string; call?: { target?: { primaryKey?: string } } };
      const intentId = `33333333-3333-4333-8333-33333333330${intentSeq}`;
      const targetPrimaryKey = body.call?.target?.primaryKey ?? null;
      preparedIntents.set(intentId, { operationId: body.operationId, targetPrimaryKey });
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
      });
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
      const body = request.body as { operationId?: string };
      if (typeof body.operationId === "string") readOperations.push(body.operationId);
      if (body.operationId === "definition.test") {
        return Response.json({ kind: "markdown", markdown: "# Metric Preview\n\nTotal: 42" });
      }
      if (body.operationId === "definition.testExecute") {
        return Response.json({ kind: "json", value: { result: [{ total: 42 }], truncated: false } });
      }
      return Response.json({ kind: "json", value: {} });
    }
    if (path === `/api/product-panels/${metricViewsPanel.id}`) return panelAnswer(metricViewsPanel, request);
    if (path === `/api/product-panels/${metricViewsPanel.id}/snapshot`) {
      return panelSnapshot(metricViewsPanel, Object.fromEntries(projections), request);
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
        return Response.json({
          status: "ready",
          value: {
            primaryKey: key,
            label: key === "mv-1" ? "Revenue" : "Active Users",
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
    dispatched,
    router,
    setHeaderOverride(fn: ((key: string) => Record<string, unknown>) | null) {
      headerOverride = fn;
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
          panelUses: [use],
        },
      ];
      await router.push(panelAddress(use.path, initialState, metricViewsPanel.manifest));
      const Host = defineComponent({
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
      return mountPlatformPage(() => h(Host), router);
    },
  };
}

afterEach(() => {
  leaveFrame();
  useApplicationCatalog().applications.value = [];
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

describe("metric-views builtin panel detail mount lifecycle", () => {
  it("keeps definition unmounted on catalog, preserves mv-catalog with v-show while editing, and unmounts definition on back", async () => {
    const harness = mountMetricViews();
    const mounted = await harness.open();
    try {
      await waitFor(
        () =>
          mounted.element.textContent?.includes("Revenue") === true
          && mounted.element.textContent?.includes("Active Users") === true
          && harness.controller() !== null,
        "initial metric views catalog",
      );

      // 1. On catalog view (!detailVisible), mv-detail and definition form are unmounted.
      const catalogEl = mounted.element.querySelector(".mv-catalog") as HTMLElement | null;
      expect(catalogEl).not.toBeNull();
      expect(catalogEl!.style.display).not.toBe("none");
      expect(mounted.element.querySelector(".mv-detail")).toBeNull();
      expect(harness.reads.some((r) => r.memberPath[0]?.member === "definition")).toBe(false);
      expect(harness.context()?.forms?.some((f) => f.member === "definition") ?? false).toBe(false);

      expect(await harness.controller()!.fillForm!({ member: "definition", values: { "/name": "Blocked" } })).toMatchObject({
        ok: false,
        reason: "form_not_found",
      });
      expect(await harness.controller()!.fillForm!({ values: { "/name": "Blocked" } })).toMatchObject({
        ok: false,
        reason: "form_not_found",
      });
      expect(await harness.controller()!.executeAction!({ operation: "definition.save", agentRun: AGENT_RUN })).toMatchObject({
        ok: false,
        reason: "action_not_found",
      });

      // Check a row so catalog batch selection state is active before opening detail.
      const rowCheckboxes = Array.from(
        catalogEl!.querySelectorAll<HTMLInputElement>("tbody input[type='checkbox']"),
      );
      expect(rowCheckboxes.length).toBeGreaterThan(0);
      rowCheckboxes[0]!.click();
      await waitFor(
        () => catalogEl!.textContent?.includes("Update status") === true,
        "catalog batch status button mounted when row checked",
      );

      // 2. Enter edit detail (selected non-null): definition mounts & registers, mv-catalog stays mounted via v-show.
      harness.controller()!.applyState({ selected: metricRef("mv-1") });
      await waitFor(
        () =>
          mounted.element.querySelector(".mv-detail") !== null
          && (mounted.element.querySelector(".mv-detail input") as HTMLInputElement | null)?.value === "Metric mv-1"
          && (harness.context()?.forms?.some((f) => f.member === "definition") ?? false),
        "edit detail definition form mounted and registered",
      );

      expect(mounted.element.contains(catalogEl!)).toBe(true);
      expect(catalogEl!.style.display).toBe("none");

      // Trial operations declared on definition bind reactively once detail is mounted.
      const testBtn = Array.from(mounted.element.querySelectorAll<HTMLButtonElement>(".mv-detail button")).find((b) =>
        b.textContent?.includes("Test"),
      );
      expect(testBtn).toBeTruthy();
      testBtn!.click();
      await waitFor(() => {
        const buttons = Array.from(document.body.querySelectorAll<HTMLButtonElement>("button"));
        const mdBtn = buttons.find((b) => b.textContent?.includes("Test and generate Markdown"));
        const jsonBtn = buttons.find((b) => b.textContent?.includes("Test and return JSON"));
        return Boolean(mdBtn && !mdBtn.disabled && jsonBtn && !jsonBtn.disabled);
      }, "trial and trialJson buttons enabled after definition mounts");

      // Human clicks on both trial buttons must dispatch read operations (not self-block on busy).
      const findButton = (label: string) =>
        Array.from(document.body.querySelectorAll<HTMLButtonElement>("button")).find((b) =>
          b.textContent?.includes(label),
        );
      findButton("Test and generate Markdown")!.click();
      await waitFor(
        () =>
          harness.readOperations.includes("definition.test")
          && document.body.textContent?.includes("Total: 42") === true,
        "human click on Markdown trial dispatches definition.test and renders preview",
      );
      findButton("Test and return JSON")!.click();
      await waitFor(
        () =>
          harness.readOperations.includes("definition.testExecute")
          && document.body.textContent?.includes("\"total\": 42") === true,
        "human click on JSON trial dispatches definition.testExecute and renders preview",
      );
      const closeBtn = Array.from(document.body.querySelectorAll<HTMLButtonElement>("button")).find(
        (b) => b.textContent?.trim() === "Close",
      );
      closeBtn?.click();

      // Agent page_action can directly trigger definition.test and definition.testExecute via unified usePanelOperation.
      const mdResult = await harness.controller()!.executeAction!({
        operation: "definition.test",
        input: { parameters: {} },
        agentRun: AGENT_RUN,
      });
      expect(mdResult).toMatchObject({ ok: true, kind: "executed", operation: "definition.test" });
      await waitFor(
        () => document.body.textContent?.includes("Total: 42") === true,
        "definition.test populates markdown preview in the panel",
      );
      const jsonResult = await harness.controller()!.executeAction!({
        operation: "definition.testExecute",
        input: { parameters: {} },
        agentRun: AGENT_RUN,
      });
      expect(jsonResult).toMatchObject({ ok: true, kind: "executed", operation: "definition.testExecute" });
      await waitFor(
        () => document.body.textContent?.includes("\"total\": 42") === true,
        "definition.testExecute populates JSON preview in the panel",
      );
      const closeAfterAgent = Array.from(document.body.querySelectorAll<HTMLButtonElement>("button")).find(
        (b) => b.textContent?.trim() === "Close",
      );
      closeAfterAgent?.click();

      // Live fillForm works while detail is open, then discard before clicking Back.
      const filled = await harness.controller()!.fillForm!({ member: "definition", values: { "/name": "Revenue Revised" } });
      expect(filled).toMatchObject({ ok: true, filledFields: ["/name"] });
      await waitFor(
        () => (mounted.element.querySelector(".mv-detail input") as HTMLInputElement | null)?.value === "Revenue Revised",
        "definition form input updated via fillForm",
      );
      const discardAwaiting = await harness.controller()!.executeAction!({
        operation: "definition.discard",
        agentRun: AGENT_RUN,
      });
      expect(discardAwaiting).toMatchObject({
        ok: true,
        kind: "awaiting_confirmation",
        operation: "definition.discard",
      });
      if (!discardAwaiting.ok || discardAwaiting.kind !== "awaiting_confirmation") {
        throw new Error("Expected definition.discard to require conversation confirmation");
      }
      expect(await discardAwaiting.confirmation.dispatch()).toMatchObject({
        ok: true,
        outcome: { discarded: true },
      });

      // 3. Return to catalog: mv-detail & definition unmount, mv-catalog stays the same element and becomes visible again.
      const backBtn = Array.from(mounted.element.querySelectorAll<HTMLButtonElement>(".mv-detail button")).find((b) =>
        b.textContent?.includes("Back to Metric Views"),
      );
      expect(backBtn).toBeTruthy();
      backBtn!.click();

      await waitFor(
        () =>
          mounted.element.querySelector(".mv-detail") === null
          && catalogEl!.style.display !== "none"
          && !(harness.context()?.forms?.some((f) => f.member === "definition") ?? false),
        "returned to catalog with definition unmounted",
      );

      expect(mounted.element.contains(catalogEl!)).toBe(true);
      expect(catalogEl!.textContent).toContain("Update status");
      expect(await harness.controller()!.fillForm!({ member: "definition", values: { "/name": "After back" } })).toMatchObject({
        ok: false,
        reason: "form_not_found",
      });
      expect(await harness.controller()!.executeAction!({ operation: "definition.save", agentRun: AGENT_RUN })).toMatchObject({
        ok: false,
        reason: "action_not_found",
      });
    } finally {
      mounted.app.unmount();
    }
  });

  it("mounts definition createForm when creating, updates detailTitle from live form handle, and unmounts on discard", async () => {
    const harness = mountMetricViews();
    const mounted = await harness.open();
    try {
      await waitFor(
        () =>
          mounted.element.textContent?.includes("Revenue") === true
          && harness.controller() !== null,
        "initial catalog ready",
      );

      const catalogEl = mounted.element.querySelector(".mv-catalog") as HTMLElement | null;
      expect(catalogEl).not.toBeNull();
      expect(mounted.element.querySelector(".mv-detail")).toBeNull();

      // Click primary "New Metric View" button -> creating: true, selected: null.
      const newBtn = Array.from(mounted.element.querySelectorAll<HTMLButtonElement>("button")).find((b) =>
        b.textContent?.includes("New Metric View"),
      );
      expect(newBtn).toBeTruthy();
      newBtn!.click();

      await waitFor(
        () =>
          mounted.element.querySelector(".mv-detail") !== null
          && harness.reads.some((r) => r.memberPath[0]?.member === "definition" && r.dataName === "createForm")
          && (harness.context()?.forms?.some((f) => f.member === "definition") ?? false),
        () => `create detail definition form mounted (detail=${Boolean(mounted.element.querySelector(".mv-detail"))}, reads=${JSON.stringify(harness.reads.map((r) => [r.memberPath[0]?.member, r.dataName]))}, forms=${JSON.stringify(harness.context()?.forms)}, detailText=${JSON.stringify(mounted.element.querySelector(".mv-detail")?.textContent)})`,
      );

      expect(mounted.element.contains(catalogEl!)).toBe(true);
      expect(catalogEl!.style.display).toBe("none");
      expect(mounted.element.querySelector(".mv-detail-header-slot")).toBeNull();
      expect(mounted.element.querySelector(".mv-detail-title")?.textContent?.trim()).toBe("New Metric View");

      // Filling the draft name updates detailTitle reactively via instance.forms.handle("definition").
      const filled = await harness.controller()!.fillForm!({ member: "definition", values: { "/name": "Draft GMV" } });
      expect(filled).toMatchObject({ ok: true, filledFields: ["/name"] });
      await waitFor(
        () => mounted.element.querySelector(".mv-detail-title")?.textContent?.trim() === "Draft GMV",
        "detailTitle updates reactively from live definition form handle",
      );

      // Discarding create form requires confirmation, then triggers onDiscarded -> setCreating(false) -> unmounts mv-detail & definition.
      const createDiscardAwaiting = await harness.controller()!.executeAction!({
        operation: "definition.discard",
        agentRun: AGENT_RUN,
      });
      expect(createDiscardAwaiting).toMatchObject({
        ok: true,
        kind: "awaiting_confirmation",
        operation: "definition.discard",
      });
      if (!createDiscardAwaiting.ok || createDiscardAwaiting.kind !== "awaiting_confirmation") {
        throw new Error("Expected create definition.discard to require conversation confirmation");
      }
      expect(await createDiscardAwaiting.confirmation.dispatch()).toMatchObject({
        ok: true,
        outcome: { discarded: true },
      });

      await waitFor(
        () =>
          mounted.element.querySelector(".mv-detail") === null
          && catalogEl!.style.display !== "none"
          && !(harness.context()?.forms?.some((f) => f.member === "definition") ?? false),
        "create form discarded and unmounted",
      );

      expect(await harness.controller()!.fillForm!({ member: "definition", values: { "/name": "Stale" } })).toMatchObject({
        ok: false,
        reason: "form_not_found",
      });
    } finally {
      mounted.app.unmount();
    }
  });

  it("stays in detail and surfaces header error, forbidden, and empty states instead of closing, closing only on delete success", async () => {
    const harness = mountMetricViews();
    const mounted = await harness.open();
    try {
      await waitFor(
        () =>
          mounted.element.textContent?.includes("Revenue") === true
          && harness.controller() !== null,
        "initial catalog ready",
      );

      const catalogEl = mounted.element.querySelector(".mv-catalog") as HTMLElement | null;
      expect(catalogEl).not.toBeNull();

      // 1. Open existing metric mv-1 and confirm ObjectHeader renders ready with no fallback title.
      harness.controller()!.applyState({ selected: metricRef("mv-1") });
      await waitFor(
        () =>
          mounted.element.querySelector(".mv-detail-header-slot")?.textContent?.includes("Revenue") === true
          && (mounted.element.querySelector(".mv-detail input") as HTMLInputElement | null)?.value === "Metric mv-1",
        "selected metric detail and header ready",
      );

      const headerSlot = () => mounted.element.querySelector(".mv-detail-header-slot") as HTMLElement | null;
      const refreshBtn = () =>
        mounted.element.querySelector<HTMLButtonElement>('button[aria-label="Refresh"]');

      expect(headerSlot()).not.toBeNull();
      expect(headerSlot()!.style.display).not.toBe("none");
      expect(mounted.element.querySelector(".mv-detail-title")).toBeNull();
      expect(harness.router.currentRoute.value.query.selected).toBeTruthy();

      // 2. Header re-read returns error: stays in detail, keeps selected, displays visible error in header.
      const readsBeforeError = harness.reads.filter((r) => r.memberPath[0]?.member === "header").length;
      harness.setHeaderOverride(() => ({ status: "error", message: "Metric service temporarily unavailable" }));
      refreshBtn()!.click();
      await waitFor(
        () =>
          harness.reads.filter((r) => r.memberPath[0]?.member === "header").length > readsBeforeError
          && headerSlot()?.textContent?.includes("Metric service temporarily unavailable") === true,
        "header shows error state after re-read",
      );

      expect(mounted.element.querySelector(".mv-detail")).not.toBeNull();
      expect(catalogEl!.style.display).toBe("none");
      expect(headerSlot()!.style.display).not.toBe("none");
      expect(headerSlot()!.querySelector(".fui-data-state-error")).not.toBeNull();
      expect(mounted.element.querySelector(".mv-detail-title")).toBeNull();
      expect(harness.router.currentRoute.value.query.selected).toBeTruthy();

      // 3. Header re-read returns forbidden: stays in detail, keeps selected, displays visible forbidden reason.
      const readsBeforeForbidden = harness.reads.filter((r) => r.memberPath[0]?.member === "header").length;
      harness.setHeaderOverride(() => ({ status: "forbidden", reason: "No permission to inspect this metric" }));
      refreshBtn()!.click();
      await waitFor(
        () =>
          harness.reads.filter((r) => r.memberPath[0]?.member === "header").length > readsBeforeForbidden
          && headerSlot()?.textContent?.includes("No permission to inspect this metric") === true,
        "header shows forbidden state after re-read",
      );

      expect(mounted.element.querySelector(".mv-detail")).not.toBeNull();
      expect(catalogEl!.style.display).toBe("none");
      expect(headerSlot()!.style.display).not.toBe("none");
      expect(headerSlot()!.querySelector(".fui-data-state-forbidden")).not.toBeNull();
      expect(mounted.element.querySelector(".mv-detail-title")).toBeNull();
      expect(harness.router.currentRoute.value.query.selected).toBeTruthy();

      // 4. Header re-read returns empty: stays in detail, keeps selected, displays visible empty state.
      const readsBeforeEmpty = harness.reads.filter((r) => r.memberPath[0]?.member === "header").length;
      harness.setHeaderOverride(() => ({ status: "empty" }));
      refreshBtn()!.click();
      await waitFor(
        () =>
          harness.reads.filter((r) => r.memberPath[0]?.member === "header").length > readsBeforeEmpty
          && headerSlot()?.querySelector(".fui-data-state-empty") !== null,
        "header shows empty state after re-read",
      );

      expect(mounted.element.querySelector(".mv-detail")).not.toBeNull();
      expect(catalogEl!.style.display).toBe("none");
      expect(headerSlot()!.style.display).not.toBe("none");
      expect(mounted.element.querySelector(".mv-detail-title")).toBeNull();
      expect(harness.router.currentRoute.value.query.selected).toBeTruthy();

      // 5. Failed delete outcome must NOT close detail or clear selected.
      harness.setDeleteOutcome({ kind: "failed", message: "Metric is referenced by a dashboard" });
      const deleteBtn = () =>
        Array.from(mounted.element.querySelectorAll<HTMLButtonElement>(".mv-detail-actions button")).find((b) =>
          b.textContent?.includes("Delete"),
        );
      await waitFor(() => Boolean(deleteBtn() && !deleteBtn()!.disabled), "delete button ready");
      deleteBtn()!.click();
      await waitFor(() => harness.dispatched.length === 1, "failed delete dispatched");

      expect(mounted.element.querySelector(".mv-detail")).not.toBeNull();
      expect(catalogEl!.style.display).toBe("none");
      expect(harness.router.currentRoute.value.query.selected).toBeTruthy();

      // 6. Successful delete outcome closes detail, clears selected, and returns to catalog.
      harness.setDeleteOutcome({
        kind: "success",
        message: "Metric view deleted",
        data: {},
        affected: {
          objects: [{ objectType: METRIC_VIEW, primaryKey: "mv-1" }],
          objectTypes: [METRIC_VIEW],
        },
      });
      await waitFor(() => Boolean(deleteBtn() && !deleteBtn()!.disabled), "delete button ready for retry");
      deleteBtn()!.click();
      await waitFor(
        () =>
          harness.dispatched.length === 2
          && mounted.element.querySelector(".mv-detail") === null
          && catalogEl!.style.display !== "none"
          && !harness.router.currentRoute.value.query.selected,
        "detail closed and selected cleared after delete success",
      );
    } finally {
      mounted.app.unmount();
    }
  });
});
