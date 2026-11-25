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
import { codedPanelTarget } from "@ontomato/platform-shell";
import { components } from "../../../../../packages/apps-sdk/src/catalogue";
import { panelModuleFor, type DirectPanelMount } from "../../../../../packages/apps-sdk/src/direct";
import type { PanelMemberReadRequest } from "../../../../../packages/apps-sdk/src/panel/direct";
import { applyPanelRequest } from "../../../../../packages/apps-sdk/src/panel/instance";
import { runPanelModule, useTemplateCompiler } from "../../../../../packages/platform-web/src/panel-module";
import catalogSource from "../../../../../packages/ontology-manager/resources/builtin-panels/actions/panel.json";
import catalogHtml from "../../../../../packages/ontology-manager/resources/builtin-panels/actions/panel.html?raw";
import catalogModuleSource from "../../../../../packages/ontology-manager/resources/builtin-panels/actions/panel.mjs?raw";
import detailSource from "../../../../../packages/ontology-manager/resources/builtin-panels/action-detail/panel.json";
import detailHtml from "../../../../../packages/ontology-manager/resources/builtin-panels/action-detail/panel.html?raw";
import detailModuleSource from "../../../../../packages/ontology-manager/resources/builtin-panels/action-detail/panel.mjs?raw";
import { confirmDiscard, directRun, noOperations } from "./panel-frame";

/*
 * Regression tests for the two-entry built-in Actions panels:
 * - Catalog (`builtin-panels/actions`): single `<page-header>` with ConversationEntry newAction button, full-width
 *   ObjectList with left search box, row click navigating to `/ontology/assets/actions/detail?selected=<id>`, and
 *   batch status updates shown only when rows are checked.
 * - Detail (`builtin-panels/action-detail`): single `<page-header>` (back to `/ontology/assets/actions`, ObjectHeader
 *   title, danger delete OperationButton, and Save/Discard draft controls via `usePanelFormDraft`), in-place
 *   missing/loading/forbidden/error handling without mounting `form`, `definition` tab kept mounted via `v-show` to
 *   preserve edits and live `form.draft -> AnnotatedCode.currentCode` sync while read-only `derived` and `code` tabs
 *   mount lazily via `v-if`, create->edit transition, delete clearing dirty form before navigating back, and
 *   bidirectional child-object `selectedParameter` <-> `activeSegmentId` linkage.
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

const catalogue = components.map((component) =>
  appsSdkComponentCatalogEntrySchema.parse({
    ...component,
    ...(component.componentId === "OperationButton"
      ? { config: [{ name: "operation", type: "string", required: true, description: "Operation local name" }] }
      : {}),
    ports: { props: [], events: [], slots: [] },
  }),
);

function buildPanelFixture(rawManifest: unknown) {
  const { members: authoring, ...authoringManifest } = panelAuthoringManifestSchema.parse(rawManifest);
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
  return {
    manifest: definePanel({ ...authoringManifest, members }),
    projections,
  };
}

const catalogFixture = buildPanelFixture(catalogSource.manifest);
const detailFixture = buildPanelFixture(detailSource.manifest);

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
    tones: {
      status: "warning",
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
      updatedAt: "2026-11-24T00:00:00Z",
    },
    fields: {
      function: "cancel_order",
      origin: "Domain",
      status: "PUBLISHED",
      createdBy: "bob",
      reviewedBy: "carol",
      updatedAt: "2026-11-24T00:00:00Z",
    },
    tones: {
      status: "success",
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

interface MountCatalogOptions {
  initial?: Record<string, RuntimeJsonValue>;
  locale?: "en" | "zh-CN";
}

async function mountCatalogPanel(options: MountCatalogOptions = {}) {
  await useTemplateCompiler();
  const { element, template } = codedPanelTarget(catalogHtml);
  document.body.append(element);

  const navigated: string[] = [];
  const navigate = vi.fn(async (address: string) => {
    navigated.push(address);
  });
  const expandPageComposer = vi.fn(async () => ({ expanded: true }));

  let resolveMount!: (mount: DirectPanelMount) => void;
  const mountedPromise = new Promise<DirectPanelMount>((resolve) => {
    resolveMount = resolve;
  });

  const activeLocale = options.locale ?? "en";
  const panelSdk = panelModuleFor({
    element,
    template,
    install(app) {
      app
        .use(createI18n({ legacy: false, locale: activeLocale, messages: { en: publicEn, "zh-CN": publicEn } }))
        .use(ElementPlus);
    },
    mounted(mount) {
      activeMounts.push(mount);
      resolveMount(mount);
    },
    manifest: catalogFixture.manifest,
    run: directRun({
      pageKey: "actions",
      url: () => "/ontology/assets/actions",
      label: () => "Actions",
      initial: options.initial ?? {},
    }),
    messages: catalogSource.content.messages,
    locale: ref(activeLocale),
    defaultLocale: "en",
    requests: {
      request: async (path) => {
        const id = path.split("/").at(-1)!;
        const projection = catalogFixture.projections.get(id);
        if (!projection) throw new Error(`Unknown projection request: ${path}`);
        return Response.json({ projection });
      },
    },
    use: { applicationId: "ontology", useId: "ontology-actions" },
    expandPageComposer,
    navigate,
    nested: noOperations.nested,
    confirmOperation: noOperations.confirmOperation,
    read: async (request): Promise<ProductPanelReadResponse> => {
      const member = request.memberPath[0]?.member;
      if (request.operations) {
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
      return { status: "empty" };
    },
  });

  await runPanelModule(catalogModuleSource, {
    [panelModuleSpecifiers.vue]: Vue as unknown as Record<string, unknown>,
    [panelModuleSpecifiers.sdk]: panelSdk,
  });

  const mount = await mountedPromise;
  return { mount, element, navigate, navigated, expandPageComposer };
}

interface MountDetailOptions {
  initial?: Record<string, RuntimeJsonValue>;
  confirmLeave?: () => boolean | Promise<boolean>;
  locale?: "en" | "zh-CN";
  headerResponse?: ProductPanelReadResponse | (() => Promise<ProductPanelReadResponse>);
  removeUnavailable?: { reason: string } | null;
  derivedData?: {
    effects?: unknown[];
    parameters?: unknown[];
    conditions?: unknown[];
    explanation?: unknown;
  };
}

async function mountDetailPanel(options: MountDetailOptions = {}) {
  await useTemplateCompiler();
  const { element, template } = codedPanelTarget(detailHtml);
  document.body.append(element);

  const reads: PanelMemberReadRequest[] = [];
  const confirmLeaveUnsaved = vi.fn(async () => (options.confirmLeave ? await options.confirmLeave() : true));
  const navigated: string[] = [];
  let currentMount: DirectPanelMount | null = null;
  const navigate = vi.fn(async (address: string) => {
    if (currentMount?.instance.dirty()) {
      const allowed = await confirmLeaveUnsaved();
      if (!allowed) return;
    }
    navigated.push(address);
  });

  let resolveMount!: (mount: DirectPanelMount) => void;
  const mountedPromise = new Promise<DirectPanelMount>((resolve) => {
    resolveMount = resolve;
  });

  const activeLocale = options.locale ?? "en";
  const panelSdk = panelModuleFor({
    element,
    template,
    install(app) {
      app
        .use(createI18n({ legacy: false, locale: activeLocale, messages: { en: publicEn, "zh-CN": publicEn } }))
        .use(ElementPlus);
    },
    mounted(mount) {
      currentMount = mount;
      activeMounts.push(mount);
      resolveMount(mount);
    },
    manifest: detailFixture.manifest,
    run: directRun({
      pageKey: "action-detail",
      url: () => "/ontology/assets/actions/detail",
      label: () => "Action detail",
      initial: options.initial ?? {},
      confirmLeaveUnsaved,
    }),
    messages: detailSource.content.messages,
    locale: ref(activeLocale),
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
        const projection = detailFixture.projections.get(id);
        if (!projection) throw new Error(`Unknown projection request: ${path}`);
        return Response.json({ projection });
      },
    },
    use: { applicationId: "ontology", useId: "ontology-action-detail" },
    expandPageComposer: noOperations.expandPageComposer,
    navigate,
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
              created: { objectType: ACTION, primaryKey: "created-action" },
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
                objects: [{ objectType: ACTION, primaryKey: "approve-order" }],
                objectTypes: [ACTION],
                removed: [{ objectType: ACTION, primaryKey: "approve-order" }],
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
                ...(options.removeUnavailable ? { unavailable: options.removeUnavailable } : {}),
              },
            } as never,
          };
        }
        return { status: "ready", value: {} as never };
      }

      if (member === "header") {
        if (typeof options.headerResponse === "function") return await options.headerResponse();
        if (options.headerResponse) return options.headerResponse;
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
      if (member === "derivedEffects") {
        return { status: "ready", value: (options.derivedData?.effects ?? []) as never };
      }
      if (member === "derivedParameters") {
        return { status: "ready", value: (options.derivedData?.parameters ?? []) as never };
      }
      if (member === "derivedConditions") {
        return { status: "ready", value: (options.derivedData?.conditions ?? []) as never };
      }
      if (member === "explanation") {
        return {
          status: "ready",
          value: (options.derivedData?.explanation ?? {
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
          }) as never,
        };
      }
      return { status: "empty" };
    },
  });

  await runPanelModule(detailModuleSource, {
    [panelModuleSpecifiers.vue]: Vue as unknown as Record<string, unknown>,
    [panelModuleSpecifiers.sdk]: panelSdk,
  });

  const mount = await mountedPromise;
  return { mount, element, reads, navigate, navigated, confirmLeaveUnsaved };
}

describe("builtin actions catalog panel (actions)", () => {
  it("renders a single page-header with New action button, navigates to action-detail on row click, and scopes batch status to checked rows", async () => {
    const { mount, element, navigated, expandPageComposer } = await mountCatalogPanel();
    const { instance } = mount;

    await vi.waitFor(() => {
      expect(element.querySelectorAll("header.sdk-page-header")).toHaveLength(1);
      expect(element.querySelector('[data-member="catalog"]')).not.toBeNull();
      expect(element.textContent).toContain("Approve order");
      expect(element.textContent).toContain("Cancel order");
    });

    // New action ConversationEntry lives in <page-header #actions>, not inside ObjectList toolbar.
    const header = element.querySelector<HTMLElement>("header.sdk-page-header")!;
    const newActionBtn = header.querySelector<HTMLButtonElement>('[data-member="newAction"] button');
    expect(newActionBtn).not.toBeNull();
    expect(newActionBtn?.textContent?.trim()).toBe("New action");
    expect(element.querySelector('[data-member="catalog"] [data-member="newAction"]')).toBeNull();

    newActionBtn!.click();
    await vi.waitFor(() => {
      expect(expandPageComposer).toHaveBeenCalledTimes(1);
    });

    // Batch status button is not mounted while no rows are checked.
    expect(element.querySelector('[data-member="setStatus"]')).toBeNull();

    // Checking a row reveals the batch status button inside ObjectList #batch-actions.
    const firstCheckbox = element.querySelector<HTMLInputElement>('[data-member="catalog"] tbody tr input[type="checkbox"]');
    expect(firstCheckbox).not.toBeNull();
    firstCheckbox!.click();
    await vi.waitFor(() => {
      expect(instance.state.values.value.checked).toEqual([{ className: ACTION, primaryKey: "approve-order" }]);
      expect(element.querySelector('[data-member="setStatus"] button')).not.toBeNull();
    });

    // Search input is present and deep-links keyword state without paging state.
    expect(catalogFixture.manifest.state.keyword?.deepLink).toBe(true);
    expect(catalogFixture.manifest.state).not.toHaveProperty("page");
    expect(catalogFixture.manifest.state).not.toHaveProperty("selected");
    expect(catalogFixture.manifest.members).not.toHaveProperty("form");

    // Clicking a row navigates to the dedicated detail entry with flat ?selected=<primaryKey>.
    const cancelRow = [...element.querySelectorAll<HTMLElement>('[data-member="catalog"] tbody tr')]
      .find((row) => row.textContent?.includes("Cancel order"));
    expect(cancelRow?.querySelector(".sdk-object-list-cell-sub")?.textContent?.trim()).toBe("No description");
    cancelRow!.click();
    await vi.waitFor(() => {
      expect(navigated).toEqual(["/ontology/assets/actions/detail?selected=cancel-order"]);
    });
  });
});

describe("builtin action-detail panel (action-detail)", () => {
  it("renders a single page-header with Back to actions, wires header Save/Discard draft controls across all three tabs, and guards unsaved edits on back", async () => {
    let allowLeave = false;
    const { mount, element, reads, navigated, confirmLeaveUnsaved } = await mountDetailPanel({
      initial: {
        selected: { className: ACTION, primaryKey: "approve-order" },
      },
      confirmLeave: () => allowLeave,
    });
    const { instance } = mount;

    await vi.waitFor(() => {
      expect(element.querySelectorAll("header.sdk-page-header")).toHaveLength(1);
      expect(element.querySelector('[data-member="header"]')?.textContent).toContain("Approve order");
      expect(element.querySelector('[data-member="remove"] button')).not.toBeNull();
      const form = instance.forms.handle("form");
      expect(form).toBeDefined();
      expect(form!.values.value.name).toBe("Approve order");
    });

    // Read-only derived & code tabs stay unmounted on initial definition tab load (zero eager reads).
    const initialMembers = new Set(reads.map((r) => r.memberPath[0]?.member));
    expect(initialMembers.has("derivedSummary")).toBe(false);
    expect(initialMembers.has("derivedEffects")).toBe(false);
    expect(initialMembers.has("derivedParameters")).toBe(false);
    expect(initialMembers.has("derivedConditions")).toBe(false);
    expect(initialMembers.has("explanation")).toBe(false);

    // Single page-header carries Back to actions, Save (disabled when clean), and no duplicate ObjectForm footer bar.
    const backButton = element.querySelector<HTMLButtonElement>("button.sdk-page-header-back");
    expect(backButton?.textContent?.trim()).toBe("Back to actions");
    expect(element.querySelector(".sdk-owner-form-actions")).toBeNull();
    const saveButton = element.querySelector<HTMLButtonElement>(".sdk-page-header-action.primary");
    expect(saveButton?.disabled).toBe(true);
    expect(element.querySelector(".sdk-page-header-unsaved")).toBeNull();

    // Edit name in form -> header Save enables, Discard + unsaved notice appear; confirming Discard resets clean state.
    const formHandle = instance.forms.handle("form")!;
    formHandle.set("/name", "Approve order v2");
    await vi.waitFor(() => {
      expect(formHandle.dirty.value).toBe(true);
      expect(saveButton?.disabled).toBe(false);
      expect(element.querySelector(".sdk-page-header-unsaved")).not.toBeNull();
      expect(element.querySelector(".sdk-page-header-action.secondary")).not.toBeNull();
    });

    const discardButton = element.querySelector<HTMLButtonElement>(".sdk-page-header-action.secondary")!;
    discardButton.click();
    await confirmDiscard();
    await vi.waitFor(() => {
      expect(formHandle.dirty.value).toBe(false);
      expect(formHandle.values.value.name).toBe("Approve order");
      expect(saveButton?.disabled).toBe(true);
      expect(element.querySelector(".sdk-page-header-unsaved")).toBeNull();
    });

    // Edit code in form -> header Save enables and live draft sync survives switching tabs.
    formHandle.set("/function/code", EDITED_CODE);
    await vi.waitFor(() => {
      expect(formHandle.dirty.value).toBe(true);
      expect(saveButton?.disabled).toBe(false);
      expect(element.querySelector(".sdk-page-header-unsaved")).not.toBeNull();
    });

    const tabs = [...element.querySelectorAll<HTMLButtonElement>('[role="tab"]')];
    const derivedTab = tabs.find((tab) => tab.textContent?.trim() === "Derived definition")!;
    const codeTab = tabs.find((tab) => tab.textContent?.trim() === "Code explanation")!;

    codeTab.click();
    await vi.waitFor(() => {
      expect(instance.state.values.value.activeTab).toBe("code");
      expect(element.textContent).toContain("Explanation may be outdated");
      expect(element.textContent).toContain(
        "The code in this form differs from the code this explanation was written for; save it and explain the action again if needed.",
      );
    });
    expect(instance.forms.handle("form")).toBe(formHandle);
    expect(element.querySelector(".sdk-page-header-unsaved")).not.toBeNull();

    // Clicking Back while dirty on the code tab triggers unsaved confirmation; cancelling keeps user on detail.
    backButton!.click();
    await vi.waitFor(() => {
      expect(confirmLeaveUnsaved).toHaveBeenCalledTimes(1);
    });
    expect(navigated).toEqual([]);
    expect(formHandle.dirty.value).toBe(true);

    // Switching to derived tab and confirming Back navigates to the actions catalog.
    derivedTab.click();
    await vi.waitFor(() => {
      expect(instance.state.values.value.activeTab).toBe("derived");
    });
    allowLeave = true;
    backButton!.click();
    await vi.waitFor(() => {
      expect(confirmLeaveUnsaved).toHaveBeenCalledTimes(2);
      expect(navigated).toEqual(["/ontology/assets/actions"]);
    });
  });

  it("hides remove when unavailable from owner, shows localized Chinese back label, and keeps form unmounted for missing/forbidden/loading states", async () => {
    // 1. Missing selection (bare detail route): renders empty state in place, does not mount form or remove.
    const missingMount = await mountDetailPanel({ locale: "zh-CN" });
    await vi.waitFor(() => {
      expect(missingMount.element.querySelector("button.sdk-page-header-back")?.textContent?.trim()).toBe("返回动作");
      expect(missingMount.element.textContent).toContain("动作不存在或已删除。");
    });
    expect(missingMount.mount.instance.forms.handle("form")).toBeUndefined();
    expect(missingMount.element.querySelector('[data-member="remove"]')).toBeNull();
    expect(missingMount.element.querySelector(".sdk-page-header-draft")).toBeNull();
    missingMount.mount.dispose();
    document.body.innerHTML = "";

    // 2. Forbidden record: renders forbidden notice in place, does not mount form or remove.
    const forbiddenMount = await mountDetailPanel({
      locale: "zh-CN",
      initial: { selected: { className: ACTION, primaryKey: "secret-action" } },
      headerResponse: { status: "forbidden", reason: "Forbidden" },
    });
    await vi.waitFor(() => {
      expect(forbiddenMount.element.textContent).toContain("当前账号无权读取这条动作。");
    });
    expect(forbiddenMount.mount.instance.forms.handle("form")).toBeUndefined();
    expect(forbiddenMount.element.querySelector('[data-member="remove"]')).toBeNull();
    forbiddenMount.mount.dispose();
    document.body.innerHTML = "";

    // 3. Ready record with owner-marked unavailable delete (e.g. system action): hides remove button.
    const systemActionMount = await mountDetailPanel({
      initial: { selected: { className: ACTION, primaryKey: "system-action" } },
      removeUnavailable: { reason: "System actions cannot be deleted" },
    });
    await vi.waitFor(() => {
      expect(systemActionMount.mount.instance.forms.handle("form")).toBeDefined();
    });
    expect(systemActionMount.element.querySelector('[data-member="remove"] button')).toBeNull();
  });

  it("supports agent-driven create mode, transitions to edit on save, and clears dirty form before navigating back on delete", async () => {
    const { mount, element, navigated, confirmLeaveUnsaved } = await mountDetailPanel({
      initial: { creating: true },
      confirmLeave: () => false,
    });
    const { instance } = mount;

    await vi.waitFor(() => {
      expect(element.querySelector("header.sdk-page-header")?.textContent).toContain("New action");
      expect(element.querySelector('[data-member="header"]')).toBeNull();
      expect(element.querySelector('[data-member="remove"]')).toBeNull();
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

    // Dirty the edit form before deleting to verify delete unmounts the dirty form and navigates back without prompt.
    const editForm = instance.forms.handle("form")!;
    editForm.set("/function/code", EDITED_CODE);
    await vi.waitFor(() => {
      expect(editForm.dirty.value).toBe(true);
    });

    element.querySelector<HTMLButtonElement>('[data-member="remove"] button')!.click();
    await vi.waitFor(() => {
      expect(instance.state.values.value.selected).toBeNull();
      expect(instance.forms.handle("form")).toBeUndefined();
      expect(navigated).toEqual(["/ontology/assets/actions"]);
    });
    expect(confirmLeaveUnsaved).not.toHaveBeenCalled();
  });

  it("deep-links activeTab so derived and code tabs restore from initial state and address requests", async () => {
    expect(detailFixture.manifest.state.activeTab?.deepLink).toBe(true);

    const derivedMount = await mountDetailPanel({
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

    applyPanelRequest(detailFixture.manifest, derivedMount.mount.instance.state, {
      useId: "ontology-action-detail",
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

  it("wires child-object selectedParameter, inline parameter links, and parameter <-> code-segment bidirectional navigation", async () => {
    expect(detailFixture.manifest.state.selectedParameter?.type).toEqual({
      kind: "child-object",
      parentType: ACTION,
      collection: "parameters",
    });

    const parent = { objectType: ACTION, primaryKey: "approve-order" };
    const orderParamRef = {
      kind: "child-reference" as const,
      parent,
      collection: "parameters",
      primaryKey: "order_id",
      label: "order_id",
    };
    const noteParamRef = {
      kind: "child-reference" as const,
      parent,
      collection: "parameters",
      primaryKey: "note",
      label: "note",
    };
    const segRef = {
      kind: "child-reference" as const,
      parent,
      collection: "codeSegments",
      primaryKey: "seg-1",
      label: "Mark approved (L1–2)",
    };

    const { mount, element } = await mountDetailPanel({
      initial: {
        selected: { className: ACTION, primaryKey: "approve-order" },
        activeTab: "derived",
      },
      derivedData: {
        effects: [
          {
            primaryKey: "effect-update-0",
            label: "Mark approved",
            fieldLabels: { group: "Category", kind: "Kind", target: "Target", fields: "Fields", guards: "Checks" },
            fields: {
              group: "Updates",
              kind: "Update object",
              target: ["Order · Object ← ", orderParamRef],
              fields: ["note ← ", noteParamRef],
              guards: "",
            },
            tones: { kind: "info" },
          },
        ],
        parameters: [
          {
            primaryKey: "order_id",
            label: "order_id",
            subtitle: "Target order key",
            fieldLabels: {
              type: "Type",
              required: "Required",
              objectTypes: "Object types",
              sample: "Sample",
              constraints: "Constraints",
              codeLocations: "Used in code",
            },
            fields: {
              type: "TYPE_STRING",
              required: "Yes",
              sample: "ORD-1",
              constraints: "",
              codeLocations: [segRef],
            },
            tags: { objectTypes: ["Order"] },
          },
          {
            primaryKey: "note",
            label: "note",
            fieldLabels: {
              type: "Type",
              required: "Required",
              objectTypes: "Object types",
              sample: "Sample",
              constraints: "Constraints",
              codeLocations: "Used in code",
            },
            fields: {
              type: "TYPE_STRING",
              required: "",
              objectTypes: "",
              sample: "ok",
              constraints: "",
            },
          },
        ],
        conditions: [
          {
            primaryKey: "condition-0",
            label: "order_id Order.status = open",
            fieldLabels: { kind: "Type", join: "Combination", expression: "Condition", detail: "Details" },
            fields: {
              kind: "Rule",
              join: "",
              expression: [orderParamRef, " Order.status = open"],
              detail: "Order must be open",
            },
            tones: { kind: "info" },
          },
        ],
        explanation: {
          code: SAVED_CODE,
          segments: [
            {
              id: "seg-1",
              lineRange: { start: 1, end: 2 },
              kind: "UPDATE_OBJECT",
              kindLabel: "Update object",
              title: "Mark approved",
              details: [
                {
                  label: "Object from",
                  parts: [{ text: "order_id", refKey: "order_id" }],
                },
              ],
            },
          ],
          summary: [{ title: "Summary", kind: "text", text: "Marks the order as approved." }],
        },
      },
    });
    const { instance } = mount;

    await vi.waitFor(() => {
      expect(element.querySelectorAll('[data-member="derivedParameters"] tbody tr[data-row-item="true"]')).toHaveLength(2);
      expect(element.querySelectorAll('[data-member="derivedEffects"] tbody tr[data-row-item="true"]')).toHaveLength(1);
      expect(element.querySelectorAll('[data-member="derivedConditions"] tbody tr[data-row-item="true"]')).toHaveLength(1);
    });

    const paramRows = [...element.querySelectorAll<HTMLElement>('[data-member="derivedParameters"] tbody tr[data-row-item="true"]')];
    const effectTargetCell = element.querySelector<HTMLElement>('[data-member="derivedEffects"] tbody tr[data-row-item="true"] td:nth-child(3)');
    expect(effectTargetCell?.textContent).not.toContain(",");

    // 1. Clicking inline parameter button in derivedEffects selects child-object state and highlights & scrolls to row.
    const scrollSpy = vi.fn();
    paramRows[0]!.scrollIntoView = scrollSpy;
    const effectParamBtn = effectTargetCell!.querySelector<HTMLButtonElement>("button.is-child-ref")!;
    expect(effectParamBtn.textContent?.trim()).toBe("order_id");
    effectParamBtn.click();

    await vi.waitFor(() => {
      expect(instance.state.values.value.selectedParameter).toEqual({
        parent,
        primaryKey: "order_id",
      });
      expect(paramRows[0]!.classList.contains("chosen")).toBe(true);
      expect(paramRows[0]!.getAttribute("aria-selected")).toBe("true");
      expect(scrollSpy).toHaveBeenCalled();
    });

    // 2. Clicking a parameter row directly selects its child-object identity (`note`).
    paramRows[1]!.click();
    await vi.waitFor(() => {
      expect(instance.state.values.value.selectedParameter).toEqual({
        parent,
        primaryKey: "note",
      });
      expect(paramRows[1]!.classList.contains("chosen")).toBe(true);
      expect(paramRows[0]!.classList.contains("chosen")).toBe(false);
    });

    // 3. Clicking inline parameter button in derivedConditions re-selects `order_id` child-object state.
    const conditionExprCell = element.querySelector<HTMLElement>('[data-member="derivedConditions"] tbody tr td:nth-child(3)');
    expect(conditionExprCell?.textContent?.replace(/\s+/g, " ").trim()).toBe("order_id Order.status = open");
    const conditionParamBtn = conditionExprCell!.querySelector<HTMLButtonElement>("button.is-child-ref")!;
    conditionParamBtn.click();
    await vi.waitFor(() => {
      expect(instance.state.values.value.selectedParameter).toEqual({
        parent,
        primaryKey: "order_id",
      });
      expect(paramRows[0]!.classList.contains("chosen")).toBe(true);
    });

    // 4. Clicking codeLocations tag button in derivedParameters jumps to `code` tab and activates `seg-1`.
    const codeLocationBtn = paramRows[0]!.querySelector<HTMLButtonElement>("button.is-child-ref")!;
    expect(codeLocationBtn.textContent?.trim()).toBe("Mark approved (L1–2)");
    codeLocationBtn.click();
    await vi.waitFor(() => {
      expect(instance.state.values.value.activeTab).toBe("code");
      expect(instance.state.values.value.activeSegmentId).toBe("seg-1");
    });

    // 5. Expanding seg-1 details and clicking its parameter reference jumps back to `derived` tab with child-object selectedParameter.
    instance.state.set("selectedParameter", null);
    await nextTick();
    const segCard = await vi.waitFor(() => {
      const found = element.querySelector<HTMLElement>('[data-member="explanation"] [data-segment-id="seg-1"]');
      expect(found).not.toBeNull();
      return found!;
    });
    segCard.querySelector<HTMLButtonElement>(".sdk-annotated-code-seg-toggle")!.click();
    await vi.waitFor(() => {
      expect(segCard.querySelector<HTMLButtonElement>(".sdk-annotated-code-ref")).not.toBeNull();
    });
    const refButton = segCard.querySelector<HTMLButtonElement>(".sdk-annotated-code-ref")!;
    expect(refButton.textContent?.trim()).toBe("order_id");
    refButton.click();
    await vi.waitFor(() => {
      expect(instance.state.values.value.activeTab).toBe("derived");
      expect(instance.state.values.value.selectedParameter).toEqual({
        parent,
        primaryKey: "order_id",
      });
    });
  });

  it("renders configured English and Chinese empty states for zero effects, parameters, and conditions without blank subtitles", async () => {
    const enMount = await mountDetailPanel({
      locale: "en",
      initial: {
        selected: { className: ACTION, primaryKey: "approve-order" },
        activeTab: "derived",
      },
    });
    await vi.waitFor(() => {
      expect(enMount.element.querySelector('[data-member="derivedEffects"]')?.textContent)
        .toContain("The owner derives no effect from this code.");
      expect(enMount.element.querySelector('[data-member="derivedParameters"]')?.textContent)
        .toContain("No parameters.");
      expect(enMount.element.querySelector('[data-member="derivedConditions"]')?.textContent)
        .toContain("No submission condition is derived.");
    });

    const zhMount = await mountDetailPanel({
      locale: "zh-CN",
      initial: {
        selected: { className: ACTION, primaryKey: "approve-order" },
        activeTab: "derived",
      },
    });
    await vi.waitFor(() => {
      expect(zhMount.element.querySelector('[data-member="derivedEffects"]')?.textContent)
        .toContain("属主没有从这段代码里推导出改动。");
      expect(zhMount.element.querySelector('[data-member="derivedParameters"]')?.textContent)
        .toContain("没有参数。");
      expect(zhMount.element.querySelector('[data-member="derivedConditions"]')?.textContent)
        .toContain("没有推导出提交条件。");
    });
  });
});
