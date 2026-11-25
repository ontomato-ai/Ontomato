import { afterEach, describe, expect, it, vi } from "vitest";
import { h } from "vue";
import { createMemoryHistory, createRouter, RouterView } from "vue-router";
import { appsSdkComponentCatalogEntrySchema } from "@ontomato/contracts/apps-sdk";
import { expandPanelAuthoringMember } from "@ontomato/contracts/panel-authoring-expansion";
import { panelAuthoringManifestSchema } from "@ontomato/contracts/panel-authoring";
import { definePanel } from "@ontomato/contracts/panel-manifest";
import { panelAddress, type ProductPanelReadRequest } from "@ontomato/contracts/panel-host";
import type { ProductProjection } from "@ontomato/contracts/product-panels";
import {
  DELETE_TRIGGER,
  SET_TRIGGER_STATUS,
  TRIGGER,
  platformObjectTypes,
} from "@ontomato/contracts/platform-object-types";
import { platformTypeTableEntrySchema } from "@ontomato/contracts/platform-type-table";
import { components } from "../../../../../packages/apps-sdk/src/catalogue";
import { useApplicationCatalog } from "../../../../../packages/platform-web/src/catalog";
import PanelApplicationRoute from "../../../../../packages/platform-web/src/pages/PanelApplicationRoute.vue";
import source from "../../../../../packages/ontology-manager/resources/builtin-panels/triggers/panel.json";
import html from "../../../../../packages/ontology-manager/resources/builtin-panels/triggers/panel.html?raw";
import module from "../../../../../packages/ontology-manager/resources/builtin-panels/triggers/panel.mjs?raw";
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

const appId = "ontology";
const use = panelUse(
  "ontology-triggers",
  "ontology-triggers",
  "builtin-product-ontology-triggers",
  "/ontology/assets/triggers",
);

const triggerTypeEntry = platformTypeTableEntrySchema.parse({
  ...platformObjectTypes[TRIGGER],
  operations: [
    {
      id: `${TRIGGER}.save`,
      kind: "form.save",
      effect: "write",
      batch: false,
      inputSchema: { type: "object" },
      target: { source: "draft" },
    },
    {
      id: SET_TRIGGER_STATUS,
      kind: "action",
      effect: "write",
      batch: false,
      inputSchema: {
        type: "object",
        properties: {
          status: { type: "string", enum: ["PENDING_REVIEW", "PUBLISHED", "UNUSED"] },
          enabled: { type: "boolean" },
        },
        required: ["status"],
      },
      target: { source: "input", input: "trigger" },
    },
    {
      id: DELETE_TRIGGER,
      kind: "action",
      effect: "write",
      batch: false,
      inputSchema: { type: "object" },
      target: { source: "input", input: "trigger" },
    },
  ],
});

const { members: authoring, ...manifest } = panelAuthoringManifestSchema.parse(source.manifest);
const catalogue = components.map((component) =>
  appsSdkComponentCatalogEntrySchema.parse({
    ...component,
    ports: { props: [], events: [], slots: [] },
  }),
);
const projections = new Map<string, ProductProjection>();
const members = Object.fromEntries(
  Object.entries(authoring).map(([name, definition]) => {
    if (!("component" in definition)) throw new Error(`Expected authored projection for ${name}`);
    const { projection, placement } = expandPanelAuthoringMember(name, definition, {
      state: manifest.state,
      typeTable: { objectTypes: { [TRIGGER]: triggerTypeEntry } },
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

const triggersPanel = {
  ...panelRecord(use.panelId, "Triggers", definePanel({ ...manifest, members })),
  visibility: "platform" as const,
  domainId: null,
  ownerId: null,
  editable: false as const,
  content: { html, module, messages: source.content.messages },
};

type DataReadRequest = Extract<ProductPanelReadRequest, { dataName: string }>;
type OpsReadRequest = Extract<ProductPanelReadRequest, { operations: true }>;

const triggerFieldLabels = {
  triggerTitle: "Trigger",
  version: "Version",
  status: "State",
  statusCode: "Status code",
  enabled: "Enabled",
  conditionKind: "Condition",
  cadence: "Cadence",
  condition: "Schedule",
  timeZone: "Time zone",
  effect: "Effect",
  executor: "Executor",
  nextRunAt: "Next run",
};

function triggerRow(id: string, name: string, enabled: boolean, statusLabel: string) {
  return {
    primaryKey: id,
    label: name,
    subtitle: `${name} description`,
    fieldLabels: triggerFieldLabels,
    fields: {
      triggerTitle: [name, "v1"],
      version: "v1",
      status: statusLabel,
      statusCode: enabled ? "PUBLISHED" : "PENDING_REVIEW",
      enabled,
      conditionKind: "Schedule",
      cadence: "Daily at 09:00",
      condition: "Daily at 09:00",
      timeZone: "UTC",
      effect: "Action · Approve expense",
      executor: "Default agent",
      nextRunAt: enabled ? "2026-11-25T01:00:00Z" : "",
    },
    tones: {
      status: enabled ? "success" : "default",
      enabled: enabled ? "success" : "info",
    },
  };
}

const sampleForm = {
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
  values: { name: "" },
  errors: [],
  save: { method: "POST", path: "/trigger/save", bodySchema: { type: "object" } },
};

const listOperations = {
  disable: {
    kind: "action",
    handlerRef: SET_TRIGGER_STATUS,
    effect: "write",
    batch: false,
    label: "Disable",
    target: { source: "row" },
    inputSchema: { type: "object" },
    resultSchema: { type: "object" },
  },
  publish: {
    kind: "action",
    handlerRef: SET_TRIGGER_STATUS,
    effect: "write",
    batch: false,
    label: "Publish",
    target: { source: "row" },
    inputSchema: { type: "object" },
    resultSchema: { type: "object" },
  },
  remove: {
    kind: "action",
    handlerRef: DELETE_TRIGGER,
    effect: "write",
    batch: false,
    label: "Delete",
    target: { source: "row" },
    inputSchema: { type: "object" },
    resultSchema: { type: "object" },
  },
};

const formOperations = {
  save: {
    kind: "form.save",
    handlerRef: `${TRIGGER}.save`,
    effect: "write",
    batch: false,
    label: "Save",
    target: { source: "input", input: "trigger" },
    inputSchema: { type: "object" },
    resultSchema: { type: "object" },
  },
};

async function flush(turns = 14) {
  for (let i = 0; i < turns; i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

function mountTriggersRoute(options: {
  initialState?: Record<string, unknown>;
  onRead: (body: DataReadRequest) => Response | Promise<Response>;
  onOperations?: (body: OpsReadRequest) => Response | Promise<Response>;
  onOperate?: (request: Sent) => Response | Promise<Response>;
}) {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [{ path: use.path, component: PanelApplicationRoute, props: { applicationId: appId } }],
  });
  const sent = installPlatform((request: Sent) => {
    const { path } = request;
    if (path === `/api/data-query/platform/applications/${appId}/panel-uses`) {
      return Response.json({
        data: { applicationId: appId, entry: { path: "/ontology", renderer: "panels" }, panelUses: [use] },
      });
    }
    if (path === `/api/product-panels/${triggersPanel.id}`) return panelAnswer(triggersPanel, request);
    if (path === `/api/product-panels/${triggersPanel.id}/snapshot`) {
      return panelSnapshot(triggersPanel, Object.fromEntries(projections), request);
    }
    if (path.startsWith("/api/product-projections/")) {
      return Response.json({ projection: projections.get(path.split("/").at(-1)!) });
    }
    if (path === "/api/product-panels/read") {
      const body = request.body as ProductPanelReadRequest;
      if ("operations" in body) {
        if (options.onOperations) return options.onOperations(body);
        const member = body.memberPath[0]?.member;
        if (member === "triggers") return Response.json({ status: "ready", value: listOperations });
        if (member === "createForm" || member === "editForm") return Response.json({ status: "ready", value: formOperations });
        return Response.json({ status: "ready", value: {} });
      }
      return options.onRead(body);
    }
    if (
      options.onOperate
      && (path === "/api/panel-operations/intents"
        || /^\/api\/panel-operation-intents\/[^/]+$/.test(path)
        || /^\/api\/panel-operations\/intents\/[^/]+\/dispatch$/.test(path))
    ) {
      return options.onOperate(request);
    }
    return nothingAt(request);
  }, router);

  return {
    router,
    sent,
    async open() {
      useApplicationCatalog().applications.value = [
        {
          id: appId,
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
      await router.push(panelAddress(use.path, options.initialState ?? {}, triggersPanel.manifest));
      const { element } = mountPlatformPage(() => h(RouterView), router);
      await flush();
      return element;
    },
  };
}

afterEach(() => {
  leaveFrame();
  useApplicationCatalog().applications.value = [];
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

describe("triggers builtin panel", () => {
  it("renders owner armed/total counts, table rows, and conditional inline row actions", async () => {
    const rows = [
      triggerRow("tr-1", "Nightly sync", true, "Published"),
      triggerRow("tr-2", "Monthly close", false, "Draft"),
    ];
    const route = mountTriggersRoute({
      onRead(body) {
        const member = body.memberPath[0]?.member;
        if (member === "armedStats") return Response.json({ status: "ready", value: { rows: [], total: 1 } });
        if (member === "totalStats") return Response.json({ status: "ready", value: { rows: [], total: 2 } });
        if (member === "triggers") return Response.json({ status: "ready", value: { rows, total: rows.length } });
        return Response.json({ status: "ready", value: sampleForm });
      },
    });

    const host = await route.open();
    await vi.waitFor(() => {
      expect(host.textContent).toContain("Armed");
      expect(host.textContent).toContain("Nightly sync");
    });
    expect(host.textContent).toContain("Triggers");
    const countValues = [...host.querySelectorAll(".sdk-object-count-value")].map((el) => el.textContent?.trim());
    expect(countValues).toEqual(["1", "2"]);

    const bodyRows = [...host.querySelectorAll(".sdk-object-list-table tbody tr")];
    expect(bodyRows).toHaveLength(2);

    const labelOf = (btn: Element) => btn.textContent?.trim() || btn.getAttribute("aria-label") || btn.getAttribute("title") || "";
    const row1Actions = [...bodyRows[0]!.querySelectorAll(".sdk-object-list-action-btn")].map(labelOf);
    const row2Actions = [...bodyRows[1]!.querySelectorAll(".sdk-object-list-action-btn")].map(labelOf);
    expect(row1Actions).toEqual(["Edit", "Disable", "Delete"]);
    expect(row2Actions).toEqual(["Edit", "Publish", "Delete"]);
  });

  it("distinguishes empty state from no-match search results while keeping the table header visible", async () => {
    const route = mountTriggersRoute({
      initialState: { search: "nonexistent" },
      onRead(body) {
        const member = body.memberPath[0]?.member;
        if (member === "armedStats" || member === "totalStats") {
          return Response.json({ status: "ready", value: { rows: [], total: 1 } });
        }
        return Response.json({ status: "ready", value: { rows: [], total: 0 } });
      },
    });

    const host = await route.open();
    await vi.waitFor(() => {
      expect(host.querySelector(".sdk-object-list-table thead")).not.toBeNull();
      expect(host.textContent).toContain("No matching triggers");
    });
    expect(host.textContent).not.toContain("No triggers in this domain yet");
  });

  it("opens the create and edit modals without polluting the URL and wires ObjectForm draft Save/Cancel", async () => {
    const formReads: DataReadRequest[] = [];
    const rows = [triggerRow("tr-1", "Nightly sync", true, "Published")];
    const route = mountTriggersRoute({
      onRead(body) {
        const member = body.memberPath[0]?.member;
        if (member === "armedStats" || member === "totalStats") {
          return Response.json({ status: "ready", value: { rows: [], total: 1 } });
        }
        if (member === "triggers") {
          return Response.json({ status: "ready", value: { rows, total: 1 } });
        }
        formReads.push(body);
        if (member === "editForm") {
          return Response.json({ status: "ready", value: { ...sampleForm, values: { name: "Nightly sync" } } });
        }
        return Response.json({ status: "ready", value: sampleForm });
      },
    });

    const host = await route.open();
    await vi.waitFor(() => {
      expect(host.textContent).toContain("Nightly sync");
    });

    // Open create modal via primary header button.
    const newButton = [...host.querySelectorAll("button")].find((btn) => btn.textContent?.includes("New trigger"));
    expect(newButton).toBeDefined();
    newButton!.click();
    await vi.waitFor(() => {
      expect(formReads.some((req) => req.memberPath[0]?.member === "createForm")).toBe(true);
    });

    expect(route.router.currentRoute.value.fullPath).toBe("/ontology/assets/triggers");
    const saveBtn = [...document.body.querySelectorAll("button")].find((btn) => btn.textContent?.trim() === "Save") as HTMLButtonElement | undefined;
    expect(saveBtn?.disabled).toBe(false);

    // Close create modal via Cancel button.
    const cancelBtn = [...document.body.querySelectorAll("button")].find((btn) => btn.textContent?.trim() === "Cancel") as HTMLButtonElement | undefined;
    expect(cancelBtn).toBeDefined();
    cancelBtn!.click();
    await vi.waitFor(() => {
      expect(document.body.querySelector(".el-dialog")).toBeNull();
    });

    // Open edit modal via inline row Edit action.
    const editBtn = host.querySelector<HTMLButtonElement>('[data-local-action="edit"]');
    expect(editBtn).not.toBeNull();
    editBtn!.click();
    await vi.waitFor(() => {
      expect(formReads.some((req) => req.memberPath[0]?.member === "editForm")).toBe(true);
    });

    expect(route.router.currentRoute.value.fullPath).toBe("/ontology/assets/triggers");
  });
});
