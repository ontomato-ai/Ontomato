/* eslint-disable vue/one-component-per-file -- test harnesses define inline Vue wrapper shells */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cloneVNode, createApp, nextTick, ref } from "vue";
import { createI18n } from "vue-i18n";
import ElementPlus from "element-plus";
import publicEn from "@ontomato/workbench-ui/locales/en";
import type { DirectPanelManifest } from "@ontomato/contracts/panel-manifest";
import type { DirectProjection } from "@ontomato/contracts/product-panels";
import type { ProductPanelReadResponse } from "@ontomato/contracts/panel-host";
import type { PanelFormField, PanelFormValues } from "@ontomato/contracts/panel-projection";
import type { PanelOwnerOperationDescriptor } from "@ontomato/contracts/panel-operations";
import { FUNCTION } from "@ontomato/contracts/platform-object-types";
import { randomId } from "@ontomato/contracts/random-id";
import { mountDirectPanel } from "../../../../../packages/apps-sdk/src/panel/direct-mount";
import { directRun, noOperations } from "./panel-frame";

/*
 * Verification of P3 unified page paradigm rules:
 * 1. ObjectForm save bar:
 *    - Hidden while clean in edit mode; appears on edit with exact changed field count + Discard/Save order.
 *    - Never shown when all non-hidden fields are readOnly in edit mode.
 *    - Always pinned in create mode with Cancel/Create labels; Cancel confirms only when dirty, resets draft, and emits `cancel`.
 * 2. OperationButton parameter dialog (OperationInputDialog):
 *    - Zero-dialog direct dispatch when inputSchema.properties is absent/empty, upload is declared, or read is draft/readOperationInputs-bound.
 *    - Opens ElDialog + ElForm when editable inputSchema.properties exist: renders string/enum/textarea/number/integer/boolean,
 *      validates required + integer constraints, passes typed `input` to writeOperation (single & batch) and readOperation.
 */

const meta = {
  domainId: "d",
  ownerId: "o",
  revision: 1,
  createdAt: "",
  updatedAt: "",
  editable: false,
  visibility: "domain" as const,
  description: "",
};

const formSaveMeta = {
  method: "PUT",
  path: "/functions/:id",
  bodySchema: {},
  draftOperation: "function.save",
};

const saveDescriptor: PanelOwnerOperationDescriptor = {
  kind: "form.save",
  handlerRef: `${FUNCTION}.save`,
  label: "Save",
  effect: "write",
  target: { source: "input", input: "item" },
  inputSchema: {},
  resultSchema: {},
  batch: false,
};

const i18n = (locale: "en" | "zh-CN" = "en") => createI18n({
  legacy: false,
  locale,
  messages: {
    en: publicEn,
    "zh-CN": {
      ...publicEn,
      platform: {
        ...publicEn.platform,
        save: "保存",
        create: "创建",
        cancel: "取消",
        confirm: "确认",
        discard: "放弃",
        formChangedCount: "已修改 {count} 项",
      },
    },
  },
});

const fnType = { kind: "object", objectType: FUNCTION } as const;
const fnListType = { kind: "list", items: fnType } as const;

afterEach(() => {
  document.querySelectorAll(".el-message-box__wrapper, .el-overlay").forEach((node) => node.remove());
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

function mountFormHarness(options: {
  fields: PanelFormField[];
  values: PanelFormValues;
  createMode?: boolean;
  locale?: "en" | "zh-CN";
  config?: DirectProjection["config"];
  onSave?: (values: PanelFormValues) => void;
}) {
  const createMode = options.createMode ?? false;
  const projection: DirectProjection = {
    ...meta,
    id: "paradigm-form",
    name: "Paradigm form",
    componentId: "@ontomato/sdk:ObjectForm",
    inputs: createMode
      ? { values: { kind: "json" }, changedField: { kind: "scalar", type: "string" } }
      : { item: fnType, values: { kind: "json" }, changedField: { kind: "scalar", type: "string" } },
    outputs: {},
    config: options.config ?? {},
    data: createMode
      ? {
          createForm: {
            source: { type: { kind: "PlatformObjectType", id: FUNCTION } },
            read: "createForm",
            params: { values: { input: "values" }, changedField: { input: "changedField" } },
          },
        }
      : {
          form: {
            source: { object: { input: "item" } },
            read: "form",
            params: { values: { input: "values" }, changedField: { input: "changedField" } },
          },
        },
    operations: {
      save: {
        operation: { kind: "PlatformOperation", id: `${FUNCTION}.save` },
        target: createMode ? { literal: { className: FUNCTION, primaryKey: "new" } } : { input: "item" },
      },
    },
  };
  const manifest: DirectPanelManifest = createMode
    ? { state: {}, members: { form: { target: { projectionId: projection.id } } }, commands: {} }
    : {
        state: { item: { type: fnType, personal: false, deepLink: true, external: false } },
        members: { form: { target: { projectionId: projection.id }, inputs: { item: { state: "item" } } } },
        commands: {},
      };

  const intentId = randomId();
  let lastSavedValues: PanelFormValues | null = null;
  const cancelled: number[] = [];
  const savedEvents: unknown[] = [];

  const mount = mountDirectPanel({
    manifest,
    run: directRun({
      pageKey: "paradigm-form",
      url: () => "/paradigm-form",
      label: () => "Paradigm form",
      initial: createMode ? {} : { item: { className: FUNCTION, primaryKey: "fn-1" } },
    }),
    messages: {},
    locale: ref(options.locale ?? "en"),
    defaultLocale: "en",
    requests: {
      request: async (path, init) => {
        if (path === "/panel-operations/intents") {
          const body = JSON.parse(String(init?.body)) as { call: { input: { values: PanelFormValues } } };
          lastSavedValues = body.call.input.values;
          options.onSave?.(lastSavedValues);
          return Response.json({ intentId, operationId: "form.save", label: "Save", confirmation: { kind: "none" } });
        }
        return Response.json({ projection });
      },
    },
    use: { applicationId: "app", useId: "paradigm-form" },
    expandPageComposer: noOperations.expandPageComposer,
    navigate: noOperations.navigate,
    nested: noOperations.nested,
    confirmOperation: async () => ({
      decision: "confirm",
      response: {
        kind: "dispatched",
        intentId,
        outcome: {
          kind: "success",
          data: {},
          affected: { objects: [{ objectType: FUNCTION, primaryKey: "fn-created" }], objectTypes: [FUNCTION] },
        },
      },
    }),
    read: async (request): Promise<ProductPanelReadResponse> => request.operations
      ? { status: "ready", value: { save: saveDescriptor } as never }
      : {
          status: "ready",
          value: {
            fields: options.fields,
            values: options.values,
            errors: [],
            revision: 1,
            save: formSaveMeta,
          } as never,
        },
  });

  const element = document.createElement("div");
  document.body.append(element);
  const app = createApp({
    render: () => cloneVNode(mount.member("form"), {
      onCancel: () => cancelled.push(Date.now()),
      onSaved: (payload: unknown) => savedEvents.push(payload),
    }),
  });
  app.use(i18n(options.locale ?? "en")).use(ElementPlus).mount(element);
  return {
    element,
    cancelled,
    savedEvents,
    getLastSavedValues: () => lastSavedValues,
    dispose: () => {
      app.unmount();
      mount.dispose();
    },
  };
}

describe("P3 ObjectForm save bar paradigm rules", () => {
  it("hides the save bar when clean in edit mode, shows changed count and Discard/Save on edit, and hides again on discard/save", async () => {
    const fields: PanelFormField[] = [
      { path: "/name", label: "Name", required: true, readOnly: false, valueSchema: { type: "string" }, control: { kind: "text", multiline: false } },
      { path: "/summary", label: "Summary", required: false, readOnly: false, valueSchema: { type: "string" }, control: { kind: "text", multiline: false } },
    ];
    const harness = mountFormHarness({ fields, values: { name: "Order", summary: "Initial" } });
    try {
      await vi.waitFor(() => expect(harness.element.querySelector('[data-field="/name"] input')).not.toBeNull());
      // Clean edit form: save bar is not rendered at all.
      expect(harness.element.querySelector(".sdk-owner-form-actions")).toBeNull();

      // Edit first field -> save bar appears with "1 change", Discard on left, Save on right.
      const nameInput = harness.element.querySelector<HTMLInputElement>('[data-field="/name"] input')!;
      nameInput.value = "Order v2";
      nameInput.dispatchEvent(new Event("input"));
      await vi.waitFor(() => expect(harness.element.querySelector(".sdk-owner-form-actions")).not.toBeNull());
      expect(harness.element.querySelector(".sdk-owner-form-unsaved")?.textContent?.trim()).toBe("1 change");
      const buttons = [...harness.element.querySelectorAll<HTMLButtonElement>(".sdk-owner-form-actions button")];
      expect(buttons.map((b) => b.textContent?.trim())).toEqual(["Discard", "Save"]);

      // Edit second field -> count updates to "2 changes".
      const summaryInput = harness.element.querySelector<HTMLInputElement>('[data-field="/summary"] input')!;
      summaryInput.value = "Updated summary";
      summaryInput.dispatchEvent(new Event("input"));
      await vi.waitFor(() => expect(harness.element.querySelector(".sdk-owner-form-unsaved")?.textContent?.trim()).toBe("2 changes"));

      // Save -> form becomes clean and save bar disappears.
      buttons[1]!.click();
      await vi.waitFor(() => expect(harness.getLastSavedValues()).toEqual({ name: "Order v2", summary: "Updated summary" }));
      await vi.waitFor(() => expect(harness.element.querySelector(".sdk-owner-form-actions")).toBeNull());
    } finally {
      harness.dispose();
    }
  });

  it("renders Chinese changed count label cleanly", async () => {
    const fields: PanelFormField[] = [
      { path: "/name", label: "名称", required: true, readOnly: false, valueSchema: { type: "string" }, control: { kind: "text", multiline: false } },
      { path: "/summary", label: "说明", required: false, readOnly: false, valueSchema: { type: "string" }, control: { kind: "text", multiline: false } },
    ];
    const harness = mountFormHarness({ fields, values: { name: "订单", summary: "初始" }, locale: "zh-CN" });
    try {
      await vi.waitFor(() => expect(harness.element.querySelector('[data-field="/name"] input')).not.toBeNull());
      const nameInput = harness.element.querySelector<HTMLInputElement>('[data-field="/name"] input')!;
      nameInput.value = "订单 v2";
      nameInput.dispatchEvent(new Event("input"));
      const summaryInput = harness.element.querySelector<HTMLInputElement>('[data-field="/summary"] input')!;
      summaryInput.value = "已更新";
      summaryInput.dispatchEvent(new Event("input"));
      await vi.waitFor(() => expect(harness.element.querySelector(".sdk-owner-form-unsaved")?.textContent?.trim()).toBe("已修改 2 项"));
    } finally {
      harness.dispose();
    }
  });

  it("never renders the save bar when all non-hidden fields are read-only", async () => {
    const fields: PanelFormField[] = [
      { path: "/internalId", label: "ID", required: false, readOnly: false, valueSchema: { type: "string" }, control: { kind: "hidden" } },
      { path: "/name", label: "Name", required: false, readOnly: true, readOnlyReason: "Managed by workflow skill", valueSchema: { type: "string" }, control: { kind: "text", multiline: false } },
      { path: "/summary", label: "Summary", required: false, readOnly: true, readOnlyReason: "Managed by workflow skill", valueSchema: { type: "string" }, control: { kind: "text", multiline: false } },
    ];
    const harness = mountFormHarness({ fields, values: { internalId: "1", name: "Frozen", summary: "Read only" } });
    try {
      await vi.waitFor(() => expect(harness.element.querySelector('[data-field="/name"] input')).not.toBeNull());
      expect(harness.element.textContent).toContain("Managed by workflow skill");
      expect(harness.element.querySelector(".sdk-owner-form-actions")).toBeNull();
    } finally {
      harness.dispose();
    }
  });

  it("keeps Cancel and Create pinned in create mode, confirms Cancel only when dirty, resets draft, and emits cancel", async () => {
    const fields: PanelFormField[] = [
      { path: "/name", label: "Name", required: true, readOnly: false, valueSchema: { type: "string" }, control: { kind: "text", multiline: false } },
    ];
    const harness = mountFormHarness({ fields, values: { name: "" }, createMode: true });
    try {
      await vi.waitFor(() => expect(harness.element.querySelector(".sdk-owner-form-actions")).not.toBeNull());
      const buttons = () => [...harness.element.querySelectorAll<HTMLButtonElement>(".sdk-owner-form-actions button")];
      expect(buttons().map((b) => b.textContent?.trim())).toEqual(["Cancel", "Create"]);
      expect(harness.element.querySelector(".sdk-owner-form-unsaved")).toBeNull();

      // Clicking Cancel while clean does not prompt and immediately emits `cancel`.
      buttons()[0]!.click();
      await nextTick();
      expect(document.querySelector(".el-message-box")).toBeNull();
      expect(harness.cancelled).toHaveLength(1);

      // Edit field -> count appears; clicking Cancel prompts before discarding.
      const input = harness.element.querySelector<HTMLInputElement>('[data-field="/name"] input')!;
      input.value = "New function";
      input.dispatchEvent(new Event("input"));
      await vi.waitFor(() => expect(harness.element.querySelector(".sdk-owner-form-unsaved")?.textContent?.trim()).toBe("1 change"));

      buttons()[0]!.click();
      const box = await vi.waitFor(() => {
        const found = document.querySelector<HTMLElement>(".el-message-box");
        if (!found) throw new Error("Expected confirmation dialog");
        return found;
      });
      // Choosing "Keep editing" keeps edits and does not emit cancel.
      [...box.querySelectorAll<HTMLButtonElement>("button")].find((b) => b.textContent?.trim() === "Keep editing")!.click();
      await vi.waitFor(() => expect(document.querySelector<HTMLElement>(".el-message-box")?.style.display ?? "none").toBe("none"));
      expect(input.value).toBe("New function");
      expect(harness.cancelled).toHaveLength(1);

      // Choosing "Discard" resets draft to baseline and emits cancel.
      buttons()[0]!.click();
      const secondBox = await vi.waitFor(() => {
        const found = document.querySelector<HTMLElement>(".el-message-box");
        if (!found || found.style.display === "none") throw new Error("Expected confirmation dialog");
        return found;
      });
      [...secondBox.querySelectorAll<HTMLButtonElement>("button")].find((b) => b.textContent?.trim() === "Discard")!.click();
      await vi.waitFor(() => expect(harness.cancelled).toHaveLength(2));
      expect(harness.element.querySelector<HTMLInputElement>('[data-field="/name"] input')?.value).toBe("");
      expect(harness.element.querySelector(".sdk-owner-form-unsaved")).toBeNull();

      // Clicking Create submits the create form.
      input.value = "Created function";
      input.dispatchEvent(new Event("input"));
      await nextTick();
      buttons()[1]!.click();
      await vi.waitFor(() => expect(harness.getLastSavedValues()).toEqual({ name: "Created function" }));
      await vi.waitFor(() => expect(harness.savedEvents).toHaveLength(1));
    } finally {
      harness.dispose();
    }
  });

  it("shows word limits on maxLength text fields, applies select placeholder, and honors create-only actions", async () => {
    const fields: PanelFormField[] = [
      { path: "/name", label: "Name", required: true, readOnly: false, valueSchema: { type: "string", maxLength: 80 }, control: { kind: "text", multiline: false, maxLength: 80 } },
      { path: "/desc", label: "Description", required: false, readOnly: false, valueSchema: { type: "string", maxLength: 400 }, control: { kind: "text", multiline: true, maxLength: 400 } },
      { path: "/source", label: "Source", required: true, readOnly: false, valueSchema: { type: "string" }, control: { kind: "select", options: [{ value: "a", label: "A", description: null, disabled: false, disabledReason: null }], placeholder: "Select source object type" } },
    ];
    const editHarness = mountFormHarness({ fields, values: { name: "rel", desc: "ok", source: "" }, config: { actions: "create-only" } });
    try {
      await vi.waitFor(() => expect(editHarness.element.querySelector('[data-field="/name"] input')).not.toBeNull());
      expect(editHarness.element.querySelector('[data-field="/name"] .el-input__count')?.textContent?.replace(/\s+/g, " ").trim()).toBe("3 / 80");
      expect(editHarness.element.querySelector('[data-field="/desc"] .el-input__count')?.textContent?.replace(/\s+/g, " ").trim()).toBe("2 / 400");
      expect(editHarness.element.querySelector('[data-field="/source"]')?.textContent).toContain("Select source object type");
      const nameInput = editHarness.element.querySelector<HTMLInputElement>('[data-field="/name"] input')!;
      nameInput.value = "rel2";
      nameInput.dispatchEvent(new Event("input"));
      await nextTick();
      // Edit mode with actions="create-only" keeps footer hidden so panel titlebar owns Save.
      expect(editHarness.element.querySelector(".sdk-owner-form-actions")).toBeNull();
    } finally {
      editHarness.dispose();
    }

    const createHarness = mountFormHarness({ fields, values: { name: "", desc: "", source: "" }, createMode: true, config: { actions: "create-only" } });
    try {
      await vi.waitFor(() => expect(createHarness.element.querySelector(".sdk-owner-form-actions")).not.toBeNull());
      const buttons = [...createHarness.element.querySelectorAll<HTMLButtonElement>(".sdk-owner-form-actions button")];
      expect(buttons.map((b) => b.textContent?.trim())).toEqual(["Cancel", "Create"]);
    } finally {
      createHarness.dispose();
    }
  });
});

function mountOperationHarness(options: {
  descriptor: PanelOwnerOperationDescriptor;
  batch?: boolean;
  boundParams?: Record<string, { literal: string }>;
}) {
  const batch = options.batch ?? false;
  const projection: DirectProjection = {
    ...meta,
    id: "op-button",
    name: "Operation",
    componentId: "@ontomato/sdk:OperationButton",
    inputs: options.descriptor.target.source === "input"
      ? { item: batch ? fnListType : fnType }
      : {},
    outputs: {},
    config: { operation: "run" },
    data: {},
    operations: {
      run: {
        operation: { kind: "PlatformOperation", id: options.descriptor.handlerRef },
        ...(options.descriptor.target.source === "input" ? { target: { input: "item" } } : {}),
        ...(options.boundParams ? { params: options.boundParams } : {}),
      },
    },
  };
  const manifest: DirectPanelManifest = options.descriptor.target.source === "input"
    ? {
        state: {
          item: { type: batch ? fnListType : fnType, personal: false, deepLink: false, external: false },
        },
        members: {
          action: { target: { projectionId: projection.id }, inputs: { item: { state: "item" } } },
        },
        commands: {},
      }
    : {
        state: {},
        members: { action: { target: { projectionId: projection.id } } },
        commands: {},
      };

  const intentId = randomId();
  const intentBodies: unknown[] = [];
  const readCalls: unknown[] = [];

  const mount = mountDirectPanel({
    manifest,
    run: directRun({
      pageKey: "op-test",
      url: () => "/op-test",
      label: () => "Op test",
      initial: options.descriptor.target.source === "input"
        ? {
            item: batch
              ? [{ className: FUNCTION, primaryKey: "fn-1" }, { className: FUNCTION, primaryKey: "fn-2" }]
              : { className: FUNCTION, primaryKey: "fn-1" },
          }
        : {},
    }),
    messages: {},
    locale: ref("en"),
    defaultLocale: "en",
    requests: {
      request: async (path, init) => {
        if (path === "/panel-operations/intents") {
          intentBodies.push(JSON.parse(String(init?.body)));
          return Response.json({ intentId, operationId: "action.run", label: options.descriptor.label, confirmation: { kind: "none" } });
        }
        if (path === "/panel-operations/read") {
          readCalls.push(JSON.parse(String(init?.body)));
          return Response.json({ kind: "markdown", markdown: "Preview ok" });
        }
        return Response.json({ projection });
      },
    },
    use: { applicationId: "app", useId: "op-test" },
    expandPageComposer: noOperations.expandPageComposer,
    navigate: noOperations.navigate,
    nested: noOperations.nested,
    confirmOperation: async () => ({
      decision: "confirm",
      response: {
        kind: "dispatched",
        intentId,
        outcome: batch
          ? {
              kind: "batch",
              items: [
                { target: { objectType: FUNCTION, primaryKey: "fn-1" }, outcome: { kind: "success", data: {} } },
                { target: { objectType: FUNCTION, primaryKey: "fn-2" }, outcome: { kind: "success", data: {} } },
              ],
            }
          : { kind: "success", data: {}, message: "Executed", affected: { objects: [], objectTypes: [] } },
      },
    }),
    read: async (): Promise<ProductPanelReadResponse> => ({
      status: "ready",
      value: { run: options.descriptor } as never,
    }),
  });

  const element = document.createElement("div");
  document.body.append(element);
  const app = createApp({ render: () => mount.member("action") });
  app.use(i18n("en")).use(ElementPlus).mount(element);
  return {
    element,
    intentBodies,
    readCalls,
    dispose: () => {
      app.unmount();
      mount.dispose();
    },
  };
}

describe("P3 OperationButton parameter dialog", () => {
  it("dispatches immediately without opening a dialog when inputSchema has no properties", async () => {
    const harness = mountOperationHarness({
      descriptor: {
        kind: "action",
        handlerRef: `${FUNCTION}.run`,
        label: "Run now",
        effect: "write",
        target: { source: "input", input: "item" },
        inputSchema: { type: "object", properties: {} },
        resultSchema: {},
        batch: false,
      },
    });
    try {
      const btn = await vi.waitFor(() => {
        const found = harness.element.querySelector<HTMLButtonElement>(".sdk-operation-button button");
        if (!found || found.disabled) throw new Error("Button not ready");
        return found;
      });
      btn.click();
      await vi.waitFor(() => expect(harness.intentBodies).toHaveLength(1));
      expect(document.querySelector(".sdk-operation-input-dialog")).toBeNull();
      expect(harness.intentBodies[0]).toMatchObject({
        operationId: "action.run",
        call: { target: { kind: "object", objectType: FUNCTION, primaryKey: "fn-1" }, input: {} },
      });
    } finally {
      harness.dispose();
    }
  });

  it("opens the parameter dialog for non-empty inputSchema.properties, validates required/integer fields, and passes typed input", async () => {
    const harness = mountOperationHarness({
      descriptor: {
        kind: "action",
        handlerRef: `${FUNCTION}.import`,
        label: "Import ontology",
        effect: "write",
        target: { source: "none" },
        inputSchema: {
          type: "object",
          required: ["sourceUrl", "mode", "retries"],
          properties: {
            sourceUrl: { type: "string", title: "Source URL", description: "URL to fetch definitions from" },
            mode: { type: "string", title: "Merge mode", enum: ["merge", "replace"], default: "merge" },
            notes: { type: "string", title: "Notes", format: "textarea" },
            retries: { type: "integer", title: "Retries", default: 2 },
            threshold: { type: "number", title: "Threshold" },
            dryRun: { type: "boolean", title: "Dry run", default: true },
          },
        },
        resultSchema: {},
        batch: false,
      },
    });
    try {
      const btn = await vi.waitFor(() => {
        const found = harness.element.querySelector<HTMLButtonElement>(".sdk-operation-button button");
        if (!found || found.disabled) throw new Error("Button not ready");
        return found;
      });
      btn.click();

      // Dialog opens; nothing dispatched yet.
      const dialog = await vi.waitFor(() => {
        const found = document.querySelector<HTMLElement>(".sdk-operation-input-dialog");
        if (!found) throw new Error("Dialog not open");
        return found;
      });
      expect(harness.intentBodies).toHaveLength(0);
      expect(dialog.textContent).toContain("Import ontology");
      expect(dialog.textContent).toContain("URL to fetch definitions from");
      // Textarea rendered for format: "textarea".
      expect(dialog.querySelector('[data-input-field="notes"] textarea')).not.toBeNull();
      // Default values pre-populated.
      expect(dialog.querySelector<HTMLInputElement>('[data-input-field="retries"] input')?.value).toBe("2");
      expect(dialog.querySelector('[data-input-field="dryRun"] .el-switch')?.classList.contains("is-checked")).toBe(true);

      // Submitting with missing required sourceUrl and non-integer retries shows errors and blocks dispatch.
      const retriesInput = dialog.querySelector<HTMLInputElement>('[data-input-field="retries"] input')!;
      retriesInput.value = "1.5";
      retriesInput.dispatchEvent(new Event("input"));
      await nextTick();

      const confirmBtn = () => [...dialog.querySelectorAll<HTMLButtonElement>(".sdk-operation-input-footer button")]
        .find((b) => b.textContent?.trim() === "Confirm")!;
      confirmBtn().click();
      await vi.waitFor(() => {
        expect(dialog.querySelector('[data-input-field="sourceUrl"]')?.textContent).toContain("Source URL is required");
        expect(dialog.querySelector('[data-input-field="retries"]')?.textContent).toContain("Retries must be an integer");
      });
      expect(harness.intentBodies).toHaveLength(0);

      // Fill valid values across all control types and confirm.
      const urlInput = dialog.querySelector<HTMLInputElement>('[data-input-field="sourceUrl"] input')!;
      urlInput.value = "https://example.com/model.json";
      urlInput.dispatchEvent(new Event("input"));
      const notesArea = dialog.querySelector<HTMLTextAreaElement>('[data-input-field="notes"] textarea')!;
      notesArea.value = "Initial sync";
      notesArea.dispatchEvent(new Event("input"));
      retriesInput.value = "3";
      retriesInput.dispatchEvent(new Event("input"));
      const thresholdInput = dialog.querySelector<HTMLInputElement>('[data-input-field="threshold"] input')!;
      thresholdInput.value = "0.75";
      thresholdInput.dispatchEvent(new Event("input"));
      await nextTick();

      confirmBtn().click();
      await vi.waitFor(() => expect(harness.intentBodies).toHaveLength(1));
      expect(harness.intentBodies[0]).toMatchObject({
        operationId: "action.run",
        call: {
          target: null,
          input: {
            sourceUrl: "https://example.com/model.json",
            mode: "merge",
            notes: "Initial sync",
            retries: 3,
            threshold: 0.75,
            dryRun: true,
          },
        },
      });
    } finally {
      harness.dispose();
    }
  });

  it("passes collected parameters to readOperation for unbound read operations with inputSchema.properties", async () => {
    const harness = mountOperationHarness({
      descriptor: {
        kind: "action",
        handlerRef: `${FUNCTION}.preview`,
        label: "Preview export",
        effect: "read",
        target: { source: "input", input: "item" },
        inputSchema: {
          type: "object",
          required: ["format"],
          properties: {
            format: { type: "string", title: "Format", enum: ["yaml", "json"], default: "yaml" },
            includeHistory: { type: "boolean", title: "Include history", default: false },
          },
        },
        resultSchema: {},
        batch: false,
      },
    });
    try {
      const btn = await vi.waitFor(() => {
        const found = harness.element.querySelector<HTMLButtonElement>(".sdk-operation-button button");
        if (!found || found.disabled) throw new Error("Button not ready");
        return found;
      });
      btn.click();

      const dialog = await vi.waitFor(() => {
        const found = document.querySelector<HTMLElement>(".sdk-operation-input-dialog");
        if (!found) throw new Error("Dialog not open");
        return found;
      });
      [...dialog.querySelectorAll<HTMLButtonElement>(".sdk-operation-input-footer button")]
        .find((b) => b.textContent?.trim() === "Confirm")!.click();

      await vi.waitFor(() => expect(harness.readCalls).toHaveLength(1));
      expect(harness.readCalls[0]).toMatchObject({
        operationId: "action.run",
        call: {
          target: { kind: "object", objectType: FUNCTION, primaryKey: "fn-1" },
          input: { format: "yaml", includeHistory: false },
        },
      });
    } finally {
      harness.dispose();
    }
  });

  it("passes collected parameters on every call of a batch write and skips dialog when all properties are bound by operation.params", async () => {
    const batchHarness = mountOperationHarness({
      batch: true,
      descriptor: {
        kind: "action",
        handlerRef: `${FUNCTION}.archive`,
        label: "Archive",
        effect: "write",
        target: { source: "input", input: "item" },
        inputSchema: {
          type: "object",
          required: ["reason"],
          properties: { reason: { type: "string", title: "Reason" } },
        },
        resultSchema: {},
        batch: true,
      },
    });
    try {
      const btn = await vi.waitFor(() => {
        const found = batchHarness.element.querySelector<HTMLButtonElement>(".sdk-operation-button button");
        if (!found || found.disabled) throw new Error("Button not ready");
        return found;
      });
      btn.click();
      const dialog = await vi.waitFor(() => {
        const found = document.querySelector<HTMLElement>(".sdk-operation-input-dialog");
        if (!found) throw new Error("Dialog not open");
        return found;
      });
      const reasonInput = dialog.querySelector<HTMLInputElement>('[data-input-field="reason"] input')!;
      reasonInput.value = "Deprecated";
      reasonInput.dispatchEvent(new Event("input"));
      await nextTick();
      [...dialog.querySelectorAll<HTMLButtonElement>(".sdk-operation-input-footer button")]
        .find((b) => b.textContent?.trim() === "Confirm")!.click();

      await vi.waitFor(() => expect(batchHarness.intentBodies).toHaveLength(1));
      expect(batchHarness.intentBodies[0]).toMatchObject({
        calls: [
          { target: { kind: "object", objectType: FUNCTION, primaryKey: "fn-1" }, input: { reason: "Deprecated" } },
          { target: { kind: "object", objectType: FUNCTION, primaryKey: "fn-2" }, input: { reason: "Deprecated" } },
        ],
      });
    } finally {
      batchHarness.dispose();
    }

    // All schema properties bound by projection.operations[op].params -> zero dialog, direct dispatch.
    const boundHarness = mountOperationHarness({
      boundParams: { entryId: { literal: "e-1" } },
      descriptor: {
        kind: "action",
        handlerRef: `${FUNCTION}.removeEntry`,
        label: "Remove entry",
        effect: "write",
        target: { source: "input", input: "item" },
        inputSchema: {
          type: "object",
          required: ["entryId"],
          properties: { entryId: { type: "string", title: "Entry ID" } },
        },
        resultSchema: {},
        batch: false,
      },
    });
    try {
      const btn = await vi.waitFor(() => {
        const found = boundHarness.element.querySelector<HTMLButtonElement>(".sdk-operation-button button");
        if (!found || found.disabled) throw new Error("Button not ready");
        return found;
      });
      btn.click();
      await vi.waitFor(() => expect(boundHarness.intentBodies).toHaveLength(1));
      expect(document.querySelector(".sdk-operation-input-dialog")).toBeNull();
    } finally {
      boundHarness.dispose();
    }
  });
});
