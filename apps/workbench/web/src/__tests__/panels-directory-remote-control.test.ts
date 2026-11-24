import { afterEach, describe, expect, it, vi } from "vitest";
import { defineComponent, h } from "vue";
import { createMemoryHistory, createRouter } from "vue-router";
import type { PresentationFrame } from "@ontomato/contracts/agent-presentation";
import { appsSdkComponentCatalogEntrySchema } from "@ontomato/contracts/apps-sdk";
import { expandPanelAuthoringMember } from "@ontomato/contracts/panel-authoring-expansion";
import { panelAuthoringManifestSchema } from "@ontomato/contracts/panel-authoring";
import { definePanel, type PanelOperationCall } from "@ontomato/contracts/panel-manifest";
import type { ProductPanelReadRequest } from "@ontomato/contracts/panel-host";
import type { ProductProjection } from "@ontomato/contracts/product-panels";
import { PRODUCT_PANEL, PRODUCT_PROJECTION, platformObjectTypes } from "@ontomato/contracts/platform-object-types";
import { platformTypeTableEntrySchema } from "@ontomato/contracts/platform-type-table";
import { useConversationDisplay } from "../../../../../packages/agent-shell-ui/src/conversation-display";
import { components } from "../../../../../packages/apps-sdk/src/catalogue";
import { useApplicationCatalog } from "../../../../../packages/platform-web/src/catalog";
import PanelApplicationRoute from "../../../../../packages/platform-web/src/pages/PanelApplicationRoute.vue";
import source from "../../../../../packages/ontology-manager/resources/builtin-panels/panels/panel.json";
import html from "../../../../../packages/ontology-manager/resources/builtin-panels/panels/panel.html?raw";
import module from "../../../../../packages/ontology-manager/resources/builtin-panels/panels/panel.mjs?raw";
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

const SESSION = "11111111-1111-4111-8111-111111111111";
const RUN = "22222222-2222-4222-8222-222222222222";
const APP_ID = "ontology";
const ENTRY_PATH = "/ontology/panels";

const use = panelUse(
  "use-ontology-panels",
  "ontology-panels",
  "builtin-product-ontology-panels",
  ENTRY_PATH,
);

const objectTypes = Object.fromEntries(
  Object.entries(platformObjectTypes).map(([type, entry]) => [
    type,
    platformTypeTableEntrySchema.parse({
      ...entry,
      operations: entry.operations?.map((id) => {
        const form = id.endsWith(".save") || id.endsWith(".create");
        return {
          id,
          kind: form ? "form.save" : "action",
          effect: "write",
          batch: false,
          inputSchema: {},
          target: form ? { source: "draft" } : { source: "input", input: "target" },
        };
      }),
    }),
  ]),
);

const { members: authoring, ...manifest } = panelAuthoringManifestSchema.parse(source.manifest);
const catalogue = components.map((component) =>
  appsSdkComponentCatalogEntrySchema.parse({
    ...component,
    ...(component.componentId === "FileUploadControl" || component.componentId === "OperationButton"
      ? { config: [{ name: "operation", type: "string", required: true, description: "Operation local name" }] }
      : {}),
    ports: { props: [], events: [], slots: [] },
  }),
);
const projections = new Map<string, ProductProjection>();
const members = Object.fromEntries(
  Object.entries(authoring).map(([name, definition]) => {
    if (!("component" in definition)) {
      return [name, definition];
    }
    const { projection, placement } = expandPanelAuthoringMember(name, definition, {
      state: manifest.state,
      typeTable: { objectTypes },
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
      createdAt: "2026-11-23T00:00:00Z",
      updatedAt: "2026-11-23T00:00:00Z",
    });
    return [name, { ...placement, target: { projectionId: definition.id! } }];
  }),
);

const panelsDirectoryPanel = {
  ...panelRecord(use.panelId, "Panels", definePanel({ ...manifest, members })),
  visibility: "platform" as const,
  domainId: null,
  ownerId: null,
  editable: false as const,
  content: { html, module, messages: source.content.messages },
};

const panelRef = (primaryKey: string) => ({ className: PRODUCT_PANEL, primaryKey });

function presentFrame(state: Record<string, unknown>, address = ENTRY_PATH): PresentationFrame {
  return {
    type: "presentation",
    sessionId: SESSION,
    runId: RUN,
    toolCallId: `call-${Math.random()}`,
    target: {
      kind: "page",
      address,
      state: state as PresentationFrame["target"] extends { state?: infer S } ? S : never,
    },
  };
}

type DataReadRequest = Extract<ProductPanelReadRequest, { dataName: string }>;

function readTargetKey(req: DataReadRequest): string {
  for (const value of Object.values(req.inputs ?? {})) {
    if (value && typeof value === "object" && "primaryKey" in value && typeof value.primaryKey === "string") {
      return value.primaryKey;
    }
  }
  return "";
}

function formDescription(mode: "create" | "edit", key: string, includeMembersField = false) {
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
      ...(includeMembersField
        ? [
            {
              path: "/manifest/members",
              label: "Members",
              required: true,
              readOnly: false,
              control: { kind: "code", language: "json" },
              valueSchema: { type: "object" },
            },
          ]
        : []),
    ],
    values: {
      name: mode === "create" ? "" : `Panel ${key}`,
      ...(includeMembersField
        ? {
            manifest: {
              members: {
                existing: { target: { projectionId: "proj-0" } },
              },
            },
          }
        : {}),
    },
    errors: [],
    save: {
      method: mode === "create" ? "POST" : "PUT",
      path: `/api/product-panels/${key || "new"}`,
      bodySchema: {},
    },
  };
}

async function waitFor(check: () => boolean, label: string | (() => string)): Promise<void> {
  for (let i = 0; i < 80; i += 1) {
    if (check()) return;
    await new Promise((resolve) => setTimeout(resolve, 15));
  }
  const desc = typeof label === "function" ? label() : label;
  throw new Error(`Timed out waiting for: ${desc}`);
}

async function clickMessageBoxButton(labelText: string): Promise<HTMLElement> {
  let box: HTMLElement | undefined;
  await waitFor(() => {
    const open = [...document.querySelectorAll<HTMLElement>(".el-message-box")].filter(
      (item) => item.closest<HTMLElement>(".el-overlay")?.style.display !== "none",
    );
    box = open.at(-1);
    return Boolean(box);
  }, `message box containing "${labelText}"`);
  const btn = [...box!.querySelectorAll<HTMLButtonElement>("button")].find(
    (button) => button.textContent?.trim() === labelText,
  );
  if (!btn) {
    throw new Error(`Message box button "${labelText}" not found. Buttons: ${[...box!.querySelectorAll("button")].map((b) => b.textContent?.trim()).join(", ")}`);
  }
  btn.click();
  await waitFor(
    () => box!.closest<HTMLElement>(".el-overlay")?.style.display === "none" || !document.body.contains(box!),
    `message box close after "${labelText}"`,
  );
  return box!;
}

interface HarnessOptions {
  unavailableRows?: () => Record<string, unknown>[];
  recordFor?: (key: string) => Record<string, unknown>;
  includeMembersField?: boolean;
  memberRowsFor?: (key: string) => Record<string, unknown>[];
  projectionRecordFor?: (key: string) => Record<string, unknown>;
  operationsFor?: (member: string, inputs: Record<string, unknown>) => Record<string, unknown>;
  prepareIntent?: (body: { operationId: string; call: PanelOperationCall }) => Record<string, unknown>;
  dispatchIntent?: (operationId: string, call: PanelOperationCall) => Record<string, unknown>;
  nestedPanel?: (panelId: string, request: Sent) => Response | undefined;
}

async function mountDirectory(options: HarnessOptions = {}) {
  const reads: DataReadRequest[] = [];
  const navigated: string[] = [];
  const dispatched: { operationId: string; call: PanelOperationCall }[] = [];
  const preparedIntents = new Map<string, { preparation: Record<string, unknown>; operationId: string; call: PanelOperationCall }>();
  let intentCounter = 0;

  installPlatform((request: Sent) => {
    const { path } = request;
    if (path === `/api/data-query/platform/applications/${APP_ID}/panel-uses`) {
      return Response.json({
        data: { applicationId: APP_ID, entry: { path: "/ontology", renderer: "panels" }, panelUses: [use] },
      });
    }
    if (path === `/api/product-panels/${panelsDirectoryPanel.id}`) {
      return panelAnswer(panelsDirectoryPanel, request);
    }
    if (path === `/api/product-panels/${panelsDirectoryPanel.id}/snapshot`) {
      return panelSnapshot(panelsDirectoryPanel, Object.fromEntries(projections), request);
    }
    const nestedMatch = /^\/api\/product-panels\/([^/]+)(\/snapshot)?$/.exec(path);
    if (request.method === "GET" && nestedMatch && nestedMatch[1] !== panelsDirectoryPanel.id && options.nestedPanel) {
      const answered = options.nestedPanel(nestedMatch[1]!, request);
      if (answered) return answered;
    }
    if (path.startsWith("/api/product-projections/")) {
      return Response.json({ projection: projections.get(path.split("/").at(-1)!) });
    }
    if (path === "/api/panel-operations/intents" && request.method === "POST") {
      const body = request.body as { operationId: string; call: PanelOperationCall };
      const intentId = `00000000-0000-4000-8000-${String(++intentCounter).padStart(12, "0")}`;
      const preparation = options.prepareIntent
        ? { intentId, ...options.prepareIntent(body) }
        : { intentId, operationId: body.operationId, label: body.operationId, confirmation: { kind: "none" as const } };
      preparedIntents.set(intentId, { preparation, operationId: body.operationId, call: body.call });
      return Response.json(preparation);
    }
    const intentRead = /^\/api\/panel-operation-intents\/([^/?]+)$/.exec(path);
    if (intentRead && request.method === "GET") {
      return Response.json(preparedIntents.get(intentRead[1]!)?.preparation ?? {});
    }
    const intentDispatch = /^\/api\/panel-operations\/intents\/([^/]+)\/dispatch$/.exec(path);
    if (intentDispatch && request.method === "POST") {
      const entry = preparedIntents.get(intentDispatch[1]!)!;
      dispatched.push({ operationId: entry.operationId, call: entry.call });
      const outcome = options.dispatchIntent
        ? options.dispatchIntent(entry.operationId, entry.call)
        : { kind: "success", data: {} };
      return Response.json({ kind: "dispatched", intentId: intentDispatch[1], outcome });
    }
    if (path === "/api/product-panels/read") {
      const body = request.body as ProductPanelReadRequest;
      if ("operations" in body) {
        const member = body.memberPath.at(-1)?.member ?? "";
        const inputs = (body.inputs ?? {}) as Record<string, unknown>;
        const custom = options.operationsFor ? options.operationsFor(member, inputs) : undefined;
        if (custom && Object.keys(custom).length > 0) {
          return Response.json({ status: "ready", value: custom });
        }
        if (member === "form") {
          return Response.json({
            status: "ready",
            value: {
              save: {
                kind: "form.save",
                handlerRef: "platform:ProductPanel.save",
                label: "Save",
                effect: "write",
                batch: false,
                target: { source: "draft", slot: "form" },
                inputSchema: {},
                resultSchema: {},
              },
            },
          });
        }
        return Response.json({ status: "ready", value: custom ?? {} });
      }
      reads.push(body);
      const member = body.memberPath[0]?.member;
      if (member === "catalogue" || member === "memberPanelPicker") {
        return Response.json({
          status: "ready",
          value: {
            rows: [
              {
                primaryKey: "panel-a",
                className: PRODUCT_PANEL,
                label: "Panel A",
                subtitle: "panel-a",
                fields: { owner: "Alice", visibility: "Private", template: "No", updatedAt: "2026-11-23T00:00:00Z" },
              },
              {
                primaryKey: "panel-b",
                className: PRODUCT_PANEL,
                label: "Panel B",
                subtitle: "panel-b",
                fields: { owner: "Alice", visibility: "Private", template: "No", updatedAt: "2026-11-23T00:00:00Z" },
              },
            ],
            total: 2,
          },
        });
      }
      if (member === "unavailableList") {
        return Response.json({
          status: "ready",
          value: options.unavailableRows ? options.unavailableRows() : [],
        });
      }
      if (member === "memberProjectionPicker") {
        return Response.json({
          status: "ready",
          value: {
            rows: [
              {
                primaryKey: "proj-1",
                className: PRODUCT_PROJECTION,
                label: "Summary Projection",
                subtitle: "Displays order summary",
                fields: { id: "proj-1", component: "ObjectSummary" },
              },
            ],
            total: 1,
          },
        });
      }
      if (member === "headerTitle" || member === "overviewSummary" || member === "unavailableSummary" || member === "shareStatusDesc") {
        const key = readTargetKey(body);
        if (!key) return Response.json({ status: "empty" });
        if (options.recordFor) {
          return Response.json({ status: "ready", value: options.recordFor(key) });
        }
        return Response.json({
          status: "ready",
          value: {
            primaryKey: key,
            className: PRODUCT_PANEL,
            label: key === "panel-b" ? "Panel B" : "Panel A",
            subtitle: key,
            fields: { id: key, name: key === "panel-b" ? "Panel B" : "Panel A", objectType: PRODUCT_PANEL },
            fieldLabels: { id: "ID", name: "Name", objectType: "Object type" },
            outputs: {
              canEdit: true,
              canGrant: false,
              canDelete: true,
              isBuiltin: false,
              isTemplate: false,
              domainShared: false,
              revision: 1,
              hiddenUsedByCount: 0,
              unavailable: false,
              unavailableReason: "",
            },
          },
        });
      }
      if (member === "membersList") {
        const key = readTargetKey(body);
        return Response.json({
          status: "ready",
          value: options.memberRowsFor ? options.memberRowsFor(key) : [],
        });
      }
      if (member === "memberProjectionHeader" || member === "memberProjectionSummary") {
        const key = readTargetKey(body);
        if (!key) return Response.json({ status: "empty" });
        return Response.json({
          status: "ready",
          value: options.projectionRecordFor
            ? options.projectionRecordFor(key)
            : {
                primaryKey: key,
                className: PRODUCT_PROJECTION,
                label: "Summary Projection",
                subtitle: "Displays order summary",
                fields: {
                  id: key,
                  component: "ObjectSummary",
                  owner: "Alice",
                  projectionKind: "Standard",
                  scope: "Private",
                  access: "Editable",
                  revision: 2,
                  updatedAt: "2026-11-23T00:00:00Z",
                },
                fieldLabels: {
                  id: "ID",
                  component: "Component",
                  owner: "Owner",
                  projectionKind: "Kind",
                  scope: "Scope",
                  access: "Access",
                  revision: "Revision",
                  updatedAt: "Updated",
                },
              },
        });
      }
      if (member === "sourceViewer") {
        return Response.json({ status: "empty" });
      }
      if (member === "usedByList" || member === "grantsList" || member === "sourceTree") {
        return Response.json({ status: "ready", value: [] });
      }
      if (member === "form") {
        const key = readTargetKey(body);
        if (body.dataName === "createForm") {
          return Response.json({ status: "ready", value: formDescription("create", "", options.includeMembersField) });
        }
        return Response.json({
          status: "ready",
          value: formDescription("edit", key, options.includeMembersField),
        });
      }
      return Response.json({ status: "ready", value: { rows: [], total: 0 } });
    }
    return nothingAt(request);
  });

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

  type ObservedContext = {
    state?: Record<string, unknown> & {
      selected?: { primaryKey?: string } | null;
      previewTarget?: { primaryKey?: string } | null;
    };
    forms?: readonly { member: string; dirty: boolean; values: Record<string, unknown> }[];
  } | null;
  const observed = { context: null as ObservedContext };
  const display = useConversationDisplay({
    features: () => [{ id: "panel", label: "Panels", icon: "pages", availability: "page", withConversation: true }],
    resolve: (address) => {
      const path = address.split("?")[0]!;
      return path === ENTRY_PATH ? { featureId: "panel", address, instance: path } : null;
    },
    serialize: async () => true,
    context: (page, reported) => ({
      url: page.address,
      label: reported?.label || "Panels",
      selection: reported?.selection ?? [],
      ...(reported?.state ? { state: reported.state } : {}),
    }),
    leave: { leaves: () => false, confirm: async () => true },
  });
  display.placed(() => "side");

  await display.present({
    type: "presentation",
    sessionId: SESSION,
    runId: RUN,
    toolCallId: "open-initial",
    target: { kind: "page", address: ENTRY_PATH },
  });

  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: "/chat", component: { template: "<div />" } },
      { path: "/ontology/projections", name: "projections", component: { template: "<div />" } },
      { path: "/ontology/applications", name: "applications", component: { template: "<div />" } },
    ],
  });
  await router.push("/chat");

  const Host = defineComponent({
    setup() {
      return () =>
        display.page.value
          ? h(PanelApplicationRoute, {
              applicationId: APP_ID,
              address: display.page.value.address,
              navigate: (address: string) => {
                navigated.push(address);
                void display.navigate(address, { view: "side", history: "push" });
              },
              liveState: display.liveState.value,
              registerPageController: (controller: unknown) =>
                display.registerPageController(display.page.value!.instance, controller as never),
              onDisplayAddress: display.address,
              onDisplayLoaded: display.loaded,
              onContext: (reported: ObservedContext) => {
                observed.context = reported;
                display.context(reported as never);
              },
            })
          : null;
    },
  });

  const mounted = mountPlatformPage(() => h(Host), router);
  await waitFor(
    () => mounted.element.textContent?.includes("Panel A") === true && mounted.element.textContent?.includes("Panel B") === true,
    "initial panel list",
  );

  return { mounted, display, observed, reads, navigated, dispatched };
}

afterEach(() => {
  leaveFrame();
  useApplicationCatalog().applications.value = [];
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

describe("panels builtin directory", () => {
  it("lands directly on panel B's edit form in one present call without leaking detailMode to URL, exposes 100 page size, resets on human click, and creates with selected cleared", async () => {
    const { mounted, display, observed, reads } = await mountDirectory();
    try {
      // Unavailable section is collapsed when there are no unavailable panels.
      const unavailableSection = mounted.element.querySelector<HTMLElement>(".pd-unavailable-section");
      expect(unavailableSection?.style.display).toBe("none");

      // Pagination page sizes include 20, 50, and 100.
      const pageSizeOptions = [...mounted.element.querySelectorAll<HTMLOptionElement>(".sdk-object-list-page-size option")].map((o) =>
        Number(o.value),
      );
      expect(pageSizeOptions).toEqual([20, 50, 100]);

      // 1. Agent asks to select Panel B and enter edit mode in a single present call.
      reads.length = 0;
      const editReceipt = await display.present(presentFrame({ selected: panelRef("panel-b"), detailMode: "edit" }));
      expect(editReceipt).toMatchObject({ status: "opened" });

      await waitFor(
        () => reads.some((r) => r.memberPath[0]?.member === "form" && r.dataName === "form" && readTargetKey(r) === "panel-b"),
        "panel-b edit form read",
      );
      await waitFor(
        () => (mounted.element.querySelector(".pd-form-wrap input") as HTMLInputElement | null)?.value === "Panel panel-b",
        "panel-b edit form input value",
      );

      expect(observed.context?.state?.selected).toEqual(panelRef("panel-b"));
      expect(observed.context?.state?.detailMode).toBe("edit");
      // detailMode must not be persisted into the URL address.
      expect(display.page.value?.address).not.toContain("detailMode");

      // 2. Human clicks Panel A in the catalogue list -> leaves edit mode back to view mode.
      const panelARow = [...mounted.element.querySelectorAll("tr")].find((row) => row.textContent?.includes("Panel A"));
      expect(panelARow).toBeTruthy();
      panelARow!.dispatchEvent(new MouseEvent("click", { bubbles: true }));

      await waitFor(
        () => !mounted.element.querySelector(".pd-form-wrap") && observed.context?.state?.detailMode === "view",
        "human row click exits edit mode to view",
      );
      expect(observed.context?.state?.selected).toEqual(panelRef("panel-a"));

      // 3. While Panel A is selected in view mode, a single present call selects Panel B and enters edit mode.
      reads.length = 0;
      const switchEditReceipt = await display.present(
        presentFrame({ selected: panelRef("panel-b"), detailMode: "edit" }, display.page.value!.address),
      );
      expect(switchEditReceipt).toMatchObject({ status: "opened" });
      await waitFor(
        () => reads.some((r) => r.memberPath[0]?.member === "form" && r.dataName === "form" && readTargetKey(r) === "panel-b"),
        "panel-a -> panel-b direct edit form read",
      );
      await waitFor(
        () => (mounted.element.querySelector(".pd-form-wrap input") as HTMLInputElement | null)?.value === "Panel panel-b",
        "panel-a -> panel-b edit form input value",
      );
      expect(observed.context?.state?.selected).toEqual(panelRef("panel-b"));
      expect(observed.context?.state?.detailMode).toBe("edit");

      // 4. Agent follows create recipe (`selected: null, creating: true`) while Panel B is selected.
      reads.length = 0;
      const createReceipt = await display.present(
        presentFrame({ selected: null, creating: true }, display.page.value!.address),
      );
      expect(createReceipt).toMatchObject({ status: "opened" });

      await waitFor(
        () => reads.some((r) => r.memberPath[0]?.member === "form" && r.dataName === "createForm" && readTargetKey(r) === ""),
        "createForm read with cleared selection",
      );
      expect(observed.context?.state?.selected ?? null).toBeNull();
      expect(observed.context?.state?.creating).toBe(true);
      expect(reads.some((r) => r.memberPath[0]?.member === "form" && r.dataName === "form")).toBe(false);
    } finally {
      mounted.app.unmount();
    }
  });

  it("displays clickable unavailable panels, shows diagnostic summary on the right, and confirms deletion via owner inspectImpact", async () => {
    let brokenPresent = true;
    const { mounted, observed, dispatched } = await mountDirectory({
      unavailableRows: () =>
        brokenPresent
          ? [
              {
                primaryKey: "broken-panel",
                className: PRODUCT_PANEL,
                label: "broken-panel",
                subtitle: "manifest.members.bad: Invalid reference",
                fields: {
                  id: "broken-panel",
                  reason: "manifest.members.bad: Invalid reference",
                  revision: 3,
                  canDelete: true,
                },
                fieldLabels: { id: "ID", reason: "Reason", revision: "Revision", canDelete: "Can delete" },
                tones: { reason: "danger" },
              },
            ]
          : [],
      recordFor: (key) => {
        if (key === "broken-panel") {
          return {
            primaryKey: "broken-panel",
            className: PRODUCT_PANEL,
            label: "broken-panel",
            subtitle: "manifest.members.bad: Invalid reference",
            fields: {
              id: "broken-panel",
              unavailableReason: "manifest.members.bad: Invalid reference",
              revision: 3,
              objectType: PRODUCT_PANEL,
            },
            fieldLabels: {
              id: "ID",
              unavailableReason: "Unavailable reason",
              revision: "Revision",
              objectType: "Object type",
            },
            tones: { unavailableReason: "danger" },
            outputs: {
              unavailable: true,
              unavailableReason: "manifest.members.bad: Invalid reference",
              revision: 3,
              canEdit: false,
              canGrant: false,
              canDelete: true,
              isBuiltin: false,
              isTemplate: false,
              domainShared: false,
              hiddenUsedByCount: 0,
            },
          };
        }
        return {
          primaryKey: key,
          className: PRODUCT_PANEL,
          label: `Panel ${key}`,
          fields: { id: key, name: `Panel ${key}` },
          outputs: {
            canEdit: true,
            canGrant: false,
            canDelete: true,
            isBuiltin: false,
            isTemplate: false,
            domainShared: false,
            revision: 1,
            hiddenUsedByCount: 0,
            unavailable: false,
            unavailableReason: "",
          },
        };
      },
      operationsFor: (member, inputs) => {
        if (member === "deletePanel" && inputs.target) {
          return {
            delete: {
              kind: "action",
              handlerRef: "productPanels.delete",
              label: "Delete",
              effect: "write",
              batch: false,
              inspectImpact: { handlerRef: "productPanels.delete" },
              target: { source: "input", input: "target" },
              inputSchema: { type: "object", properties: { revision: { type: "number" } } },
              resultSchema: {},
            },
          };
        }
        return {};
      },
      prepareIntent: ({ operationId, call }) => {
        const key = (call.target as { primaryKey: string }).primaryKey;
        return {
          operationId,
          label: "Delete panel",
          confirmation: {
            kind: "impact" as const,
            impact: {
              summary: `Delete ${key}? Unused projections will also be removed.`,
              total: 1,
              objects: [{ target: { objectType: PRODUCT_PANEL, primaryKey: key }, label: key }],
            },
          },
        };
      },
      dispatchIntent: () => {
        brokenPresent = false;
        return { kind: "success", data: { deletedProjectionIds: [], retainedProjectionIdsWithoutEdit: [] } };
      },
    });

    try {
      const unavailableSection = mounted.element.querySelector<HTMLElement>(".pd-unavailable-section");
      await waitFor(
        () => unavailableSection?.style.display !== "none" && unavailableSection?.textContent?.includes("broken-panel") === true,
        "unavailable panel list visible",
      );

      // Click the broken panel row.
      const brokenButton = unavailableSection!.querySelector<HTMLButtonElement>("button.sdk-object-list-item-btn");
      expect(brokenButton).toBeTruthy();
      brokenButton!.click();

      // Right pane renders diagnostic view with reason, no edit/tabs, and exposes delete button.
      await waitFor(
        () =>
          mounted.element.querySelector(".pd-unavailable-detail")?.textContent?.includes("manifest.members.bad: Invalid reference") === true,
        "unavailable diagnostic detail",
      );
      expect(mounted.element.querySelector(".pd-tabs")).toBeNull();

      // Click delete -> triggers host inspectImpact confirmation dialog.
      await waitFor(
        () => Boolean(mounted.element.querySelector<HTMLButtonElement>(".pd-detail-actions .el-button--danger")),
        "delete button visible on unavailable panel",
      );
      mounted.element.querySelector<HTMLButtonElement>(".pd-detail-actions .el-button--danger")!.click();

      // First test cancelling confirmation does not dispatch delete.
      const cancelBox = await clickMessageBoxButton("Cancel");
      expect(cancelBox.textContent).toContain("Delete broken-panel?");
      expect(dispatched).toHaveLength(0);

      // Click delete again and confirm.
      mounted.element.querySelector<HTMLButtonElement>(".pd-detail-actions .el-button--danger")!.click();
      await clickMessageBoxButton("Delete panel");

      await waitFor(() => dispatched.length === 1, "delete dispatched after confirmation");
      expect(dispatched[0]?.call.input).toEqual({ revision: 3 });
      await waitFor(
        () => (observed.context?.state?.selected ?? null) === null && unavailableSection?.style.display === "none",
        "selection cleared and unavailable list collapsed after deletion",
      );

      // Normal panel delete also routes through owner inspectImpact confirmation.
      const panelBRow = [...mounted.element.querySelectorAll("tr")].find((row) => row.textContent?.includes("Panel B"))!;
      panelBRow.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await waitFor(
        () => Boolean(mounted.element.querySelector<HTMLButtonElement>(".pd-detail-actions .el-button--danger")),
        "delete button visible on normal panel",
      );
      mounted.element.querySelector<HTMLButtonElement>(".pd-detail-actions .el-button--danger")!.click();
      const normalImpactBox = await clickMessageBoxButton("Delete panel");
      expect(normalImpactBox.textContent).toContain("Delete panel-b?");
      await waitFor(() => dispatched.length === 2, "normal panel delete dispatched after confirmation");
      expect(dispatched[1]?.call.input).toEqual({ revision: 1 });
    } finally {
      mounted.app.unmount();
    }
  });

  it("prompts before discarding unsaved form edits when switching rows or clicking New panel", async () => {
    const { mounted, display, observed } = await mountDirectory();
    try {
      await display.present(presentFrame({ selected: panelRef("panel-b"), detailMode: "edit" }));
      await waitFor(
        () => (mounted.element.querySelector(".pd-form-wrap input") as HTMLInputElement | null)?.value === "Panel panel-b",
        "panel-b form ready",
      );

      // Make the form dirty by editing the name field.
      const input = mounted.element.querySelector<HTMLInputElement>(".pd-form-wrap input")!;
      input.value = "Panel B Unsaved Edit";
      input.dispatchEvent(new Event("input", { bubbles: true }));
      await waitFor(
        () => observed.context?.forms?.some((f) => f.member === "form" && f.dirty) === true,
        "form marked dirty",
      );

      // 1. Click Panel A while dirty -> choose "Cancel" -> stays on Panel B with edits intact.
      const panelARow = [...mounted.element.querySelectorAll("tr")].find((row) => row.textContent?.includes("Panel A"))!;
      panelARow.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await clickMessageBoxButton("Cancel");

      await waitFor(
        () => observed.context?.state?.selected?.primaryKey === "panel-b" && observed.context?.state?.detailMode === "edit",
        "selection restored to panel-b on cancel",
      );
      expect(mounted.element.querySelector<HTMLInputElement>(".pd-form-wrap input")?.value).toBe("Panel B Unsaved Edit");

      // 2. Click "New panel" while dirty -> choose "Cancel" -> stays on Panel B with edits intact.
      const newBtn = [...mounted.element.querySelectorAll<HTMLButtonElement>("button")].find((b) =>
        b.textContent?.includes("New panel"),
      )!;
      newBtn.click();
      await clickMessageBoxButton("Cancel");
      expect(observed.context?.state?.detailMode).toBe("edit");
      expect(mounted.element.querySelector<HTMLInputElement>(".pd-form-wrap input")?.value).toBe("Panel B Unsaved Edit");

      // 3. Click Panel A again -> choose "OK" -> switches to Panel A in view mode and closes form.
      panelARow.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await clickMessageBoxButton("OK");

      await waitFor(
        () => !mounted.element.querySelector(".pd-form-wrap") && observed.context?.state?.selected?.primaryKey === "panel-a",
        "switched to panel-a after confirming discard",
      );
      expect(observed.context?.state?.detailMode).toBe("view");
    } finally {
      mounted.app.unmount();
    }
  });

  it("lets authors search and add existing projections or panels into /manifest/members from the open form", async () => {
    const { mounted, display, observed } = await mountDirectory({ includeMembersField: true });
    try {
      // Picker is not mounted before entering form mode.
      expect(mounted.element.querySelector(".pd-member-picker")).toBeNull();

      await display.present(presentFrame({ selected: panelRef("panel-b"), detailMode: "edit" }));
      await waitFor(
        () => Boolean(mounted.element.querySelector(".pd-member-picker")),
        "member picker mounted when form has editable /manifest/members",
      );
      await waitFor(
        () => mounted.element.querySelector(".pd-member-picker-list")?.textContent?.includes("Summary Projection") === true,
        "candidate projections loaded via ObjectList",
      );

      // Select candidate projection and enter slot name.
      const candidateBtn = mounted.element.querySelector<HTMLButtonElement>(".pd-member-picker-list button.sdk-object-list-item-btn")!;
      candidateBtn.click();

      const slotInput = mounted.element.querySelector<HTMLInputElement>(".pd-member-picker-inputs input")!;
      slotInput.value = "existing";
      slotInput.dispatchEvent(new Event("input", { bubbles: true }));

      const addBtn = mounted.element.querySelector<HTMLButtonElement>(".pd-member-picker-inputs button")!;
      await waitFor(() => !addBtn.disabled, "add button enabled");
      addBtn.click();

      // Duplicate slot name is rejected with an inline error.
      await waitFor(
        () => mounted.element.querySelector(".pd-member-picker .pd-error")?.textContent?.includes("/manifest/members") === true,
        "duplicate slot name error",
      );

      // Enter a new slot name and add it into /manifest/members.
      slotInput.value = "summaryCard";
      slotInput.dispatchEvent(new Event("input", { bubbles: true }));
      addBtn.click();

      await waitFor(() => {
        const formValues = observed.context?.forms?.find((f) => f.member === "form")?.values as
          | { manifest?: { members?: Record<string, unknown> } }
          | undefined;
        return Boolean(formValues?.manifest?.members?.summaryCard);
      }, "summaryCard added to form /manifest/members");

      const formValues = observed.context?.forms?.find((f) => f.member === "form")?.values as {
        manifest?: { members?: Record<string, unknown> };
      };
      expect(formValues.manifest?.members).toEqual({
        existing: { target: { projectionId: "proj-0" } },
        summaryCard: { target: { projectionId: "proj-1" } },
      });
    } finally {
      mounted.app.unmount();
    }
  });

  it("shows inline projection summary in Members tab, page skills note in Usage tab, and mounts Preview child panel on demand only", async () => {
    const nestedRequests: string[] = [];
    const childPanel = {
      ...panelRecord("panel-a", "Panel A Preview", definePanel({ state: {}, members: {} })),
      visibility: "platform" as const,
      domainId: null,
      ownerId: null,
      editable: false as const,
      content: { html: "<div class=\"child-preview-body\">Child Preview Loaded</div>", module: "import { mountPanel } from '@ontomato/sdk/panel'; await mountPanel({ setup: () => ({}) });", messages: {} },
    };

    const { mounted, display, observed, navigated } = await mountDirectory({
      memberRowsFor: () => [
        {
          primaryKey: "proj-1",
          className: PRODUCT_PROJECTION,
          label: "Summary Projection",
          subtitle: "proj-1",
          fields: {
            slot: "summary",
            kindLabel: "Projection",
            target: { kind: "reference", className: PRODUCT_PROJECTION, primaryKey: "proj-1", label: "Summary Projection" },
            componentId: "ObjectSummary",
            inputs: "—",
            outputs: "—",
          },
        },
      ],
      nestedPanel: (panelId, request) => {
        nestedRequests.push(`${panelId}:${request.path}`);
        if (request.path.endsWith("/snapshot")) return panelSnapshot(childPanel, {}, request);
        return panelAnswer(childPanel, request);
      },
    });

    try {
      // Select Panel A on Overview tab -> preview must NOT mount or request nested panel definition.
      const panelARow = [...mounted.element.querySelectorAll("tr")].find((row) => row.textContent?.includes("Panel A"))!;
      panelARow.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await waitFor(() => Boolean(mounted.element.querySelector(".pd-tabs")), "detail tabs shown");
      expect(nestedRequests).toHaveLength(0);
      expect(observed.context?.state?.previewTarget ?? null).toBeNull();

      // Switch to Members tab -> click projection row -> inline summary card appears and opens Projections on click.
      await display.present(presentFrame({ tab: "members" }, display.page.value!.address));
      await waitFor(
        () => mounted.element.textContent?.includes("Summary Projection") === true,
        "members list rendered",
      );
      const memberRow = [...mounted.element.querySelectorAll(".pd-section tr")].find((row) =>
        row.textContent?.includes("Summary Projection"),
      )!;
      memberRow.dispatchEvent(new MouseEvent("click", { bubbles: true }));

      await waitFor(
        () =>
          mounted.element.querySelector(".pd-member-card")?.textContent?.includes("Displays order summary") === true
          && mounted.element.querySelector(".pd-member-card")?.textContent?.includes("ObjectSummary") === true,
        "inline projection summary rendered",
      );

      const openProjBtn = [...mounted.element.querySelectorAll<HTMLButtonElement>(".pd-member-card button")].find((b) =>
        b.textContent?.includes("Open in Projections"),
      )!;
      openProjBtn.click();
      await waitFor(() => navigated.at(-1) === "/ontology/projections?selected=proj-1", () => `navigated=${JSON.stringify(navigated)}`);

      // Switch to Usage tab -> page skills correspondence note is shown.
      await display.present(presentFrame({ tab: "usage" }, display.page.value!.address));
      await waitFor(
        () => mounted.element.querySelector(".pd-usage-skills")?.textContent?.includes("derives a page skill") === true,
        "usage page skills hint rendered",
      );
      expect(nestedRequests).toHaveLength(0);

      // Switch to Preview tab -> preview mounts on demand.
      await display.present(presentFrame({ tab: "preview" }, display.page.value!.address));
      await waitFor(
        () => Boolean(mounted.element.querySelector(".pd-preview-box")) && observed.context?.state?.previewTarget?.primaryKey === "panel-a",
        "preview mounted on Preview tab",
      );

      // Switch back to Overview -> previewTarget clears and preview unmounts.
      await display.present(presentFrame({ tab: "overview" }, display.page.value!.address));
      await waitFor(
        () => !mounted.element.querySelector(".pd-preview-box") && (observed.context?.state?.previewTarget ?? null) === null,
        "preview unmounted when leaving Preview tab",
      );
    } finally {
      mounted.app.unmount();
    }
  });

  it("aligns dialog permissions with detail entry rules, resets mode/dialogs on selected-only updates, and selects copied panel solely from owner receipt data.id", async () => {
    let copyReceiptData: Record<string, unknown> = { id: "server-assigned-copy" };
    const { mounted, display, observed, dispatched } = await mountDirectory({
      recordFor: (key) => {
        const readOnly = key === "panel-a";
        return {
          primaryKey: key,
          className: PRODUCT_PANEL,
          label: key === "panel-b" ? "Panel B" : "Panel A",
          fields: { id: key, name: key === "panel-b" ? "Panel B" : "Panel A" },
          outputs: {
            canEdit: !readOnly,
            canGrant: !readOnly,
            canDelete: !readOnly,
            isBuiltin: readOnly,
            isTemplate: false,
            domainShared: false,
            revision: 1,
            hiddenUsedByCount: 0,
            unavailable: false,
            unavailableReason: "",
          },
        };
      },
      operationsFor: (member, inputs) => {
        if (member === "copySubmit" && inputs.target) {
          return {
            copy: {
              kind: "action",
              handlerRef: "productPanels.copy",
              label: "Copy",
              effect: "write",
              batch: false,
              target: { source: "input", input: "target" },
              inputSchema: { type: "object", properties: { id: { type: "string" }, name: { type: "string" } } },
              resultSchema: {},
            },
          };
        }
        return {};
      },
      dispatchIntent: () => ({ kind: "success", data: copyReceiptData }),
    });

    try {
      // 1. Read-only, non-template Panel A cannot open copyDialog or grantDialog via public state.
      await display.present(
        presentFrame({
          selected: panelRef("panel-a"),
          copyDialog: true,
          copyId: "forced-id",
          copyName: "Forced Name",
          grantDialog: true,
        }),
      );
      await waitFor(
        () =>
          observed.context?.state?.selected?.primaryKey === "panel-a"
          && (observed.context?.state?.copyDialog ?? null) === null
          && (observed.context?.state?.grantDialog ?? null) === null,
        "unauthorized dialogs auto-closed for read-only panel",
      );
      expect(document.querySelector(".el-dialog")).toBeNull();

      // 2. Select editable Panel B in edit mode: detailMode stays out of URL (deepLink: false),
      // and a subsequent selected-only update to Panel A resets back to view mode.
      await display.present(presentFrame({ selected: panelRef("panel-b"), detailMode: "edit" }, display.page.value!.address));
      await waitFor(() => observed.context?.state?.detailMode === "edit", "panel-b entered edit mode");
      expect(source.manifest.state.detailMode.deepLink).toBe(false);
      expect(source.manifest.members.catalogue.config.pageSizes).toContain(100);
      expect(display.page.value!.address).not.toContain("detailMode");

      await display.present(presentFrame({ selected: panelRef("panel-a") }, display.page.value!.address));
      await waitFor(
        () => observed.context?.state?.selected?.primaryKey === "panel-a" && observed.context?.state?.detailMode === "view",
        "selected-only update returned to view mode",
      );

      // 3. Open copy dialog on editable Panel B; selected-only switch closes it; submitting takes owner receipt data.id.
      await display.present(
        presentFrame(
          { selected: panelRef("panel-b"), copyDialog: true, copyMode: "copy", copyId: "draft-id", copyName: "Copy B" },
          display.page.value!.address,
        ),
      );
      await waitFor(() => Boolean(document.querySelector(".el-dialog .el-button--primary")), "copy submit button mounted");

      await display.present(presentFrame({ selected: panelRef("panel-a") }, display.page.value!.address));
      await waitFor(
        () => observed.context?.state?.selected?.primaryKey === "panel-a" && (observed.context?.state?.copyDialog ?? null) === null,
        "selected-only update closed open copy dialog",
      );

      await display.present(
        presentFrame(
          { selected: panelRef("panel-b"), copyDialog: true, copyMode: "copy", copyId: "draft-id", copyName: "Copy B" },
          display.page.value!.address,
        ),
      );
      await waitFor(() => Boolean(document.querySelector(".el-dialog .el-button--primary")), "copy submit button mounted for dispatch");
      document.querySelector<HTMLButtonElement>(".el-dialog .el-button--primary")!.click();

      await waitFor(
        () => dispatched.length === 1 && observed.context?.state?.selected?.primaryKey === "server-assigned-copy",
        "selected panel taken from owner receipt data.id",
      );

      // 4. If owner receipt omits data.id, panel must NOT fall back to selecting the typed draftId.
      copyReceiptData = {};
      await display.present(
        presentFrame(
          { selected: panelRef("panel-b"), copyDialog: true, copyMode: "copy", copyId: "never-select-draft", copyName: "Copy B2" },
          display.page.value!.address,
        ),
      );
      await waitFor(() => Boolean(document.querySelector(".el-dialog .el-button--primary")), "copy submit button mounted again");
      document.querySelector<HTMLButtonElement>(".el-dialog .el-button--primary")!.click();

      await waitFor(() => dispatched.length === 2, "second copy dispatched");
      await waitFor(() => (observed.context?.state?.copyDialog ?? null) === null, "copy dialog closed");
      expect(observed.context?.state?.selected?.primaryKey).toBe("panel-b");

      // 5. Same-object detail tabs stay mounted via v-show while Preview mounts strictly on demand.
      await display.present(presentFrame({ selected: panelRef("panel-b"), tab: "overview" }, display.page.value!.address));
      await waitFor(
        () => mounted.element.querySelectorAll(".pd-tab-panel").length === 5,
        "all 5 same-object detail tabs mounted for grant-capable panel-b",
      );
      const usageTab = mounted.element.querySelector<HTMLElement>('.pd-tab-panel[data-tab="usage"]')!;
      expect(usageTab.style.display).toBe("none");
      expect(mounted.element.querySelector('[data-tab="preview"]')).toBeNull();

      await display.present(presentFrame({ tab: "usage" }, display.page.value!.address));
      await waitFor(() => usageTab.style.display !== "none", "usage tab shown via v-show without remounting");
      expect(mounted.element.contains(usageTab)).toBe(true);
    } finally {
      mounted.app.unmount();
    }
  });
});
