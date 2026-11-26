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
  CREATE_TRIGGER,
  DELETE_TRIGGER,
  RUN_NOW,
  SET_TRIGGER_ENABLED,
  SET_TRIGGER_STATUS,
  TRIGGER,
  platformObjectTypes,
} from "@ontomato/contracts/platform-object-types";
import { platformTypeTableEntrySchema } from "@ontomato/contracts/platform-type-table";
import { components } from "../../../../../packages/apps-sdk/src/catalogue";
import { useApplicationCatalog } from "../../../../../packages/platform-web/src/catalog";
import PanelApplicationRoute from "../../../../../packages/platform-web/src/pages/PanelApplicationRoute.vue";
import ontologyApp from "../../../../../packages/data-engine-core/src/main/resources/applications/ontology.json";
import source from "../../../../../packages/platform-schedules/resources/builtin-panels/schedules/panel.json";
import html from "../../../../../packages/platform-schedules/resources/builtin-panels/schedules/panel.html?raw";
import module from "../../../../../packages/platform-schedules/resources/builtin-panels/schedules/panel.mjs?raw";
import runDetailSource from "../../../../../packages/platform-schedules/resources/builtin-panels/scheduled-task-run-detail/panel.json";
import runDetailHtml from "../../../../../packages/platform-schedules/resources/builtin-panels/scheduled-task-run-detail/panel.html?raw";
import runDetailModule from "../../../../../packages/platform-schedules/resources/builtin-panels/scheduled-task-run-detail/panel.mjs?raw";
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
const ontologyTriggerUse = ontologyApp.declaration.panelUses.find((item) => item.id === "ontology-triggers")!;
const use = {
  ...panelUse(
    ontologyTriggerUse.id,
    ontologyTriggerUse.pageKey,
    ontologyTriggerUse.panelId,
    ontologyTriggerUse.path,
  ),
  inputs: ontologyTriggerUse.inputs,
};

const objectTypes = Object.fromEntries(
  Object.entries(platformObjectTypes).map(([type, entry]) => [
    type,
    platformTypeTableEntrySchema.parse({
      ...entry,
      operations: entry.operations?.map((id) => {
        const form = id === `${TRIGGER}.save` || id === CREATE_TRIGGER;
        return {
          id,
          kind: form ? "form.save" : "action",
          effect: "write",
          batch: false,
          inputSchema: {},
          target: form
            ? { source: "draft" }
            : { source: "input", input: type === "platform:Application" ? "application" : "task" },
        };
      }),
    }),
  ]),
);

const catalogue = components.map((component) =>
  appsSdkComponentCatalogEntrySchema.parse({
    ...component,
    ports: { props: [], events: [], slots: [] },
  }),
);
const projections = new Map<string, ProductProjection>();

function expandPanel(panelId: string, name: string, raw: { manifest: unknown; content?: { messages?: Record<string, Record<string, string>> } }, panelHtml: string, panelModule: string) {
  const { members: authoring, ...manifest } = panelAuthoringManifestSchema.parse(raw.manifest);
  const members = Object.fromEntries(
    Object.entries(authoring).map(([memberName, definition]) => {
      if (!("component" in definition)) return [memberName, definition];
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
        createdAt: "2026-11-26T00:00:00Z",
        updatedAt: "2026-11-26T00:00:00Z",
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
    content: { html: panelHtml, module: panelModule, messages: raw.content?.messages },
  };
}

const triggersPanel = expandPanel(use.panelId, "Task triggers", source, html, module);
const runDetailPanel = expandPanel("builtin-product-scheduled-task-run-detail", "Run detail", runDetailSource, runDetailHtml, runDetailModule);

type DataReadRequest = Extract<ProductPanelReadRequest, { dataName: string }>;

function triggerRow(
  id: string,
  title: string,
  opts: {
    targetKind: "application" | "action" | "workflow";
    targetName: string;
    status: "PENDING_REVIEW" | "PUBLISHED" | "UNUSED";
    enabled: boolean;
    version: number;
    revision: number;
    executorId: string;
    reviewedBy?: string;
    coauthorIds?: string;
    lastRun?: string;
  },
) {
  const statusLabels = {
    PENDING_REVIEW: "Pending review",
    PUBLISHED: "Published",
    UNUSED: "Unused",
  };
  return {
    primaryKey: id,
    label: title,
    fieldLabels: {
      executorId: "Executor",
      reviewedBy: "Reviewed by",
      coauthorIds: "Coauthors",
    },
    fields: {
      application: opts.targetKind === "application" ? "agents" : "",
      targetKind: opts.targetKind,
      targetId: opts.targetKind === "application" ? "agents" : `${opts.targetKind}-1`,
      targetName: opts.targetName,
      status: opts.status,
      definitionStatus: statusLabels[opts.status],
      version: opts.version,
      revision: opts.revision,
      executorId: opts.executorId,
      reviewedBy: opts.reviewedBy ?? "",
      coauthorIds: opts.coauthorIds ?? "",
      settings: `${opts.targetKind}: ${opts.targetName}`,
      frequency: "Daily 09:00",
      timeZone: "UTC",
      state: opts.enabled ? "on" : "off",
      stateLabel: opts.enabled ? "On" : "Off",
      enabled: opts.enabled,
      pauseCode: "",
      nextRun: opts.enabled ? "2026-11-27T09:00:00Z" : "",
      nextRunAt: opts.enabled ? "2026-11-27T09:00:00Z" : "",
      lastRun: opts.lastRun ?? "",
      lastRunStatus: opts.lastRun ?? "",
      lastRunSummary: "",
      latestResultPath: "",
    },
    tones: { state: opts.enabled ? ("success" as const) : ("info" as const) },
    outputs: {
      revision: opts.revision,
      definitionStatus: opts.status,
      targetKind: opts.targetKind,
      enabled: opts.enabled,
      paused: false,
      pauseCode: "",
      latestResultPath: "",
      isRunning: false,
    },
  };
}

const sampleForm = {
  fields: [
    { path: "/task/title", label: "Title", required: true, readOnly: false, control: { kind: "text" as const }, valueSchema: { type: "string" } },
    {
      path: "/task/targetKind",
      label: "Target kind",
      required: true,
      readOnly: false,
      refreshOnChange: true,
      control: {
        kind: "select" as const,
        options: [
          { value: "application", label: "Application", description: null, disabled: false, disabledReason: null },
          { value: "action", label: "Action", description: null, disabled: false, disabledReason: null },
          { value: "workflow", label: "Workflow", description: null, disabled: false, disabledReason: null },
        ],
      },
      valueSchema: { type: "string" },
    },
    {
      path: "/task/targetId",
      label: "Target",
      required: true,
      readOnly: false,
      control: {
        kind: "select" as const,
        options: [
          { value: "wf-1", label: "Approval workflow", description: "Starts case approval", disabled: false, disabledReason: null },
        ],
      },
      valueSchema: { type: "string" },
    },
    {
      path: "/task/executorId",
      label: "Executor",
      required: false,
      readOnly: false,
      control: { kind: "reference" as const, objectType: "platform:User", multiple: false },
      valueSchema: { type: ["string", "null"] },
    },
    {
      path: "/task/coauthorIds",
      label: "Coauthors",
      required: false,
      readOnly: false,
      control: { kind: "reference" as const, objectType: "platform:User", multiple: true },
      valueSchema: { type: "array", items: { type: "string" } },
    },
  ],
  sections: [],
  values: { task: { title: "", targetKind: "workflow", targetId: "wf-1", executorId: "alice", coauthorIds: ["bob"] } },
  errors: [],
  revision: 2,
  save: { method: "POST" as const, path: "/platform/triggers", bodySchema: { type: "object" } },
};

const cleanup: Array<() => void> = [];
afterEach(() => {
  while (cleanup.length) cleanup.pop()!();
  leaveFrame();
  useApplicationCatalog().applications.value = [];
});

function mountTriggersRoute(options: {
  initialState?: Record<string, unknown>;
  onRead: (body: DataReadRequest) => Response;
}) {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: "/", component: { render: () => h("div") } },
      { path: use.path, component: PanelApplicationRoute, props: { applicationId: appId, use } },
    ],
  });

  const sent: Sent[] = installPlatform((request) => {
    const { path } = request;
    if (path === `/api/data-query/platform/applications/${appId}/panel-uses`) {
      return Response.json({
        data: {
          applicationId: appId,
          entry: { entryKey: "ontology", path: "/ontology", renderer: "ontology" },
          panelUses: [use],
        },
      });
    }
    if (path === `/api/product-panels/${triggersPanel.id}`) return panelAnswer(triggersPanel, request);
    if (path === `/api/product-panels/${runDetailPanel.id}`) return panelAnswer(runDetailPanel, request);
    if (path === `/api/product-panels/${triggersPanel.id}/snapshot`)
      return panelSnapshot(triggersPanel, Object.fromEntries(projections), request);
    if (path === `/api/product-panels/${runDetailPanel.id}/snapshot`)
      return panelSnapshot(runDetailPanel, Object.fromEntries(projections), request);
    if (path.startsWith("/api/product-projections/")) {
      const projection = projections.get(path.split("/").at(-1)!);
      return projection ? Response.json({ projection }) : Response.json({ error: "missing" }, { status: 404 });
    }
    if (path === "/api/product-panels/read") {
      const body = request.body as ProductPanelReadRequest;
      if ("operations" in body) {
        const member = body.memberPath[0]?.member;
        if (member === "tasks") {
          return Response.json({
            status: "ready",
            value: {
              setEnabled: { kind: "action", handlerRef: SET_TRIGGER_ENABLED, effect: "write", batch: false, label: "Enable", target: { source: "row" }, inputSchema: {}, resultSchema: {} },
              publish: { kind: "action", handlerRef: SET_TRIGGER_STATUS, effect: "write", batch: false, label: "Publish", target: { source: "row" }, inputSchema: {}, resultSchema: {} },
              unuse: { kind: "action", handlerRef: SET_TRIGGER_STATUS, effect: "write", batch: false, label: "Mark unused", target: { source: "row" }, inputSchema: {}, resultSchema: {} },
              runNow: { kind: "action", handlerRef: RUN_NOW, effect: "write", batch: false, label: "Run now", target: { source: "row" }, inputSchema: {}, resultSchema: {} },
              delete: { kind: "action", handlerRef: DELETE_TRIGGER, effect: "write", batch: false, label: "Delete", target: { source: "row" }, inputSchema: {}, resultSchema: {} },
            },
          });
        }
        if (member === "newForm") {
          return Response.json({
            status: "ready",
            value: { create: { kind: "form.save", handlerRef: CREATE_TRIGGER, effect: "write", batch: false, label: "Save", target: { source: "draft" }, inputSchema: {}, resultSchema: {} } },
          });
        }
        if (member === "editForm") {
          return Response.json({
            status: "ready",
            value: { save: { kind: "form.save", handlerRef: `${TRIGGER}.save`, effect: "write", batch: false, label: "Save", target: { source: "draft" }, inputSchema: {}, resultSchema: {} } },
          });
        }
        return Response.json({ status: "ready", value: {} });
      }
      return options.onRead(body);
    }
    if (path === "/api/panel-operations/intents") {
      return Response.json({ intentId: "intent-1", operationId: (request.body as { operationId: string }).operationId, label: "Publish", confirmation: { kind: "none" } });
    }
    if (path === "/api/panel-operations/intents/intent-1/dispatch") {
      return Response.json({
        kind: "dispatched",
        intentId: "intent-1",
        outcome: { kind: "success", data: { id: "tr-2", status: "PUBLISHED", enabled: true, pause: null }, affected: { objects: [], objectTypes: [TRIGGER] } },
      });
    }
    return nothingAt(request);
  }, router);

  useApplicationCatalog().applications.value = [
    {
      id: appId,
      kind: "native",
      rail: "apps",
      category: "build",
      sort: 10,
      entry: { entryKey: "ontology", path: "/ontology", renderer: "ontology" },
      scheduleAdapter: null,
      allowStandalone: false,
      declaration: {
        names: { en: "Ontology manager" },
        descriptions: { en: "Ontology" },
        icon: "ontology",
        groups: [],
      },
      panelUses: [use],
    },
  ];

  const targetAddress = options.initialState ? panelAddress(use.path, options.initialState, triggersPanel.manifest) : use.path;
  return {
    sent,
    router,
    async open() {
      await router.push(targetAddress);
      const { app, element } = mountPlatformPage(() => h(RouterView), router);
      cleanup.push(() => app.unmount());
      return element;
    },
  };
}

describe("ontology triggers entry (shared builtin-product-scheduled-tasks panel)", () => {
  it("declares the 8-language Task triggers entry without java:ontology scheduleAdapter", () => {
    expect(ontologyApp.scheduleAdapter).toBeNull();
    expect(ontologyTriggerUse.panelId).toBe("builtin-product-scheduled-tasks");
    expect(ontologyTriggerUse.names).toEqual({
      en: "Task triggers",
      "zh-CN": "任务触发",
      "zh-TW": "任務觸發",
      ja: "タスクトリガー",
      ar: "مشغّلات المهام",
      fr: "Déclencheurs de tâches",
      de: "Aufgabenauslöser",
      it: "Trigger delle attività",
    });
  });

  it("renders multi-target triggers with governance metadata, workflow-started status, and Publish action", async () => {
    const rows = [
      triggerRow("tr-1", "Approval dispatch", {
        targetKind: "workflow",
        targetName: "Approval workflow",
        status: "PUBLISHED",
        enabled: true,
        version: 3,
        revision: 4,
        executorId: "alice",
        reviewedBy: "admin",
        coauthorIds: "bob",
        lastRun: "completed",
      }),
      triggerRow("tr-2", "Pending nightly action", {
        targetKind: "action",
        targetName: "Sync ledger",
        status: "PENDING_REVIEW",
        enabled: false,
        version: 1,
        revision: 2,
        executorId: "carol",
      }),
    ];

    const route = mountTriggersRoute({
      onRead(body) {
        const member = body.memberPath[0]?.member;
        if (member === "pageNotice") return Response.json({ status: "ready", value: { primaryKey: "s", label: "Task triggers", fields: {}, outputs: { hasCredentialPaused: false, credentialStatus: "valid" } } });
        if (member === "appFilter") return Response.json({ status: "ready", value: [{ key: "", label: "All", count: 2 }, { key: "workflow", label: "Workflow", count: 1 }, { key: "action", label: "Action", count: 1 }] });
        if (member === "tasks") return Response.json({ status: "ready", value: rows });
        return Response.json({ status: "ready", value: rows[0] });
      },
    });

    const host = await route.open();
    await vi.waitFor(() => {
      expect(host.querySelectorAll(".sdk-sts-card")).toHaveLength(2);
    });

    expect(host.textContent).toContain("Task triggers");
    const cards = [...host.querySelectorAll<HTMLElement>(".sdk-sts-card")];
    // Published workflow card: shows version, reviewer, executor, coauthors, switch, and "Workflow started" instead of "Completed".
    expect(cards[0]!.textContent).toContain("Approval workflow");
    expect(cards[0]!.textContent).toContain("Published · v3");
    expect(cards[0]!.textContent).toContain("Executor: alice");
    expect(cards[0]!.textContent).toContain("Reviewed by: admin");
    expect(cards[0]!.textContent).toContain("Coauthors: bob");
    expect(cards[0]!.textContent).toContain("Workflow started");
    expect(cards[0]!.querySelector(".el-switch")).not.toBeNull();

    // Pending review card: hides enabled switch and offers Publish operation with status/enabled/revision.
    expect(cards[1]!.textContent).toContain("Pending review · v1");
    expect(cards[1]!.querySelector(".el-switch")).toBeNull();
    const publishBtn = cards[1]!.querySelector<HTMLButtonElement>('[data-operation="publish"]');
    expect(publishBtn).not.toBeNull();
    publishBtn!.click();
    await vi.waitFor(() => expect(route.sent).toContainEqual(expect.objectContaining({
      path: "/api/panel-operations/intents",
      body: {
        applicationId: appId,
        useId: use.id,
        operationId: "tasks.publish",
        call: {
          target: { kind: "object", objectType: TRIGGER, primaryKey: "tr-2" },
          input: { status: "PUBLISHED", enabled: true, revision: 2 },
        },
      },
    })));
  });

  it("opens create and edit dialogs without polluting the URL and mounts member reference pickers", async () => {
    const formReads: DataReadRequest[] = [];
    const rows = [
      triggerRow("tr-1", "Approval dispatch", {
        targetKind: "workflow",
        targetName: "Approval workflow",
        status: "PUBLISHED",
        enabled: true,
        version: 1,
        revision: 2,
        executorId: "alice",
      }),
    ];
    const route = mountTriggersRoute({
      onRead(body) {
        const member = body.memberPath[0]?.member;
        if (member === "pageNotice") return Response.json({ status: "ready", value: { primaryKey: "s", label: "Task triggers", fields: {}, outputs: { hasCredentialPaused: false, credentialStatus: "valid" } } });
        if (member === "appFilter") return Response.json({ status: "ready", value: [{ key: "", label: "All", count: 1 }] });
        if (member === "tasks") return Response.json({ status: "ready", value: rows });
        if (member === "executorPicker" || member === "coauthorsPicker") {
          return Response.json({ status: "ready", value: { options: [{ primaryKey: "alice", value: "alice", label: "Alice" }, { primaryKey: "bob", value: "bob", label: "Bob" }] } });
        }
        if (member === "newForm" || member === "editForm") {
          formReads.push(body);
          return Response.json({ status: "ready", value: sampleForm });
        }
        return Response.json({ status: "ready", value: rows[0] });
      },
    });

    const host = await route.open();
    await vi.waitFor(() => expect(host.textContent).toContain("Approval dispatch"));

    const newButton = host.querySelector<HTMLButtonElement>('[data-action="new-task"]');
    expect(newButton).not.toBeNull();
    newButton!.click();
    await vi.waitFor(() => {
      expect(formReads.some((req) => req.memberPath[0]?.member === "newForm")).toBe(true);
    });
    expect(route.router.currentRoute.value.fullPath).toBe("/ontology/assets/triggers");

    const cancelBtn = await vi.waitFor(() => {
      const btn = [...document.body.querySelectorAll<HTMLButtonElement>('[data-form="create"] button')].find((b) => b.textContent?.trim() === "Cancel");
      expect(btn).toBeDefined();
      return btn!;
    });
    cancelBtn.click();
    await vi.waitFor(() => expect(document.body.querySelector('[data-form="create"]')).toBeNull());

    // Open edit dialog via row Edit action.
    const editBtn = await vi.waitFor(() => {
      const btn = host.querySelector<HTMLButtonElement>('[data-local-action="edit"]');
      expect(btn).not.toBeNull();
      return btn!;
    });
    editBtn.click();
    await vi.waitFor(() => {
      expect(formReads.some((req) => req.memberPath[0]?.member === "editForm")).toBe(true);
    });
    expect(document.body.querySelector('[data-form="edit"]')).not.toBeNull();
  });
});
