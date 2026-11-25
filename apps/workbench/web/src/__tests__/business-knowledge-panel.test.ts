import { afterEach, describe, expect, it, vi } from "vitest";
import { defineComponent, h } from "vue";
import { createMemoryHistory, createRouter, RouterView } from "vue-router";
import type { DisplayPageController } from "../../../../../packages/agent-shell-ui/src/conversation-display";
import type { BatchItemOperationOutcome, PanelHumanOperationConfirmation } from "@ontomato/contracts/panel-agent";
import { appsSdkComponentCatalogEntrySchema } from "@ontomato/contracts/apps-sdk";
import { panelAuthoringManifestSchema } from "@ontomato/contracts/panel-authoring";
import { expandPanelAuthoringMember } from "@ontomato/contracts/panel-authoring-expansion";
import { panelAddress, type ProductPanelReadRequest } from "@ontomato/contracts/panel-host";
import { definePanel, type PanelOperationCall } from "@ontomato/contracts/panel-manifest";
import type { PanelFormDescription, PanelFormSaveInput, PanelFormValues } from "@ontomato/contracts/panel-projection";
import {
  APPROVE_KNOWLEDGE,
  BUSINESS_KNOWLEDGE,
  DELETE_KNOWLEDGE,
  platformObjectTypes,
} from "@ontomato/contracts/platform-object-types";
import { platformTypeTableEntrySchema } from "@ontomato/contracts/platform-type-table";
import type { ProductProjection } from "@ontomato/contracts/product-panels";
import { provideUnsavedChanges } from "@ontomato/platform-shell";
import { components } from "../../../../../packages/apps-sdk/src/catalogue";
import { useApplicationCatalog } from "../../../../../packages/platform-web/src/catalog";
import PanelApplicationRoute from "../../../../../packages/platform-web/src/pages/PanelApplicationRoute.vue";
import source from "../../../../../packages/ontology-manager/resources/builtin-panels/business-knowledge/panel.json";
import html from "../../../../../packages/ontology-manager/resources/builtin-panels/business-knowledge/panel.html?raw";
import module from "../../../../../packages/ontology-manager/resources/builtin-panels/business-knowledge/panel.mjs?raw";
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
const ENTRY_A = "bk-a";
const ENTRY_B = "bk-b";
const ENTRY_C = "bk-c";
const ALREADY_APPROVED_REASON = "This business knowledge entry is already approved.";

const use = panelUse(
  "ontology-knowledge",
  "business-knowledge",
  "builtin-product-business-knowledge",
  "/ontology/knowledge",
);

const knowledgeRef = (primaryKey: string) => ({ className: BUSINESS_KNOWLEDGE, primaryKey });

const knowledgeTypeEntry = platformTypeTableEntrySchema.parse({
  ...platformObjectTypes[BUSINESS_KNOWLEDGE],
  operations: [
    {
      id: `${BUSINESS_KNOWLEDGE}.save`,
      kind: "form.save",
      effect: "write",
      batch: false,
      inputSchema: { type: "object" },
      target: { source: "input", input: "knowledge" },
    },
    {
      id: APPROVE_KNOWLEDGE,
      kind: "action",
      effect: "write",
      batch: true,
      inputSchema: { type: "object" },
      target: { source: "input", input: "knowledge" },
    },
    {
      id: DELETE_KNOWLEDGE,
      kind: "action",
      effect: "write",
      batch: true,
      inputSchema: { type: "object" },
      target: { source: "input", input: "knowledge" },
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
      typeTable: { objectTypes: { [BUSINESS_KNOWLEDGE]: knowledgeTypeEntry } },
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

const knowledgePanel = {
  ...panelRecord(use.panelId, "Business knowledge", definePanel({ ...manifest, members })),
  visibility: "platform" as const,
  domainId: null,
  ownerId: null,
  editable: false as const,
  content: { html, module, messages: source.content.messages },
};

interface KnowledgeRecord {
  primaryKey: string;
  knowledgeTitle: string;
  knowledgeText: string;
  knowledgeTags: string[];
  status: string;
}

interface SavedCall {
  targetPrimaryKey: string | null;
  values: Record<string, unknown>;
}

interface DispatchedActionCall {
  operationId: string;
  targetPrimaryKey: string | null;
}

const AGENT_RUN = {
  sessionId: "session-bk-test",
  runId: "run-bk-test",
  toolCallId: "tool-bk-test",
} as const;

const formFields: PanelFormDescription["fields"] = [
  {
    path: "/knowledgeTitle",
    label: "Title",
    required: true,
    readOnly: false,
    valueSchema: { type: "string" },
    control: { kind: "text" },
  },
  {
    path: "/knowledgeText",
    label: "Content",
    required: false,
    readOnly: false,
    valueSchema: { type: "string" },
    control: { kind: "text", multiline: true },
  },
  {
    path: "/status",
    label: "Status",
    required: false,
    readOnly: false,
    valueSchema: { type: "string" },
    control: { kind: "text" },
  },
];

function formDescription(primaryKey: string | null, values: PanelFormValues): PanelFormDescription {
  return {
    fields: formFields,
    values,
    errors: [],
    revision: 1,
    save: primaryKey
      ? { method: "PUT", path: `/knowledge/${primaryKey}`, bodySchema: {} }
      : { method: "POST", path: "/knowledge", bodySchema: {} },
  };
}

function toListRow(record: KnowledgeRecord) {
  return {
    primaryKey: record.primaryKey,
    label: record.knowledgeTitle,
    subtitle: record.knowledgeText,
    fields: {
      status: record.status,
      knowledgeTags: record.knowledgeTags,
      knowledgeText: record.knowledgeText,
    },
  };
}

function mountKnowledgeRoute(options: {
  initialState?: Record<string, unknown>;
  initialRecords?: KnowledgeRecord[];
  confirmLeave?: () => Promise<boolean>;
  beforeListRead?: () => Promise<void>;
  beforeFormRead?: () => Promise<void>;
  formReadResponse?: (dataName: string) => Response | null;
} = {}) {
  const defaultRecords: KnowledgeRecord[] = [
    {
      primaryKey: ENTRY_A,
      knowledgeTitle: "Order Cutoff Rule",
      knowledgeText: "Orders after 18:00 ship next day.",
      knowledgeTags: ["orders"],
      status: "1",
    },
    {
      primaryKey: ENTRY_B,
      knowledgeTitle: "Refund SLA",
      knowledgeText: "Refunds settle within 3 business days.",
      knowledgeTags: ["billing"],
      status: "0",
    },
  ];
  const records = new Map<string, KnowledgeRecord>(
    (options.initialRecords ?? defaultRecords).map((record) => [record.primaryKey, { ...record }]),
  );
  const savedCalls: SavedCall[] = [];
  const dispatchedActions: DispatchedActionCall[] = [];
  const formTargetReads: Array<{ dataName: string; targetPrimaryKey: string | null }> = [];
  let controller: DisplayPageController | null = null;
  let intentCounter = 0;
  const preparedIntents = new Map<
    string,
    {
      operationId: string;
      call?: PanelOperationCall;
      calls?: PanelOperationCall[];
      confirmation: PanelHumanOperationConfirmation;
    }
  >();

  const confirmLeaveUnsaved = vi.fn(async () => (options.confirmLeave ? options.confirmLeave() : true));
  const onDisplayDirty = vi.fn();

  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      {
        path: use.path,
        component: PanelApplicationRoute,
        props: {
          applicationId: APP_ID,
          onDisplayDirty,
          registerPageController(next: DisplayPageController) {
            controller = next;
            return () => {
              if (controller === next) controller = null;
            };
          },
        },
      },
    ],
  });

  const sent = installPlatform(async (request: Sent) => {
    const { path } = request;
    if (path === `/api/data-query/platform/applications/${APP_ID}/panel-uses`) {
      return Response.json({
        data: { applicationId: APP_ID, entry: { path: "/ontology", renderer: "panels" }, panelUses: [use] },
      });
    }
    if (path === `/api/product-panels/${knowledgePanel.id}`) return panelAnswer(knowledgePanel, request);
    if (path === `/api/product-panels/${knowledgePanel.id}/snapshot`) {
      return panelSnapshot(knowledgePanel, Object.fromEntries(projections), request);
    }
    if (path.startsWith("/api/product-projections/")) {
      return Response.json({ projection: projections.get(path.split("/").at(-1)!) });
    }
    if (path === "/api/product-panels/read") {
      const body = request.body as ProductPanelReadRequest;
      const member = body.memberPath[0]?.member;
      if ("operations" in body) {
        if (member === "form") {
          const targetRef = body.inputs.knowledge ?? body.inputs.target;
          const target = targetRef
            ? { source: "input", input: "knowledge" }
            : { source: "draft", slot: "form" };
          return Response.json({
            status: "ready",
            value: {
              save: {
                kind: "form.save",
                handlerRef: `${BUSINESS_KNOWLEDGE}.save`,
                label: "Save",
                effect: "write",
                target,
                inputSchema: {},
                resultSchema: {},
                batch: false,
              },
            },
          });
        }
        if (member === "approve") {
          const ref = (body.inputs.knowledge ?? body.inputs.target) as { primaryKey?: string } | undefined;
          const record = ref?.primaryKey ? records.get(ref.primaryKey) : undefined;
          if (!record) return Response.json({ status: "ready", value: {} });
          return Response.json({
            status: "ready",
            value: {
              approve: {
                kind: "action",
                handlerRef: APPROVE_KNOWLEDGE,
                label: "Approve",
                effect: "write",
                target: { source: "input", input: "knowledge" },
                inputSchema: {},
                resultSchema: {},
                batch: true,
                ...(record.status !== "0" ? { unavailable: { reason: ALREADY_APPROVED_REASON } } : {}),
              },
            },
          });
        }
        if (member === "approveAll") {
          const refs = (body.inputs.knowledge ?? body.inputs.target) as Array<{ primaryKey?: string }> | undefined;
          if (!Array.isArray(refs) || refs.length === 0) return Response.json({ status: "ready", value: {} });
          const allApproved = refs.every((ref) => {
            const record = ref?.primaryKey ? records.get(ref.primaryKey) : undefined;
            return !record || record.status !== "0";
          });
          return Response.json({
            status: "ready",
            value: {
              approve: {
                kind: "action",
                handlerRef: APPROVE_KNOWLEDGE,
                label: "Approve",
                effect: "write",
                target: { source: "input", input: "knowledge" },
                inputSchema: {},
                resultSchema: {},
                batch: true,
                ...(allApproved ? { unavailable: { reason: ALREADY_APPROVED_REASON } } : {}),
              },
            },
          });
        }
        if (member === "deleteAll") {
          const refs = (body.inputs.knowledge ?? body.inputs.target) as Array<{ primaryKey?: string }> | undefined;
          if (!Array.isArray(refs) || refs.length === 0) return Response.json({ status: "ready", value: {} });
          return Response.json({
            status: "ready",
            value: {
              delete: {
                kind: "action",
                handlerRef: DELETE_KNOWLEDGE,
                label: "Delete",
                effect: "write",
                target: { source: "input", input: "knowledge" },
                inputSchema: {},
                resultSchema: {},
                batch: true,
              },
            },
          });
        }
        if (member === "remove") {
          const ref = (body.inputs.knowledge ?? body.inputs.target) as { primaryKey?: string } | undefined;
          const record = ref?.primaryKey ? records.get(ref.primaryKey) : undefined;
          if (!record) return Response.json({ status: "ready", value: {} });
          return Response.json({
            status: "ready",
            value: {
              delete: {
                kind: "action",
                handlerRef: DELETE_KNOWLEDGE,
                label: "Delete",
                effect: "write",
                target: { source: "input", input: "knowledge" },
                inputSchema: {},
                resultSchema: {},
                batch: true,
              },
            },
          });
        }
        return Response.json({ status: "ready", value: {} });
      }
      if (member === "tabs") {
        return Response.json({
          status: "ready",
          value: [
            { key: "all", label: "All", count: records.size },
            { key: "0", label: "Pending", count: [...records.values()].filter((r) => r.status === "0").length },
            { key: "1", label: "Approved", count: [...records.values()].filter((r) => r.status === "1").length },
          ],
        });
      }
      if (member === "list") {
        if (options.beforeListRead) await options.beforeListRead();
        const rows = [...records.values()].map(toListRow);
        return Response.json({ status: "ready", value: { rows, total: rows.length } });
      }
      if (member === "detail") {
        const ref = (body.inputs.knowledge ?? body.inputs.target) as { primaryKey?: string } | undefined;
        const record = ref?.primaryKey ? records.get(ref.primaryKey) : undefined;
        if (!record) return Response.json({ status: "empty" });
        return Response.json({ status: "ready", value: toListRow(record) });
      }
      if (member === "form") {
        if (options.beforeFormRead) await options.beforeFormRead();
        if (body.dataName === "createForm") {
          formTargetReads.push({ dataName: "createForm", targetPrimaryKey: null });
          const custom = options.formReadResponse?.(body.dataName);
          if (custom) return custom;
          return Response.json({
            status: "ready",
            value: formDescription(null, { knowledgeTitle: "", knowledgeText: "", status: "0" }),
          });
        }
        const ref = (body.inputs.knowledge ?? body.inputs.target) as { primaryKey?: string } | undefined;
        const record = ref?.primaryKey ? records.get(ref.primaryKey) : undefined;
        formTargetReads.push({ dataName: "form", targetPrimaryKey: ref?.primaryKey ?? null });
        const custom = options.formReadResponse?.(body.dataName);
        if (custom) return custom;
        if (!record) return Response.json({ status: "empty" });
        return Response.json({
          status: "ready",
          value: formDescription(record.primaryKey, {
            knowledgeTitle: record.knowledgeTitle,
            knowledgeText: record.knowledgeText,
            status: record.status,
          }),
        });
      }
      return Response.json({ status: "empty" });
    }
    if (request.method === "POST" && path === "/api/panel-operations/intents") {
      const { operationId, call, calls } = request.body as {
        operationId: string;
        call?: PanelOperationCall;
        calls?: PanelOperationCall[];
      };
      intentCounter += 1;
      const intentId = `22222222-2222-4222-8222-22222222222${intentCounter}`;
      const label =
        operationId === "approve.approve" || operationId === "approveAll.approve"
          ? "Approve"
          : operationId === "remove.delete" || operationId === "deleteAll.delete"
            ? "Delete"
            : "Save";
      const confirmation: PanelHumanOperationConfirmation = calls
        ? {
            kind: "batch",
            targets: {
              objects: calls.map((item) => {
                const target = item.target as { objectType: string; primaryKey: string };
                return {
                  target: { objectType: target.objectType, primaryKey: target.primaryKey },
                  label: records.get(target.primaryKey)?.knowledgeTitle ?? target.primaryKey,
                };
              }),
              total: calls.length,
            },
          }
        : { kind: "none" };
      preparedIntents.set(intentId, { operationId, call, calls, confirmation });
      return Response.json({
        intentId,
        operationId,
        label,
        confirmation,
        autoMode: true,
      });
    }
    const intentRead = /^\/api\/panel-operation-intents\/([^/?]+)$/.exec(path);
    if (intentRead && request.method === "GET") {
      const entry = preparedIntents.get(intentRead[1]!);
      const operationId = entry?.operationId ?? "form.save";
      const label =
        operationId === "approve.approve" || operationId === "approveAll.approve"
          ? "Approve"
          : operationId === "remove.delete" || operationId === "deleteAll.delete"
            ? "Delete"
            : "Save";
      return Response.json({
        intentId: intentRead[1],
        operationId,
        label,
        confirmation: entry?.confirmation ?? { kind: "none" },
        autoMode: true,
      });
    }
    const intentDispatch = /^\/api\/panel-operations\/intents\/([^/]+)\/dispatch$/.exec(path);
    if (intentDispatch && request.method === "POST") {
      const entry = preparedIntents.get(intentDispatch[1]!)!;
      if (entry.calls && entry.operationId === "approveAll.approve") {
        const affectedObjects: Array<{ objectType: string; primaryKey: string }> = [];
        const items: Array<{ target: { objectType: string; primaryKey: string }; outcome: BatchItemOperationOutcome }> =
          entry.calls.map((item) => {
            const target = item.target as { objectType: string; primaryKey: string };
            const existing = records.get(target.primaryKey);
            if (!existing || existing.status !== "0") {
              return {
                target: { objectType: target.objectType, primaryKey: target.primaryKey },
                outcome: { kind: "skipped", reason: ALREADY_APPROVED_REASON },
              };
            }
            records.set(target.primaryKey, { ...existing, status: "1" });
            dispatchedActions.push({ operationId: entry.operationId, targetPrimaryKey: target.primaryKey });
            affectedObjects.push({ objectType: BUSINESS_KNOWLEDGE, primaryKey: target.primaryKey });
            return {
              target: { objectType: target.objectType, primaryKey: target.primaryKey },
              outcome: {
                kind: "success",
                data: {},
                affected: {
                  objects: [{ objectType: BUSINESS_KNOWLEDGE, primaryKey: target.primaryKey }],
                  objectTypes: [BUSINESS_KNOWLEDGE],
                },
              },
            };
          });
        return Response.json({
          kind: "dispatched",
          intentId: intentDispatch[1],
          outcome: {
            kind: "batch",
            items,
            ...(affectedObjects.length > 0
              ? { affected: { objects: affectedObjects, objectTypes: [BUSINESS_KNOWLEDGE] } }
              : {}),
          },
        });
      }
      const target = entry.call?.target as { primaryKey?: string } | undefined;
      const targetPrimaryKey = target?.primaryKey ?? null;
      dispatchedActions.push({ operationId: entry.operationId, targetPrimaryKey });
      if (entry.operationId === "approve.approve") {
        if (targetPrimaryKey) {
          const existing = records.get(targetPrimaryKey);
          if (existing) records.set(targetPrimaryKey, { ...existing, status: "1" });
        }
        return Response.json({
          kind: "dispatched",
          intentId: intentDispatch[1],
          outcome: {
            kind: "success",
            message: "Approved",
            data: {},
            affected: {
              objects: targetPrimaryKey ? [{ objectType: BUSINESS_KNOWLEDGE, primaryKey: targetPrimaryKey }] : [],
              objectTypes: [BUSINESS_KNOWLEDGE],
            },
          },
        });
      }
      if (entry.operationId === "remove.delete") {
        if (targetPrimaryKey) records.delete(targetPrimaryKey);
        return Response.json({
          kind: "dispatched",
          intentId: intentDispatch[1],
          outcome: {
            kind: "success",
            message: "Deleted",
            data: {},
            affected: {
              objects: targetPrimaryKey ? [{ objectType: BUSINESS_KNOWLEDGE, primaryKey: targetPrimaryKey }] : [],
              removed: targetPrimaryKey ? [{ objectType: BUSINESS_KNOWLEDGE, primaryKey: targetPrimaryKey }] : [],
              objectTypes: [BUSINESS_KNOWLEDGE],
            },
          },
        });
      }
      const input = entry.call?.input as PanelFormSaveInput | undefined;
      const values = (input?.values ?? {}) as Record<string, unknown>;
      savedCalls.push({ targetPrimaryKey, values: { ...values } });
      const savedKey = targetPrimaryKey ?? `bk-new-${savedCalls.length}`;
      const existing = records.get(savedKey);
      records.set(savedKey, {
        primaryKey: savedKey,
        knowledgeTitle: String(values.knowledgeTitle ?? existing?.knowledgeTitle ?? ""),
        knowledgeText: String(values.knowledgeText ?? existing?.knowledgeText ?? ""),
        knowledgeTags: existing?.knowledgeTags ?? [],
        status: String(values.status ?? existing?.status ?? "0"),
      });
      return Response.json({
        kind: "dispatched",
        intentId: intentDispatch[1],
        outcome: {
          kind: "success",
          message: "Saved",
          data: {},
          ...(!targetPrimaryKey && { created: { objectType: BUSINESS_KNOWLEDGE, primaryKey: savedKey } }),
          affected: {
            objects: [{ objectType: BUSINESS_KNOWLEDGE, primaryKey: savedKey }],
            objectTypes: [BUSINESS_KNOWLEDGE],
          },
        },
      });
    }
    return nothingAt(request);
  }, router);

  return {
    router,
    sent,
    records,
    savedCalls,
    dispatchedActions,
    formTargetReads,
    confirmLeaveUnsaved,
    onDisplayDirty,
    getController: () => controller,
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
          scheduleAdapter: null,
          releaseId: null,
          panelUses: [use],
        },
      ];
      await router.push(panelAddress(use.path, options.initialState ?? {}, knowledgePanel.manifest));
      const Shell = defineComponent({
        setup() {
          provideUnsavedChanges(confirmLeaveUnsaved);
          return () => h(RouterView);
        },
      });
      return mountPlatformPage(() => h(Shell), router);
    },
  };
}

function titleInput(element: HTMLElement): HTMLInputElement | null {
  return element.querySelector<HTMLInputElement>('[data-field="/knowledgeTitle"] input');
}

function setTitleInput(element: HTMLElement, value: string) {
  const input = titleInput(element);
  if (!input) throw new Error("Expected /knowledgeTitle input to be mounted");
  input.value = value;
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

function findButton(element: HTMLElement, label: string): HTMLButtonElement | undefined {
  return [...element.querySelectorAll<HTMLButtonElement>("button")].find(
    (button) => button.textContent?.trim() === label,
  );
}

function findListOption(element: HTMLElement, text: string): HTMLElement | undefined {
  return [...element.querySelectorAll<HTMLElement>(".sdk-object-list [role='option']")].find((option) =>
    option.textContent?.includes(text),
  );
}

function clickListOption(element: HTMLElement, text: string) {
  const option = findListOption(element, text);
  if (!option) throw new Error(`Expected list option containing "${text}"`);
  const trigger = option.querySelector<HTMLElement>(".sdk-object-list-item-btn") ?? option;
  trigger.click();
}

function findListCheckbox(element: HTMLElement, label: string): HTMLInputElement | null {
  return element.querySelector<HTMLInputElement>(`.sdk-object-list input[type="checkbox"][aria-label="${label}"]`);
}

function toggleListCheckbox(element: HTMLElement, label: string, checked: boolean) {
  const input = findListCheckbox(element, label);
  if (!input) throw new Error(`Expected list checkbox for "${label}"`);
  input.checked = checked;
  input.dispatchEvent(new Event("change", { bubbles: true }));
}

function findBatchActionButton(element: HTMLElement, label: string): HTMLButtonElement | undefined {
  return [...element.querySelectorAll<HTMLButtonElement>(".sdk-object-list-batch-actions button")].find(
    (button) => button.textContent?.trim() === label,
  );
}

function formHeading(element: HTMLElement): string | null {
  return element.querySelector(".bk-form-title")?.textContent?.trim() ?? null;
}

afterEach(() => {
  leaveFrame();
  useApplicationCatalog().applications.value = [];
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

describe("business-knowledge builtin panel formTarget synchronization", () => {
  it("human flow: editing and saving A, then selecting B and clicking Edit targets and saves B", { timeout: 20000 }, async () => {
    const route = mountKnowledgeRoute({ initialState: { selected: knowledgeRef(ENTRY_A) } });
    const { app, element } = await route.open();
    try {
      await vi.waitFor(() => {
        expect(findButton(element, "Edit")).toBeTruthy();
        expect(findListOption(element, "Refund SLA")).toBeTruthy();
      }, { timeout: 5000 });

      findButton(element, "Edit")!.click();
      await vi.waitFor(() => {
        expect(formHeading(element)).toBe("Edit Knowledge");
        expect(titleInput(element)?.value).toBe("Order Cutoff Rule");
      }, { timeout: 5000 });

      setTitleInput(element, "Order Cutoff Rule v2");
      await vi.waitFor(() => {
        expect(findButton(element, "Save")?.disabled).toBe(false);
      }, { timeout: 5000 });
      findButton(element, "Save")!.click();

      await vi.waitFor(() => {
        expect(route.savedCalls).toHaveLength(1);
        expect(route.savedCalls[0]?.targetPrimaryKey).toBe(ENTRY_A);
        expect(route.savedCalls[0]?.values.knowledgeTitle).toBe("Order Cutoff Rule v2");
        expect(formHeading(element)).toBeNull();
      }, { timeout: 5000 });

      clickListOption(element, "Refund SLA");
      await vi.waitFor(() => {
        expect(route.router.currentRoute.value.query.selected).toBe(ENTRY_B);
        expect(element.textContent).toContain("Refunds settle within 3 business days.");
      }, { timeout: 5000 });

      findButton(element, "Edit")!.click();
      await vi.waitFor(() => {
        expect(formHeading(element)).toBe("Edit Knowledge");
        expect(titleInput(element)?.value).toBe("Refund SLA");
      }, { timeout: 5000 });

      setTitleInput(element, "Refund SLA v2");
      await vi.waitFor(() => {
        expect(findButton(element, "Save")?.disabled).toBe(false);
      }, { timeout: 5000 });
      findButton(element, "Save")!.click();

      await vi.waitFor(() => {
        expect(route.savedCalls).toHaveLength(2);
        expect(route.savedCalls[1]?.targetPrimaryKey).toBe(ENTRY_B);
        expect(route.savedCalls[1]?.values.knowledgeTitle).toBe("Refund SLA v2");
      }, { timeout: 5000 });
      expect(route.records.get(ENTRY_A)?.knowledgeTitle).toBe("Order Cutoff Rule v2");
      expect(route.records.get(ENTRY_B)?.knowledgeTitle).toBe("Refund SLA v2");
    } finally {
      app.unmount();
    }
  });

  it("agent present flow: after saving A and returning to view, applying { selected: B, mode: 'edit' } retargets and saves B instead of A", { timeout: 20000 }, async () => {
    const route = mountKnowledgeRoute({ initialState: { selected: knowledgeRef(ENTRY_A) } });
    const { app, element } = await route.open();
    try {
      await vi.waitFor(() => {
        expect(findButton(element, "Edit")).toBeTruthy();
        expect(route.getController()).not.toBeNull();
      }, { timeout: 5000 });

      // Edit and save A so formTarget holds A when returning to view mode.
      findButton(element, "Edit")!.click();
      await vi.waitFor(() => {
        expect(titleInput(element)?.value).toBe("Order Cutoff Rule");
      }, { timeout: 5000 });

      setTitleInput(element, "Order Cutoff Rule Saved");
      await vi.waitFor(() => {
        expect(findButton(element, "Save")?.disabled).toBe(false);
      }, { timeout: 5000 });
      findButton(element, "Save")!.click();

      await vi.waitFor(() => {
        expect(route.savedCalls).toHaveLength(1);
        expect(route.savedCalls[0]?.targetPrimaryKey).toBe(ENTRY_A);
        expect(formHeading(element)).toBeNull();
      }, { timeout: 5000 });

      // Agent present per recipes.md: switch directly to editing B.
      route.getController()!.applyState({ selected: knowledgeRef(ENTRY_B), mode: "edit" });

      await vi.waitFor(() => {
        expect(formHeading(element)).toBe("Edit Knowledge");
        expect(titleInput(element)?.value).toBe("Refund SLA");
      }, { timeout: 5000 });

      const filled = await route.getController()!.fillForm!({
        member: "form",
        values: { knowledgeTitle: "Refund SLA by Agent" },
      });
      expect(filled.ok).toBe(true);

      await vi.waitFor(() => {
        expect(titleInput(element)?.value).toBe("Refund SLA by Agent");
        expect(findButton(element, "Save")?.disabled).toBe(false);
      }, { timeout: 5000 });
      findButton(element, "Save")!.click();

      await vi.waitFor(() => {
        expect(route.savedCalls).toHaveLength(2);
        expect(route.savedCalls[1]?.targetPrimaryKey).toBe(ENTRY_B);
        expect(route.savedCalls[1]?.values.knowledgeTitle).toBe("Refund SLA by Agent");
      }, { timeout: 5000 });
      expect(route.records.get(ENTRY_A)?.knowledgeTitle).toBe("Order Cutoff Rule Saved");
      expect(route.records.get(ENTRY_B)?.knowledgeTitle).toBe("Refund SLA by Agent");
    } finally {
      app.unmount();
    }
  });

  it("agent edit-mode switch: while already in edit mode on A, applying { selected: B, mode: 'edit' } switches formTarget to B", { timeout: 20000 }, async () => {
    const route = mountKnowledgeRoute({ initialState: { selected: knowledgeRef(ENTRY_A) } });
    const { app, element } = await route.open();
    try {
      await vi.waitFor(() => {
        expect(findButton(element, "Edit")).toBeTruthy();
        expect(route.getController()).not.toBeNull();
      }, { timeout: 5000 });

      findButton(element, "Edit")!.click();
      await vi.waitFor(() => {
        expect(formHeading(element)).toBe("Edit Knowledge");
        expect(titleInput(element)?.value).toBe("Order Cutoff Rule");
      }, { timeout: 5000 });

      route.getController()!.applyState({ selected: knowledgeRef(ENTRY_B), mode: "edit" });

      await vi.waitFor(() => {
        // BK-03: editing clears directory `selected` so the list reading highlight is removed.
        expect(route.router.currentRoute.value.query.selected).toBeUndefined();
        expect(formHeading(element)).toBe("Edit Knowledge");
        expect(titleInput(element)?.value).toBe("Refund SLA");
      }, { timeout: 5000 });

      setTitleInput(element, "Refund SLA Switched");
      await vi.waitFor(() => {
        expect(findButton(element, "Save")?.disabled).toBe(false);
      }, { timeout: 5000 });
      findButton(element, "Save")!.click();

      await vi.waitFor(() => {
        expect(route.savedCalls).toHaveLength(1);
        expect(route.savedCalls[0]?.targetPrimaryKey).toBe(ENTRY_B);
        expect(route.savedCalls[0]?.values.knowledgeTitle).toBe("Refund SLA Switched");
      }, { timeout: 5000 });
    } finally {
      app.unmount();
    }
  });

  it("dirty edit guard on row click: declining leave keeps A and unsaved edits; confirming switches to B view and syncs formTarget", { timeout: 20000 }, async () => {
    let resolveConfirm: ((ok: boolean) => void) | null = null;
    const route = mountKnowledgeRoute({
      initialState: { selected: knowledgeRef(ENTRY_A) },
      confirmLeave: () =>
        new Promise<boolean>((resolve) => {
          resolveConfirm = resolve;
        }),
    });
    const { app, element } = await route.open();
    try {
      await vi.waitFor(() => {
        expect(findButton(element, "Edit")).toBeTruthy();
        expect(findListOption(element, "Refund SLA")).toBeTruthy();
      }, { timeout: 5000 });

      findButton(element, "Edit")!.click();
      await vi.waitFor(() => {
        expect(titleInput(element)?.value).toBe("Order Cutoff Rule");
      }, { timeout: 5000 });

      setTitleInput(element, "Unsaved Draft On A");
      await vi.waitFor(() => {
        expect(findButton(element, "Save")?.disabled).toBe(false);
      }, { timeout: 5000 });

      const formReadsBeforeClick = route.formTargetReads.length;
      clickListOption(element, "Refund SLA");
      await vi.waitFor(() => {
        expect(route.confirmLeaveUnsaved).toHaveBeenCalledTimes(1);
        expect(resolveConfirm).not.toBeNull();
      }, { timeout: 5000 });

      // While waiting for confirmation, formTarget must NOT have been overwritten with B.
      expect(
        route.formTargetReads.slice(formReadsBeforeClick).some((read) => read.targetPrimaryKey === ENTRY_B),
      ).toBe(false);
      expect(titleInput(element)?.value).toBe("Unsaved Draft On A");

      // Decline leaving: directory `selected` stays cleared (BK-03), form stays on A with unsaved edits intact.
      resolveConfirm!(false);
      resolveConfirm = null;

      await vi.waitFor(() => {
        expect(route.router.currentRoute.value.query.selected).toBeUndefined();
      }, { timeout: 5000 });
      expect(formHeading(element)).toBe("Edit Knowledge");
      expect(titleInput(element)?.value).toBe("Unsaved Draft On A");
      expect(findButton(element, "Save")?.disabled).toBe(false);

      // Click B again and confirm leaving: switches to B view and syncs formTarget to B.
      clickListOption(element, "Refund SLA");
      await vi.waitFor(() => {
        expect(route.confirmLeaveUnsaved).toHaveBeenCalledTimes(2);
        expect(resolveConfirm).not.toBeNull();
      }, { timeout: 5000 });

      resolveConfirm!(true);
      resolveConfirm = null;

      await vi.waitFor(() => {
        expect(formHeading(element)).toBeNull();
        expect(route.router.currentRoute.value.query.selected).toBe(ENTRY_B);
        expect(element.textContent).toContain("Refunds settle within 3 business days.");
        expect(route.formTargetReads.at(-1)).toEqual({ dataName: "form", targetPrimaryKey: ENTRY_B });
      }, { timeout: 5000 });
    } finally {
      app.unmount();
    }
  });

  it("create mode: sets formTarget to null for the create form and restores the previous entry on cancel", { timeout: 20000 }, async () => {
    const route = mountKnowledgeRoute({ initialState: { selected: knowledgeRef(ENTRY_A) } });
    const { app, element } = await route.open();
    try {
      await vi.waitFor(() => {
        expect(findButton(element, "Add Knowledge")).toBeTruthy();
        expect(element.textContent).toContain("Orders after 18:00 ship next day.");
      }, { timeout: 5000 });

      findButton(element, "Add Knowledge")!.click();

      await vi.waitFor(() => {
        expect(formHeading(element)).toBe("Add Knowledge");
        expect(route.router.currentRoute.value.query.selected).toBeUndefined();
        expect(route.formTargetReads.at(-1)).toEqual({ dataName: "createForm", targetPrimaryKey: null });
        expect(titleInput(element)?.value).toBe("");
      }, { timeout: 5000 });

      findButton(element, "Cancel")!.click();

      await vi.waitFor(() => {
        expect(formHeading(element)).toBeNull();
        expect(route.router.currentRoute.value.query.selected).toBe(ENTRY_A);
        expect(element.textContent).toContain("Orders after 18:00 ship next day.");
      }, { timeout: 5000 });
    } finally {
      app.unmount();
    }

    // Entering create mode before the initial list resolves must keep formTarget null even when ObjectList's
    // fallbackToFirst writes `selected` on first load.
    let releaseList!: () => void;
    const listGate = new Promise<void>((resolve) => {
      releaseList = resolve;
    });
    const directCreateRoute = mountKnowledgeRoute({ beforeListRead: () => listGate });
    const directCreate = await directCreateRoute.open();
    try {
      await vi.waitFor(() => {
        expect(directCreateRoute.getController()).not.toBeNull();
      }, { timeout: 5000 });
      directCreateRoute.getController()!.applyState({ mode: "create" });
      await vi.waitFor(() => {
        expect(formHeading(directCreate.element)).toBe("Add Knowledge");
        expect(directCreateRoute.formTargetReads.at(-1)).toEqual({ dataName: "createForm", targetPrimaryKey: null });
      }, { timeout: 5000 });

      releaseList();
      await vi.waitFor(() => {
        expect(directCreate.element.querySelectorAll(".sdk-object-list [role='option']")).toHaveLength(2);
      }, { timeout: 5000 });

      expect(formHeading(directCreate.element)).toBe("Add Knowledge");
      expect(
        directCreateRoute.formTargetReads.some((read) => read.dataName === "form" && read.targetPrimaryKey !== null),
      ).toBe(false);
      expect(titleInput(directCreate.element)?.value).toBe("");
    } finally {
      releaseList();
      directCreate.app.unmount();
    }
  });
});

describe("business-knowledge builtin panel unmounts hidden form and actions", () => {
  it("unmounts form and form.save in view mode (initial, after cancel, after save), and unmounts approve/remove in edit mode", { timeout: 20000 }, async () => {
    const route = mountKnowledgeRoute({ initialState: { selected: knowledgeRef(ENTRY_B) } });
    const { app, element } = await route.open();
    try {
      // Initial view mode on pending ENTRY_B: detail actions are mounted, form is unmounted.
      await vi.waitFor(() => {
        expect(route.getController()).not.toBeNull();
        expect(element.querySelector(".bk-detail-actions")).not.toBeNull();
        expect(findButton(element, "Approve")).toBeTruthy();
        expect(findButton(element, "Edit")).toBeTruthy();
        expect(findButton(element, "Delete")).toBeTruthy();
      }, { timeout: 5000 });

      expect(titleInput(element)).toBeNull();
      expect(element.querySelector(".bk-form-actions")).toBeNull();
      await expect(
        route.getController()!.fillForm!({ member: "form", values: { knowledgeTitle: "Blocked In View" } }),
      ).resolves.toMatchObject({ ok: false, reason: "form_not_found" });
      await expect(
        route.getController()!.executeAction!({ operation: "form.save", agentRun: AGENT_RUN }),
      ).resolves.toMatchObject({ ok: false, reason: "action_not_found" });

      // Enter edit mode: form is mounted, view-mode approve/remove actions are unmounted.
      findButton(element, "Edit")!.click();
      await vi.waitFor(() => {
        expect(formHeading(element)).toBe("Edit Knowledge");
        expect(titleInput(element)?.value).toBe("Refund SLA");
        expect(element.querySelector(".bk-form-actions")).not.toBeNull();
      }, { timeout: 5000 });

      expect(element.querySelector(".bk-detail-actions")).toBeNull();
      expect(findButton(element, "Approve")).toBeUndefined();
      expect(findButton(element, "Delete")).toBeUndefined();
      await expect(
        route.getController()!.executeAction!({ operation: "approve.approve", agentRun: AGENT_RUN }),
      ).resolves.toMatchObject({ ok: false, reason: "action_not_found" });
      await expect(
        route.getController()!.executeAction!({ operation: "remove.delete", agentRun: AGENT_RUN }),
      ).resolves.toMatchObject({ ok: false, reason: "action_not_found" });

      const draftFill = await route.getController()!.fillForm!({
        member: "form",
        values: { knowledgeTitle: "Refund SLA Draft" },
      });
      expect(draftFill.ok).toBe(true);

      // Cancel back to view mode: form and form.save unmount cleanly; detail actions remount.
      findButton(element, "Cancel")!.click();
      await vi.waitFor(() => {
        expect(formHeading(element)).toBeNull();
        expect(element.querySelector(".bk-detail-actions")).not.toBeNull();
        expect(findButton(element, "Approve")).toBeTruthy();
        expect(findButton(element, "Delete")).toBeTruthy();
      }, { timeout: 5000 });

      expect(titleInput(element)).toBeNull();
      expect(element.querySelector(".bk-form-actions")).toBeNull();
      await expect(
        route.getController()!.fillForm!({ member: "form", values: { knowledgeTitle: "Blocked After Cancel" } }),
      ).resolves.toMatchObject({ ok: false, reason: "form_not_found" });
      await expect(
        route.getController()!.executeAction!({ operation: "form.save", agentRun: AGENT_RUN }),
      ).resolves.toMatchObject({ ok: false, reason: "action_not_found" });

      // Re-enter edit mode, fill, and save via form.save: returns to view mode and unmounts form.
      findButton(element, "Edit")!.click();
      await vi.waitFor(() => {
        expect(formHeading(element)).toBe("Edit Knowledge");
        expect(titleInput(element)?.value).toBe("Refund SLA");
      }, { timeout: 5000 });

      await expect(
        route.getController()!.executeAction!({ operation: "approve.approve", agentRun: AGENT_RUN }),
      ).resolves.toMatchObject({ ok: false, reason: "action_not_found" });
      await expect(
        route.getController()!.executeAction!({ operation: "remove.delete", agentRun: AGENT_RUN }),
      ).resolves.toMatchObject({ ok: false, reason: "action_not_found" });

      const editFill = await route.getController()!.fillForm!({
        member: "form",
        values: { knowledgeTitle: "Refund SLA Updated" },
      });
      expect(editFill.ok).toBe(true);

      const saved = await route.getController()!.executeAction!({
        operation: "form.save",
        agentRun: AGENT_RUN,
      });
      expect(saved).toMatchObject({ ok: true, kind: "executed", operation: "form.save" });

      await vi.waitFor(() => {
        expect(formHeading(element)).toBeNull();
        expect(element.querySelector(".bk-detail-actions")).not.toBeNull();
        expect(findButton(element, "Approve")).toBeTruthy();
        expect(findButton(element, "Delete")).toBeTruthy();
      }, { timeout: 5000 });

      expect(titleInput(element)).toBeNull();
      expect(element.querySelector(".bk-form-actions")).toBeNull();
      await expect(
        route.getController()!.fillForm!({ member: "form", values: { knowledgeTitle: "Blocked After Save" } }),
      ).resolves.toMatchObject({ ok: false, reason: "form_not_found" });
      await expect(
        route.getController()!.executeAction!({ operation: "form.save", agentRun: AGENT_RUN }),
      ).resolves.toMatchObject({ ok: false, reason: "action_not_found" });

      // View-mode approve and remove actions are mounted and executable when detail is ready.
      const approved = await route.getController()!.executeAction!({
        operation: "approve.approve",
        agentRun: AGENT_RUN,
      });
      expect(approved).toMatchObject({ ok: true, kind: "executed", operation: "approve.approve" });
      expect(route.records.get(ENTRY_B)?.status).toBe("1");

      const removed = await route.getController()!.executeAction!({
        operation: "remove.delete",
        agentRun: AGENT_RUN,
      });
      expect(removed).toMatchObject({ ok: true, kind: "executed", operation: "remove.delete" });
      expect(route.records.has(ENTRY_B)).toBe(false);
    } finally {
      app.unmount();
    }
  });

  it("unmounts approve and remove in create mode, allows form fill/save, and unmounts form again after cancel or save", { timeout: 20000 }, async () => {
    const route = mountKnowledgeRoute({ initialState: { selected: knowledgeRef(ENTRY_B) } });
    const { app, element } = await route.open();
    try {
      await vi.waitFor(() => {
        expect(route.getController()).not.toBeNull();
        expect(findButton(element, "Add Knowledge")).toBeTruthy();
        expect(findButton(element, "Approve")).toBeTruthy();
        expect(findButton(element, "Delete")).toBeTruthy();
      }, { timeout: 5000 });

      // Enter create mode: form mounts, view-mode approve/remove unmount.
      findButton(element, "Add Knowledge")!.click();
      await vi.waitFor(() => {
        expect(formHeading(element)).toBe("Add Knowledge");
        expect(titleInput(element)?.value).toBe("");
        expect(element.querySelector(".bk-form-actions")).not.toBeNull();
      }, { timeout: 5000 });

      expect(element.querySelector(".bk-detail-actions")).toBeNull();
      await expect(
        route.getController()!.executeAction!({ operation: "approve.approve", agentRun: AGENT_RUN }),
      ).resolves.toMatchObject({ ok: false, reason: "action_not_found" });
      await expect(
        route.getController()!.executeAction!({ operation: "remove.delete", agentRun: AGENT_RUN }),
      ).resolves.toMatchObject({ ok: false, reason: "action_not_found" });

      const draftCreate = await route.getController()!.fillForm!({
        member: "form",
        values: { knowledgeTitle: "Discarded Draft" },
      });
      expect(draftCreate.ok).toBe(true);

      // Cancel create: form unmounts and restored ENTRY_B view actions remount.
      findButton(element, "Cancel")!.click();
      await vi.waitFor(() => {
        expect(formHeading(element)).toBeNull();
        expect(route.router.currentRoute.value.query.selected).toBe(ENTRY_B);
        expect(element.querySelector(".bk-detail-actions")).not.toBeNull();
        expect(findButton(element, "Approve")).toBeTruthy();
        expect(findButton(element, "Delete")).toBeTruthy();
      }, { timeout: 5000 });

      expect(titleInput(element)).toBeNull();
      await expect(
        route.getController()!.fillForm!({ member: "form", values: { knowledgeTitle: "Blocked After Create Cancel" } }),
      ).resolves.toMatchObject({ ok: false, reason: "form_not_found" });
      await expect(
        route.getController()!.executeAction!({ operation: "form.save", agentRun: AGENT_RUN }),
      ).resolves.toMatchObject({ ok: false, reason: "action_not_found" });

      // Re-enter create mode, fill and save via form.save: returns to view mode and unmounts form.
      findButton(element, "Add Knowledge")!.click();
      await vi.waitFor(() => {
        expect(formHeading(element)).toBe("Add Knowledge");
        expect(titleInput(element)?.value).toBe("");
      }, { timeout: 5000 });

      const createFill = await route.getController()!.fillForm!({
        member: "form",
        values: { knowledgeTitle: "New Policy Rule" },
      });
      expect(createFill.ok).toBe(true);

      const created = await route.getController()!.executeAction!({
        operation: "form.save",
        agentRun: AGENT_RUN,
      });
      expect(created).toMatchObject({ ok: true, kind: "executed", operation: "form.save" });

      await vi.waitFor(() => {
        expect(formHeading(element)).toBeNull();
        expect(element.querySelector(".bk-detail-actions")).not.toBeNull();
        expect(findButton(element, "Approve")).toBeTruthy();
        expect(findButton(element, "Delete")).toBeTruthy();
      }, { timeout: 5000 });

      expect(titleInput(element)).toBeNull();
      await expect(
        route.getController()!.fillForm!({ member: "form", values: { knowledgeTitle: "Blocked After Create Save" } }),
      ).resolves.toMatchObject({ ok: false, reason: "form_not_found" });
      await expect(
        route.getController()!.executeAction!({ operation: "form.save", agentRun: AGENT_RUN }),
      ).resolves.toMatchObject({ ok: false, reason: "action_not_found" });
    } finally {
      app.unmount();
    }
  });
});

function installMockResizeObserver(initialWidth: number) {
  type ObserverCallback = (entries: ResizeObserverEntry[], observer: ResizeObserver) => void;
  const Original = globalThis.ResizeObserver;
  const observers = new Set<{
    callback: ObserverCallback;
    targets: Set<Element>;
  }>();

  class MockResizeObserver implements ResizeObserver {
    readonly #entry: { callback: ObserverCallback; targets: Set<Element> };
    constructor(callback: ObserverCallback) {
      this.#entry = { callback, targets: new Set() };
      observers.add(this.#entry);
    }
    observe(target: Element) {
      this.#entry.targets.add(target);
      this.#entry.callback(
        [{ target, contentRect: { width: initialWidth, height: 600 } as DOMRectReadOnly } as ResizeObserverEntry],
        this,
      );
    }
    unobserve(target: Element) {
      this.#entry.targets.delete(target);
    }
    disconnect() {
      this.#entry.targets.clear();
      observers.delete(this.#entry);
    }
  }

  globalThis.ResizeObserver = MockResizeObserver;
  return {
    restore() {
      globalThis.ResizeObserver = Original;
    },
  };
}

describe("business-knowledge builtin panel narrow layout detailOpen behavior", () => {
  it("opens detail directly on cold start with ?selected=ENTRY_A in a narrow container", { timeout: 20000 }, async () => {
    const ro = installMockResizeObserver(560);
    const route = mountKnowledgeRoute({ initialState: { selected: knowledgeRef(ENTRY_A) } });
    const { app, element } = await route.open();
    try {
      await vi.waitFor(() => {
        const root = element.querySelector<HTMLElement>(".bk");
        expect(root?.classList.contains("narrow")).toBe(true);
        expect(root?.classList.contains("detail-open")).toBe(true);
        expect(element.textContent).toContain("Orders after 18:00 ship next day.");
      }, { timeout: 5000 });
    } finally {
      app.unmount();
      ro.restore();
    }
  });

  it("keeps narrow container on list view when opened without selected despite fallbackToFirst, then opens detail on agent present", { timeout: 20000 }, async () => {
    const ro = installMockResizeObserver(560);
    const route = mountKnowledgeRoute();
    const { app, element } = await route.open();
    try {
      await vi.waitFor(() => {
        expect(route.getController()).not.toBeNull();
        expect(findListOption(element, "Order Cutoff Rule")).toBeTruthy();
        expect(findListOption(element, "Refund SLA")).toBeTruthy();
        // fallbackToFirst selects ENTRY_A in state, while narrow container keeps the list visible.
        expect(route.router.currentRoute.value.query.selected).toBe(ENTRY_A);
      }, { timeout: 5000 });

      const root = element.querySelector<HTMLElement>(".bk");
      expect(root?.classList.contains("narrow")).toBe(true);
      expect(root?.classList.contains("detail-open")).toBe(false);

      // Agent present targeting ENTRY_B from narrow list view opens detail.
      route.getController()!.applyState({ selected: knowledgeRef(ENTRY_B) });
      await vi.waitFor(() => {
        expect(root?.classList.contains("detail-open")).toBe(true);
        expect(route.router.currentRoute.value.query.selected).toBe(ENTRY_B);
        expect(element.textContent).toContain("Refunds settle within 3 business days.");
      }, { timeout: 5000 });
    } finally {
      app.unmount();
      ro.restore();
    }
  });

  it("supports returning to list and re-opening the same or another entry by click or agent present in a narrow container", { timeout: 20000 }, async () => {
    const ro = installMockResizeObserver(560);
    const route = mountKnowledgeRoute({ initialState: { selected: knowledgeRef(ENTRY_A) } });
    const { app, element } = await route.open();
    try {
      await vi.waitFor(() => {
        const root = element.querySelector<HTMLElement>(".bk");
        expect(route.getController()).not.toBeNull();
        expect(root?.classList.contains("narrow")).toBe(true);
        expect(root?.classList.contains("detail-open")).toBe(true);
        expect(findButton(element, "Back to list")).toBeTruthy();
        expect(findListOption(element, "Order Cutoff Rule")).toBeTruthy();
      }, { timeout: 5000 });

      const root = element.querySelector<HTMLElement>(".bk")!;

      // Return to list in narrow mode.
      findButton(element, "Back to list")!.click();
      await vi.waitFor(() => {
        expect(root.classList.contains("detail-open")).toBe(false);
      }, { timeout: 5000 });

      // Clicking the same entry ENTRY_A again re-opens detail.
      clickListOption(element, "Order Cutoff Rule");
      await vi.waitFor(() => {
        expect(root.classList.contains("detail-open")).toBe(true);
        expect(route.router.currentRoute.value.query.selected).toBe(ENTRY_A);
      }, { timeout: 5000 });

      // Return to list again, then click ENTRY_B.
      findButton(element, "Back to list")!.click();
      await vi.waitFor(() => {
        expect(root.classList.contains("detail-open")).toBe(false);
      }, { timeout: 5000 });

      clickListOption(element, "Refund SLA");
      await vi.waitFor(() => {
        expect(root.classList.contains("detail-open")).toBe(true);
        expect(route.router.currentRoute.value.query.selected).toBe(ENTRY_B);
      }, { timeout: 5000 });

      // Return to list again, then re-present the same ENTRY_B from agent.
      findButton(element, "Back to list")!.click();
      await vi.waitFor(() => {
        expect(root.classList.contains("detail-open")).toBe(false);
      }, { timeout: 5000 });

      route.getController()!.applyState({ selected: knowledgeRef(ENTRY_B) });
      await vi.waitFor(() => {
        expect(root.classList.contains("detail-open")).toBe(true);
        expect(route.router.currentRoute.value.query.selected).toBe(ENTRY_B);
      }, { timeout: 5000 });

      // BK-07: Entering edit mode and clicking Back to list hides the narrow detail pane while preserving the edit draft.
      findButton(element, "Edit")!.click();
      await vi.waitFor(() => {
        expect(formHeading(element)).toBe("Edit Knowledge");
        expect(root.classList.contains("detail-open")).toBe(true);
      }, { timeout: 5000 });

      findButton(element, "Back to list")!.click();
      await vi.waitFor(() => {
        expect(root.classList.contains("detail-open")).toBe(false);
        expect(formHeading(element)).toBe("Edit Knowledge");
      }, { timeout: 5000 });
    } finally {
      app.unmount();
      ro.restore();
    }
  });
});

describe("business-knowledge builtin panel Save button aligns with form.canSubmit", () => {
  it("keeps Save enabled when an edited field is changed back to its original value, matching form.save", { timeout: 20000 }, async () => {
    const route = mountKnowledgeRoute({ initialState: { selected: knowledgeRef(ENTRY_A) } });
    const { app, element } = await route.open();
    try {
      await vi.waitFor(() => {
        expect(findButton(element, "Edit")).toBeTruthy();
      }, { timeout: 5000 });

      findButton(element, "Edit")!.click();
      await vi.waitFor(() => {
        expect(formHeading(element)).toBe("Edit Knowledge");
        expect(titleInput(element)?.value).toBe("Order Cutoff Rule");
      }, { timeout: 5000 });

      // Before any edit, Save is disabled because canSettle/canSubmit is false.
      expect(findButton(element, "Save")?.disabled).toBe(true);

      // Edit title -> Save enables.
      setTitleInput(element, "Order Cutoff Rule Temp");
      await vi.waitFor(() => {
        expect(findButton(element, "Save")?.disabled).toBe(false);
      }, { timeout: 5000 });

      // Revert title back to its original value -> Save stays enabled because the field is still in `submitted` (`canSettle === true`).
      setTitleInput(element, "Order Cutoff Rule");
      await vi.waitFor(() => {
        expect(titleInput(element)?.value).toBe("Order Cutoff Rule");
      }, { timeout: 5000 });
      expect(findButton(element, "Save")?.disabled).toBe(false);

      // Clicking Save submits successfully.
      findButton(element, "Save")!.click();
      await vi.waitFor(() => {
        expect(route.savedCalls).toHaveLength(1);
        expect(route.savedCalls[0]?.targetPrimaryKey).toBe(ENTRY_A);
        expect(route.savedCalls[0]?.values.knowledgeTitle).toBe("Order Cutoff Rule");
        expect(formHeading(element)).toBeNull();
      }, { timeout: 5000 });
    } finally {
      app.unmount();
    }
  });

  it("disables Save while the form is loading or when the form read fails", { timeout: 20000 }, async () => {
    const formReadGate: { release: (() => void) | null } = { release: null };
    let shouldFail = false;
    const route = mountKnowledgeRoute({
      initialState: { selected: knowledgeRef(ENTRY_A) },
      beforeFormRead: async () => {
        if (shouldFail) return;
        await new Promise<void>((resolve) => {
          formReadGate.release = resolve;
        });
      },
      formReadResponse: () => {
        if (!shouldFail) return null;
        return Response.json({ status: "error", message: "Form load failed" }, { status: 500 });
      },
    });
    const { app, element } = await route.open();
    try {
      await vi.waitFor(() => {
        expect(findButton(element, "Add Knowledge")).toBeTruthy();
        expect(findButton(element, "Edit")).toBeTruthy();
      }, { timeout: 5000 });

      // Create mode while form description is still loading: Save must be disabled.
      findButton(element, "Add Knowledge")!.click();
      await vi.waitFor(() => {
        expect(formHeading(element)).toBe("Add Knowledge");
        expect(formReadGate.release).not.toBeNull();
      }, { timeout: 5000 });
      expect(findButton(element, "Save")?.disabled).toBe(true);

      // Release loading; still disabled until a field is set, then enables on edit.
      formReadGate.release!();
      formReadGate.release = null;
      await vi.waitFor(() => {
        expect(titleInput(element)).not.toBeNull();
      }, { timeout: 5000 });
      expect(findButton(element, "Save")?.disabled).toBe(true);

      findButton(element, "Cancel")!.click();
      await vi.waitFor(() => {
        expect(formHeading(element)).toBeNull();
        expect(findButton(element, "Edit")).toBeTruthy();
      }, { timeout: 5000 });

      // Form read failure: once the failed read settles, Save must remain disabled.
      shouldFail = true;
      findButton(element, "Edit")!.click();
      await vi.waitFor(() => {
        expect(formHeading(element)).toBe("Edit Knowledge");
        expect(route.formTargetReads.some((r) => r.dataName === "form")).toBe(true);
        expect(element.textContent).toContain("Form load failed");
      }, { timeout: 5000 });

      expect(titleInput(element)).toBeNull();
      expect(findButton(element, "Save")?.disabled).toBe(true);
    } finally {
      formReadGate.release?.();
      app.unmount();
    }
  });
});

describe("business-knowledge builtin panel batch approve skipped receipt", () => {
  it("shows persistent OperationBatchReceipt with skipped reason for a mixed batch, removes succeeded items from checked, and dismisses manually", { timeout: 20000 }, async () => {
    const route = mountKnowledgeRoute({ initialState: { selected: knowledgeRef(ENTRY_A) } });
    const { app, element } = await route.open();
    try {
      await vi.waitFor(() => {
        expect(findListCheckbox(element, "Order Cutoff Rule")).not.toBeNull();
        expect(findListCheckbox(element, "Refund SLA")).not.toBeNull();
      }, { timeout: 5000 });

      toggleListCheckbox(element, "Order Cutoff Rule", true);
      toggleListCheckbox(element, "Refund SLA", true);

      await vi.waitFor(() => {
        const approveBatch = findBatchActionButton(element, "Approve");
        expect(approveBatch).toBeTruthy();
        expect(approveBatch?.disabled).toBe(false);
      }, { timeout: 5000 });

      findBatchActionButton(element, "Approve")!.click();

      const confirmButton = await vi.waitFor(() => {
        const button = document.body.querySelector<HTMLButtonElement>(".el-message-box__btns .el-button--primary");
        expect(button).not.toBeNull();
        return button!;
      }, { timeout: 5000 });
      confirmButton.click();

      const receiptSelector = ".sdk-object-list-batch-receipt";
      await vi.waitFor(() => {
        expect(element.querySelector(receiptSelector)).not.toBeNull();
      }, { timeout: 5000 });

      expect(route.dispatchedActions).toEqual([{ operationId: "approveAll.approve", targetPrimaryKey: ENTRY_B }]);
      expect(element.querySelectorAll(".sdk-batch-receipt")).toHaveLength(1);
      const items = [...element.querySelectorAll(`${receiptSelector} li`)];
      expect(items.map((item) => item.getAttribute("data-outcome"))).toEqual(["skipped", "success"]);
      expect(items[0]?.textContent).toContain("Order Cutoff Rule");
      expect(items[0]?.textContent).toContain(ALREADY_APPROVED_REASON);
      expect(items[1]?.textContent).toContain("Refund SLA");
      expect(element.querySelector(`${receiptSelector} [role="status"] p`)?.textContent).toContain("1 skipped");

      // Succeeded entry is removed from checked; skipped entry stays checked.
      await vi.waitFor(() => {
        expect(findListCheckbox(element, "Order Cutoff Rule")?.checked).toBe(true);
        expect(findListCheckbox(element, "Refund SLA")?.checked).toBe(false);
      }, { timeout: 5000 });

      // Receipt remains visible until manually dismissed.
      expect(element.querySelector(receiptSelector)).not.toBeNull();
      element.querySelector<HTMLButtonElement>(`${receiptSelector} .sdk-batch-receipt-dismiss`)!.click();
      await vi.waitFor(() => {
        expect(element.querySelector(receiptSelector)).toBeNull();
      }, { timeout: 5000 });
      expect(findListCheckbox(element, "Order Cutoff Rule")?.checked).toBe(true);
    } finally {
      app.unmount();
    }
  });

  it("hides batch approve when all checked items are already approved and renders all-skipped receipt when items become approved before dispatch", { timeout: 20000 }, async () => {
    const initialRecords: KnowledgeRecord[] = [
      {
        primaryKey: ENTRY_A,
        knowledgeTitle: "Order Cutoff Rule",
        knowledgeText: "Orders after 18:00 ship next day.",
        knowledgeTags: ["orders"],
        status: "1",
      },
      {
        primaryKey: ENTRY_B,
        knowledgeTitle: "Refund SLA",
        knowledgeText: "Refunds settle within 3 business days.",
        knowledgeTags: ["billing"],
        status: "0",
      },
      {
        primaryKey: ENTRY_C,
        knowledgeTitle: "Shipping SLA",
        knowledgeText: "Domestic orders ship within 24 hours.",
        knowledgeTags: ["shipping"],
        status: "0",
      },
    ];
    const route = mountKnowledgeRoute({ initialState: { selected: knowledgeRef(ENTRY_A) }, initialRecords });
    const { app, element } = await route.open();
    try {
      await vi.waitFor(() => {
        expect(findListCheckbox(element, "Order Cutoff Rule")).not.toBeNull();
        expect(findListCheckbox(element, "Refund SLA")).not.toBeNull();
        expect(findListCheckbox(element, "Shipping SLA")).not.toBeNull();
      }, { timeout: 5000 });

      // Checking only already-approved ENTRY_A hides approveAll via hideWhenUnavailable.
      toggleListCheckbox(element, "Order Cutoff Rule", true);
      await vi.waitFor(() => {
        expect(findBatchActionButton(element, "Delete")).toBeTruthy();
      }, { timeout: 5000 });
      expect(findBatchActionButton(element, "Approve")).toBeUndefined();
      toggleListCheckbox(element, "Order Cutoff Rule", false);

      // Check two pending entries so approveAll is visible, then mark both approved before dispatch.
      toggleListCheckbox(element, "Refund SLA", true);
      toggleListCheckbox(element, "Shipping SLA", true);
      await vi.waitFor(() => {
        const approveBatch = findBatchActionButton(element, "Approve");
        expect(approveBatch).toBeTruthy();
        expect(approveBatch?.disabled).toBe(false);
      }, { timeout: 5000 });

      route.records.set(ENTRY_B, { ...route.records.get(ENTRY_B)!, status: "1" });
      route.records.set(ENTRY_C, { ...route.records.get(ENTRY_C)!, status: "1" });

      findBatchActionButton(element, "Approve")!.click();

      const confirmButton = await vi.waitFor(() => {
        const button = document.body.querySelector<HTMLButtonElement>(".el-message-box__btns .el-button--primary");
        expect(button).not.toBeNull();
        return button!;
      }, { timeout: 5000 });
      confirmButton.click();

      const receiptSelector = ".sdk-object-list-batch-receipt";
      await vi.waitFor(() => {
        expect(element.querySelector(receiptSelector)).not.toBeNull();
      }, { timeout: 5000 });

      expect(route.dispatchedActions).toHaveLength(0);
      const items = [...element.querySelectorAll(`${receiptSelector} li`)];
      expect(items.map((item) => item.getAttribute("data-outcome"))).toEqual(["skipped", "skipped"]);
      expect(items[0]?.textContent).toContain("Refund SLA");
      expect(items[0]?.textContent).toContain(ALREADY_APPROVED_REASON);
      expect(items[1]?.textContent).toContain("Shipping SLA");
      expect(items[1]?.textContent).toContain(ALREADY_APPROVED_REASON);
      expect(element.querySelector(`${receiptSelector} [role="status"] p`)?.textContent).toContain("2 skipped");

      // Neither entry succeeded, so both remain checked until the user clears or dismisses the receipt.
      expect(findListCheckbox(element, "Refund SLA")?.checked).toBe(true);
      expect(findListCheckbox(element, "Shipping SLA")?.checked).toBe(true);

      element.querySelector<HTMLButtonElement>(`${receiptSelector} .sdk-batch-receipt-dismiss`)!.click();
      await vi.waitFor(() => {
        expect(element.querySelector(receiptSelector)).toBeNull();
      }, { timeout: 5000 });
    } finally {
      app.unmount();
    }
  });
});

describe("business-knowledge builtin panel same-page unsaved navigation guard", () => {
  it("guards selection before mutation and rolls back mode changes that would discard the draft", { timeout: 20000 }, async () => {
    const route = mountKnowledgeRoute({ initialState: { selected: knowledgeRef(ENTRY_A) } });
    const { app, element } = await route.open();
    try {
      await vi.waitFor(() => {
        expect(route.getController()).not.toBeNull();
        expect(findButton(element, "Edit")).toBeTruthy();
      }, { timeout: 5000 });

      findButton(element, "Edit")!.click();
      await vi.waitFor(() => {
        expect(formHeading(element)).toBe("Edit Knowledge");
        expect(titleInput(element)?.value).toBe("Order Cutoff Rule");
      }, { timeout: 5000 });

      // Agent or human edits leave the form dirty and signal display-dirty to the panel host.
      const fillResult = await route.getController()!.fillForm!({
        member: "form",
        values: { "/knowledgeTitle": "Order Cutoff Rule Unsaved Draft" },
      });
      expect(fillResult).toMatchObject({
        ok: true,
        member: "form",
        filledFields: ["/knowledgeTitle"],
      });
      await vi.waitFor(() => {
        expect(route.onDisplayDirty).toHaveBeenLastCalledWith(true);
        expect(titleInput(element)?.value).toBe("Order Cutoff Rule Unsaved Draft");
        expect(element.querySelector(".sdk-owner-form-changed")).not.toBeNull();
      }, { timeout: 5000 });

      const controller = route.getController()!;
      const formEl = element.querySelector('[data-field="/knowledgeTitle"]');
      // BK-03: editing clears directory `selected`, so the current address has no `selected` query.
      const currentAddress = use.path;
      const blockedCases = [
        { address: `${use.path}?selected=${ENTRY_B}` },
        { address: use.path, state: { selected: knowledgeRef(ENTRY_B) } },
        { address: `${use.path}?selected=${ENTRY_A}` },
        { address: use.path, state: { selected: knowledgeRef(ENTRY_A) } },
      ] as const;

      for (const next of blockedCases) {
        expect(controller.blocksNavigation!(next)).toBe(true);
      }

      // No-op presentations matching the current edit state are not blocked.
      const allowedCases = [
        { address: currentAddress },
        { address: currentAddress, state: { mode: "edit" } },
      ] as const;
      for (const next of allowedCases) {
        expect(controller.blocksNavigation!(next)).toBe(false);
      }

      const listPatch = { address: use.path, state: { search: "Refund", status: "pending", checked: [knowledgeRef(ENTRY_B)] } };
      expect(controller.blocksNavigation!(listPatch)).toBe(false);
      expect(await controller.probePresentation!(listPatch)).toBe(true);
      expect(element.querySelector('[data-field="/knowledgeTitle"]')).toBe(formEl);
      expect(titleInput(element)?.value).toBe("Order Cutoff Rule Unsaved Draft");

      for (const mode of ["create", "view"]) {
        const next = { address: currentAddress, state: { mode } };
        expect(controller.blocksNavigation!(next)).toBe(false);
        expect(await controller.probePresentation!(next)).toBe(false);
        expect(formHeading(element)).toBe("Edit Knowledge");
        expect(titleInput(element)?.value).toBe("Order Cutoff Rule Unsaved Draft");
      }
      expect(route.confirmLeaveUnsaved).not.toHaveBeenCalled();
      expect(element.querySelector(".sdk-owner-form-changed")).not.toBeNull();
      expect(route.onDisplayDirty).toHaveBeenLastCalledWith(true);

      // Saving clears the dirty flag so same-page state changes are no longer blocked.
      findButton(element, "Save")!.click();
      await vi.waitFor(() => {
        expect(route.savedCalls).toHaveLength(1);
        expect(formHeading(element)).toBeNull();
        expect(route.onDisplayDirty).toHaveBeenLastCalledWith(false);
      }, { timeout: 5000 });
      expect(controller.blocksNavigation!({ address: use.path, state: { mode: "view" } })).toBe(false);
    } finally {
      app.unmount();
    }
  });
});

