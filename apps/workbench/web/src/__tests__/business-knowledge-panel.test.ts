import { afterEach, describe, expect, it, vi } from "vitest";
import { defineComponent, h } from "vue";
import { createMemoryHistory, createRouter, RouterView } from "vue-router";
import type { DisplayPageController } from "../../../../../packages/agent-shell-ui/src/conversation-display";
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
      ? { method: "PUT", path: `/knowledge/${primaryKey}`, bodySchema: {}, draftOperation: "knowledge.update" }
      : { method: "POST", path: "/knowledge", bodySchema: {}, draftOperation: "knowledge.create" },
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
  confirmLeave?: () => Promise<boolean>;
  beforeListRead?: () => Promise<void>;
} = {}) {
  const records = new Map<string, KnowledgeRecord>([
    [
      ENTRY_A,
      {
        primaryKey: ENTRY_A,
        knowledgeTitle: "Order Cutoff Rule",
        knowledgeText: "Orders after 18:00 ship next day.",
        knowledgeTags: ["orders"],
        status: "1",
      },
    ],
    [
      ENTRY_B,
      {
        primaryKey: ENTRY_B,
        knowledgeTitle: "Refund SLA",
        knowledgeText: "Refunds settle within 3 business days.",
        knowledgeTags: ["billing"],
        status: "0",
      },
    ],
  ]);
  const savedCalls: SavedCall[] = [];
  const formTargetReads: Array<{ dataName: string; targetPrimaryKey: string | null }> = [];
  let controller: DisplayPageController | null = null;
  let intentCounter = 0;
  const preparedIntents = new Map<string, { operationId: string; call: PanelOperationCall }>();

  const confirmLeaveUnsaved = vi.fn(async () => (options.confirmLeave ? options.confirmLeave() : true));

  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      {
        path: use.path,
        component: PanelApplicationRoute,
        props: {
          applicationId: APP_ID,
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
        if (body.dataName === "createForm") {
          formTargetReads.push({ dataName: "createForm", targetPrimaryKey: null });
          return Response.json({
            status: "ready",
            value: formDescription(null, { knowledgeTitle: "", knowledgeText: "", status: "0" }),
          });
        }
        const ref = (body.inputs.knowledge ?? body.inputs.target) as { primaryKey?: string } | undefined;
        const record = ref?.primaryKey ? records.get(ref.primaryKey) : undefined;
        formTargetReads.push({ dataName: "form", targetPrimaryKey: ref?.primaryKey ?? null });
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
      const { operationId, call } = request.body as { operationId: string; call: PanelOperationCall };
      intentCounter += 1;
      const intentId = `22222222-2222-4222-8222-22222222222${intentCounter}`;
      preparedIntents.set(intentId, { operationId, call });
      return Response.json({
        intentId,
        operationId,
        label: "Save",
        confirmation: { kind: "none" },
      });
    }
    const intentRead = /^\/api\/panel-operation-intents\/([^/?]+)$/.exec(path);
    if (intentRead && request.method === "GET") {
      const entry = preparedIntents.get(intentRead[1]!);
      return Response.json({
        intentId: intentRead[1],
        operationId: entry?.operationId ?? "form.save",
        label: "Save",
        confirmation: { kind: "none" },
      });
    }
    const intentDispatch = /^\/api\/panel-operations\/intents\/([^/]+)\/dispatch$/.exec(path);
    if (intentDispatch && request.method === "POST") {
      const entry = preparedIntents.get(intentDispatch[1]!)!;
      const target = entry.call.target as { primaryKey?: string } | undefined;
      const input = entry.call.input as PanelFormSaveInput | undefined;
      const values = (input?.values ?? {}) as Record<string, unknown>;
      const targetPrimaryKey = target?.primaryKey ?? null;
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
    formTargetReads,
    confirmLeaveUnsaved,
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
          entryAccess: ["domain-member"],
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
        expect(route.router.currentRoute.value.query.selected).toBe(ENTRY_B);
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

      // Decline leaving: selected reverts to A, form stays on A with unsaved edits intact.
      resolveConfirm!(false);
      resolveConfirm = null;

      await vi.waitFor(() => {
        expect(route.router.currentRoute.value.query.selected).toBe(ENTRY_A);
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
