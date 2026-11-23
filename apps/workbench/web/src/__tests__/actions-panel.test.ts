import { afterEach, describe, expect, it, vi } from "vitest";
import * as Vue from "vue";
import { nextTick, ref } from "vue";
import { createI18n } from "vue-i18n";
import ElementPlus from "element-plus";
import publicEn from "@ontomato/workbench-ui/locales/en";
import type { RuntimeJsonValue } from "@ontomato/contracts/agent-runtime-values";
import { appsSdkComponentCatalogEntrySchema } from "@ontomato/contracts/apps-sdk";
import { panelAuthoringManifestSchema } from "@ontomato/contracts/panel-authoring";
import { expandPanelAuthoringMember } from "@ontomato/contracts/panel-authoring-expansion";
import type { ProductPanelReadResponse } from "@ontomato/contracts/panel-host";
import { definePanel } from "@ontomato/contracts/panel-manifest";
import { panelModuleSpecifiers } from "@ontomato/contracts/panel-module";
import type { PanelFormDescription } from "@ontomato/contracts/panel-projection";
import { ACTION, DELETE_ACTION, SET_ACTION_STATUS, platformObjectTypes } from "@ontomato/contracts/platform-object-types";
import { platformTypeTableEntrySchema } from "@ontomato/contracts/platform-type-table";
import type { ProductProjection } from "@ontomato/contracts/product-panels";
import { randomId } from "@ontomato/contracts/random-id";
import { codedPanelTarget, createPanelBackController } from "@ontomato/platform-shell";
import { components } from "../../../../../packages/apps-sdk/src/catalogue";
import { panelModuleFor, type DirectPanelMount } from "../../../../../packages/apps-sdk/src/direct";
import type { PanelMemberReadRequest } from "../../../../../packages/apps-sdk/src/panel/direct";
import { applyPanelRequest } from "../../../../../packages/apps-sdk/src/panel/instance";
import { runPanelModule, useTemplateCompiler } from "../../../../../packages/platform-web/src/panel-module";
import source from "../../../../../packages/ontology-manager/resources/builtin-panels/actions/panel.json";
import html from "../../../../../packages/ontology-manager/resources/builtin-panels/actions/panel.html?raw";
import moduleSource from "../../../../../packages/ontology-manager/resources/builtin-panels/actions/panel.mjs?raw";
import { directRun, noOperations } from "./panel-frame";

/*
 * Regression tests for the built-in Actions panel (`builtin-panels/actions`):
 * - Detail section (`ac-detail`) unmounts via `v-if="detailVisible"` when neither viewing a selected action nor
 *   creating a new one, so the `form` projection is not registered while on the catalog view.
 * - Catalog section (`ac-section`) stays mounted under `v-show="!detailVisible"` while viewing/creating an action so
 *   local search, checked rows, and list DOM state survive returning to the catalog.
 * - Detail tabs (`definition`, `derived`, `code`) stay mounted under `v-show` inside `ac-detail` so unsaved form edits
 *   and `draftCode` synchronization into `AnnotatedCode.currentCode` survive switching tabs.
 */

const actionTypeEntry = platformTypeTableEntrySchema.parse({
  ...platformObjectTypes[ACTION],
  operations: [
    {
      id: `${ACTION}.save`,
      kind: "form.save",
      effect: "write",
      batch: false,
      inputSchema: { type: "object" },
      target: { source: "input", input: "action" },
    },
    {
      id: SET_ACTION_STATUS,
      kind: "action",
      effect: "write",
      batch: true,
      inputSchema: { type: "object" },
      target: { source: "input", input: "actions" },
    },
    {
      id: DELETE_ACTION,
      kind: "action",
      effect: "write",
      batch: false,
      inputSchema: { type: "object" },
      target: { source: "input", input: "action" },
    },
  ],
});

const { members: authoring, ...authoringManifest } = panelAuthoringManifestSchema.parse(source.manifest);
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
      state: authoringManifest.state,
      typeTable: { objectTypes: { [ACTION]: actionTypeEntry } },
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

const manifest = definePanel({ ...authoringManifest, members });

const SAVED_CODE = "def run(ctx):\n    return 'saved'\n";
const EDITED_CODE = "def run(ctx):\n    return 'edited'\n";

const catalogRows = [
  {
    primaryKey: "approve-order",
    label: "Approve order",
    subtitle: "Marks a pending order as approved",
    fieldLabels: {
      function: "Function",
      origin: "Origin",
      status: "Status",
      createdBy: "Created by",
      reviewedBy: "Reviewed by",
      updatedAt: "Updated at",
    },
    fields: {
      function: "approve_order",
      origin: "Domain",
      status: "PENDING_REVIEW",
      createdBy: "alice",
      reviewedBy: "",
      updatedAt: "2026-11-24T00:00:00Z",
    },
  },
  {
    primaryKey: "cancel-order",
    label: "Cancel order",
    fieldLabels: {
      function: "Function",
      origin: "Origin",
      status: "Status",
      createdBy: "Created by",
      reviewedBy: "Reviewed by",
      updatedAt: "Updated at",
    },
    fields: {
      function: "cancel_order",
      origin: "Domain",
      status: "PUBLISHED",
      createdBy: "bob",
      reviewedBy: "carol",
      updatedAt: "2026-11-24T00:00:00Z",
    },
  },
];

function actionFormDescription(values: { name: string; code: string }, isCreate: boolean): PanelFormDescription {
  return {
    fields: [
      {
        path: "/name",
        label: "Name",
        required: true,
        readOnly: false,
        valueSchema: { type: "string" },
        control: { kind: "text" },
      },
      {
        path: "/function",
        label: "Function",
        required: true,
        readOnly: false,
        valueSchema: { type: "object" },
        control: {
          kind: "object",
          fields: [
            {
              path: "/code",
              label: "Code",
              required: true,
              readOnly: false,
              valueSchema: { type: "string" },
              control: { kind: "code", language: "python" },
            },
          ],
        },
      },
    ],
    values: {
      name: values.name,
      function: { code: values.code },
    },
    errors: [],
    revision: 1,
    save: {
      method: isCreate ? "POST" : "PUT",
      path: isCreate ? "/actions" : "/actions/approve-order",
      bodySchema: { type: "object" },
      draftOperation: isCreate ? "action.create" : "action.update",
    },
  };
}

const activeMounts: DirectPanelMount[] = [];

afterEach(() => {
  while (activeMounts.length > 0) {
    activeMounts.pop()!.dispose();
  }
  document.body.innerHTML = "";
});

interface MountActionsOptions {
  initial?: Record<string, RuntimeJsonValue>;
  confirmLeave?: () => boolean | Promise<boolean>;
}

async function mountActionsPanel(options: MountActionsOptions | Record<string, RuntimeJsonValue> = {}) {
  const normalized: MountActionsOptions =
    "initial" in options || "confirmLeave" in options
      ? (options as MountActionsOptions)
      : { initial: options as Record<string, RuntimeJsonValue> };
  const initial = normalized.initial ?? {};

  await useTemplateCompiler();
  const { element, template } = codedPanelTarget(html);
  document.body.append(element);

  const reads: PanelMemberReadRequest[] = [];
  const confirmLeaveUnsaved = vi.fn(async () => (normalized.confirmLeave ? await normalized.confirmLeave() : true));
  let resolveMount!: (mount: DirectPanelMount) => void;
  const mountedPromise = new Promise<DirectPanelMount>((resolve) => {
    resolveMount = resolve;
  });
  let currentMount: DirectPanelMount | null = null;
  const backController = createPanelBackController({
    active: () => true,
    allowHistory: () => false,
    isDirty: () => Boolean(currentMount?.instance.dirty()),
    confirmLeaveUnsaved,
  });

  const panelSdk = panelModuleFor({
    element,
    template,
    install(app) {
      app
        .use(createI18n({ legacy: false, locale: "en", messages: { en: publicEn } }))
        .use(ElementPlus);
    },
    mounted(mount) {
      currentMount = mount;
      activeMounts.push(mount);
      resolveMount(mount);
    },
    manifest,
    run: directRun({
      pageKey: "ontology-actions",
      url: () => "/ontology/actions",
      label: () => "Actions",
      initial,
      registerBackHandler: backController.register,
      confirmLeaveUnsaved,
    }),
    messages: source.content.messages,
    locale: ref("en"),
    defaultLocale: "en",
    requests: {
      request: async (path, init) => {
        if (path === "/panel-operations/intents" && init?.method === "POST") {
          const body = JSON.parse(String(init.body)) as { operationId: string };
          return Response.json({
            intentId: randomId(),
            operationId: body.operationId,
            label: body.operationId,
            confirmation: { kind: "none" },
          });
        }
        const id = path.split("/").at(-1)!;
        const projection = projections.get(id);
        if (!projection) throw new Error(`Unknown projection request: ${path}`);
        return Response.json({ projection });
      },
    },
    use: { applicationId: "ontology", useId: "ontology-actions" },
    expandPageComposer: noOperations.expandPageComposer,
    navigate: noOperations.navigate,
    nested: noOperations.nested,
    confirmOperation: async (preparation) => {
      if (preparation.operationId === "form.save") {
        return {
          decision: "confirm",
          response: {
            kind: "dispatched",
            intentId: preparation.intentId,
            outcome: {
              kind: "success",
              message: "Saved",
              data: { primaryKey: "created-action", className: ACTION },
              affected: {
                objects: [{ objectType: ACTION, primaryKey: "created-action" }],
                objectTypes: [ACTION],
              },
            },
          },
        };
      }
      if (preparation.operationId === "remove.delete") {
        return {
          decision: "confirm",
          response: {
            kind: "dispatched",
            intentId: preparation.intentId,
            outcome: {
              kind: "success",
              message: "Deleted",
              data: {} as Record<string, RuntimeJsonValue>,
              affected: {
                objects: [{ objectType: ACTION, primaryKey: "created-action" }],
                objectTypes: [ACTION],
                removed: [{ objectType: ACTION, primaryKey: "created-action" }],
              },
            },
          },
        };
      }
      throw new Error(`Unexpected operation confirmation: ${preparation.operationId}`);
    },
    read: async (request): Promise<ProductPanelReadResponse> => {
      reads.push(request);
      const member = request.memberPath[0]?.member;
      if (request.operations) {
        if (member === "form") {
          const hasSelected = Boolean(request.inputs.action);
          return {
            status: "ready",
            value: {
              save: {
                kind: "form.save",
                handlerRef: `${ACTION}.save`,
                label: "Save",
                effect: "write",
                batch: false,
                target: hasSelected ? { source: "input", input: "action" } : { source: "draft", slot: "form" },
                inputSchema: {},
                resultSchema: {},
              },
            } as never,
          };
        }
        if (member === "remove") {
          return {
            status: "ready",
            value: {
              delete: {
                kind: "action",
                handlerRef: DELETE_ACTION,
                label: "Delete",
                effect: "write",
                batch: false,
                target: { source: "input", input: "action" },
                inputSchema: {},
                resultSchema: {},
              },
            } as never,
          };
        }
        if (member === "setStatus") {
          return {
            status: "ready",
            value: {
              setStatus: {
                kind: "action",
                handlerRef: SET_ACTION_STATUS,
                label: "Change status",
                effect: "write",
                batch: true,
                target: { source: "input", input: "actions" },
                inputSchema: {},
                resultSchema: {},
              },
            } as never,
          };
        }
        return { status: "ready", value: {} as never };
      }

      if (member === "catalog") {
        return { status: "ready", value: catalogRows as never };
      }
      if (member === "header") {
        return { status: "ready", value: catalogRows[0] as never };
      }
      if (member === "form") {
        if (request.dataName === "createForm") {
          return { status: "ready", value: actionFormDescription({ name: "", code: "" }, true) as never };
        }
        return {
          status: "ready",
          value: actionFormDescription({ name: "Approve order", code: SAVED_CODE }, false) as never,
        };
      }
      if (member === "derivedSummary") {
        return {
          status: "ready",
          value: {
            primaryKey: "approve-order",
            label: "Approve order",
            fieldLabels: { declaredTarget: "Target", affects: "Affects" },
            fields: { declaredTarget: "Order", affects: "Order.status" },
          } as never,
        };
      }
      if (member === "derivedEffects" || member === "derivedParameters" || member === "derivedConditions") {
        return { status: "ready", value: [] as never };
      }
      if (member === "explanation") {
        return {
          status: "ready",
          value: {
            code: SAVED_CODE,
            segments: [
              {
                id: "seg-1",
                lineRange: { start: 1, end: 2 },
                kind: "write",
                kindLabel: "Write",
                title: "Return saved status",
              },
            ],
            summary: [{ title: "Summary", kind: "text", text: "Marks the order as approved." }],
          } as never,
        };
      }
      return { status: "empty" };
    },
  });

  await runPanelModule(moduleSource, {
    [panelModuleSpecifiers.vue]: Vue as unknown as Record<string, unknown>,
    [panelModuleSpecifiers.sdk]: panelSdk,
  });

  const mount = await mountedPromise;
  const originalDispose = mount.dispose;
  mount.dispose = () => {
    backController.dispose();
    originalDispose();
  };
  return { mount, element, reads, confirmLeaveUnsaved };
}

function catalogSection(element: HTMLElement): HTMLElement {
  const section = element.querySelector<HTMLElement>('[data-member="catalog"]')?.closest<HTMLElement>(".ac-section");
  if (!section) throw new Error("Catalog section is not mounted");
  return section;
}

describe("builtin actions panel detail mount lifecycle", () => {
  it("guards unsaved changes across detail tabs on back and Escape, preserves catalog on leave, and updates stale explanation copy", async () => {
    let allowLeave = false;
    const { mount, element, reads, confirmLeaveUnsaved } = await mountActionsPanel({
      confirmLeave: () => allowLeave,
    });
    const { instance } = mount;

    // 1. Catalog view (!detailVisible): catalog is mounted & visible; detail and form are unmounted.
    await vi.waitFor(() => {
      expect(element.querySelector('[data-member="catalog"]')).not.toBeNull();
      expect(element.textContent).toContain("Approve order");
    });
    const cancelRow = [...element.querySelectorAll('[data-member="catalog"] tbody tr')]
      .find((row) => row.textContent?.includes("Cancel order"));
    expect(cancelRow?.querySelector(".sdk-object-list-cell-sub")?.textContent?.trim()).toBeTruthy();
    const initialCatalogEl = element.querySelector('[data-member="catalog"]');
    expect(catalogSection(element).style.display).not.toBe("none");
    expect(element.querySelector(".ac-detail")).toBeNull();
    expect(instance.forms.handle("form")).toBeUndefined();
    expect(reads.some((r) => !r.operations && r.memberPath[0]?.member === "form")).toBe(false);

    // Keep local catalog state (search keyword) to verify catalog stays mounted under v-show.
    instance.state.set("keyword", "Approve");
    await nextTick();

    // 2. Enter edit detail (selected non-null): form mounts & registers; catalog stays mounted but hidden via v-show.
    instance.state.set("selected", { className: ACTION, primaryKey: "approve-order" });
    await vi.waitFor(() => {
      expect(element.querySelector(".ac-detail")).not.toBeNull();
      const form = instance.forms.handle("form");
      expect(form).toBeDefined();
      expect(form!.values.value.name).toBe("Approve order");
    });
    expect(element.querySelector('[data-member="catalog"]')).toBe(initialCatalogEl);
    expect(catalogSection(element).style.display).toBe("none");
    expect(instance.state.values.value.draftCode).toBe(SAVED_CODE);

    // 3. Edit code in form and switch tabs (definition -> code -> derived):
    //    form remains mounted & registered, unsaved draft and draftCode sync are preserved.
    const formHandle = instance.forms.handle("form")!;
    formHandle.set("/function/code", EDITED_CODE);
    await vi.waitFor(() => {
      expect(formHandle.dirty.value).toBe(true);
      expect(instance.state.values.value.draftCode).toBe(EDITED_CODE);
    });

    const tabs = [...element.querySelectorAll<HTMLButtonElement>('[role="tab"]')];
    const derivedTab = tabs.find((tab) => tab.textContent?.trim() === "Derived definition");
    const codeTab = tabs.find((tab) => tab.textContent?.trim() === "Code explanation");
    expect(derivedTab).toBeDefined();
    expect(codeTab).toBeDefined();

    codeTab!.click();
    await vi.waitFor(() => {
      expect(instance.state.values.value.activeTab).toBe("code");
      expect(element.textContent).toContain("Explanation may be outdated");
      expect(element.textContent).toContain(
        "The code in this form differs from the code this explanation was written for; save it and explain the action again if needed.",
      );
    });
    expect(instance.forms.handle("form")).toBe(formHandle);
    expect((formHandle.values.value.function as Record<string, unknown>).code).toBe(EDITED_CODE);
    expect(formHandle.dirty.value).toBe(true);
    expect(instance.state.values.value.draftCode).toBe(EDITED_CODE);

    // 4a. Clicking Back on the `code` tab with unsaved changes triggers confirmation; cancelling keeps detail & draft.
    const backButton = [...element.querySelectorAll<HTMLButtonElement>(".ac-detail-head button")]
      .find((button) => button.textContent?.trim() === "Back to the catalog");
    expect(backButton).toBeDefined();
    backButton!.click();

    await vi.waitFor(() => {
      expect(confirmLeaveUnsaved).toHaveBeenCalledTimes(1);
    });
    // Flush the cancelled confirmation promise so usePanelBack finishes and releases its in-flight guard.
    await Promise.resolve();
    await nextTick();
    expect(instance.state.values.value.selected).toEqual({ className: ACTION, primaryKey: "approve-order" });
    expect(instance.state.values.value.activeTab).toBe("code");
    expect(element.querySelector(".ac-detail")).not.toBeNull();
    expect(instance.forms.handle("form")).toBe(formHandle);
    expect((formHandle.values.value.function as Record<string, unknown>).code).toBe(EDITED_CODE);
    expect(formHandle.dirty.value).toBe(true);
    expect(instance.state.values.value.draftCode).toBe(EDITED_CODE);

    // 4b. Switch to `derived` tab; Escape also passes through the unsaved confirmation guard; cancelling keeps draft.
    derivedTab!.click();
    await vi.waitFor(() => {
      expect(instance.state.values.value.activeTab).toBe("derived");
    });
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
    await vi.waitFor(() => {
      expect(confirmLeaveUnsaved).toHaveBeenCalledTimes(2);
    });
    await Promise.resolve();
    await nextTick();
    expect(instance.state.values.value.selected).toEqual({ className: ACTION, primaryKey: "approve-order" });
    expect(instance.state.values.value.activeTab).toBe("derived");
    expect(formHandle.dirty.value).toBe(true);
    expect(instance.state.values.value.draftCode).toBe(EDITED_CODE);

    // 4c. Confirming Back on `derived` tab leaves detail, unmounts form, clears draft, and preserves catalog state.
    allowLeave = true;
    backButton!.click();

    await vi.waitFor(() => {
      expect(confirmLeaveUnsaved).toHaveBeenCalledTimes(3);
      expect(instance.state.values.value.selected).toBeNull();
      expect(instance.state.values.value.creating).toBe(false);
      expect(instance.state.values.value.activeTab).toBe("definition");
      expect(element.querySelector(".ac-detail")).toBeNull();
      expect(instance.forms.handle("form")).toBeUndefined();
    });
    expect(instance.state.values.value.draftCode).toBeNull();
    expect(element.querySelector('[data-member="catalog"]')).toBe(initialCatalogEl);
    expect(catalogSection(element).style.display).not.toBe("none");
    expect(instance.state.values.value.keyword).toBe("Approve");
  });

  it("mounts form in create mode (creating: true) while keeping catalog mounted, and unmounts form on back", async () => {
    const { mount, element, confirmLeaveUnsaved } = await mountActionsPanel();
    const { instance } = mount;

    await vi.waitFor(() => {
      expect(element.querySelector('[data-member="catalog"]')).not.toBeNull();
    });
    const initialCatalogEl = element.querySelector('[data-member="catalog"]');
    expect(instance.forms.handle("form")).toBeUndefined();

    // Enter create mode with no selected action.
    instance.state.set("creating", true);
    await vi.waitFor(() => {
      expect(element.querySelector(".ac-detail")).not.toBeNull();
      expect(element.querySelector(".ac-draft-title")?.textContent?.trim()).toBe("New action");
      expect(element.querySelector('[data-member="header"]')).toBeNull();
      const form = instance.forms.handle("form");
      expect(form).toBeDefined();
      expect(form!.fields.value.length).toBeGreaterThan(0);
    });
    expect(element.querySelector('[data-member="catalog"]')).toBe(initialCatalogEl);
    expect(catalogSection(element).style.display).toBe("none");

    // Clean back to catalog does not prompt and unmounts detail and form.
    const backButton = [...element.querySelectorAll<HTMLButtonElement>(".ac-detail-head button")]
      .find((button) => button.textContent?.trim() === "Back to the catalog");
    expect(backButton).toBeDefined();
    backButton!.click();

    await vi.waitFor(() => {
      expect(instance.state.values.value.creating).toBe(false);
      expect(element.querySelector(".ac-detail")).toBeNull();
      expect(instance.forms.handle("form")).toBeUndefined();
    });
    expect(confirmLeaveUnsaved).not.toHaveBeenCalled();
    expect(element.querySelector('[data-member="catalog"]')).toBe(initialCatalogEl);
    expect(catalogSection(element).style.display).not.toBe("none");
  });

  it("transitions from create to edit on save without unmounting detail, and leaves detail directly after delete without unsaved prompt", async () => {
    const { mount, element, confirmLeaveUnsaved } = await mountActionsPanel({
      confirmLeave: () => false,
    });
    const { instance } = mount;

    await vi.waitFor(() => {
      expect(element.querySelector('[data-member="catalog"]')).not.toBeNull();
    });

    // Open create mode and fill required fields.
    instance.state.set("creating", true);
    await vi.waitFor(() => {
      const form = instance.forms.handle("form");
      expect(form).toBeDefined();
      expect(form!.fields.value.length).toBeGreaterThan(0);
    });
    const formHandle = instance.forms.handle("form")!;
    formHandle.set("/name", "Created action");
    formHandle.set("/function/code", SAVED_CODE);
    await nextTick();

    // Save the created action -> transitions to edit mode (`creating: false`, `selected` populated) with header/remove mounted.
    await instance.forms.submit("form");
    await vi.waitFor(() => {
      expect(instance.state.values.value.creating).toBe(false);
      expect(instance.state.values.value.selected).toEqual({ className: ACTION, primaryKey: "created-action" });
      expect(element.querySelector('[data-member="header"]')).not.toBeNull();
      expect(element.querySelector('[data-member="remove"] button')).not.toBeNull();
    });
    expect(instance.forms.handle("form")).toBe(formHandle);

    // Dirty the form again before deleting to verify delete bypasses the unsaved-changes back confirmation.
    formHandle.set("/function/code", EDITED_CODE);
    await vi.waitFor(() => {
      expect(formHandle.dirty.value).toBe(true);
    });

    // Delete via header's remove OperationButton -> returns to catalog directly without triggering confirmLeaveUnsaved.
    element.querySelector<HTMLButtonElement>('[data-member="remove"] button')!.click();
    await vi.waitFor(() => {
      expect(instance.state.values.value.selected).toBeNull();
      expect(instance.state.values.value.creating).toBe(false);
      expect(element.querySelector(".ac-detail")).toBeNull();
      expect(instance.forms.handle("form")).toBeUndefined();
    });
    expect(confirmLeaveUnsaved).not.toHaveBeenCalled();
    expect(catalogSection(element).style.display).not.toBe("none");
  });

  it("deep-links activeTab so derived and code tabs restore from initial state and address requests", async () => {
    expect(manifest.state.activeTab?.deepLink).toBe(true);

    // 1. Restore `derived` tab directly from initial state.
    const derivedMount = await mountActionsPanel({
      initial: {
        selected: { className: ACTION, primaryKey: "approve-order" },
        activeTab: "derived",
      },
    });
    await vi.waitFor(() => {
      expect(derivedMount.mount.instance.state.values.value.activeTab).toBe("derived");
      const activeTabEl = derivedMount.element.querySelector<HTMLButtonElement>('[role="tab"][aria-selected="true"]');
      expect(activeTabEl?.textContent?.trim()).toBe("Derived definition");
    });
    expect(derivedMount.mount.instance.deepLink()).toMatchObject({
      selected: { className: ACTION, primaryKey: "approve-order" },
      activeTab: "derived",
    });

    // 2. Restore `code` tab via an incoming address request (`applyPanelRequest`).
    applyPanelRequest(manifest, derivedMount.mount.instance.state, {
      useId: "ontology-actions",
      state: {
        selected: { className: ACTION, primaryKey: "approve-order" },
        activeTab: "code",
      },
    });
    await vi.waitFor(() => {
      expect(derivedMount.mount.instance.state.values.value.activeTab).toBe("code");
      const activeTabEl = derivedMount.element.querySelector<HTMLButtonElement>('[role="tab"][aria-selected="true"]');
      expect(activeTabEl?.textContent?.trim()).toBe("Code explanation");
    });
    expect(derivedMount.mount.instance.deepLink()).toMatchObject({
      selected: { className: ACTION, primaryKey: "approve-order" },
      activeTab: "code",
    });
  });
});
