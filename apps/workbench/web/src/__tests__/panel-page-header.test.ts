import { afterEach, describe, expect, it, vi } from "vitest";
import { createApp, defineComponent, h, nextTick, provide, reactive, ref, type VNodeChild } from "vue";
import { createI18n } from "vue-i18n";
import ElementPlus from "element-plus";
import publicEn from "@ontomato/workbench-ui/locales/en";
import type { DirectPanelManifest } from "@ontomato/contracts/panel-manifest";
import type { DirectProjection } from "@ontomato/contracts/product-panels";
import type { ProductPanelReadResponse } from "@ontomato/contracts/panel-host";
import type { PanelFormField } from "@ontomato/contracts/panel-projection";
import { FUNCTION } from "@ontomato/contracts/platform-object-types";
import { randomId } from "@ontomato/contracts/random-id";
import { createPanelBackController } from "@ontomato/platform-shell";
import PageHeader from "../../../../../packages/apps-sdk/src/base/PageHeader.vue";
import { panelContextKey, type PanelContext } from "../../../../../packages/apps-sdk/src/panel/context";
import { mountDirectPanel } from "../../../../../packages/apps-sdk/src/panel/direct-mount";
import { usePanelBack } from "../../../../../packages/apps-sdk/src/panel/back";
import { usePanelFormDraft } from "../../../../../packages/apps-sdk/src/panel/form-draft";
import { prepareTemplateComponents } from "../../../../../packages/apps-sdk/src/panel/template-components";
import { baseComponents } from "../../../../../packages/apps-sdk/src/base-components";
import { directRun, noOperations } from "./panel-frame";

/*
 * Official presentational `<page-header>` component, `ObjectForm` / `PanelFormHandle` / `usePanelFormDraft` wiring,
 * and form-scoped `usePanelBack` regression coverage.
 */

const baseRecord = {
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
  path: "/objects/:id",
  bodySchema: {},
  draftOperation: "object.update",
};

const fields: PanelFormField[] = [
  { path: "/name", label: "Name", control: { kind: "text" }, valueSchema: {}, required: true, readOnly: false },
  { path: "/desc", label: "Description", control: { kind: "text" }, valueSchema: {}, required: false, readOnly: false },
];

const i18n = () => createI18n({ legacy: false, locale: "en", messages: { en: publicEn } });

async function clickDialogButton(text: string) {
  await vi.waitFor(() => {
    const boxes = [...document.querySelectorAll<HTMLElement>(".el-message-box")];
    const open = boxes.find((box) => box.closest<HTMLElement>(".el-overlay")?.style.display !== "none");
    expect(open).toBeDefined();
    const button = [...open!.querySelectorAll<HTMLButtonElement>("button")].find((item) => item.textContent?.trim() === text);
    expect(button).toBeDefined();
    button!.click();
  });
}

afterEach(() => {
  document.body.innerHTML = "";
});

describe("official presentational PageHeader component", () => {
  function mountHeader(
    initialProps: Record<string, unknown>,
    slots?: Record<string, () => VNodeChild>,
  ) {
    const props = reactive({ ...initialProps });
    const host = document.createElement("div");
    document.body.append(host);
    const app = createApp(defineComponent({
      render: () => h(PageHeader, props, slots),
    }));
    app.use(i18n()).mount(host);
    return {
      host,
      header: () => host.querySelector<HTMLElement>("header.sdk-page-header")!,
      props,
      unmount: () => app.unmount(),
    };
  }

  it("renders title, description, leading, explicit back button with divider, and flexible actions/default slots", async () => {
    const onBack = vi.fn();
    const view = mountHeader(
      {
        title: "Relation types",
        description: "Connect object types across the ontology",
        backLabel: "Back to catalog",
        onBack,
      },
      {
        leading: () => h("span", { class: "avatar-badge" }, "R"),
        actions: () => [
          h("span", { class: "header-count" }, "14 items"),
          h("button", { type: "button", class: "custom-create" }, "New relation"),
        ],
        default: () => h("input", { class: "header-search", placeholder: "Search" }),
      },
    );
    try {
      expect(view.header().classList.contains("sdk-page-header")).toBe(true);
      expect(view.header().classList.contains("compact")).toBe(true);
      expect(view.host.querySelector(".sdk-page-header-leading .avatar-badge")?.textContent).toBe("R");
      expect(view.host.querySelector(".sdk-page-header-back")?.textContent).toContain("Back to catalog");
      expect(view.host.querySelector(".sdk-page-header-back-divider")).not.toBeNull();
      expect(view.host.querySelector("h1.sdk-page-header-title")?.textContent).toBe("Relation types");
      expect(view.host.querySelector(".sdk-page-header-description")?.textContent).toBe("Connect object types across the ontology");
      expect(view.host.querySelector(".sdk-page-header-actions .header-count")?.textContent).toBe("14 items");
      expect(view.host.querySelector(".sdk-page-header-actions .custom-create")?.textContent).toBe("New relation");
      expect(view.host.querySelector(".sdk-page-header-actions .header-search")).not.toBeNull();

      view.host.querySelector<HTMLButtonElement>(".sdk-page-header-back")!.click();
      await nextTick();
      expect(onBack).toHaveBeenCalledOnce();
    } finally {
      view.unmount();
    }
  });

  it("supports custom #title slot (for projection-bound object names) and non-compact mode", () => {
    const view = mountHeader(
      {
        backLabel: "Back to object types",
        compact: false,
      },
      {
        title: () =>
          h("div", { class: "sdk-object-header" }, [
            h("div", { class: "sdk-object-header-row" }, [
              h("div", { class: "sdk-object-header-identity" }, [
                h("div", { class: "sdk-object-header-title-line" }, [
                  h("h2", { class: "sdk-object-header-title" }, "VeryLongOntologyObjectTypeDisplayNameForEllipsisCheck"),
                ]),
              ]),
            ]),
          ]),
      },
    );
    try {
      expect(view.header().classList.contains("compact")).toBe(false);
      expect(view.host.querySelector("h1.sdk-page-header-title")).toBeNull();
      expect(view.host.querySelector(".sdk-page-header-back-divider")).not.toBeNull();
      expect(view.host.querySelector(".sdk-page-header-title-slot .sdk-object-header-title")?.textContent).toBe(
        "VeryLongOntologyObjectTypeDisplayNameForEllipsisCheck",
      );
    } finally {
      view.unmount();
    }
  });

  it("renders draft Save/Discard/Unsaved states cleanly and blocks duplicate clicks while saving", async () => {
    const onSave = vi.fn();
    const onDiscard = vi.fn();
    const draftSave = vi.fn();
    const draftDiscard = vi.fn();
    const view = mountHeader({
      title: "Customer",
      draft: { dirty: false, saving: false, save: draftSave, discard: draftDiscard },
      onSave,
      onDiscard,
    });
    try {
      // Clean draft: only disabled Save shows; no unsaved notice or Discard button.
      expect(view.host.querySelector(".sdk-page-header-unsaved")).toBeNull();
      expect(view.host.querySelector("button.sdk-page-header-action.secondary")).toBeNull();
      const saveBtn = () => view.host.querySelector<HTMLButtonElement>("button.sdk-page-header-action.primary")!;
      expect(saveBtn().textContent?.trim()).toBe("Save");
      expect(saveBtn().disabled).toBe(true);

      // Dirty draft: unsaved notice, Discard, and enabled Save show.
      view.props.draft = { dirty: true, saving: false, save: draftSave, discard: draftDiscard };
      await nextTick();
      expect(view.host.querySelector(".sdk-page-header-unsaved")?.textContent?.trim()).toBe("Unsaved changes");
      const discardBtn = () => view.host.querySelector<HTMLButtonElement>("button.sdk-page-header-action.secondary")!;
      expect(discardBtn().textContent?.trim()).toBe("Discard");
      expect(discardBtn().disabled).toBe(false);
      expect(saveBtn().disabled).toBe(false);

      discardBtn().click();
      await nextTick();
      expect(draftDiscard).toHaveBeenCalledOnce();
      expect(onDiscard).toHaveBeenCalledOnce();

      saveBtn().click();
      await nextTick();
      expect(draftSave).toHaveBeenCalledOnce();
      expect(onSave).toHaveBeenCalledOnce();

      // Saving: both buttons disabled, aria-busy="true", spinner shown, clicks ignored.
      view.props.draft = { dirty: true, saving: true, save: draftSave, discard: draftDiscard };
      await nextTick();
      expect(saveBtn().getAttribute("aria-busy")).toBe("true");
      expect(saveBtn().disabled).toBe(true);
      expect(discardBtn().disabled).toBe(true);
      expect(view.host.querySelector(".sdk-page-header-spinner")).not.toBeNull();
      saveBtn().click();
      discardBtn().click();
      expect(draftSave).toHaveBeenCalledOnce();
      expect(draftDiscard).toHaveBeenCalledOnce();
    } finally {
      view.unmount();
    }
  });

  it("registers <page-header> automatically in panel templates via prepareTemplateComponents", async () => {
    const template = '<div class="wrap"><page-header title="Orders" description="All customer orders"></page-header></div>';
    const install = await prepareTemplateComponents(template, baseComponents);
    const host = document.createElement("div");
    document.body.append(host);
    const app = createApp({ template });
    install(app);
    app.use(i18n()).mount(host);
    try {
      expect(host.querySelector(".sdk-page-header .sdk-page-header-title")?.textContent?.trim()).toBe("Orders");
      expect(host.querySelector(".sdk-page-header .sdk-page-header-description")?.textContent?.trim()).toBe("All customer orders");
    } finally {
      app.unmount();
    }
  });
});

describe("ObjectForm + usePanelFormDraft + PageHeader integration", () => {
  it("exposes dirty, dirtyFields, submitting, canSubmit, submit() and reset() and drives PageHeader draft controls", async () => {
    let storedValues = { name: "Customer", desc: "Initial description" };
    let resolveSave: (() => void) | null = null;
    const saveCalls: Record<string, unknown>[] = [];

    const formProjection: DirectProjection = {
      ...baseRecord,
      id: "object-form",
      name: "Object form",
      componentId: "@ontomato/sdk:ObjectForm",
      inputs: { app: { kind: "object", objectType: FUNCTION }, values: { kind: "json" }, changedField: { kind: "scalar", type: "string" } },
      outputs: {},
      config: { actions: "none" },
      data: {
        form: {
          source: { object: { input: "app" } },
          read: "form",
          params: { values: { input: "values" }, changedField: { input: "changedField" } },
        },
      },
      operations: {
        save: { operation: { kind: "PlatformOperation", id: `${FUNCTION}.save` }, target: { input: "app" } },
      },
    };
    const manifest: DirectPanelManifest = {
      state: { selected: { type: { kind: "object", objectType: FUNCTION }, personal: false, deepLink: true, external: false } },
      members: { form: { target: { projectionId: formProjection.id }, inputs: { app: { state: "selected" } } } },
      commands: {},
    };

    const mountResult = mountDirectPanel({
      manifest,
      run: directRun({
        pageKey: "objects",
        url: () => "/objects",
        label: () => "Objects",
        initial: { selected: { className: FUNCTION, primaryKey: "Customer" } },
      }),
      messages: {},
      locale: ref("en"),
      defaultLocale: "en",
      requests: {
        request: async (path, init) => {
          if (path === "/panel-operations/intents") {
            const body = JSON.parse(String(init?.body ?? "{}"));
            saveCalls.push(body.call.input.values);
            storedValues = { ...storedValues, ...body.call.input.values };
            return Response.json({ intentId: randomId(), operationId: "form.save", label: "Save", confirmation: { kind: "none" } });
          }
          return Response.json({ projection: formProjection });
        },
      },
      use: { applicationId: "app", useId: "objects" },
      expandPageComposer: noOperations.expandPageComposer,
      navigate: noOperations.navigate,
      nested: noOperations.nested,
      confirmOperation: async (preparation) => {
        await new Promise<void>((resolve) => { resolveSave = resolve; });
        return {
          decision: "confirm",
          response: {
            kind: "dispatched",
            intentId: preparation.intentId,
            outcome: { kind: "success", data: { primaryKey: "Customer" }, affected: { objects: [], objectTypes: [] } },
          },
        };
      },
      read: async (request): Promise<ProductPanelReadResponse> =>
        request.operations
          ? { status: "ready", value: { save: saveDescriptor } as never }
          : { status: "ready", value: { fields, values: { ...storedValues }, errors: [], revision: 1, save: formSaveMeta } as never },
    });

    const element = document.createElement("div");
    document.body.append(element);

    const Page = defineComponent({
      setup() {
        const draft = usePanelFormDraft("form");
        return () => h("div", [
          h(PageHeader, { backLabel: "Back to object types", title: "Customer", draft: draft.value }),
          mountResult.member("form"),
        ]);
      },
    });
    const app = createApp({
      setup() {
        provide(panelContextKey, {
          instance: mountResult.instance,
          manifest,
          t: (key: string) => key,
          navigate: noOperations.navigate,
          notify: () => {},
        } as unknown as PanelContext);
        return () => h(Page);
      },
    });
    app.use(i18n()).use(ElementPlus).mount(element);

    try {
      await vi.waitFor(() => expect(element.querySelector('[data-field="/name"] input')).not.toBeNull());
      const handle = () => mountResult.instance.forms.handle("form")!;
      const saveBtn = () => element.querySelector<HTMLButtonElement>(".sdk-page-header button.primary")!;
      const discardBtn = () => element.querySelector<HTMLButtonElement>(".sdk-page-header button.secondary");
      const unsaved = () => element.querySelector(".sdk-page-header .sdk-page-header-unsaved")?.textContent?.trim() ?? null;

      // Clean initial state: Save disabled, no Discard/unsaved indicator, handle reflects clean state.
      expect(handle().dirty.value).toBe(false);
      expect(handle().dirtyFields.value.size).toBe(0);
      expect(handle().submitting.value).toBe(false);
      expect(handle().canSubmit.value).toBe(false);
      expect(saveBtn().disabled).toBe(true);
      expect(discardBtn()).toBeNull();
      expect(unsaved()).toBeNull();

      // Edit field: handle & PageHeader both become dirty.
      const input = element.querySelector<HTMLInputElement>('[data-field="/name"] input')!;
      input.value = "Customer Updated";
      input.dispatchEvent(new Event("input"));
      await vi.waitFor(() => expect(handle().dirty.value).toBe(true));
      expect([...handle().dirtyFields.value]).toEqual(["/name"]);
      expect(handle().canSubmit.value).toBe(true);
      expect(saveBtn().disabled).toBe(false);
      expect(discardBtn()).not.toBeNull();
      expect(unsaved()).toBe("Unsaved changes");

      // Click Discard in PageHeader -> confirms via dialog and restores original value.
      discardBtn()!.click();
      await clickDialogButton("Discard");
      await vi.waitFor(() => expect(handle().dirty.value).toBe(false));
      expect(element.querySelector<HTMLInputElement>('[data-field="/name"] input')!.value).toBe("Customer");
      expect(handle().dirtyFields.value.size).toBe(0);
      expect(saveBtn().disabled).toBe(true);
      expect(discardBtn()).toBeNull();

      // Programmatic reset() without confirm discards immediately.
      input.value = "Customer Temp";
      input.dispatchEvent(new Event("input"));
      await vi.waitFor(() => expect(handle().dirty.value).toBe(true));
      expect(await handle().reset()).toBe(true);
      await nextTick();
      expect(handle().dirty.value).toBe(false);
      expect(element.querySelector<HTMLInputElement>('[data-field="/name"] input')!.value).toBe("Customer");

      // Edit again and click Save in PageHeader -> submitting state during save, then settles clean.
      input.value = "Customer Saved";
      input.dispatchEvent(new Event("input"));
      await vi.waitFor(() => expect(saveBtn().disabled).toBe(false));
      saveBtn().click();
      await vi.waitFor(() => expect(handle().submitting.value).toBe(true));
      expect(saveBtn().disabled).toBe(true);
      expect(saveBtn().getAttribute("aria-busy")).toBe("true");
      expect(discardBtn()!.disabled).toBe(true);

      await vi.waitFor(() => expect(resolveSave).not.toBeNull());
      resolveSave!();
      await vi.waitFor(() => expect(handle().submitting.value).toBe(false));
      await vi.waitFor(() => expect(handle().dirty.value).toBe(false));
      expect(saveCalls).toEqual([{ name: "Customer Saved", desc: "Initial description" }]);
      expect(saveBtn().disabled).toBe(true);
      expect(discardBtn()).toBeNull();
    } finally {
      app.unmount();
      mountResult.dispose();
    }
  });
});

describe("form-scoped usePanelBack across sibling forms in one panel", () => {
  it("discards only form B when confirming scoped back for B, preserving form A's unsaved edits", async () => {
    const formAProjection: DirectProjection = {
      ...baseRecord,
      id: "form-a",
      name: "Object basic info",
      componentId: "@ontomato/sdk:ObjectForm",
      inputs: { app: { kind: "object", objectType: FUNCTION }, values: { kind: "json" }, changedField: { kind: "scalar", type: "string" } },
      outputs: {},
      config: { actions: "none" },
      data: {
        form: {
          source: { object: { input: "app" } },
          read: "form",
          params: { values: { input: "values" }, changedField: { input: "changedField" } },
        },
      },
      operations: {
        save: { operation: { kind: "PlatformOperation", id: `${FUNCTION}.save` }, target: { input: "app" } },
      },
    };
    const formBProjection: DirectProjection = {
      ...formAProjection,
      id: "form-b",
      name: "Attribute inline edit",
    };
    const manifest: DirectPanelManifest = {
      state: {
        objectA: { type: { kind: "object", objectType: FUNCTION }, personal: false, deepLink: true, external: false },
        objectB: { type: { kind: "object", objectType: FUNCTION }, personal: false, deepLink: true, external: false },
      },
      members: {
        formA: { target: { projectionId: formAProjection.id }, inputs: { app: { state: "objectA" } } },
        formB: { target: { projectionId: formBProjection.id }, inputs: { app: { state: "objectB" } } },
      },
      commands: {},
    };

    let allowLeave = false;
    const confirmLeaveUnsaved = vi.fn(async () => allowLeave);
    let backController!: ReturnType<typeof createPanelBackController>;
    const mountResult = mountDirectPanel({
      manifest,
      run: {
        ...directRun({
          pageKey: "objects",
          url: () => "/objects",
          label: () => "Objects",
          initial: {
            objectA: { className: FUNCTION, primaryKey: "obj-a" },
            objectB: { className: FUNCTION, primaryKey: "attr-b" },
          },
        }),
        confirmLeaveUnsaved,
      },
      messages: {},
      locale: ref("en"),
      defaultLocale: "en",
      requests: {
        request: async (path) => {
          const projection = path.includes("form-b") ? formBProjection : formAProjection;
          return Response.json({ projection });
        },
      },
      use: { applicationId: "app", useId: "objects" },
      expandPageComposer: noOperations.expandPageComposer,
      navigate: noOperations.navigate,
      nested: noOperations.nested,
      confirmOperation: noOperations.confirmOperation,
      read: async (request): Promise<ProductPanelReadResponse> => {
        if (request.operations) return { status: "ready", value: { save: saveDescriptor } as never };
        const isB = request.memberPath.some((segment) => segment.member === "formB");
        return {
          status: "ready",
          value: {
            fields,
            values: isB ? { name: "Attr B", desc: "B baseline" } : { name: "Object A", desc: "A baseline" },
            errors: [],
            revision: 1,
            save: formSaveMeta,
          } as never,
        };
      },
    });

    backController = createPanelBackController({
      active: () => true,
      allowHistory: () => false,
      isDirty: () => mountResult.instance.dirty(),
      confirmLeaveUnsaved: () => (mountResult.instance.dirty() ? confirmLeaveUnsaved() : Promise.resolve(true)),
    });

    const element = document.createElement("div");
    document.body.append(element);

    const attrOpen = ref(true);
    let attrBack!: ReturnType<typeof usePanelBack>;

    const Inner = defineComponent({
      setup() {
        attrBack = usePanelBack(
          attrOpen,
          () => { attrOpen.value = false; },
          { pushHistory: false, forms: "formB" },
        );
        return () => h("div", [
          h("section", { class: "pane-a" }, [mountResult.member("formA")]),
          attrOpen.value ? h("section", { class: "pane-b" }, [mountResult.member("formB")]) : null,
        ]);
      },
    });

    const app = createApp({
      setup() {
        provide(panelContextKey, {
          instance: mountResult.instance,
          manifest,
          t: (key: string) => key,
          navigate: noOperations.navigate,
          notify: () => {},
          registerBackHandler: backController.register,
          confirmLeaveUnsaved: () => (mountResult.instance.dirty() ? confirmLeaveUnsaved() : Promise.resolve(true)),
        } as unknown as PanelContext);
        return () => h(Inner);
      },
    });
    app.use(i18n()).use(ElementPlus).mount(element);

    try {
      await vi.waitFor(() => {
        expect(element.querySelector('.pane-a [data-field="/name"] input')).not.toBeNull();
        expect(element.querySelector('.pane-b [data-field="/name"] input')).not.toBeNull();
      });

      const inputA = element.querySelector<HTMLInputElement>('.pane-a [data-field="/name"] input')!;

      // Edit ONLY form A; form B stays clean.
      inputA.value = "Object A Edited";
      inputA.dispatchEvent(new Event("input"));
      await vi.waitFor(() => expect(mountResult.instance.forms.dirty("formA")).toBe(true));
      expect(mountResult.instance.forms.dirty("formB")).toBe(false);

      // Closing clean form B via Escape must NOT prompt and must keep form A's edits intact.
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
      await nextTick();
      expect(confirmLeaveUnsaved).not.toHaveBeenCalled();
      expect(attrOpen.value).toBe(false);
      expect(mountResult.instance.forms.dirty("formA")).toBe(true);
      expect(element.querySelector<HTMLInputElement>('.pane-a [data-field="/name"] input')!.value).toBe("Object A Edited");

      // Re-open form B and edit form B too so BOTH A and B are dirty.
      attrOpen.value = true;
      await vi.waitFor(() => expect(element.querySelector('.pane-b [data-field="/name"] input')).not.toBeNull());
      const inputB2 = element.querySelector<HTMLInputElement>('.pane-b [data-field="/name"] input')!;
      inputB2.value = "Attr B Edited";
      inputB2.dispatchEvent(new Event("input"));
      await vi.waitFor(() => expect(mountResult.instance.forms.dirty("formB")).toBe(true));
      expect(mountResult.instance.forms.dirty("formA")).toBe(true);

      // Cancel scoped back on B -> prompts once, neither A nor B is discarded.
      allowLeave = false;
      expect(await attrBack.back()).toBe(false);
      expect(confirmLeaveUnsaved).toHaveBeenCalledTimes(1);
      expect(attrOpen.value).toBe(true);
      expect(mountResult.instance.forms.dirty("formA")).toBe(true);
      expect(mountResult.instance.forms.dirty("formB")).toBe(true);

      // Confirm scoped back on B -> prompts once, ONLY B is discarded, A's edits stay intact!
      allowLeave = true;
      expect(await attrBack.back()).toBe(true);
      await nextTick();
      expect(confirmLeaveUnsaved).toHaveBeenCalledTimes(2);
      expect(attrOpen.value).toBe(false);
      expect(mountResult.instance.forms.dirty("formA")).toBe(true);
      expect(mountResult.instance.forms.dirty("formB")).toBe(false);
      expect(element.querySelector<HTMLInputElement>('.pane-a [data-field="/name"] input')!.value).toBe("Object A Edited");
      expect(mountResult.instance.forms.handle("formA")?.values.value.name).toBe("Object A Edited");
    } finally {
      backController.dispose();
      app.unmount();
      mountResult.dispose();
    }
  });
});
