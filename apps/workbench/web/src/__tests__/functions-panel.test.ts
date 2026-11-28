import { afterEach, describe, expect, it, vi } from "vitest";
import { defineComponent, h, nextTick, onBeforeUnmount } from "vue";
import { createMemoryHistory, createRouter, RouterView } from "vue-router";
import { appsSdkComponentCatalogEntrySchema } from "@ontomato/contracts/apps-sdk";
import { expandPanelAuthoringMember } from "@ontomato/contracts/panel-authoring-expansion";
import { panelAuthoringManifestSchema } from "@ontomato/contracts/panel-authoring";
import { definePanel, type PanelOperationCall } from "@ontomato/contracts/panel-manifest";
import {
  panelAddress,
  panelAddressState,
  type ProductPanelReadRequest,
} from "@ontomato/contracts/panel-host";
import { DELETE_FUNCTION, FUNCTION, platformObjectTypes } from "@ontomato/contracts/platform-object-types";
import { platformTypeTableEntrySchema } from "@ontomato/contracts/platform-type-table";
import type { ProductProjection } from "@ontomato/contracts/product-panels";
import { provideUnsavedChanges } from "@ontomato/platform-shell";
import { components } from "../../../../../packages/apps-sdk/src/catalogue";
import { useApplicationCatalog } from "../../../../../packages/platform-web/src/catalog";
import { DETAIL_SELECTIONS, detailSelectionGuard } from "../../../../../packages/platform-web/src/detail-selection";
import PanelApplicationRoute from "../../../../../packages/platform-web/src/pages/PanelApplicationRoute.vue";
import catalogSource from "../../../../../packages/ontology-manager/resources/builtin-panels/functions/panel.json";
import catalogHtml from "../../../../../packages/ontology-manager/resources/builtin-panels/functions/panel.html?raw";
import catalogModule from "../../../../../packages/ontology-manager/resources/builtin-panels/functions/panel.mjs?raw";
import detailSource from "../../../../../packages/ontology-manager/resources/builtin-panels/function-detail/panel.json";
import detailHtml from "../../../../../packages/ontology-manager/resources/builtin-panels/function-detail/panel.html?raw";
import detailModule from "../../../../../packages/ontology-manager/resources/builtin-panels/function-detail/panel.mjs?raw";
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
  sentPanelReadItems,
  type Sent,
} from "./panel-frame";

const APP_ID = "ontology";
const CATALOG_PATH = "/ontology/assets/functions";
const DETAIL_PATH = "/ontology/assets/functions/detail";

const catalogUse = panelUse(
  "ontology-functions",
  "ontology-functions",
  "builtin-product-ontology-functions",
  CATALOG_PATH,
);
const detailUse = panelUse(
  "ontology-function-detail",
  "function-detail",
  "builtin-product-ontology-function-detail",
  DETAIL_PATH,
);

const functionTypeEntry = platformTypeTableEntrySchema.parse({
  ...platformObjectTypes[FUNCTION],
  operations: [
    {
      id: `${FUNCTION}.save`,
      kind: "form.save",
      effect: "write",
      batch: false,
      inputSchema: { type: "object" },
      target: { source: "draft" },
    },
    {
      id: DELETE_FUNCTION,
      kind: "action",
      effect: "write",
      batch: false,
      inputSchema: { type: "object" },
      target: { source: "input", input: "function" },
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

function buildBuiltinPanel(
  panelId: string,
  name: string,
  source: typeof catalogSource | typeof detailSource,
  html: string,
  module: string,
) {
  const { members: authoring, ...manifest } = panelAuthoringManifestSchema.parse(source.manifest);
  const projections = new Map<string, ProductProjection>();
  const members = Object.fromEntries(
    Object.entries(authoring).map(([memberName, definition]) => {
      if (!("component" in definition)) throw new Error(`Expected an authored projection for ${memberName}`);
      const { projection, placement } = expandPanelAuthoringMember(memberName, definition, {
        state: manifest.state,
        typeTable: { objectTypes: { [FUNCTION]: functionTypeEntry } },
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
    panel: {
      ...panelRecord(panelId, name, definePanel({ ...manifest, members })),
      visibility: "platform" as const,
      domainId: null,
      ownerId: null,
      editable: false as const,
      content: { html, module, messages: source.content.messages },
    },
    projections,
  };
}

const builtCatalog = buildBuiltinPanel(catalogUse.panelId, "Functions", catalogSource, catalogHtml, catalogModule);
const builtDetail = buildBuiltinPanel(detailUse.panelId, "Function detail", detailSource, detailHtml, detailModule);
const allProjections = new Map<string, ProductProjection>([
  ...builtCatalog.projections.entries(),
  ...builtDetail.projections.entries(),
]);

interface FunctionFixture {
  id: string;
  name: string;
  description: string;
  operation: "OPERATION_READ" | "OPERATION_WRITE";
  operationLabel: string;
  logic: string;
  queryPackage?: Record<string, unknown>;
  code?: string;
  deleteUnavailableReason?: string;
}

const initialFunctions = (): FunctionFixture[] => [
  {
    id: "fn-read-1",
    name: "Revenue query",
    description: "Calculates monthly revenue by region",
    operation: "OPERATION_READ",
    operationLabel: "Read",
    logic: "Sum paid order totals by month",
    queryPackage: { manifest: { version: 1 }, files: [] },
  },
  {
    id: "fn-write-1",
    name: "Approve order",
    description: "Updates order status after approval",
    operation: "OPERATION_WRITE",
    operationLabel: "Write",
    logic: "Set order state to approved",
    code: "# ontomato-python:2\ndef run(order_id):\n    return {'ok': True}\n",
  },
];

function ownerFieldsFor(fn: FunctionFixture, existing: boolean) {
  const fields = [
    {
      path: "/name",
      label: "Name",
      required: true,
      readOnly: false,
      valueSchema: { type: "string" },
      control: { kind: "text", multiline: false },
    },
    {
      path: "/description",
      label: "Description",
      required: false,
      readOnly: false,
      valueSchema: { type: "string" },
      control: { kind: "text", multiline: true },
    },
    {
      path: "/operation",
      label: "Operation",
      required: false,
      readOnly: existing,
      valueSchema: { type: "string", enum: ["OPERATION_READ", "OPERATION_WRITE"] },
      control: {
        kind: "select",
        presentation: "radio",
        options: [
          { value: "OPERATION_READ", label: "Read", description: null, disabled: false, disabledReason: null },
          { value: "OPERATION_WRITE", label: "Write", description: null, disabled: false, disabledReason: null },
        ],
      },
      refreshOnChange: true,
    },
    ...(fn.operation === "OPERATION_WRITE" ? [{
      path: "/code",
      label: "Code",
      required: false,
      readOnly: false,
      valueSchema: { type: "string" },
      control: { kind: "text", multiline: true },
    }] : []),
    {
      path: "/logic",
      label: "Logic",
      required: false,
      readOnly: false,
      valueSchema: { type: "string" },
      control: { kind: "text", multiline: true },
    },
  ];
  return fields;
}

function toRecord(fn: FunctionFixture) {
  return {
    primaryKey: fn.id,
    label: fn.name,
    ...(fn.description ? { subtitle: fn.description } : {}),
    fieldLabels: { operation: "Operation" },
    fields: { operation: fn.operationLabel },
  };
}

function toFormValue(fn: FunctionFixture) {
  return {
    name: fn.name,
    description: fn.description,
    operation: fn.operation,
    logic: fn.logic,
  };
}

const SAVE_DESCRIPTOR = {
  kind: "form.save",
  handlerRef: `${FUNCTION}.save`,
  label: "Save",
  effect: "write",
  target: { source: "input", input: "target" },
  inputSchema: {},
  resultSchema: {},
  batch: false,
};

const CREATE_SAVE_DESCRIPTOR = {
  ...SAVE_DESCRIPTOR,
  target: { source: "draft", slot: "definition" },
};

const DELETE_DESCRIPTOR = (unavailableReason?: string) => ({
  kind: "action",
  handlerRef: DELETE_FUNCTION,
  label: "Delete function",
  effect: "write",
  target: { source: "input", input: "function" },
  inputSchema: {},
  resultSchema: {},
  batch: false,
  ...(unavailableReason ? { unavailable: { code: "FUNCTION_REFERENCED", reason: unavailableReason } } : {}),
});

type DataReadRequest = Extract<ProductPanelReadRequest, { dataName: string }>;

interface HarnessOptions {
  initialPath?: string;
  functions?: FunctionFixture[];
  onRecordRead?: (primaryKey: string) => Response | Promise<Response> | undefined;
  askUnsaved?: () => Promise<boolean>;
}

async function clickDialogButton(label: string) {
  let target: HTMLButtonElement | undefined;
  await vi.waitFor(() => {
    target = [...document.body.querySelectorAll<HTMLButtonElement>(".el-message-box button, .el-dialog button")]
      .find((button) => button.textContent?.trim() === label);
    expect(target).toBeDefined();
  }, { timeout: 3000 });
  target!.click();
}

async function mountFunctionsApp(options: HarnessOptions = {}) {
  const store = options.functions ? [...options.functions] : initialFunctions();
  let createdSeq = 0;
  const savedPayloads: Array<{ operationId: string; call: PanelOperationCall }> = [];
  const deletedIds: string[] = [];

  const intents = humanIntents(
    (operationId, call) => {
      if (operationId === "definition.save") {
        savedPayloads.push({ operationId, call });
        const input = (call.input ?? {}) as { values?: Record<string, unknown>; submittedFields?: string[] };
        const inputValues = (input.values ?? {}) as Record<string, unknown>;
        const submittedValues = (baseline: Record<string, unknown>) => {
          if (!Array.isArray(input.submittedFields)) return { ...inputValues };
          const merged = { ...baseline };
          for (const path of input.submittedFields) {
            const key = path.replace(/^\//, "");
            if (Object.hasOwn(inputValues, key)) merged[key] = inputValues[key];
          }
          return merged;
        };
        const target = call.target as { kind?: string; primaryKey?: string } | undefined;
        if (target?.kind === "object" && target.primaryKey) {
          const existing = store.find((item) => item.id === target.primaryKey);
          if (existing) {
            const accepted = submittedValues(toFormValue(existing) as Record<string, unknown>);
            if (typeof accepted.name === "string") existing.name = accepted.name;
            if (typeof accepted.description === "string") existing.description = accepted.description;
            if (typeof accepted.logic === "string") existing.logic = accepted.logic;
          }
          return {
            kind: "success",
            data: { primaryKey: target.primaryKey },
            affected: {
              objects: [{ objectType: FUNCTION, primaryKey: target.primaryKey }],
              objectTypes: [FUNCTION],
            },
          };
        }
        createdSeq += 1;
        const newId = `fn-created-${createdSeq}`;
        const accepted = submittedValues({
          name: "",
          description: "",
          operation: "OPERATION_READ",
          logic: "",
        });
        const operation = accepted.operation === "OPERATION_WRITE" ? "OPERATION_WRITE" : "OPERATION_READ";
        store.push({
          id: newId,
          name: typeof accepted.name === "string" ? accepted.name : "Untitled function",
          description: typeof accepted.description === "string" ? accepted.description : "",
          operation,
          operationLabel: operation === "OPERATION_WRITE" ? "Write" : "Read",
          logic: typeof accepted.logic === "string" ? accepted.logic : "",
        });
        return {
          kind: "success",
          data: { primaryKey: newId },
          created: { objectType: FUNCTION, primaryKey: newId },
          affected: {
            objects: [{ objectType: FUNCTION, primaryKey: newId }],
            objectTypes: [FUNCTION],
          },
        };
      }
      if (operationId === "remove.delete") {
        const target = call.target as { kind?: string; primaryKey?: string } | undefined;
        const id = target?.primaryKey ?? "";
        deletedIds.push(id);
        const idx = store.findIndex((item) => item.id === id);
        if (idx >= 0) store.splice(idx, 1);
        return {
          kind: "success",
          data: { deleted: true },
          affected: {
            objects: [],
            objectTypes: [FUNCTION],
            removed: id ? [{ objectType: FUNCTION, primaryKey: id }] : [],
          },
        };
      }
      return { kind: "success", data: {}, affected: { objects: [], objectTypes: [] } };
    },
    { source: "input", input: "target" },
    {
      creates: true,
      admitted: (member, inputs) => {
        const selected = (inputs.target ?? inputs.function ?? inputs.selected) as { primaryKey?: string } | null | undefined;
        if (member === "definition") {
          return selected?.primaryKey ? { save: SAVE_DESCRIPTOR } : { save: CREATE_SAVE_DESCRIPTOR };
        }
        if (member === "remove") {
          if (!selected?.primaryKey) return {};
          const fn = store.find((item) => item.id === selected.primaryKey);
          return { delete: DELETE_DESCRIPTOR(fn?.deleteUnavailableReason) };
        }
        return {};
      },
    },
  );

  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      {
        path: CATALOG_PATH,
        component: PanelApplicationRoute,
        props: { applicationId: APP_ID },
      },
      {
        path: DETAIL_PATH,
        component: PanelApplicationRoute,
        props: { applicationId: APP_ID },
      },
      {
        path: `${CATALOG_PATH}/:id`,
        component: PanelApplicationRoute,
        props: { applicationId: APP_ID },
      },
    ],
  });
  router.beforeEach(detailSelectionGuard(DETAIL_SELECTIONS));

  useApplicationCatalog().applications.value = [
    {
      id: APP_ID,
      kind: "native",
      names: { en: "Ontology manager" },
      descriptions: {},
      icon: "ontology",
      rail: "apps",
      category: "build",
      sort: 10,
      entry: { path: "/ontology", renderer: "ontology" },
      scheduleAdapter: null,
      releaseId: null,
      panelUses: [catalogUse, detailUse],
    },
  ];

  const sent = installPlatform((request: Sent) => {
    const intentResponse = intents(request);
    if (intentResponse) return intentResponse;

    const { path } = request;
    if (path === `/api/data-query/platform/applications/${APP_ID}/panel-uses`) {
      return Response.json({
        data: {
          applicationId: APP_ID,
          entry: { path: "/ontology", renderer: "ontology" },
          panelUses: [catalogUse, detailUse],
        },
      });
    }
    if (path === `/api/product-panels/${catalogUse.panelId}`) return panelAnswer(builtCatalog.panel, request);
    if (path === `/api/product-panels/${catalogUse.panelId}/snapshot`) {
      return panelSnapshot(builtCatalog.panel, Object.fromEntries(builtCatalog.projections), request);
    }
    if (path === `/api/product-panels/${detailUse.panelId}`) return panelAnswer(builtDetail.panel, request);
    if (path === `/api/product-panels/${detailUse.panelId}/snapshot`) {
      return panelSnapshot(builtDetail.panel, Object.fromEntries(builtDetail.projections), request);
    }
    const projMatch = /^\/api\/product-projections\/([^/]+)$/.exec(path);
    if (projMatch) {
      const projection = allProjections.get(projMatch[1]!);
      if (projection) return Response.json({ projection });
    }
    if (path === "/api/product-panels/read") {
      const body = request.body as DataReadRequest;
      const member = body.memberPath.at(-1)!.member;
      if (member === "list" && body.dataName === "rows") {
        const search = String((body.runtimeParams?.search ?? body.inputs?.search ?? "")).trim().toLowerCase();
        const kept = search
          ? store.filter((item) => `${item.name} ${item.description}`.toLowerCase().includes(search))
          : store;
        return Response.json({
          status: "ready",
          value: { rows: kept.map(toRecord), total: kept.length },
        });
      }
      if (member === "header" && body.dataName === "record") {
        const selected = (body.inputs?.target ?? body.inputs?.selected) as { primaryKey?: string } | undefined;
        const key = selected?.primaryKey ?? "";
        const custom = options.onRecordRead?.(key);
        if (custom) return custom;
        const fn = store.find((item) => item.id === key);
        if (!fn) return Response.json({ status: "empty" });
        return Response.json({ status: "ready", value: toRecord(fn) });
      }
      if (member === "definition" && body.dataName === "form") {
        const selected = (body.inputs?.target ?? body.inputs?.selected) as { primaryKey?: string } | undefined;
        const fn = store.find((item) => item.id === selected?.primaryKey);
        if (!fn) return Response.json({ status: "empty" });
        return Response.json({
          status: "ready",
          value: {
            fields: ownerFieldsFor(fn, true),
            values: toFormValue(fn),
            errors: [],
            revision: 1,
            save: { method: "POST", path: "/function/save", bodySchema: {} },
          },
        });
      }
      if (member === "definition" && body.dataName === "createForm") {
        const draft: FunctionFixture = {
          id: "",
          name: "",
          description: "",
          operation: "OPERATION_READ",
          operationLabel: "Read",
          logic: "",
        };
        const checked = (body.runtimeParams?.values ?? {}) as Record<string, unknown>;
        const values = { ...toFormValue(draft), ...checked };
        const shown: FunctionFixture = {
          ...draft,
          operation: values.operation === "OPERATION_WRITE" ? "OPERATION_WRITE" : "OPERATION_READ",
        };
        return Response.json({
          status: "ready",
          value: {
            fields: ownerFieldsFor(shown, false),
            values,
            errors: [],
            save: { method: "POST", path: "/function/save", bodySchema: {} },
          },
        });
      }
    }
    return nothingAt(request);
  }, router);

  await router.push(options.initialPath ?? CATALOG_PATH);
  const Shell = defineComponent({
    setup() {
      if (options.askUnsaved) {
        const unsaved = provideUnsavedChanges(options.askUnsaved);
        const removeLeaveCheck = router.beforeEach((to) => unsaved.allows(to.path));
        onBeforeUnmount(removeLeaveCheck);
      }
      return () => h(RouterView);
    },
  });
  const mounted = mountPlatformPage(() => h(Shell), router);
  return { ...mounted, router, sent, store, savedPayloads, deletedIds };
}

afterEach(() => {
  leaveFrame();
  useApplicationCatalog().applications.value = [];
  document.body.innerHTML = "";
});

describe("Functions two-entry panels (catalog -> detail)", () => {
  it("renders a full-width catalog table without two-pane split or fallbackToFirst, navigates on row click and New function", async () => {
    const app = await mountFunctionsApp();
    try {
      await vi.waitFor(() => {
        expect(app.element.textContent).toContain("Revenue query");
        expect(app.element.textContent).toContain("Approve order");
      }, { timeout: 3000 });

      // Single page header, full-width table, no two-pane split, no form mounted on catalog.
      expect(app.element.querySelectorAll(".sdk-page-header")).toHaveLength(1);
      expect(app.element.querySelector("two-pane-layout")).toBeNull();
      expect(app.element.querySelector(".sdk-two-pane")).toBeNull();
      expect(app.element.querySelector(".sdk-owner-form")).toBeNull();
      expect(app.element.querySelector(".sdk-object-list-table")).not.toBeNull();
      expect(app.element.querySelector(".sdk-object-list-row-chevron")).not.toBeNull();

      // Never auto-selects the first row into detail or URL state.
      expect(app.router.currentRoute.value.path).toBe(CATALOG_PATH);
      expect(panelAddressState(app.router.currentRoute.value.fullPath)).toEqual({});

      // Search updates deepLink `search` without leaking pagination into the URL.
      const searchInput = app.element.querySelector<HTMLInputElement>(".sdk-object-list-search")!;
      expect(searchInput).not.toBeNull();
      searchInput.value = "Revenue";
      searchInput.dispatchEvent(new Event("input"));
      await vi.waitFor(() => {
        expect(app.element.textContent).toContain("Revenue query");
        expect(app.element.textContent).not.toContain("Approve order");
      }, { timeout: 3000 });
      expect(panelAddressState(app.router.currentRoute.value.fullPath)).toEqual({ search: "Revenue" });
      expect(app.router.currentRoute.value.fullPath).not.toContain("page=");

      // Clicking a row navigates to the non-menu detail entry with ?selected=<id>.
      const row = [...app.element.querySelectorAll<HTMLTableRowElement>(".sdk-object-list-table tbody tr")]
        .find((tr) => tr.textContent?.includes("Revenue query"))!;
      row.click();
      await vi.waitFor(() => {
        expect(app.router.currentRoute.value.path).toBe(DETAIL_PATH);
        expect(panelAddressState(app.router.currentRoute.value.fullPath)).toEqual({ selected: "fn-read-1" });
      }, { timeout: 3000 });

      // Navigating back to catalog and clicking "New function" opens detail in create mode.
      await app.router.push(CATALOG_PATH);
      const newBtn = await vi.waitFor(() => {
        const button = [...app.element.querySelectorAll<HTMLButtonElement>(".sdk-page-header button")]
          .find((candidate) => candidate.textContent?.includes("New function")
            && candidate.closest<HTMLElement>(".panel-host")?.style.display !== "none");
        expect(button).toBeDefined();
        expect(button?.disabled).toBe(false);
        return button!;
      }, { timeout: 3000 });
      newBtn.click();
      await vi.waitFor(() => {
        expect(app.router.currentRoute.value.path).toBe(DETAIL_PATH);
        expect(panelAddressState(app.router.currentRoute.value.fullPath)).toEqual({ mode: "create" });
      }, { timeout: 3000 });
    } finally {
      app.app.unmount();
    }
  });

  it("renders single PageHeader + header draft bar, deduplicates /name to one field, and supports discard, save, and leave guard", async () => {
    let allowLeave = false;
    const askUnsaved = vi.fn(async () => allowLeave);
    const app = await mountFunctionsApp({
      initialPath: panelAddress(DETAIL_PATH, { selected: "fn-read-1" }),
      askUnsaved,
    });
    try {
      await vi.waitFor(() => {
        expect(app.element.querySelector('[data-field="/name"] input')).not.toBeNull();
      }, { timeout: 3000 });

      // Single PageHeader with Back button, object title, and deduplicated /name input (exactly one).
      expect(app.element.querySelectorAll(".sdk-page-header")).toHaveLength(1);
      expect(app.element.querySelector(".sdk-page-header-back")?.textContent?.trim()).toBe("Back to functions");
      expect(app.element.querySelector(".sdk-page-header")?.textContent).toContain("Revenue query");
      expect(app.element.querySelectorAll('[data-field="/name"]')).toHaveLength(1);
      expect(app.element.querySelectorAll('[data-field="/name"] input')).toHaveLength(1);
      // Form footer action bar is hidden (`actions: "none"`).
      expect(app.element.querySelector(".sdk-owner-form-actions")).toBeNull();

      const saveBtn = () => app.element.querySelector<HTMLButtonElement>(".sdk-page-header button.primary")!;
      const discardBtn = () => app.element.querySelector<HTMLButtonElement>(".sdk-page-header button.secondary");
      const nameInput = () => app.element.querySelector<HTMLInputElement>('[data-field="/name"] input')!;

      // Clean state: Save disabled, no Discard button, no unsaved indicator.
      expect(saveBtn().disabled).toBe(true);
      expect(discardBtn()).toBeNull();
      expect(app.element.querySelector(".sdk-page-header-unsaved")).toBeNull();

      // Edit /name -> dirty state shows unsaved indicator, Discard, and enabled Save.
      nameInput().value = "Revenue query v2";
      nameInput().dispatchEvent(new Event("input"));
      await vi.waitFor(() => expect(saveBtn().disabled).toBe(false), { timeout: 3000 });
      expect(discardBtn()).not.toBeNull();
      expect(app.element.querySelector(".sdk-page-header-unsaved")).not.toBeNull();

      // Header Discard confirms and clears dirty state back to baseline.
      discardBtn()!.click();
      await clickDialogButton("Discard");
      await vi.waitFor(() => expect(saveBtn().disabled).toBe(true), { timeout: 3000 });
      expect(nameInput().value).toBe("Revenue query");
      expect(discardBtn()).toBeNull();

      // Edit again and click Save in header -> dispatches save and returns to catalog (FN-06).
      nameInput().value = "Revenue query updated";
      nameInput().dispatchEvent(new Event("input"));
      await vi.waitFor(() => expect(saveBtn().disabled).toBe(false), { timeout: 3000 });
      saveBtn().click();
      await vi.waitFor(() => expect(app.savedPayloads).toHaveLength(1), { timeout: 3000 });
      await vi.waitFor(() => expect(app.router.currentRoute.value.path).toBe(CATALOG_PATH), { timeout: 3000 });

      // Re-open detail, edit again and click Back -> host unsaved guard intercepts; Cancel stays, Confirm returns to catalog.
      await app.router.push(panelAddress(DETAIL_PATH, { selected: "fn-read-1" }));
      await vi.waitFor(() => {
        expect(app.element.querySelector('[data-field="/name"] input')).not.toBeNull();
      }, { timeout: 3000 });
      nameInput().value = "Unsaved draft name";
      nameInput().dispatchEvent(new Event("input"));
      await vi.waitFor(() => expect(saveBtn().disabled).toBe(false), { timeout: 3000 });

      allowLeave = false;
      app.element.querySelector<HTMLButtonElement>(".sdk-page-header-back")!.click();
      await vi.waitFor(() => expect(askUnsaved).toHaveBeenCalledTimes(1), { timeout: 3000 });
      await askUnsaved.mock.results[0]!.value;
      await nextTick();
      expect(app.router.currentRoute.value.path).toBe(DETAIL_PATH);
      expect(nameInput().value).toBe("Unsaved draft name");

      allowLeave = true;
      app.element.querySelector<HTMLButtonElement>(".sdk-page-header-back")!.click();
      await vi.waitFor(() => expect(app.router.currentRoute.value.path).toBe(CATALOG_PATH), { timeout: 3000 });
      expect(askUnsaved).toHaveBeenCalledTimes(2);
    } finally {
      app.app.unmount();
    }
  });

  it("handles full-width create mode: discard returns to catalog, save converges URL to ?selected=<id> without mode", async () => {
    const app = await mountFunctionsApp({
      initialPath: panelAddress(DETAIL_PATH, { mode: "create" }),
    });
    try {
      await vi.waitFor(() => {
        expect(app.element.querySelector('[data-field="/name"] input')).not.toBeNull();
      }, { timeout: 3000 });

      expect(app.element.querySelector(".sdk-page-header")?.textContent).toContain("New function");
      // Delete wrapper stays hidden via v-show in create mode.
      const removeWrap = app.element.querySelector<HTMLElement>(".sdk-page-header-actions > div");
      expect(removeWrap?.style.display).toBe("none");

      const saveBtn = () => app.element.querySelector<HTMLButtonElement>(".sdk-page-header button.primary")!;
      const discardBtn = () => app.element.querySelector<HTMLButtonElement>(".sdk-page-header button.secondary");
      const nameInput = () => app.element.querySelector<HTMLInputElement>('[data-field="/name"] input')!;

      expect(saveBtn().disabled).toBe(true);

      // Edit /name and Discard in create mode -> confirms and navigates back to catalog.
      nameInput().value = "Abandoned function";
      nameInput().dispatchEvent(new Event("input"));
      await vi.waitFor(() => expect(discardBtn()).not.toBeNull(), { timeout: 3000 });
      discardBtn()!.click();
      await clickDialogButton("Discard");
      await vi.waitFor(() => expect(app.router.currentRoute.value.path).toBe(CATALOG_PATH), { timeout: 3000 });

      // Re-open create mode via legacy /new redirect and save -> URL converges to ?selected=<newId> with mode cleared.
      await app.router.push("/ontology/assets/functions/new");
      await vi.waitFor(() => {
        expect(app.router.currentRoute.value.path).toBe(DETAIL_PATH);
        expect(panelAddressState(app.router.currentRoute.value.fullPath)).toEqual({ mode: "create" });
        expect(app.element.querySelector('[data-field="/name"] input')).not.toBeNull();
      }, { timeout: 3000 });

      nameInput().value = "Net margin query";
      nameInput().dispatchEvent(new Event("input"));
      await vi.waitFor(() => expect(saveBtn().disabled).toBe(false), { timeout: 3000 });
      saveBtn().click();

      await vi.waitFor(() => {
        expect(app.savedPayloads).toHaveLength(1);
        expect(panelAddressState(app.router.currentRoute.value.fullPath)).toEqual({ selected: "fn-created-1" });
      }, { timeout: 3000 });
      expect(app.router.currentRoute.value.fullPath).not.toContain("mode=");
      await vi.waitFor(() => {
        expect(app.element.querySelector(".sdk-page-header")?.textContent).toContain("Net margin query");
        expect(app.element.querySelector<HTMLElement>(".sdk-page-header-actions > div")?.style.display).not.toBe("none");
      }, { timeout: 3000 });
    } finally {
      app.app.unmount();
    }
  });

  it("keeps common fields submitted when a create switches the refresh-on-change operation branch", async () => {
    const app = await mountFunctionsApp({
      initialPath: panelAddress(DETAIL_PATH, { mode: "create" }),
    });
    try {
      await vi.waitFor(() => {
        expect(app.element.querySelector('[data-field="/name"] input')).not.toBeNull();
      }, { timeout: 3000 });
      const input = (path: string) => app.element.querySelector<HTMLInputElement>(`[data-field="${path}"] input, [data-field="${path}"] textarea`)!;
      input("/name").value = "Branch switching function";
      input("/name").dispatchEvent(new Event("input"));
      input("/description").value = "Common fields survive the operation switch";
      input("/description").dispatchEvent(new Event("input"));
      await nextTick();

      const writeRadio = [...app.element.querySelectorAll<HTMLElement>('[data-field="/operation"] .el-radio')]
        .find((radio) => radio.textContent?.trim() === "Write")!;
      writeRadio.click();
      await vi.waitFor(() => {
        expect(app.element.querySelector('[data-field="/code"]')).not.toBeNull();
      }, { timeout: 3000 });
      expect(input("/name").value).toBe("Branch switching function");
      expect(input("/description").value).toBe("Common fields survive the operation switch");

      const saveBtn = () => app.element.querySelector<HTMLButtonElement>(".sdk-page-header button.primary")!;
      await vi.waitFor(() => expect(saveBtn().disabled).toBe(false), { timeout: 3000 });
      saveBtn().click();
      await vi.waitFor(() => expect(app.savedPayloads).toHaveLength(1), { timeout: 3000 });

      const saveInput = app.savedPayloads[0]!.call.input as { values?: Record<string, unknown>; submittedFields?: string[] };
      expect(saveInput.values).toMatchObject({
        name: "Branch switching function",
        description: "Common fields survive the operation switch",
        operation: "OPERATION_WRITE",
      });
      expect(new Set(saveInput.submittedFields)).toEqual(new Set(["/name", "/description", "/operation"]));
      await vi.waitFor(() => {
        expect(app.element.querySelector(".sdk-page-header")?.textContent).toContain("Branch switching function");
      }, { timeout: 3000 });
    } finally {
      app.app.unmount();
    }
  });

  it("hides Delete when owner marks it unavailable, and navigates back to catalog after delete even after letGo clears selected", async () => {
    const functions = initialFunctions();
    functions[0]!.deleteUnavailableReason = "Referenced by Metric View";
    const app = await mountFunctionsApp({
      initialPath: panelAddress(DETAIL_PATH, { selected: "fn-read-1" }),
      functions,
    });
    try {
      await vi.waitFor(() => {
        expect(app.element.querySelector('[data-field="/name"] input')).not.toBeNull();
      }, { timeout: 3000 });

      // Referenced function: hideWhenUnavailable hides the Delete button.
      const deleteButtonsOnReferenced = [...app.element.querySelectorAll<HTMLButtonElement>(".sdk-page-header button")]
        .filter((button) => button.textContent?.trim() === "Delete");
      expect(deleteButtonsOnReferenced).toHaveLength(0);

      // Navigate to a deletable function: Delete button renders inside v-show wrapper and returns to catalog on done.
      await app.router.push(panelAddress(DETAIL_PATH, { selected: "fn-write-1" }));
      let deleteBtn: HTMLButtonElement | undefined;
      await vi.waitFor(() => {
        deleteBtn = [...app.element.querySelectorAll<HTMLButtonElement>(".sdk-page-header button")]
          .find((button) => button.textContent?.trim() === "Delete");
        expect(deleteBtn).toBeDefined();
      }, { timeout: 3000 });

      deleteBtn!.click();
      await vi.waitFor(() => {
        expect(app.deletedIds).toEqual(["fn-write-1"]);
        expect(app.router.currentRoute.value.path).toBe(CATALOG_PATH);
      }, { timeout: 3000 });
    } finally {
      app.app.unmount();
    }
  });

  it("shows loading, forbidden, error, and missing states in place without mounting the form", async () => {
    let mode: "loading" | "forbidden" | "error" | "missing" = "loading";
    const loadingGate: { release: (() => void) | null } = { release: null };

    const app = await mountFunctionsApp({
      initialPath: panelAddress(DETAIL_PATH, { selected: "fn-check" }),
      onRecordRead: () => {
        if (mode === "loading") {
          return new Promise<Response>((resolve) => {
            loadingGate.release = () => resolve(Response.json({ status: "empty" }));
          });
        }
        if (mode === "forbidden") return Response.json({ status: "forbidden" });
        if (mode === "error") return Response.json({ status: "error", message: "Backend unavailable" });
        return Response.json({ status: "empty" });
      },
    });
    try {
      // Loading: form is not mounted.
      await vi.waitFor(() => {
        expect(app.element.textContent).toContain("Loading function...");
      }, { timeout: 3000 });
      expect(app.element.querySelector(".sdk-owner-form")).toBeNull();
      expect(
        sentPanelReadItems(app.sent).some((item) => {
          const body = item.body as ProductPanelReadRequest;
          return "dataName" in body && body.memberPath.at(-1)?.member === "definition";
        }),
      ).toBe(false);

      // Release loading into empty/missing state.
      mode = "missing";
      loadingGate.release?.();
      await vi.waitFor(() => {
        expect(app.element.textContent).toContain("Function not found or has been deleted.");
      }, { timeout: 3000 });
      expect(app.element.querySelector(".sdk-owner-form")).toBeNull();

      // Forbidden state.
      mode = "forbidden";
      await app.router.push(panelAddress(DETAIL_PATH, { selected: "fn-forbidden" }));
      await vi.waitFor(() => {
        expect(app.element.textContent).toContain("You do not have permission to view this function.");
      }, { timeout: 3000 });
      expect(app.element.querySelector(".sdk-owner-form")).toBeNull();

      // Error state shows owner message and Retry button.
      mode = "error";
      await app.router.push(panelAddress(DETAIL_PATH, { selected: "fn-error" }));
      await vi.waitFor(() => {
        expect(app.element.textContent).toContain("Backend unavailable");
      }, { timeout: 3000 });
      expect(app.element.querySelector(".sdk-owner-form")).toBeNull();
      expect(
        [...app.element.querySelectorAll<HTMLButtonElement>("button")].some((b) => b.textContent?.trim() === "Retry"),
      ).toBe(true);

      // Bare detail URL without selected or mode shows missing state without mounting form.
      await app.router.push(DETAIL_PATH);
      await vi.waitFor(() => {
        expect(app.element.textContent).toContain("Function not found or has been deleted.");
      }, { timeout: 3000 });
      expect(app.element.querySelector(".sdk-owner-form")).toBeNull();
    } finally {
      app.app.unmount();
    }
  });
});
