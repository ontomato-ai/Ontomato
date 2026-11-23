import { afterEach, describe, expect, it, vi } from "vitest";
import { createApp, h, ref } from "vue";
import { createI18n } from "vue-i18n";
import ElementPlus from "element-plus";
import publicEn from "@ontomato/workbench-ui/locales/en";
import type { PageDraft, PageDraftLink } from "@ontomato/contracts/page-draft";
import {
  definePanel,
  type PanelManifest,
  type PanelMemberPath,
  type PanelOperationRowContext,
} from "@ontomato/contracts/panel-manifest";
import type { ProductPanelReadResponse } from "@ontomato/contracts/panel-host";
import type { DirectProjection } from "@ontomato/contracts/product-panels";
import { APPLICATION, ONTOLOGY_TYPE, SCHEDULED_TASK, WORKFLOW } from "@ontomato/contracts/platform-object-types";
import {
  createDirectPanelInstance,
  type DirectPanelInstance,
  type PanelMemberReadRequest,
} from "../../../../../packages/apps-sdk/src/panel/direct";
import type { PanelWriteInvocation } from "../../../../../packages/apps-sdk/src/panel/human-operations";
import { itemKeysEqual } from "../../../../../packages/apps-sdk/src/panel/member-forms";
import PanelMember from "../../../../../packages/apps-sdk/src/panel/PanelMember.vue";
import { createPanelText } from "../../../../../packages/apps-sdk/src/panel/text";
import { noOperations } from "./panel-frame";

const meta = {
  domainId: "domain-1",
  ownerId: "owner-1",
  revision: 1,
  createdAt: "2026-11-22T00:00:00.000Z",
  updatedAt: "2026-11-22T00:00:00.000Z",
  editable: false,
  visibility: "domain" as const,
  description: "",
};

const ready = (value: unknown): ProductPanelReadResponse => ({ status: "ready", value: value as never });
const sampleLink: PageDraftLink = {
  sessionId: "session-1",
  runId: "run-1",
  path: "outputs/drafts/entry.page-draft.json",
};

interface PreparedCall {
  operationId: string;
  invocation: PanelWriteInvocation;
  memberPath?: PanelMemberPath;
  rowContext?: PanelOperationRowContext;
}

let cleanup: (() => void) | null = null;

afterEach(() => {
  cleanup?.();
  cleanup = null;
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

function formDescription(label: string, draftOperation: string) {
  return {
    fields: [
      {
        path: "/label",
        label: "Label",
        required: true,
        readOnly: false,
        valueSchema: { type: "string" },
        control: { kind: "text", multiline: false },
      },
    ],
    values: { label },
    errors: [],
    revision: 1,
    save: {
      method: "PUT",
      path: "/applications/:id",
      bodySchema: {},
      draftOperation,
    },
  };
}

function saveOperation(handlerRef: string) {
  return {
    save: {
      kind: "form.save",
      handlerRef,
      label: "Save",
      effect: "write",
      target: { source: "input", input: "app" },
      inputSchema: {},
      resultSchema: {},
      batch: false,
    },
  };
}

function formProjection(
  id: string,
  name: string,
  operationId: string,
  section: "identity" | "entries",
  extraInputs: DirectProjection["inputs"] = {},
): DirectProjection {
  return {
    ...meta,
    id,
    name,
    componentId: "@ontomato/sdk:ObjectForm",
    inputs: {
      app: { kind: "object", objectType: APPLICATION },
      values: { kind: "json" },
      changedField: { kind: "scalar", type: "string" },
      ...extraInputs,
    },
    outputs: {},
    config: {},
    data: {
      form: {
        source: { object: { input: "app" } },
        read: "form",
        params: {
          section: { literal: section },
          values: { input: "values" },
          changedField: { input: "changedField" },
        },
      },
    },
    operations: {
      save: {
        operation: { kind: "PlatformOperation", id: operationId },
        target: { input: "app" },
      },
    },
  };
}

function mountPanel(options: {
  manifest: PanelManifest;
  projections: Record<string, DirectProjection>;
  members: readonly string[];
  initial?: Record<string, unknown>;
  answer: (request: PanelMemberReadRequest) => ProductPanelReadResponse | Promise<ProductPanelReadResponse>;
}) {
  const reads: PanelMemberReadRequest[] = [];
  const preparedCalls: PreparedCall[] = [];
  const instance: DirectPanelInstance = createDirectPanelInstance(options.manifest, {
    pageKey: "app-entries-page",
    url: () => "/panels/app-entries",
    label: () => "App Entries",
    initial: options.initial as never,
    recordDraftCreated: async () => {},
    text: createPanelText({}, ref("en"), "en"),
    ...noOperations,
    operations: {
      ...noOperations.operations,
      async prepare(operationId, invocation, memberPath, rowContext) {
        preparedCalls.push({ operationId, invocation, memberPath, rowContext });
        return {
          intentId: `intent-${preparedCalls.length}`,
          operationId,
          label: "Save",
          confirmation: { kind: "none" },
        };
      },
    },
    confirmOperation: async (preparation) => ({
      decision: "confirm",
      response: {
        kind: "dispatched",
        intentId: preparation.intentId,
        outcome: { kind: "success", message: "Saved", data: {} },
      },
    }),
    readProjection: async (id) => {
      const found = options.projections[id];
      if (!found) throw new Error(`Unknown projection ${id}`);
      return found;
    },
    read: async (request) => {
      reads.push(request);
      return options.answer(request);
    },
  });

  const element = document.createElement("div");
  document.body.appendChild(element);
  const app = createApp({
    setup: () => () => h("div", options.members.map((member) => h(PanelMember, { instance, member, key: member }))),
  })
    .use(createI18n({ legacy: false, locale: "en", messages: { en: publicEn } as never }))
    .use(ElementPlus);
  app.mount(element);

  cleanup = () => {
    app.unmount();
    element.remove();
  };

  return { instance, element, reads, preparedCalls };
}

function holdDraft(instance: DirectPanelInstance, draft: PageDraft<Record<string, unknown>>) {
  instance.forms.hold(draft, sampleLink, instance.receiveDraft, () => true, () => {}, instance.rollbackDraft);
}

describe("row-attached ObjectForm draft itemKey matching and isolation", () => {
  it("claims an itemKey draft only on the matching row, prevents top-level hijacking, isolates active draft across rows, and saves with row memberPath", async () => {
    const projections: Record<string, DirectProjection> = {
      "app-settings-form": formProjection("app-settings-form", "App settings", `${APPLICATION}.save`, "identity"),
      "app-add-entry-form": formProjection("app-add-entry-form", "Add entry", "applications.addEntry", "entries"),
      "app-entries-list": {
        ...meta,
        id: "app-entries-list",
        name: "Entries",
        componentId: "@ontomato/sdk:ObjectList",
        inputs: {},
        outputs: {},
        config: {},
        data: {
          rows: { source: { type: { kind: "PlatformObjectType", id: APPLICATION } }, read: "query", params: {} },
        },
      },
      "app-entry-row-form": formProjection("app-entry-row-form", "Edit entry", "applications.updateEntry", "entries", {
        entryId: { kind: "scalar", type: "string" },
      }),
    };

    const manifest = definePanel({
      state: {
        application: { type: { kind: "object", objectType: APPLICATION } },
      },
      members: {
        parentForm: { target: { projectionId: "app-settings-form" }, inputs: { app: { state: "application" } } },
        addEntryForm: { target: { projectionId: "app-add-entry-form" }, inputs: { app: { state: "application" } } },
        entries: { target: { projectionId: "app-entries-list" } },
        rowForm: {
          target: { projectionId: "app-entry-row-form" },
          listRowDetail: { slot: "entries" },
          inputs: { app: { state: "application" }, entryId: { item: "primaryKey" } },
        },
      },
    });

    const entryLabels: Record<string, string> = {
      "entry-1": "Home",
      "entry-2": "Reports",
    };

    const { instance, element, reads, preparedCalls } = mountPanel({
      manifest,
      projections,
      members: ["parentForm", "addEntryForm", "entries"],
      initial: { application: { className: APPLICATION, primaryKey: "app-1" } },
      answer(request) {
        const member = request.memberPath[0]?.member;
        if (request.operations) {
          if (member === "parentForm") return ready(saveOperation(`${APPLICATION}.save`));
          if (member === "addEntryForm") return ready(saveOperation("applications.addEntry"));
          if (member === "rowForm") return ready(saveOperation("applications.updateEntry"));
          return ready({});
        }
        if (request.dataName === "rows") {
          return ready({
            rows: [
              { primaryKey: "entry-1", label: "Home", fields: {} },
              { primaryKey: "entry-2", label: "Reports", fields: {} },
            ],
            total: 2,
          });
        }
        const draftLabel = (request.inputs.values as { label?: string } | undefined)?.label;
        if (member === "parentForm") {
          return ready(formDescription(draftLabel ?? "Main App", `${APPLICATION}.save`));
        }
        if (member === "addEntryForm") {
          return ready(formDescription(draftLabel ?? "", "applications.addEntry"));
        }
        const entryId = String(request.inputs.entryId ?? "");
        return ready(formDescription(draftLabel ?? entryLabels[entryId] ?? "", "applications.updateEntry"));
      },
    });

    await vi.waitFor(() => expect(element.querySelectorAll(".sdk-object-list-expand-btn")).toHaveLength(2));

    // Hold a row-scoped draft targeting entry-2 on app-1.
    holdDraft(instance, {
      pageKey: "app-entries-page",
      operation: "applications.updateEntry",
      target: { objectType: APPLICATION, id: "app-1", itemKey: "entry-2" },
      form: { label: "Sales Reports" },
    });

    // Top-level non-row forms never hijack an itemKey draft, and unclaimedDraft waits for the row detail.
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(instance.draft.value).toBeNull();
    expect(instance.unclaimedDraft.value).toBeNull();
    expect(
      reads.some(
        (read) =>
          (read.memberPath[0]?.member === "parentForm" || read.memberPath[0]?.member === "addEntryForm") &&
          read.inputs.values !== undefined,
      ),
    ).toBe(false);

    // Expanding row entry-1 must NOT claim entry-2's draft.
    const expandButtons = () => [...element.querySelectorAll<HTMLButtonElement>(".sdk-object-list-expand-btn")];
    expandButtons()[0]!.click();
    await vi.waitFor(() => {
      expect(element.querySelector<HTMLInputElement>(".sdk-object-list-detail-host input")?.value).toBe("Home");
    });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(instance.draft.value).toBeNull();
    expect(element.querySelector(".sdk-object-list-detail-host .sdk-owner-form-actions")).toBeNull();

    // Expanding row entry-2 mounts rowForm for entry-2 and immediately claims the held draft.
    expandButtons()[1]!.click();
    await vi.waitFor(() => {
      expect(instance.draft.value).toMatchObject({
        slot: "rowForm",
        operation: "applications.updateEntry",
        target: { objectType: APPLICATION, id: "app-1", itemKey: "entry-2" },
      });
    });
    await vi.waitFor(() => {
      expect(element.querySelector<HTMLInputElement>(".sdk-object-list-detail-host input")?.value).toBe("Sales Reports");
    });
    expect(element.querySelector(".sdk-object-list-detail-host .sdk-owner-form-actions")).not.toBeNull();

    // Switching back to entry-1 must NOT expose entry-2's active draft or Save/Discard bar on entry-1.
    expandButtons()[0]!.click();
    await vi.waitFor(() => {
      expect(element.querySelector<HTMLInputElement>(".sdk-object-list-detail-host input")?.value).toBe("Home");
    });
    expect(element.querySelector(".sdk-object-list-detail-host .sdk-owner-form-actions")).toBeNull();
    expect(instance.draft.value?.target.itemKey).toBe("entry-2");

    // Switching back to entry-2 and saving dispatches through rowOperation with itemKey on memberPath and settles the draft.
    expandButtons()[1]!.click();
    await vi.waitFor(() => {
      expect(element.querySelector(".sdk-object-list-detail-host .sdk-owner-form-actions")).not.toBeNull();
    });
    const saveButton = element.querySelector<HTMLButtonElement>(
      ".sdk-object-list-detail-host .sdk-owner-form-actions .el-button--primary",
    );
    expect(saveButton).not.toBeNull();
    saveButton!.click();
    await vi.waitFor(() => expect(preparedCalls).toHaveLength(1));
    expect(preparedCalls[0]).toMatchObject({
      operationId: "rowForm.save",
      memberPath: [{ member: "rowForm", itemKey: "entry-2" }],
      rowContext: {
        state: {
          application: { className: APPLICATION, primaryKey: "app-1" },
        },
      },
    });
    await vi.waitFor(() => expect(instance.draft.value).toBeNull());
  });

  it("never lets a mounted row form steal a draft without itemKey (parent add-row or ordinary object draft)", async () => {
    const projections: Record<string, DirectProjection> = {
      "app-add-entry-form": formProjection("app-add-entry-form", "Add entry", "applications.addEntry", "entries"),
      "app-entries-list": {
        ...meta,
        id: "app-entries-list",
        name: "Entries",
        componentId: "@ontomato/sdk:ObjectList",
        inputs: {},
        outputs: {},
        config: {},
        data: {
          rows: { source: { type: { kind: "PlatformObjectType", id: APPLICATION } }, read: "query", params: {} },
        },
      },
      "app-entry-row-form": formProjection("app-entry-row-form", "Edit entry", "applications.addEntry", "entries", {
        entryId: { kind: "scalar", type: "string" },
      }),
    };

    const manifest = definePanel({
      state: { application: { type: { kind: "object", objectType: APPLICATION } } },
      members: {
        entries: { target: { projectionId: "app-entries-list" } },
        rowForm: {
          target: { projectionId: "app-entry-row-form" },
          listRowDetail: { slot: "entries" },
          inputs: { app: { state: "application" }, entryId: { item: "primaryKey" } },
        },
        addEntryForm: { target: { projectionId: "app-add-entry-form" }, inputs: { app: { state: "application" } } },
      },
    });

    const { instance, element } = mountPanel({
      manifest,
      projections,
      members: ["entries", "addEntryForm"],
      initial: { application: { className: APPLICATION, primaryKey: "app-1" } },
      answer(request) {
        if (request.operations) return ready(saveOperation("applications.addEntry"));
        if (request.dataName === "rows") {
          return ready({
            rows: [{ primaryKey: "entry-1", label: "Home", fields: {} }],
            total: 1,
          });
        }
        const next = (request.inputs.values as { label?: string } | undefined)?.label ?? "Existing";
        // Even if both forms report the same draftOperation, only the non-row form may claim a draft without itemKey.
        return ready(formDescription(next, "applications.addEntry"));
      },
    });

    await vi.waitFor(() => expect(element.querySelector(".sdk-object-list-expand-btn")).not.toBeNull());
    element.querySelector<HTMLButtonElement>(".sdk-object-list-expand-btn")!.click();
    await vi.waitFor(() => {
      expect(element.querySelector<HTMLInputElement>(".sdk-object-list-detail-host input")?.value).toBe("Existing");
    });

    holdDraft(instance, {
      pageKey: "app-entries-page",
      operation: "applications.addEntry",
      target: { objectType: APPLICATION, id: "app-1" },
      form: { label: "New Entry" },
    });

    await vi.waitFor(() => {
      expect(instance.draft.value).toMatchObject({
        slot: "addEntryForm",
        operation: "applications.addEntry",
        target: { objectType: APPLICATION, id: "app-1" },
      });
    });
    expect(instance.draft.value?.target.itemKey).toBeUndefined();
    expect(element.querySelector<HTMLInputElement>(".sdk-object-list-detail-host input")?.value).toBe("Existing");
  });

  it("matches heterogeneous { className, primaryKey } itemKeys strictly and rejects mismatched parent ids or string/object mismatches", async () => {
    expect(itemKeysEqual("entry-1", "entry-1")).toBe(true);
    expect(itemKeysEqual("entry-1", "entry-2")).toBe(false);
    expect(itemKeysEqual("entry-1", { className: WORKFLOW, primaryKey: "entry-1" })).toBe(false);
    expect(
      itemKeysEqual(
        { className: WORKFLOW, primaryKey: "shared-id" },
        { className: WORKFLOW, primaryKey: "shared-id" },
      ),
    ).toBe(true);
    expect(
      itemKeysEqual(
        { className: WORKFLOW, primaryKey: "shared-id" },
        { className: SCHEDULED_TASK, primaryKey: "shared-id" },
      ),
    ).toBe(false);

    const projections: Record<string, DirectProjection> = {
      "hetero-list": {
        ...meta,
        id: "hetero-list",
        name: "Items",
        componentId: "@ontomato/sdk:ObjectList",
        inputs: {},
        outputs: {},
        config: {},
        data: {
          objects: {
            source: { type: { kind: "PlatformObjectType", id: ONTOLOGY_TYPE } },
            read: "objects",
            params: { type: { literal: WORKFLOW } },
          },
        },
      },
      "hetero-row-form": formProjection("hetero-row-form", "Row form", "applications.updateEntry", "entries"),
    };

    const manifest = definePanel({
      state: { application: { type: { kind: "object", objectType: APPLICATION } } },
      members: {
        items: { target: { projectionId: "hetero-list" } },
        rowForm: {
          target: { projectionId: "hetero-row-form" },
          listRowDetail: { slot: "items" },
          inputs: { app: { state: "application" } },
        },
      },
    });

    const { instance, element } = mountPanel({
      manifest,
      projections,
      members: ["items"],
      initial: { application: { className: APPLICATION, primaryKey: "app-1" } },
      answer(request) {
        if (request.operations) return ready(saveOperation("applications.updateEntry"));
        if (request.dataName === "objects") {
          return ready({
            status: "ok",
            type: WORKFLOW,
            layer: "capability",
            page: 1,
            pageSize: 20,
            total: 2,
            items: [
              { node: { className: WORKFLOW, primaryKey: "shared-id" }, label: "Workflow row" },
              { node: { className: SCHEDULED_TASK, primaryKey: "shared-id" }, label: "Task row" },
            ],
          });
        }
        const next = (request.inputs.values as { label?: string } | undefined)?.label ?? "Initial";
        return ready(formDescription(next, "applications.updateEntry"));
      },
    });

    await vi.waitFor(() => expect(element.querySelectorAll(".sdk-object-list-expand-btn")).toHaveLength(2));
    const expandButtons = () => [...element.querySelectorAll<HTMLButtonElement>(".sdk-object-list-expand-btn")];

    // First verify a mismatched parent id on a matching itemKey is declined without mutating panel state.
    holdDraft(instance, {
      pageKey: "app-entries-page",
      operation: "applications.updateEntry",
      target: {
        objectType: APPLICATION,
        id: "app-other",
        itemKey: { className: SCHEDULED_TASK, primaryKey: "shared-id" },
      },
      form: { label: "Wrong Parent" },
    });
    expandButtons()[1]!.click();
    await vi.waitFor(() => {
      expect(element.querySelector<HTMLInputElement>(".sdk-object-list-detail-host input")?.value).toBe("Initial");
    });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(instance.draft.value).toBeNull();
    expect(instance.state.values.value.application).toEqual({ className: APPLICATION, primaryKey: "app-1" });

    // Now test heterogeneous { className, primaryKey } isolation between two rows sharing primaryKey "shared-id".
    expandButtons()[0]!.click();
    await vi.waitFor(() => {
      expect(element.querySelector<HTMLInputElement>(".sdk-object-list-detail-host input")?.value).toBe("Initial");
    });
    holdDraft(instance, {
      pageKey: "app-entries-page",
      operation: "applications.updateEntry",
      target: {
        objectType: APPLICATION,
        id: "app-1",
        itemKey: { className: SCHEDULED_TASK, primaryKey: "shared-id" },
      },
      form: { label: "Task Updated" },
    });
    await new Promise((resolve) => setTimeout(resolve, 20));
    // Workflow row with the same primaryKey must NOT claim ScheduledTask's draft.
    expect(instance.draft.value).toBeNull();

    // Expanding the ScheduledTask row claims the draft cleanly.
    expandButtons()[1]!.click();
    await vi.waitFor(() => {
      expect(instance.draft.value).toMatchObject({
        slot: "rowForm",
        target: {
          objectType: APPLICATION,
          id: "app-1",
          itemKey: { className: SCHEDULED_TASK, primaryKey: "shared-id" },
        },
      });
    });
    await vi.waitFor(() => {
      expect(element.querySelector<HTMLInputElement>(".sdk-object-list-detail-host input")?.value).toBe("Task Updated");
    });
  });

  it("reports unclaimedDraft when a panel without listRowDetail receives an itemKey draft", async () => {
    const projections: Record<string, DirectProjection> = {
      "app-settings-form": formProjection("app-settings-form", "App settings", `${APPLICATION}.save`, "identity"),
    };
    const manifest = definePanel({
      state: { application: { type: { kind: "object", objectType: APPLICATION } } },
      members: {
        parentForm: { target: { projectionId: "app-settings-form" }, inputs: { app: { state: "application" } } },
      },
    });

    const { instance, element } = mountPanel({
      manifest,
      projections,
      members: ["parentForm"],
      initial: { application: { className: APPLICATION, primaryKey: "app-1" } },
      answer(request) {
        if (request.operations) return ready(saveOperation(`${APPLICATION}.save`));
        return ready(formDescription("Main App", `${APPLICATION}.save`));
      },
    });

    await vi.waitFor(() => expect(element.querySelector<HTMLInputElement>("input")?.value).toBe("Main App"));

    holdDraft(instance, {
      pageKey: "app-entries-page",
      operation: "applications.updateEntry",
      target: { objectType: APPLICATION, id: "app-1", itemKey: "entry-1" },
      form: { label: "Orphan Row Draft" },
    });

    await vi.waitFor(() => {
      expect(instance.unclaimedDraft.value).toEqual({
        objectType: APPLICATION,
        operation: "applications.updateEntry",
      });
    });
    expect(instance.draft.value).toBeNull();
  });
});
