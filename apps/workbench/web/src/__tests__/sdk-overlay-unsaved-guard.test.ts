import { afterEach, describe, expect, it, vi } from "vitest";
import { createApp, defineComponent, h, nextTick, provide, ref } from "vue";
import { createI18n } from "vue-i18n";
import ElementPlus from "element-plus";
import publicEn from "@ontomato/workbench-ui/locales/en";
import type { DirectPanelManifest } from "@ontomato/contracts/panel-manifest";
import type { DirectProjection } from "@ontomato/contracts/product-panels";
import type { ProductPanelReadResponse } from "@ontomato/contracts/panel-host";
import { FUNCTION } from "@ontomato/contracts/platform-object-types";
import { mountDirectPanel } from "../../../../../packages/apps-sdk/src/panel/direct-mount";
import { panelContextKey, type PanelContext } from "../../../../../packages/apps-sdk/src/panel/context";
import { usePanelBack } from "../../../../../packages/apps-sdk/src/panel/back";
import { SdkDialog } from "../../../../../packages/apps-sdk/src/ui/SdkDialog";
import { SdkDrawer } from "../../../../../packages/apps-sdk/src/ui/SdkDrawer";
import { directRun, noOperations } from "./panel-frame";

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

const projection: DirectProjection = {
  ...record,
  id: "overlay-form",
  name: "Overlay form",
  componentId: "@ontomato/sdk:ObjectForm",
  inputs: {
    app: { kind: "object", objectType: FUNCTION },
    values: { kind: "json" },
    changedField: { kind: "scalar", type: "string" },
  },
  outputs: {},
  config: {},
  data: {
    form: {
      source: { object: { input: "app" } },
      read: "form",
      params: {
        values: { input: "values" },
        changedField: { input: "changedField" },
      },
    },
  },
  operations: {
    save: {
      operation: { kind: "PlatformOperation", id: `${FUNCTION}.save` },
      target: { input: "app" },
    },
  },
};

const manifest: DirectPanelManifest = {
  state: {
    mainApp: { type: { kind: "object", objectType: FUNCTION }, personal: false, deepLink: false, external: false },
    overlayApp: { type: { kind: "object", objectType: FUNCTION }, personal: false, deepLink: false, external: false },
    nestedApp: { type: { kind: "object", objectType: FUNCTION }, personal: false, deepLink: false, external: false },
  },
  members: {
    mainForm: { target: { projectionId: projection.id }, inputs: { app: { state: "mainApp" } } },
    overlayForm: { target: { projectionId: projection.id }, inputs: { app: { state: "overlayApp" } } },
    nestedForm: { target: { projectionId: projection.id }, inputs: { app: { state: "nestedApp" } } },
  },
};

const fields = [
  { path: "/name", label: "Name", required: false, readOnly: false, valueSchema: {}, control: { kind: "text" } },
];

const save = {
  kind: "form.save",
  handlerRef: `${FUNCTION}.save`,
  label: "Save",
  effect: "write",
  target: { source: "input", input: "app" },
  inputSchema: {},
  resultSchema: {},
  batch: false,
};

afterEach(() => {
  document.body.innerHTML = "";
});

function createPanelHarness(options?: {
  confirmLeaveUnsaved?: () => Promise<boolean>;
  withHostConfirm?: boolean;
}) {
  const withHostConfirm = options?.withHostConfirm ?? true;
  const confirmSpy = vi.fn(options?.confirmLeaveUnsaved ?? (async () => true));
  const run = directRun({
    pageKey: "overlay-guard",
    url: () => "/overlay-guard",
    label: () => "Overlay guard",
    initial: {
      mainApp: { className: FUNCTION, primaryKey: "main-1" },
      overlayApp: { className: FUNCTION, primaryKey: "overlay-1" },
      nestedApp: { className: FUNCTION, primaryKey: "nested-1" },
    },
  });
  if (withHostConfirm) {
    run.confirmLeaveUnsaved = confirmSpy;
  }

  const mount = mountDirectPanel({
    manifest,
    run,
    messages: {},
    locale: ref("en"),
    defaultLocale: "en",
    requests: { request: async () => Response.json({ projection }) },
    use: { applicationId: "app", useId: "overlay-guard" },
    expandPageComposer: noOperations.expandPageComposer,
    navigate: noOperations.navigate,
    nested: noOperations.nested,
    confirmOperation: noOperations.confirmOperation,
    read: async (request): Promise<ProductPanelReadResponse> =>
      request.operations
        ? { status: "ready", value: { save } as never }
        : {
            status: "ready",
            value: {
              fields,
              values: { name: `Initial ${request.memberPath.at(-1)?.member ?? "form"}` },
              errors: [],
              revision: 1,
              save: { method: "PUT", path: "/apps/:id", bodySchema: {} },
            } as never,
          },
  });

  const panelContext = {
    instance: mount.instance,
    manifest,
    t: (key: string) => key,
    navigate: noOperations.navigate,
    notify: () => {},
    ...(withHostConfirm
      ? { confirmLeaveUnsaved: () => (mount.instance.dirty() ? confirmSpy() : Promise.resolve(true)) }
      : {}),
  } as unknown as PanelContext;

  return { mount, panelContext, confirmSpy };
}

function setInputValue(input: HTMLInputElement, value: string) {
  input.value = value;
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

async function flushAsync() {
  await new Promise((resolve) => setTimeout(resolve, 0));
  await nextTick();
}

describe.each([
  { label: "SdkDialog", Component: SdkDialog, closeSelector: ".el-dialog__headerbtn", overlaySelector: ".el-overlay-dialog", bodySelector: ".el-dialog__body" },
  { label: "SdkDrawer", Component: SdkDrawer, closeSelector: ".el-drawer__close-btn", overlaySelector: ".el-overlay", bodySelector: ".el-drawer__body" },
])("$label unsaved-changes guard", ({ label, Component, closeSelector, overlaySelector, bodySelector }) => {
  it("guards close button, backdrop click, Escape, and handleClose before hiding or destroying a dirty form, keeps edits on cancel, and discards only overlay forms on confirm", async () => {
    let allowLeave = false;
    const { mount, panelContext, confirmSpy } = createPanelHarness({
      confirmLeaveUnsaved: async () => allowLeave,
    });
    const open = ref(true);
    const overlayRef = ref<{ handleClose?: () => void } | null>(null);
    const updateCalls: boolean[] = [];

    const Root = defineComponent({
      setup() {
        provide(panelContextKey, panelContext);
        // Simulate a panel that also wires `usePanelBack` into the overlay's `v-model` setter.
        const overlayBack = usePanelBack(open, () => {
          open.value = false;
        }, { forms: ["overlayForm"] });
        return () =>
          h("div", [
            h("div", { class: "outside-host" }, [mount.member("mainForm")]),
            h(
              Component as never,
              {
                ref: overlayRef,
                modelValue: open.value,
                "onUpdate:modelValue": (next: boolean) => {
                  updateCalls.push(next);
                  if (!next) {
                    void overlayBack.back();
                  } else {
                    open.value = next;
                  }
                },
                title: `${label} title`,
                destroyOnClose: true,
                closeOnClickModal: true,
                closeOnPressEscape: true,
              },
              {
                default: () => h("div", { class: "overlay-host" }, [mount.member("overlayForm")]),
              },
            ),
          ]);
      },
    });

    const container = document.createElement("div");
    document.body.append(container);
    const app = createApp(Root);
    app.use(createI18n({ legacy: false, locale: "en", messages: { en: publicEn } })).use(ElementPlus).mount(container);

    await vi.waitFor(() => {
      expect(container.querySelector(".outside-host input")).not.toBeNull();
      expect(document.querySelector(`${bodySelector} .overlay-host input`)).not.toBeNull();
    });

    const outsideInput = container.querySelector<HTMLInputElement>(".outside-host input")!;
    const overlayInput = document.querySelector<HTMLInputElement>(`${bodySelector} .overlay-host input`)!;
    setInputValue(outsideInput, "Edited outside");
    setInputValue(overlayInput, "Edited inside");
    await vi.waitFor(() => {
      expect(mount.instance.forms.dirty("mainForm")).toBe(true);
      expect(mount.instance.forms.dirty("overlayForm")).toBe(true);
    });

    // 1. Click close X while keeping edits -> prompts once, keeps overlay open and form intact.
    document.querySelector<HTMLButtonElement>(closeSelector)!.click();
    await vi.waitFor(() => expect(confirmSpy).toHaveBeenCalledTimes(1));
    await flushAsync();
    expect(open.value).toBe(true);
    expect(updateCalls).toEqual([]);
    expect(document.querySelector<HTMLInputElement>(`${bodySelector} .overlay-host input`)?.value).toBe("Edited inside");
    expect(mount.instance.forms.dirty("overlayForm")).toBe(true);

    // 2. Click backdrop while keeping edits -> prompts again, keeps overlay open.
    const backdrop = document.querySelector<HTMLElement>(overlaySelector)!;
    backdrop.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    backdrop.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
    backdrop.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await vi.waitFor(() => expect(confirmSpy).toHaveBeenCalledTimes(2));
    await flushAsync();
    expect(open.value).toBe(true);
    expect(document.querySelector<HTMLInputElement>(`${bodySelector} .overlay-host input`)?.value).toBe("Edited inside");

    // 3. Press Escape on the dialog/drawer -> prompts again, keeps overlay open.
    const dialogRoleEl = document.querySelector<HTMLElement>('[role="dialog"]')!;
    dialogRoleEl.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", code: "Escape", bubbles: true }));
    await vi.waitFor(() => expect(confirmSpy).toHaveBeenCalledTimes(3));
    await flushAsync();
    expect(open.value).toBe(true);
    expect(mount.instance.forms.dirty("overlayForm")).toBe(true);

    // 4. Confirm discard via handleClose() -> prompts once, discards ONLY overlayForm (outside mainForm stays dirty),
    // closes overlay, and when update:modelValue(false) triggers overlayBack.back(), does NOT prompt a second time.
    allowLeave = true;
    overlayRef.value!.handleClose!();
    await vi.waitFor(() => expect(confirmSpy).toHaveBeenCalledTimes(4));
    await vi.waitFor(() => expect(mount.instance.forms.dirty("overlayForm")).toBe(false));
    await vi.waitFor(() => expect(open.value).toBe(false));
    await flushAsync();
    expect(updateCalls).toEqual([false]);
    expect(mount.instance.forms.dirty("mainForm")).toBe(true);
    expect(outsideInput.value).toBe("Edited outside");
    // No duplicate confirmation prompt even after update:modelValue(false) invokes overlayBack.back().
    expect(confirmSpy).toHaveBeenCalledTimes(4);

    app.unmount();
    mount.dispose();
  });

  it("closes immediately without prompting when overlay form is clean even if an outside form is dirty, and still calls custom beforeClose", async () => {
    const { mount, panelContext, confirmSpy } = createPanelHarness();
    const customBeforeClose = vi.fn((done: () => void) => done());
    const overlayRef = ref<{ handleClose?: () => void } | null>(null);
    const open = ref(true);

    const Root = defineComponent({
      setup() {
        provide(panelContextKey, panelContext);
        return () =>
          h("div", [
            h("div", { class: "outside-host" }, [mount.member("mainForm")]),
            h(
              Component as never,
              {
                ref: overlayRef,
                modelValue: open.value,
                "onUpdate:modelValue": (next: boolean) => {
                  open.value = next;
                },
                beforeClose: customBeforeClose,
              },
              {
                default: () => h("div", { class: "overlay-host" }, [mount.member("overlayForm")]),
              },
            ),
          ]);
      },
    });

    const container = document.createElement("div");
    document.body.append(container);
    const app = createApp(Root);
    app.use(createI18n({ legacy: false, locale: "en", messages: { en: publicEn } })).use(ElementPlus).mount(container);

    await vi.waitFor(() => {
      expect(container.querySelector(".outside-host input")).not.toBeNull();
      expect(document.querySelector(`${bodySelector} .overlay-host input`)).not.toBeNull();
    });

    // Dirty only the outside form.
    setInputValue(container.querySelector<HTMLInputElement>(".outside-host input")!, "Outside edit");
    await vi.waitFor(() => expect(mount.instance.forms.dirty("mainForm")).toBe(true));
    expect(mount.instance.forms.dirty("overlayForm")).toBe(false);

    overlayRef.value!.handleClose!();
    expect(confirmSpy).not.toHaveBeenCalled();
    expect(customBeforeClose).toHaveBeenCalledTimes(1);
    expect(mount.instance.forms.dirty("mainForm")).toBe(true);

    app.unmount();
    mount.dispose();
  });

  it("runs caller-supplied beforeClose only after unsaved guard confirms and discards, and deduplicates concurrent close requests", async () => {
    let resolveConfirm: ((leave: boolean) => void) | null = null;
    const { mount, panelContext, confirmSpy } = createPanelHarness({
      confirmLeaveUnsaved: () =>
        new Promise<boolean>((resolve) => {
          resolveConfirm = resolve;
        }),
    });
    const customBeforeClose = vi.fn((done: () => void) => done());
    const overlayRef = ref<{ handleClose?: () => void } | null>(null);
    const open = ref(true);

    const Root = defineComponent({
      setup() {
        provide(panelContextKey, panelContext);
        return () =>
          h(
            Component as never,
            {
              ref: overlayRef,
              modelValue: open.value,
              "onUpdate:modelValue": (next: boolean) => {
                open.value = next;
              },
              "before-close": customBeforeClose,
            },
            {
              default: () => h("div", { class: "overlay-host" }, [mount.member("overlayForm")]),
            },
          );
      },
    });

    const container = document.createElement("div");
    document.body.append(container);
    const app = createApp(Root);
    app.use(createI18n({ legacy: false, locale: "en", messages: { en: publicEn } })).use(ElementPlus).mount(container);

    await vi.waitFor(() => expect(document.querySelector(`${bodySelector} .overlay-host input`)).not.toBeNull());
    setInputValue(document.querySelector<HTMLInputElement>(`${bodySelector} .overlay-host input`)!, "Dirty value");
    await vi.waitFor(() => expect(mount.instance.forms.dirty("overlayForm")).toBe(true));

    // Fire three rapid close requests before the first confirmation settles -> must only ask once.
    overlayRef.value!.handleClose!();
    overlayRef.value!.handleClose!();
    document.querySelector<HTMLButtonElement>(closeSelector)!.click();
    expect(confirmSpy).toHaveBeenCalledTimes(1);
    expect(customBeforeClose).not.toHaveBeenCalled();

    // Cancel first -> customBeforeClose must NOT run and lock must release for a subsequent attempt.
    resolveConfirm!(false);
    await flushAsync();
    expect(customBeforeClose).not.toHaveBeenCalled();
    expect(mount.instance.forms.dirty("overlayForm")).toBe(true);

    // Second attempt -> confirm -> form is discarded before customBeforeClose runs.
    let dirtyInsideBeforeClose: boolean | null = null;
    customBeforeClose.mockImplementation((done: () => void) => {
      dirtyInsideBeforeClose = mount.instance.forms.dirty("overlayForm");
      done();
    });
    overlayRef.value!.handleClose!();
    expect(confirmSpy).toHaveBeenCalledTimes(2);
    resolveConfirm!(true);
    await vi.waitFor(() => expect(customBeforeClose).toHaveBeenCalledTimes(1));
    expect(dirtyInsideBeforeClose).toBe(false);

    app.unmount();
    mount.dispose();
  });

  it("falls back to confirmDanger when panel.confirmLeaveUnsaved is absent", async () => {
    const { mount, panelContext } = createPanelHarness({ withHostConfirm: false });
    const overlayRef = ref<{ handleClose?: () => void } | null>(null);
    const open = ref(true);

    const Root = defineComponent({
      setup() {
        provide(panelContextKey, panelContext);
        return () =>
          h(
            Component as never,
            {
              ref: overlayRef,
              modelValue: open.value,
              "onUpdate:modelValue": (next: boolean) => {
                open.value = next;
              },
            },
            {
              default: () => h("div", { class: "overlay-host" }, [mount.member("overlayForm")]),
            },
          );
      },
    });

    const container = document.createElement("div");
    document.body.append(container);
    const app = createApp(Root);
    app.use(createI18n({ legacy: false, locale: "en", messages: { en: publicEn } })).use(ElementPlus).mount(container);

    await vi.waitFor(() => expect(document.querySelector(`${bodySelector} .overlay-host input`)).not.toBeNull());
    setInputValue(document.querySelector<HTMLInputElement>(`${bodySelector} .overlay-host input`)!, "Fallback edit");
    await vi.waitFor(() => expect(mount.instance.forms.dirty("overlayForm")).toBe(true));

    overlayRef.value!.handleClose!();
    const messageBox = () => document.querySelector<HTMLElement>(".el-message-box");
    await vi.waitFor(() => expect(messageBox()?.textContent).toContain("Unsaved changes"));

    // Keep editing -> stays open and dirty.
    [...messageBox()!.querySelectorAll<HTMLButtonElement>("button")]
      .find((button) => button.textContent?.trim() === "Keep editing")!
      .click();
    await vi.waitFor(() => expect(messageBox()?.style.display ?? "none").toBe("none"));
    expect(mount.instance.forms.dirty("overlayForm")).toBe(true);

    // Discard -> clears dirty state and closes.
    overlayRef.value!.handleClose!();
    await vi.waitFor(() => expect(messageBox()?.style.display).not.toBe("none"));
    [...messageBox()!.querySelectorAll<HTMLButtonElement>("button")]
      .find((button) => button.textContent?.trim() === "Discard")!
      .click();
    await vi.waitFor(() => expect(mount.instance.forms.dirty("overlayForm")).toBe(false));

    app.unmount();
    mount.dispose();
  });

  it("works transparently outside panelContextKey and forwards slots, attrs, and exposed methods", async () => {
    const customBeforeClose = vi.fn((done: () => void) => done());
    const overlayRef = ref<{ handleClose?: () => void; visible?: boolean } | null>(null);
    const open = ref(true);

    const Root = defineComponent({
      setup() {
        return () =>
          h(
            Component as never,
            {
              ref: overlayRef,
              modelValue: open.value,
              "onUpdate:modelValue": (next: boolean) => {
                open.value = next;
              },
              beforeClose: customBeforeClose,
            },
            {
              header: ({ close }: { close: () => void }) =>
                h("button", { class: "custom-header-close", onClick: close }, "Header Close"),
              default: () => h("p", { class: "standalone-body" }, "Standalone Body"),
              footer: () => h("span", { class: "standalone-footer" }, "Standalone Footer"),
            },
          );
      },
    });

    const container = document.createElement("div");
    document.body.append(container);
    const app = createApp(Root);
    app.use(ElementPlus).mount(container);

    await vi.waitFor(() => {
      expect(document.querySelector(".custom-header-close")).not.toBeNull();
      expect(document.querySelector(".standalone-body")?.textContent).toBe("Standalone Body");
      expect(document.querySelector(".standalone-footer")?.textContent).toBe("Standalone Footer");
    });

    document.querySelector<HTMLButtonElement>(".custom-header-close")!.click();
    expect(customBeforeClose).toHaveBeenCalledTimes(1);

    app.unmount();
  });
});

it("scopes nested overlays so closing an inner SdkDialog only discards its own form and leaves an outer SdkDrawer form intact", async () => {
  const { mount, panelContext, confirmSpy } = createPanelHarness({
    confirmLeaveUnsaved: async () => true,
  });
  const drawerOpen = ref(true);
  const dialogOpen = ref(true);
  const drawerRef = ref<{ handleClose?: () => void } | null>(null);
  const dialogRef = ref<{ handleClose?: () => void } | null>(null);

  const Root = defineComponent({
    setup() {
      provide(panelContextKey, panelContext);
      return () =>
        h(
          SdkDrawer as never,
          {
            ref: drawerRef,
            modelValue: drawerOpen.value,
            "onUpdate:modelValue": (next: boolean) => {
              drawerOpen.value = next;
            },
          },
          {
            default: () =>
              h("div", [
                h("div", { class: "drawer-form-host" }, [mount.member("overlayForm")]),
                h(
                  SdkDialog as never,
                  {
                    ref: dialogRef,
                    modelValue: dialogOpen.value,
                    "onUpdate:modelValue": (next: boolean) => {
                      dialogOpen.value = next;
                    },
                  },
                  {
                    default: () => h("div", { class: "nested-dialog-form-host" }, [mount.member("nestedForm")]),
                  },
                ),
              ]),
          },
        );
    },
  });

  const container = document.createElement("div");
  document.body.append(container);
  const app = createApp(Root);
  app.use(createI18n({ legacy: false, locale: "en", messages: { en: publicEn } })).use(ElementPlus).mount(container);

  await vi.waitFor(() => {
    expect(document.querySelector(".drawer-form-host input")).not.toBeNull();
    expect(document.querySelector(".nested-dialog-form-host input")).not.toBeNull();
  });

  setInputValue(document.querySelector<HTMLInputElement>(".drawer-form-host input")!, "Drawer edit");
  setInputValue(document.querySelector<HTMLInputElement>(".nested-dialog-form-host input")!, "Nested edit");
  await vi.waitFor(() => {
    expect(mount.instance.forms.dirty("overlayForm")).toBe(true);
    expect(mount.instance.forms.dirty("nestedForm")).toBe(true);
  });

  // Closing the inner dialog asks once and discards only nestedForm; drawer's overlayForm stays dirty.
  dialogRef.value!.handleClose!();
  await vi.waitFor(() => expect(confirmSpy).toHaveBeenCalledTimes(1));
  await vi.waitFor(() => expect(mount.instance.forms.dirty("nestedForm")).toBe(false));
  expect(mount.instance.forms.dirty("overlayForm")).toBe(true);

  app.unmount();
  mount.dispose();
});
