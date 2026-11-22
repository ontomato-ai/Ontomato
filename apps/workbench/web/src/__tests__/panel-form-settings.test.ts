import { afterEach, describe, expect, it, vi } from "vitest";
import { createApp, defineComponent, h, nextTick, ref, type Ref } from "vue";
import { createI18n } from "vue-i18n";
import ElementPlus from "element-plus";
import publicEn from "@ontomato/workbench-ui/locales/en";
import type { RuntimeJsonValue } from "@ontomato/contracts/agent-runtime-values";
import type { DirectPanelManifest } from "@ontomato/contracts/panel-manifest";
import type { DirectProjection } from "@ontomato/contracts/product-panels";
import type { ProductPanelReadResponse } from "@ontomato/contracts/panel-host";
import type { PanelFormDescription, PanelFormField, PanelFormValues } from "@ontomato/contracts/panel-projection";
import { FUNCTION } from "@ontomato/contracts/platform-object-types";
import { MODEL_OPTION } from "@ontomato/contracts/panel-client-requests";
import { randomId } from "@ontomato/contracts/random-id";
import {
  PanelHost,
  PlatformPageHeader,
  providePageActions,
  type PanelHostLabels,
  type PanelHostPort,
  type PlatformPageActions,
} from "@ontomato/platform-shell";
import { mountDirectPanel } from "../../../../../packages/apps-sdk/src/panel/direct-mount";
import { directRun, noOperations, panelRecord } from "./panel-frame";

/*
 * Official ObjectForm capabilities for settings-style forms (work_item-94726183):
 * 1. Row layout (`layout: "rows"`) with left label/help, middle control/error/warning, right Reset to default,
 *    preserving sections, formField members (ReferencePicker), read-only rules, and fixedFields.
 * 2. Field-level Reset to default for any declared `defaultValue !== undefined` (including `null` and strings),
 *    deep equality disabling, deep-cloned draft updates without auto-saving, and `refreshOnChange` reread chain.
 * 3. Non-blocking `field.warning` rendering alongside validation errors without blocking Save.
 * 4. Header draft actions (`actions: "header"`) handing Save/Discard/unsaved state through DirectPanelInstance ->
 *    DirectPanelRun -> PanelInstanceView -> PanelHost -> PlatformPageHeader, with cleanup on hide/unmount and
 *    automatic footer fallback when no header host exists.
 * 5. Read-failure Retry button (`common.retry`) for `form` and `createForm` reads.
 */

const record = {
  domainId: "d",
  ownerId: "o",
  revision: 1,
  createdAt: "",
  updatedAt: "",
  editable: false,
  visibility: "domain" as const,
  description: "",
};

const saveDescriptor = {
  kind: "form.save",
  handlerRef: `${FUNCTION}.save`,
  label: "Save",
  effect: "write",
  target: { source: "input", input: "app" },
  inputSchema: {},
  resultSchema: {},
  batch: false,
};

const formSaveMeta = {
  method: "PUT" as const,
  path: "/settings/:id",
  bodySchema: {},
  draftOperation: "settings.update",
};

const hostLabels: PanelHostLabels = {
  notStarted: "Not started",
  failures: { fileUnavailable: "Missing {file}", scriptThrew: "Script threw", scriptRejected: "Script rejected" },
  content: { styleOutside: "CSS outside" },
  draft: { opening: "Opening…", close: "Close", toAgent: "To agent", toAgentText: "Draft failed: {reason}" },
  refresh: "Refresh",
};

const headerLabels = {
  save: publicEn.platform.save,
  discard: publicEn.platform.discard,
  unsavedChanges: publicEn.platform.unsavedChanges,
};

const i18n = () => createI18n({ legacy: false, locale: "en", messages: { en: publicEn } });

function makeFormProjection(config: Record<string, RuntimeJsonValue> = {}, createOnly = false): DirectProjection {
  return {
    ...record,
    id: "settings-form",
    name: "Settings",
    componentId: "@ontomato/sdk:ObjectForm",
    inputs: createOnly
      ? { values: { kind: "json" }, changedField: { kind: "scalar", type: "string" } }
      : { app: { kind: "object", objectType: FUNCTION }, values: { kind: "json" }, changedField: { kind: "scalar", type: "string" } },
    outputs: {},
    config,
    data: createOnly
      ? { createForm: { source: { type: { kind: "PlatformObjectType", id: FUNCTION } }, read: "createForm", params: { values: { input: "values" }, changedField: { input: "changedField" } } } }
      : { form: { source: { object: { input: "app" } }, read: "form", params: { values: { input: "values" }, changedField: { input: "changedField" } } } },
    operations: {
      save: {
        operation: { kind: "PlatformOperation", id: `${FUNCTION}.save` },
        ...(createOnly ? {} : { target: { input: "app" } }),
      },
    },
  };
}

const modelPickerProjection: DirectProjection = {
  ...record,
  id: "model-picker",
  name: "Model picker",
  componentId: "@ontomato/sdk:ReferencePicker",
  inputs: {},
  outputs: {},
  config: {},
  data: {
    options: { source: { type: { kind: "PlatformObjectType", id: MODEL_OPTION } }, read: "options", params: {} },
    selected: { source: { type: { kind: "PlatformObjectType", id: MODEL_OPTION } }, read: "resolve", params: {} },
  },
  operations: {},
};

const formManifest: DirectPanelManifest = {
  state: { app: { type: { kind: "object", objectType: FUNCTION }, personal: false, deepLink: true, external: false } },
  members: { form: { target: { projectionId: "settings-form" }, inputs: { app: { state: "app" } } } },
  commands: {},
};

const formWithPickerManifest: DirectPanelManifest = {
  state: { app: { type: { kind: "object", objectType: FUNCTION }, personal: false, deepLink: true, external: false } },
  members: {
    form: { target: { projectionId: "settings-form" }, inputs: { app: { state: "app" } } },
    modelPicker: { target: { projectionId: "model-picker" }, formField: { slot: "form", path: "/diagModel" } },
  },
  commands: {},
};

async function confirmDialog(buttonText: string) {
  const box = await vi.waitFor(() => {
    const open = [...document.querySelectorAll<HTMLElement>(".el-message-box")]
      .filter((item) => item.closest<HTMLElement>(".el-overlay")?.style.display !== "none");
    if (!open.length) throw new Error("Confirm dialog not open");
    return open.at(-1)!;
  });
  [...box.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent?.trim() === buttonText)!.click();
  await vi.waitFor(() => {
    if (box.closest<HTMLElement>(".el-overlay")?.style.display !== "none") throw new Error("Confirm dialog still open");
  });
  await nextTick();
}

afterEach(() => {
  document.body.innerHTML = "";
});

describe("ObjectForm settings parity", () => {
  it("renders layout='rows' with left meta, middle control/error/warning, right reset, sections, ReferencePicker, and fixedFields", async () => {
    const projection = makeFormProjection({
      layout: "rows",
      fixedFields: { "/tenant": { literal: "acme" } },
    });
    const fields: PanelFormField[] = [
      {
        path: "/diagModel",
        label: "Diagnosis model",
        help: "Model used for automated diagnosis",
        warning: "Using a custom model overrides the domain default",
        required: false,
        readOnly: false,
        defaultValue: null,
        section: "models",
        valueSchema: { type: ["string", "null"] },
        control: { kind: "reference", objectType: MODEL_OPTION, multiple: false },
      },
      {
        path: "/timeout",
        label: "Timeout (seconds)",
        help: "Maximum wait time",
        required: true,
        readOnly: false,
        defaultValue: 30,
        section: "general",
        valueSchema: { type: "number" },
        control: { kind: "number" },
      },
      {
        path: "/tenant",
        label: "Tenant",
        required: false,
        readOnly: false,
        defaultValue: "default-tenant",
        section: "general",
        valueSchema: { type: "string" },
        control: { kind: "text", multiline: false },
      },
    ];
    const sections = [
      { key: "models", title: "Models", hint: "Agent model bindings" },
      { key: "general", title: "General" },
    ];
    const formDesc: PanelFormDescription = {
      fields,
      sections,
      values: { diagModel: "gpt-4o", timeout: 60, tenant: "ignored" },
      errors: [{ field: "/diagModel", code: "invalid_option", message: "Model deprecated" }],
      revision: 1,
      save: formSaveMeta,
    };

    const mount = mountDirectPanel({
      manifest: formWithPickerManifest,
      run: directRun({
        pageKey: "settings",
        url: () => "/settings",
        label: () => "Settings",
        initial: { app: { className: FUNCTION, primaryKey: "sys-1" } },
      }),
      messages: {},
      locale: ref("en"),
      defaultLocale: "en",
      requests: {
        request: async (path) => Response.json({
          projection: path.includes("model-picker") ? modelPickerProjection : projection,
        }),
      },
      use: { applicationId: "app", useId: "settings" },
      expandPageComposer: noOperations.expandPageComposer,
      navigate: noOperations.navigate,
      nested: noOperations.nested,
      confirmOperation: noOperations.confirmOperation,
      read: async (request): Promise<ProductPanelReadResponse> => {
        if (request.operations) return { status: "ready", value: { save: saveDescriptor } as never };
        if (request.dataName === "options" || request.dataName === "selected") {
          return {
            status: "ready",
            value: {
              options: [
                { primaryKey: "default", value: null, label: "Follow domain default" },
                { primaryKey: "gpt-4o", value: "gpt-4o", label: "GPT-4o" },
              ],
            } as never,
          };
        }
        return { status: "ready", value: formDesc as never };
      },
    });

    const element = document.createElement("div");
    document.body.append(element);
    const app = createApp({
      render: () => h("div", [mount.member("modelPicker"), mount.member("form")]),
    });
    app.use(i18n()).use(ElementPlus).mount(element);

    await vi.waitFor(() => expect(element.querySelector('[data-field="/diagModel"] .sdk-reference-picker-select')).not.toBeNull());

    // Sections remain intact in order.
    const renderedSections = [...element.querySelectorAll<HTMLElement>("[data-form-section]")].map((node) => node.dataset.formSection);
    expect(renderedSections).toEqual(["models", "general"]);

    // ReferencePicker field renders as a settings row with left meta, middle control+error+warning, right reset button.
    const diagRow = element.querySelector<HTMLElement>('[data-field="/diagModel"]')!;
    expect(diagRow.dataset.formLayout).toBe("rows");
    expect(diagRow.querySelector(".sdk-form-row-meta .sdk-form-row-label")?.textContent?.trim()).toBe("Diagnosis model");
    expect(diagRow.querySelector(".sdk-form-row-meta .sdk-form-row-help")?.textContent?.trim()).toBe("Model used for automated diagnosis");
    expect(diagRow.querySelector(".sdk-form-row-control .sdk-reference-picker-select")).not.toBeNull();
    await vi.waitFor(() => expect(diagRow.querySelector(".sdk-form-row-control .el-form-item__error")?.textContent?.trim()).toBe("Model deprecated"));
    const warning = diagRow.querySelector<HTMLElement>(".sdk-form-row-control [data-field-warning]");
    expect(warning?.getAttribute("role")).toBe("status");
    expect(warning?.textContent?.trim()).toBe("Using a custom model overrides the domain default");
    const diagReset = diagRow.querySelector<HTMLButtonElement>(".sdk-form-row-actions [data-field-reset]")!;
    expect(diagReset.textContent?.trim()).toBe("Reset to default");
    expect(diagReset.disabled).toBe(false);

    // Required marker appears on required row field.
    const timeoutRow = element.querySelector<HTMLElement>('[data-field="/timeout"]')!;
    expect(timeoutRow.querySelector(".sdk-form-row-label")?.classList.contains("is-required")).toBe(true);

    // Fixed field stays read-only with its fixed value and disabled reset button.
    const tenantRow = element.querySelector<HTMLElement>('[data-field="/tenant"]')!;
    expect(tenantRow.querySelector<HTMLInputElement>("input")?.value).toBe("acme");
    expect(tenantRow.querySelector<HTMLInputElement>("input")?.disabled).toBe(true);
    expect(tenantRow.querySelector<HTMLButtonElement>("[data-field-reset]")?.disabled).toBe(true);

    app.unmount();
    mount.dispose();
  });

  it("resets fields to defaultValue (including null, string, and deep-cloned objects), marks dirty without saving, and triggers refreshOnChange", async () => {
    const projection = makeFormProjection({ layout: "rows" });
    const defaultConfig = { mode: "auto", retries: 2 };
    const fields: PanelFormField[] = [
      {
        path: "/diagModel",
        label: "Diagnosis model",
        required: false,
        readOnly: false,
        defaultValue: null,
        refreshOnChange: true,
        valueSchema: { type: ["string", "null"] },
        control: { kind: "text", multiline: false },
      },
      {
        path: "/lang",
        label: "Language",
        required: false,
        readOnly: false,
        defaultValue: "@default",
        valueSchema: { type: "string" },
        control: { kind: "text", multiline: false },
      },
      {
        path: "/policy",
        label: "Policy",
        required: false,
        readOnly: false,
        defaultValue: defaultConfig,
        valueSchema: { type: "object" },
        control: { kind: "code", language: "json" },
      },
      {
        path: "/locked",
        label: "Locked",
        required: false,
        readOnly: true,
        defaultValue: "base",
        valueSchema: { type: "string" },
        control: { kind: "text", multiline: false },
      },
      {
        path: "/note",
        label: "Note",
        required: false,
        readOnly: false,
        valueSchema: { type: "string" },
        control: { kind: "text", multiline: false },
      },
    ];

    const reads: { changedField: string | null; values?: PanelFormValues }[] = [];
    const savedIntents: unknown[] = [];

    const mount = mountDirectPanel({
      manifest: formManifest,
      run: directRun({
        pageKey: "settings",
        url: () => "/settings",
        label: () => "Settings",
        initial: { app: { className: FUNCTION, primaryKey: "sys-1" } },
      }),
      messages: {},
      locale: ref("en"),
      defaultLocale: "en",
      requests: {
        request: async (path, init) => {
          if (path.includes("intents")) {
            savedIntents.push(init?.body);
          }
          return Response.json({ projection });
        },
      },
      use: { applicationId: "app", useId: "settings" },
      expandPageComposer: noOperations.expandPageComposer,
      navigate: noOperations.navigate,
      nested: noOperations.nested,
      confirmOperation: noOperations.confirmOperation,
      read: async (request): Promise<ProductPanelReadResponse> => {
        if (request.operations) return { status: "ready", value: { save: saveDescriptor } as never };
        const changedField = (request.runtimeParams?.changedField ?? request.inputs?.changedField ?? null) as string | null;
        const incomingValues = (request.runtimeParams?.values ?? request.inputs?.values) as PanelFormValues | undefined;
        reads.push({ changedField, values: incomingValues });
        return {
          status: "ready",
          value: {
            fields,
            // Key order of `/policy` is reversed from defaultConfig to verify deep equality independent of key order.
            values: incomingValues ?? { diagModel: "gpt-4o", lang: "@default", policy: { retries: 2, mode: "auto" }, locked: "override", note: "" },
            errors: [],
            revision: 1,
            save: formSaveMeta,
          } as never,
        };
      },
    });

    const element = document.createElement("div");
    document.body.append(element);
    const app = createApp({ render: () => mount.member("form") });
    app.use(i18n()).use(ElementPlus).mount(element);

    await vi.waitFor(() => expect(element.querySelector('[data-field="/diagModel"] [data-field-reset]')).not.toBeNull());

    const resetBtn = (path: string) => element.querySelector<HTMLButtonElement>(`[data-field="${path}"] [data-field-reset]`);

    // Field with value differing from defaultValue: null -> enabled.
    expect(resetBtn("/diagModel")?.disabled).toBe(false);
    // Field matching defaultValue: "@default" -> disabled.
    expect(resetBtn("/lang")?.disabled).toBe(true);
    // Field deeply matching object defaultValue with different key order -> disabled.
    expect(resetBtn("/policy")?.disabled).toBe(true);
    // Read-only field -> disabled even when value differs from defaultValue.
    expect(resetBtn("/locked")?.disabled).toBe(true);
    // Field without defaultValue -> no reset button rendered.
    expect(resetBtn("/note")).toBeNull();

    expect(mount.instance.dirty()).toBe(false);

    // Click Reset to default on `/diagModel` (defaultValue: null): writes null, marks dirty, does NOT save, triggers refreshOnChange.
    resetBtn("/diagModel")!.click();
    await vi.waitFor(() => expect(reads).toHaveLength(2));
    expect(reads[1]).toEqual({
      changedField: "/diagModel",
      values: { diagModel: null, lang: "@default", policy: { retries: 2, mode: "auto" }, locked: "override", note: "" },
    });
    expect(mount.instance.forms.handle("form")!.values.value.diagModel).toBeNull();
    expect(mount.instance.dirty()).toBe(true);
    expect(resetBtn("/diagModel")?.disabled).toBe(true);
    expect(savedIntents).toHaveLength(0);

    // Edit `/policy` away from default, then reset to default -> deep copy written, not same object reference.
    mount.instance.forms.handle("form")!.set("/policy", { mode: "manual", retries: 5 });
    await nextTick();
    expect(resetBtn("/policy")?.disabled).toBe(false);
    resetBtn("/policy")!.click();
    await nextTick();
    const restoredPolicy = mount.instance.forms.handle("form")!.values.value.policy;
    expect(restoredPolicy).toEqual(defaultConfig);
    expect(restoredPolicy).not.toBe(defaultConfig);
    expect(resetBtn("/policy")?.disabled).toBe(true);

    app.unmount();
    mount.dispose();
  });

  it("renders non-blocking field.warning without blocking Save", async () => {
    const projection = makeFormProjection();
    const fields: PanelFormField[] = [
      {
        path: "/model",
        label: "Model",
        required: false,
        readOnly: false,
        warning: "Provider quota is low",
        valueSchema: { type: "string" },
        control: { kind: "text", multiline: false },
      },
    ];
    let savedValues: PanelFormValues | null = null;
    const intentId = randomId();
    const mount = mountDirectPanel({
      manifest: formManifest,
      run: directRun({
        pageKey: "settings",
        url: () => "/settings",
        label: () => "Settings",
        initial: { app: { className: FUNCTION, primaryKey: "sys-1" } },
      }),
      messages: {},
      locale: ref("en"),
      defaultLocale: "en",
      requests: {
        request: async (path, init) => {
          if (path === "/panel-operations/intents") {
            const body = JSON.parse(String(init?.body)) as { call: { input: { values: PanelFormValues } } };
            savedValues = body.call.input.values;
            return Response.json({ intentId, operationId: "form.save", label: "Save", confirmation: { kind: "none" } });
          }
          return Response.json({ projection });
        },
      },
      use: { applicationId: "app", useId: "settings" },
      expandPageComposer: noOperations.expandPageComposer,
      navigate: noOperations.navigate,
      nested: noOperations.nested,
      confirmOperation: async () => ({ decision: "confirm", response: { kind: "dispatched", intentId, outcome: { kind: "success", data: {}, affected: { objects: [], objectTypes: [] } } } }),
      read: async (request): Promise<ProductPanelReadResponse> => request.operations
        ? { status: "ready", value: { save: saveDescriptor } as never }
        : { status: "ready", value: { fields, values: { model: "gpt-4" }, errors: [], revision: 1, save: formSaveMeta } as never },
    });

    const element = document.createElement("div");
    document.body.append(element);
    const app = createApp({ render: () => mount.member("form") });
    app.use(i18n()).use(ElementPlus).mount(element);

    await vi.waitFor(() => expect(element.querySelector('[data-field="/model"] [data-field-warning]')).not.toBeNull());
    expect(element.querySelector('[data-field="/model"] .el-form-item__error')).toBeNull();
    expect(element.querySelector('[data-field="/model"] [data-field-warning]')?.textContent?.trim()).toBe("Provider quota is low");

    // Edit and save: warning must not block Save; stacked layout also renders Reset to default.
    const input = element.querySelector<HTMLInputElement>('[data-field="/model"] input')!;
    input.value = "gpt-4.1";
    input.dispatchEvent(new Event("input"));
    await nextTick();
    const saveBtn = [...element.querySelectorAll<HTMLButtonElement>(".sdk-owner-form-actions button")]
      .find((button) => button.textContent?.trim() === "Save")!;
    expect(saveBtn.disabled).toBe(false);
    saveBtn.click();
    await vi.waitFor(() => expect(savedValues).toEqual({ model: "gpt-4.1" }));

    app.unmount();
    mount.dispose();
  });

  it("hands Save, Discard, and unsaved state to PlatformPageHeader when actions='header', cleans up on hide/unmount, and falls back to footer without a header host", async () => {
    const projection = makeFormProjection({ layout: "rows", actions: "header" });
    const fields: PanelFormField[] = [
      {
        path: "/lang",
        label: "Backend language",
        required: false,
        readOnly: false,
        defaultValue: "en",
        valueSchema: { type: "string" },
        control: { kind: "text", multiline: false },
      },
    ];
    let currentValues: PanelFormValues = { lang: "en" };
    let resolveSave: (() => void) | null = null;
    let rejectNextSave: string | null = null;

    const panel = panelRecord("panel-settings", "Settings", formManifest);
    panel.content = { ...panel.content, html: '<div id="app"><projection slot="form"></projection></div>', module: "" };

    const port: PanelHostPort = {
      source: async () => ({ kind: "registered", panel, use: { id: "use-1", pageKey: "settings", panelId: panel.id, path: "/settings" } } as never),
      pageKey: "settings",
      use: { applicationId: "app", useId: "use-1" },
      panel: async () => panel,
      release: async () => { throw new Error("Direct panel does not fetch frame SDK release"); },
      frame: () => ({ dispose: () => {}, open: () => {} }),
      snapshot: async () => ({ panel: { id: panel.id, revision: 1 }, projections: [] }),
      mode: { kind: "view" },
      coded: async (_source, run, target) => {
        const mount = mountDirectPanel({
          manifest: formManifest,
          run,
          messages: {},
          locale: ref("en"),
          defaultLocale: "en",
          requests: {
            request: async (path, init) => {
              if (path === "/panel-operations/intents") {
                const body = JSON.parse(String(init?.body)) as { call: { input: { values: PanelFormValues } } };
                if (!rejectNextSave) currentValues = { ...body.call.input.values };
                return Response.json({ intentId: randomId(), operationId: "form.save", label: "Save", confirmation: { kind: "none" } });
              }
              return Response.json({ projection });
            },
          },
          use: { applicationId: "app", useId: "use-1" },
          expandPageComposer: noOperations.expandPageComposer,
          navigate: noOperations.navigate,
          nested: noOperations.nested,
          confirmOperation: async (preparation) => {
            if (rejectNextSave) {
              const message = rejectNextSave;
              rejectNextSave = null;
              return {
                decision: "confirm",
                response: {
                  kind: "dispatched",
                  intentId: preparation.intentId,
                  outcome: { kind: "refusal", code: "VALIDATION_FAILED", message, errors: [{ field: "/lang", code: "invalid_format", message: "Unsupported locale" }] },
                },
              };
            }
            await new Promise<void>((resolve) => { resolveSave = resolve; });
            return {
              decision: "confirm",
              response: { kind: "dispatched", intentId: preparation.intentId, outcome: { kind: "success", data: {}, affected: { objects: [], objectTypes: [] } } },
            };
          },
          read: async (request): Promise<ProductPanelReadResponse> => request.operations
            ? { status: "ready", value: { save: saveDescriptor } as never }
            : { status: "ready", value: { fields, values: { ...currentValues }, errors: [], revision: 1, save: formSaveMeta } as never },
        });
        const inner = createApp({ render: () => mount.member("form") });
        inner.use(i18n()).use(ElementPlus).mount(target.element);
        return {
          ...mount,
          dispose() {
            inner.unmount();
            mount.dispose();
          },
        };
      },
    };

    const shown = ref(true);
    const mountedPanel = ref(true);
    let pageActions!: Readonly<Ref<PlatformPageActions | null>>;

    const Host = defineComponent({
      setup() {
        pageActions = providePageActions();
        return () => h("div", [
          h(PlatformPageHeader, {
            title: "System settings",
            actions: pageActions.value?.actions,
            draft: pageActions.value?.draft ?? null,
            labels: headerLabels,
            onSave: () => pageActions.value?.draft?.save(),
            onDiscard: () => pageActions.value?.draft?.discard(),
          }),
          mountedPanel.value
            ? h(PanelHost, {
                port,
                address: "/settings",
                initial: { app: { className: FUNCTION, primaryKey: "sys-1" } },
                labels: hostLabels,
                language: { locale: "en", fallback: "en" },
                shown: shown.value,
              })
            : null,
        ]);
      },
    });

    const element = document.createElement("div");
    document.body.append(element);
    const app = createApp(Host);
    app.use(i18n()).use(ElementPlus).mount(element);

    const headerSave = () => [...element.querySelectorAll<HTMLButtonElement>(".platform-page-header button.action.primary")]
      .find((button) => button.textContent?.trim() === "Save") ?? null;
    const headerDiscard = () => [...element.querySelectorAll<HTMLButtonElement>(".platform-page-header button.action.secondary")]
      .find((button) => button.textContent?.trim() === "Discard") ?? null;
    const headerUnsaved = () => element.querySelector(".platform-page-header .unsaved")?.textContent?.trim() ?? null;

    // Form loaded clean: footer action bar is hidden; header shows disabled Save and no Discard/unsaved marker.
    await vi.waitFor(() => expect(headerSave()).not.toBeNull());
    expect(element.querySelector(".sdk-owner-form-actions")).toBeNull();
    expect(headerSave()!.disabled).toBe(true);
    expect(headerDiscard()).toBeNull();
    expect(headerUnsaved()).toBeNull();

    // Edit field: header shows unsaved marker, Discard, and enabled Save.
    const input = element.querySelector<HTMLInputElement>('[data-field="/lang"] input')!;
    input.value = "zh-CN";
    input.dispatchEvent(new Event("input"));
    await vi.waitFor(() => expect(headerSave()!.disabled).toBe(false));
    expect(headerUnsaved()).toBe("Unsaved changes");
    expect(headerDiscard()).not.toBeNull();

    // Click header Discard -> confirms and restores initial value, clearing dirty state in header.
    headerDiscard()!.click();
    await confirmDialog("Discard");
    await vi.waitFor(() => expect(headerSave()!.disabled).toBe(true));
    expect(input.value).toBe("en");
    expect(headerUnsaved()).toBeNull();
    expect(headerDiscard()).toBeNull();

    // Edit again and trigger a refused save: refusal summary remains visible in form even with footer hidden.
    input.value = "bad-locale";
    input.dispatchEvent(new Event("input"));
    await vi.waitFor(() => expect(headerSave()!.disabled).toBe(false));
    rejectNextSave = "Save refused";
    headerSave()!.click();
    await vi.waitFor(() => expect(element.querySelector(".sdk-owner-form-refusal")?.textContent?.trim()).toBe("1 field needs changing"));
    await vi.waitFor(() => expect(element.querySelector('[data-field="/lang"] .el-form-item__error')?.textContent?.trim()).toBe("Unsupported locale"));

    // Edit to valid value and click header Save: shows saving state while in flight, then settles clean.
    input.value = "ja";
    input.dispatchEvent(new Event("input"));
    await nextTick();
    headerSave()!.click();
    await vi.waitFor(() => expect(pageActions.value?.draft?.saving).toBe(true));
    expect(headerSave()!.disabled).toBe(true);
    expect(headerDiscard()!.disabled).toBe(true);
    expect(element.querySelector<HTMLButtonElement>('[data-field="/lang"] [data-field-reset]')?.disabled).toBe(true);
    resolveSave!();
    await vi.waitFor(() => expect(pageActions.value?.draft?.saving).toBe(false));
    expect(headerSave()!.disabled).toBe(true);
    expect(headerUnsaved()).toBeNull();
    expect(currentValues).toEqual({ lang: "ja" });

    // Hiding the panel clears the header draft; showing it again restores it; unmounting clears it.
    shown.value = false;
    await vi.waitFor(() => expect(pageActions.value).toBeNull());
    shown.value = true;
    await vi.waitFor(() => expect(pageActions.value?.draft).not.toBeNull());
    mountedPanel.value = false;
    await vi.waitFor(() => expect(pageActions.value).toBeNull());

    app.unmount();

    // Headerless fallback: mounting PanelHost without providePageActions() keeps the footer action bar usable.
    const fallbackEl = document.createElement("div");
    document.body.append(fallbackEl);
    const fallbackApp = createApp({
      render: () => h(PanelHost, {
        port,
        address: "/settings",
        initial: { app: { className: FUNCTION, primaryKey: "sys-1" } },
        labels: hostLabels,
        language: { locale: "en", fallback: "en" },
      }),
    });
    fallbackApp.use(i18n()).use(ElementPlus).mount(fallbackEl);
    await vi.waitFor(() => expect(fallbackEl.querySelector(".sdk-owner-form-actions")).not.toBeNull());
    fallbackApp.unmount();
  });

  it("shows a Retry button on form and createForm read failure and recovers after clicking Retry", async () => {
    for (const mode of ["form", "createForm"] as const) {
      const createOnly = mode === "createForm";
      const projection = makeFormProjection({ actions: "header" }, createOnly);
      const manifest: DirectPanelManifest = createOnly
        ? { state: {}, members: { form: { target: { projectionId: "settings-form" } } }, commands: {} }
        : formManifest;
      let attempts = 0;
      const reportedDrafts: (unknown | null)[] = [];
      const mount = mountDirectPanel({
        manifest,
        run: directRun({
          pageKey: "settings",
          url: () => "/settings",
          label: () => "Settings",
          initial: createOnly ? {} : { app: { className: FUNCTION, primaryKey: "sys-1" } },
          headerDraft: (draft) => { reportedDrafts.push(draft); },
        }),
        messages: {},
        locale: ref("en"),
        defaultLocale: "en",
        requests: { request: async () => Response.json({ projection }) },
        use: { applicationId: "app", useId: "settings" },
        expandPageComposer: noOperations.expandPageComposer,
        navigate: noOperations.navigate,
        nested: noOperations.nested,
        confirmOperation: noOperations.confirmOperation,
        read: async (request): Promise<ProductPanelReadResponse> => {
          if (request.operations) return { status: "ready", value: { save: saveDescriptor } as never };
          attempts += 1;
          if (attempts === 1) return { status: "error", message: `${mode} backend unavailable` };
          return {
            status: "ready",
            value: {
              fields: [{ path: "/name", label: "Name", required: false, readOnly: false, valueSchema: { type: "string" }, control: { kind: "text", multiline: false } }],
              values: { name: `Loaded via ${mode}` },
              errors: [],
              revision: 1,
              save: formSaveMeta,
            } as never,
          };
        },
      });

      const element = document.createElement("div");
      document.body.append(element);
      const app = createApp({ render: () => mount.member("form") });
      app.use(i18n()).use(ElementPlus).mount(element);

      // First read fails: shows alert + Retry button, and does not expose a broken header draft.
      await vi.waitFor(() => expect(element.querySelector('[role="alert"]')?.textContent?.trim()).toBe(`${mode} backend unavailable`));
      expect(reportedDrafts.at(-1)).toBeNull();
      const retryButton = [...element.querySelectorAll<HTMLButtonElement>("button")]
        .find((button) => button.textContent?.trim() === publicEn.common.retry)!;
      expect(retryButton).toBeDefined();

      // Clicking Retry re-reads and renders the form + publishes the header draft.
      retryButton.click();
      await vi.waitFor(() => expect(element.querySelector<HTMLInputElement>('[data-field="/name"] input')?.value).toBe(`Loaded via ${mode}`));
      expect(attempts).toBe(2);
      expect(reportedDrafts.at(-1)).not.toBeNull();

      app.unmount();
      mount.dispose();
    }
  });
});
