import { afterEach, describe, expect, it, vi } from "vitest";
import { computed, createApp, h, nextTick, ref } from "vue";
import { createI18n } from "vue-i18n";
import ElementPlus from "element-plus";
import publicEn from "@ontomato/workbench-ui/locales/en";
import { definePanel, type DirectPanelManifest } from "@ontomato/contracts/panel-manifest";
import type { DirectProjection } from "@ontomato/contracts/product-panels";
import type { ProductPanelReadResponse } from "@ontomato/contracts/panel-host";
import { ATTRIBUTE, FUNCTION, OBJECT_TYPE } from "@ontomato/contracts/platform-object-types";
import { PanelFormAdapters, type PanelFormAdapter, type PanelFormHandle } from "../../../../../packages/apps-sdk/src/panel/forms";
import { createPanelInstance } from "../../../../../packages/apps-sdk/src/panel/instance";
import { mountDirectPanel } from "../../../../../packages/apps-sdk/src/panel/direct-mount";
import { createPanelText } from "../../../../../packages/apps-sdk/src/panel/text";
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

const textField = (path: string, label: string) => ({
  path,
  label,
  required: false,
  readOnly: false,
  valueSchema: {},
  control: { kind: "text" },
});

const fields = [textField("/name", "Name"), textField("/className", "Class")];

const saveOperation = (objectType: string, input: string) => ({
  kind: "form.save",
  handlerRef: `${objectType}.save`,
  label: "Save",
  effect: "write",
  target: { source: "input", input },
  inputSchema: {},
  resultSchema: {},
  batch: false,
});

function stubAdapter(options: {
  dirty: boolean;
  canSettle?: boolean;
  target?: { kind: "object"; objectType: string; primaryKey: string } | { kind: "draft"; objectType: string };
  inputStateKeys?: readonly string[];
  onDiscard?: () => void;
}) {
  let dirtyState = options.dirty;
  const canSettle = ref(options.canSettle ?? options.dirty);
  const discard = vi.fn(() => {
    dirtyState = false;
    canSettle.value = false;
    options.onDiscard?.();
  });
  const handle = {
    fields: ref([]),
    values: ref({}),
    errors: ref({}),
    changed: ref(new Set<string>()),
    busy: ref(false),
    dirty: canSettle,
    dirtyFields: ref(new Set<string>()),
    submitting: ref(false),
    canSubmit: ref(false),
    set: vi.fn(),
    submit: vi.fn(async () => ({})),
    reset: vi.fn(async () => true),
  } as unknown as PanelFormHandle;
  const adapter: PanelFormAdapter = {
    handle,
    submit: vi.fn(async () => ({})),
    dirty: () => dirtyState,
    discard,
    snapshot: () => ({
      ...(options.target ? { target: options.target } : {}),
      dirty: dirtyState,
      values: {},
    }),
    ...(options.inputStateKeys
      ? {
          draft: {
            identity: () => "draft-id",
            inputStateKeys: () => options.inputStateKeys!,
            capture: () => ({}) as never,
            restore: vi.fn(),
          },
        }
      : {}),
  };
  return { adapter, discard, canSettle };
}

afterEach(() => {
  document.body.innerHTML = "";
});

function mountView(render: () => ReturnType<typeof h>) {
  const element = document.createElement("div");
  document.body.append(element);
  const app = createApp({ render });
  app.use(createI18n({ legacy: false, locale: "en", messages: { en: publicEn } })).use(ElementPlus).mount(element);
  return { app, element };
}

describe("PanelFormAdapters.discardRemoved and PanelInstance.letGo", () => {
  it("discards only dirty adapters matching removed targets or cleared state keys, including canSettle-only adapters", () => {
    const forms = new PanelFormAdapters(["removedEdit", "canSettleOnly", "cleanRemoved", "sameKeyOtherType", "otherObject", "fixedChild"]);
    const removedEdit = stubAdapter({
      dirty: true,
      target: { kind: "object", objectType: ATTRIBUTE, primaryKey: "attr-1" },
    });
    const canSettleOnly = stubAdapter({
      dirty: false,
      canSettle: true,
      target: { kind: "object", objectType: ATTRIBUTE, primaryKey: "attr-1" },
    });
    const cleanRemoved = stubAdapter({
      dirty: false,
      canSettle: false,
      target: { kind: "object", objectType: ATTRIBUTE, primaryKey: "attr-1" },
    });
    const sameKeyOtherType = stubAdapter({
      dirty: true,
      target: { kind: "object", objectType: OBJECT_TYPE, primaryKey: "attr-1" },
    });
    const otherObject = stubAdapter({
      dirty: true,
      target: { kind: "object", objectType: ATTRIBUTE, primaryKey: "attr-2" },
    });
    const fixedChild = stubAdapter({
      dirty: true,
      target: { kind: "draft", objectType: ATTRIBUTE },
      inputStateKeys: ["parentClass"],
    });

    forms.register("removedEdit", removedEdit.adapter);
    forms.register("canSettleOnly", canSettleOnly.adapter);
    forms.register("cleanRemoved", cleanRemoved.adapter);
    forms.register("sameKeyOtherType", sameKeyOtherType.adapter);
    forms.register("otherObject", otherObject.adapter);
    forms.register("fixedChild", fixedChild.adapter);

    forms.discardRemoved(
      [{ objectType: ATTRIBUTE, primaryKey: "attr-1" }],
      new Set(["parentClass"]),
    );

    expect(removedEdit.discard).toHaveBeenCalledTimes(1);
    expect(canSettleOnly.discard).toHaveBeenCalledTimes(1);
    expect(cleanRemoved.discard).not.toHaveBeenCalled();
    expect(sameKeyOtherType.discard).not.toHaveBeenCalled();
    expect(otherObject.discard).not.toHaveBeenCalled();
    expect(fixedChild.discard).toHaveBeenCalledTimes(1);
  });

  it("discards matching dirty forms (including nested panels) before clearing panel state in letGo", () => {
    const manifest = definePanel({
      state: {
        selected: { type: { kind: "object", objectType: ATTRIBUTE } },
        other: { type: { kind: "object", objectType: ATTRIBUTE } },
      },
      members: {
        form: { target: { projectionId: "p-form" }, inputs: { attr: { state: "selected" } } },
        otherForm: { target: { projectionId: "p-other" }, inputs: { attr: { state: "other" } } },
      },
    });
    const locale = ref("en");
    const instance = createPanelInstance(manifest, {
      ...noOperations,
      text: createPanelText({}, locale, "en"),
      pageKey: "attrs",
      url: () => "/attrs",
      label: () => "Attributes",
      initial: {
        selected: { className: ATTRIBUTE, primaryKey: "attr-1" },
        other: { className: ATTRIBUTE, primaryKey: "attr-2" },
      },
      readProjection: async () => {
        throw new Error("unused");
      },
    });

    const events: string[] = [];
    const mainForm = stubAdapter({
      dirty: true,
      target: { kind: "object", objectType: ATTRIBUTE, primaryKey: "attr-1" },
      onDiscard: () => {
        events.push(`discard:selected=${instance.state.values.value.selected ? "present" : "null"}`);
        // Even if a @discarded handler writes the removed object back, letGo's subsequent state cleanup clears it.
        instance.state.set("selected", { className: ATTRIBUTE, primaryKey: "attr-1" });
      },
    });
    const siblingForm = stubAdapter({
      dirty: true,
      target: { kind: "object", objectType: ATTRIBUTE, primaryKey: "attr-2" },
    });
    instance.forms.register("form", mainForm.adapter);
    instance.forms.register("otherForm", siblingForm.adapter);

    // Nested panel forms registered via publish() must also discard matching removed targets,
    // without inheriting the parent's state key namespace.
    const nestedForms = new PanelFormAdapters(["nestedRemoved", "nestedSameStateName"]);
    const nestedRemoved = stubAdapter({
      dirty: true,
      target: { kind: "object", objectType: ATTRIBUTE, primaryKey: "attr-1" },
      onDiscard: () => {
        events.push(`nested-discard:selected=${instance.state.values.value.selected ? "present" : "null"}`);
      },
    });
    const nestedSameStateName = stubAdapter({
      dirty: true,
      target: { kind: "draft", objectType: FUNCTION },
      inputStateKeys: ["selected"],
    });
    nestedForms.register("nestedRemoved", nestedRemoved.adapter);
    nestedForms.register("nestedSameStateName", nestedSameStateName.adapter);
    instance.publish("nested", computed(() => ({
      instanceId: "nested-1",
      operations: [],
      context: null,
      dirty: () => nestedForms.dirty(),
      formRegistries: () => [nestedForms],
    })));

    instance.letGo([{ objectType: ATTRIBUTE, primaryKey: "attr-1" }]);

    expect(events).toEqual([
      "discard:selected=present",
      "nested-discard:selected=present",
    ]);
    expect(mainForm.discard).toHaveBeenCalledTimes(1);
    expect(nestedRemoved.discard).toHaveBeenCalledTimes(1);
    expect(siblingForm.discard).not.toHaveBeenCalled();
    expect(nestedSameStateName.discard).not.toHaveBeenCalled();
    expect(instance.state.values.value.selected).toBeNull();
    expect(instance.state.values.value.other).toEqual({ className: ATTRIBUTE, primaryKey: "attr-2" });
  });
});

describe("mounted ObjectForm discarding on affected.removed", () => {
  it("discards a dirty edit form on refresh(removed) without prompting or writing the removed object back", async () => {
    const formProjection: DirectProjection = {
      ...record,
      id: "fn-form",
      name: "Function",
      componentId: "@ontomato/sdk:ObjectForm",
      inputs: {
        fn: { kind: "object", objectType: FUNCTION },
        values: { kind: "json" },
        changedField: { kind: "scalar", type: "string" },
      },
      outputs: {},
      config: {},
      data: {
        form: {
          source: { object: { input: "fn" } },
          read: "form",
          params: { values: { input: "values" }, changedField: { input: "changedField" } },
        },
      },
      operations: {
        save: { operation: { kind: "PlatformOperation", id: `${FUNCTION}.save` }, target: { input: "fn" } },
      },
    };
    const manifest: DirectPanelManifest = {
      state: {
        fn: { type: { kind: "object", objectType: FUNCTION }, personal: false, deepLink: true, external: false },
      },
      members: {
        form: { target: { projectionId: formProjection.id }, inputs: { fn: { state: "fn" } } },
      },
    };

    // Returning false simulates choosing "Keep editing": must never be invoked when the object was removed.
    const confirmLeaveUnsaved = vi.fn(async () => false);
    const mount = mountDirectPanel({
      manifest,
      run: {
        ...directRun({
          pageKey: "fns",
          url: () => "/fns",
          label: () => "Functions",
          initial: { fn: { className: FUNCTION, primaryKey: "fn-1" } },
        }),
        confirmLeaveUnsaved,
      },
      messages: {},
      locale: ref("en"),
      defaultLocale: "en",
      requests: { request: async () => Response.json({ projection: formProjection }) },
      use: { applicationId: "app", useId: "fns" },
      expandPageComposer: noOperations.expandPageComposer,
      navigate: noOperations.navigate,
      nested: noOperations.nested,
      confirmOperation: noOperations.confirmOperation,
      read: async (request): Promise<ProductPanelReadResponse> =>
        request.operations
          ? { status: "ready", value: { save: saveOperation(FUNCTION, "fn") } as never }
          : {
              status: "ready",
              value: {
                fields: [textField("/name", "Name")],
                values: { name: "Original" },
                errors: [],
                revision: 1,
                save: { method: "PUT", path: "/fns/:id", bodySchema: {} },
              } as never,
            },
    });

    const { app, element } = mountView(() => mount.member("form"));

    await vi.waitFor(() => expect(element.querySelector('[data-field="/name"] input')).not.toBeNull());
    const input = element.querySelector<HTMLInputElement>('[data-field="/name"] input')!;
    input.value = "Unsaved edit";
    input.dispatchEvent(new Event("input"));
    await vi.waitFor(() => expect(mount.instance.dirty()).toBe(true));

    mount.refresh(null, {
      objects: [{ objectType: FUNCTION, primaryKey: "fn-1" }],
      objectTypes: [FUNCTION],
      removed: [{ objectType: FUNCTION, primaryKey: "fn-1" }],
    });
    await nextTick();
    await nextTick();

    expect(confirmLeaveUnsaved).not.toHaveBeenCalled();
    expect(document.querySelector(".el-message-box")).toBeNull();
    expect(mount.instance.state.values.value.fn).toBeNull();
    expect(mount.instance.dirty()).toBe(false);
    expect(mount.instance.forms.handle("form")?.dirty.value).toBe(false);
    expect(element.querySelector('[data-field="/name"] input')).toBeNull();

    app.unmount();
    mount.dispose();
  });

  it("does not trigger confirmDanger when confirmLeaveUnsaved is absent and form was edited then reverted (canSettle only)", async () => {
    const dualProjection: DirectProjection = {
      ...record,
      id: "fn-dual-form",
      name: "Function",
      componentId: "@ontomato/sdk:ObjectForm",
      inputs: {
        fn: { kind: "object", objectType: FUNCTION },
        values: { kind: "json" },
        changedField: { kind: "scalar", type: "string" },
      },
      outputs: {},
      config: {},
      data: {
        form: {
          source: { object: { input: "fn" } },
          read: "form",
          params: { values: { input: "values" }, changedField: { input: "changedField" } },
        },
        createForm: {
          source: { type: { kind: "PlatformObjectType", id: FUNCTION } },
          read: "createForm",
          params: { values: { input: "values" }, changedField: { input: "changedField" } },
        },
      },
      operations: {
        save: { operation: { kind: "PlatformOperation", id: `${FUNCTION}.save` }, target: { input: "fn" } },
      },
    };
    const manifest: DirectPanelManifest = {
      state: {
        fn: { type: { kind: "object", objectType: FUNCTION }, personal: false, deepLink: true, external: false },
      },
      members: {
        form: { target: { projectionId: dualProjection.id }, inputs: { fn: { state: "fn" } } },
      },
    };

    const mount = mountDirectPanel({
      manifest,
      run: directRun({
        pageKey: "fns",
        url: () => "/fns",
        label: () => "Functions",
        initial: { fn: { className: FUNCTION, primaryKey: "fn-1" } },
      }),
      messages: {},
      locale: ref("en"),
      defaultLocale: "en",
      requests: { request: async () => Response.json({ projection: dualProjection }) },
      use: { applicationId: "app", useId: "fns" },
      expandPageComposer: noOperations.expandPageComposer,
      navigate: noOperations.navigate,
      nested: noOperations.nested,
      confirmOperation: noOperations.confirmOperation,
      read: async (request): Promise<ProductPanelReadResponse> =>
        request.operations
          ? { status: "ready", value: { save: saveOperation(FUNCTION, "fn") } as never }
          : {
              status: "ready",
              value: {
                fields: [textField("/name", "Name")],
                values: { name: request.dataName === "createForm" ? "" : "Original" },
                errors: [],
                revision: 1,
                save: { method: "PUT", path: "/fns/:id", bodySchema: {} },
              } as never,
            },
    });

    const { app, element } = mountView(() => mount.member("form"));

    await vi.waitFor(() => expect(element.querySelector('[data-field="/name"] input')).not.toBeNull());
    const input = element.querySelector<HTMLInputElement>('[data-field="/name"] input')!;
    // Edit then revert back to original: `dirty` returns to false, while `submitted` keeps `canSettle` true.
    input.value = "Temporarily changed";
    input.dispatchEvent(new Event("input"));
    await nextTick();
    input.value = "Original";
    input.dispatchEvent(new Event("input"));
    await vi.waitFor(() => {
      expect(mount.instance.forms.dirty("form")).toBe(false);
      expect(mount.instance.forms.handle("form")?.dirty.value).toBe(true);
    });

    mount.refresh(null, {
      objects: [{ objectType: FUNCTION, primaryKey: "fn-1" }],
      objectTypes: [FUNCTION],
      removed: [{ objectType: FUNCTION, primaryKey: "fn-1" }],
    });
    await nextTick();
    await nextTick();

    expect(document.querySelector(".el-message-box")).toBeNull();
    expect(mount.instance.state.values.value.fn).toBeNull();
    expect(mount.instance.forms.handle("form")?.dirty.value).toBe(false);

    app.unmount();
    mount.dispose();
  });

  it("keeps a sibling dirty form editing a different object untouched when another object is removed", async () => {
    const primaryProjection: DirectProjection = {
      ...record,
      id: "attr-form-a",
      name: "Attribute A",
      componentId: "@ontomato/sdk:ObjectForm",
      inputs: {
        attr: { kind: "object", objectType: ATTRIBUTE },
        values: { kind: "json" },
        changedField: { kind: "scalar", type: "string" },
      },
      outputs: {},
      config: {},
      data: {
        form: {
          source: { object: { input: "attr" } },
          read: "form",
          params: { values: { input: "values" }, changedField: { input: "changedField" } },
        },
      },
      operations: {
        save: { operation: { kind: "PlatformOperation", id: `${ATTRIBUTE}.save` }, target: { input: "attr" } },
      },
    };
    const siblingProjection: DirectProjection = {
      ...primaryProjection,
      id: "attr-form-b",
      name: "Attribute B",
    };
    const byId: Record<string, DirectProjection> = {
      [primaryProjection.id]: primaryProjection,
      [siblingProjection.id]: siblingProjection,
    };
    const manifest: DirectPanelManifest = {
      state: {
        first: { type: { kind: "object", objectType: ATTRIBUTE }, personal: false, deepLink: false, external: false },
        second: { type: { kind: "object", objectType: ATTRIBUTE }, personal: false, deepLink: false, external: false },
      },
      members: {
        firstForm: { target: { projectionId: primaryProjection.id }, inputs: { attr: { state: "first" } } },
        secondForm: { target: { projectionId: siblingProjection.id }, inputs: { attr: { state: "second" } } },
      },
    };

    const confirmLeaveUnsaved = vi.fn(async () => false);
    const mount = mountDirectPanel({
      manifest,
      run: {
        ...directRun({
          pageKey: "attrs",
          url: () => "/attrs",
          label: () => "Attributes",
          initial: {
            first: { className: ATTRIBUTE, primaryKey: "attr-1" },
            second: { className: ATTRIBUTE, primaryKey: "attr-2" },
          },
        }),
        confirmLeaveUnsaved,
      },
      messages: {},
      locale: ref("en"),
      defaultLocale: "en",
      requests: {
        request: async (path) => {
          const id = path.split("/").pop()!;
          return Response.json({ projection: byId[id] });
        },
      },
      use: { applicationId: "app", useId: "attrs" },
      expandPageComposer: noOperations.expandPageComposer,
      navigate: noOperations.navigate,
      nested: noOperations.nested,
      confirmOperation: noOperations.confirmOperation,
      read: async (request): Promise<ProductPanelReadResponse> => {
        if (request.operations) {
          return { status: "ready", value: { save: saveOperation(ATTRIBUTE, "attr") } as never };
        }
        const key = (request.inputs.attr as { primaryKey?: string } | undefined)?.primaryKey;
        return {
          status: "ready",
          value: {
            fields: [textField("/name", "Name")],
            values: { name: key === "attr-1" ? "First" : "Second" },
            errors: [],
            revision: 1,
            save: { method: "PUT", path: "/attrs/:id", bodySchema: {} },
          } as never,
        };
      },
    });

    const { app, element } = mountView(() => h("div", [
      h("div", { class: "slot-first" }, [mount.member("firstForm")]),
      h("div", { class: "slot-second" }, [mount.member("secondForm")]),
    ]));

    await vi.waitFor(() => {
      expect(element.querySelector('.slot-first [data-field="/name"] input')).not.toBeNull();
      expect(element.querySelector('.slot-second [data-field="/name"] input')).not.toBeNull();
    });

    const firstInput = element.querySelector<HTMLInputElement>('.slot-first [data-field="/name"] input')!;
    const secondInput = element.querySelector<HTMLInputElement>('.slot-second [data-field="/name"] input')!;
    firstInput.value = "First edited";
    firstInput.dispatchEvent(new Event("input"));
    secondInput.value = "Second edited";
    secondInput.dispatchEvent(new Event("input"));

    await vi.waitFor(() => {
      expect(mount.instance.forms.dirty("firstForm")).toBe(true);
      expect(mount.instance.forms.dirty("secondForm")).toBe(true);
    });

    // Remove only attr-1; attr-2's form must remain dirty and intact.
    mount.refresh(null, {
      objects: [{ objectType: ATTRIBUTE, primaryKey: "attr-1" }],
      objectTypes: [ATTRIBUTE],
      removed: [{ objectType: ATTRIBUTE, primaryKey: "attr-1" }],
    });
    await nextTick();
    await nextTick();

    expect(confirmLeaveUnsaved).not.toHaveBeenCalled();
    expect(document.querySelector(".el-message-box")).toBeNull();
    expect(mount.instance.state.values.value.first).toBeNull();
    expect(mount.instance.forms.dirty("firstForm")).toBe(false);
    expect(mount.instance.state.values.value.second).toEqual({ className: ATTRIBUTE, primaryKey: "attr-2" });
    expect(mount.instance.forms.dirty("secondForm")).toBe(true);
    expect(element.querySelector<HTMLInputElement>('.slot-second [data-field="/name"] input')!.value).toBe("Second edited");

    app.unmount();
    mount.dispose();
  });

  it("discards a dirty create draft whose fixedFields parent object state is cleared by letGo", async () => {
    const createProjection: DirectProjection = {
      ...record,
      id: "attr-create-form",
      name: "Create Attribute",
      componentId: "@ontomato/sdk:ObjectForm",
      inputs: {
        values: { kind: "json" },
        changedField: { kind: "scalar", type: "string" },
      },
      outputs: {},
      config: {
        fixedFields: {
          "/className": { state: "parentClass", path: "/primaryKey" },
        },
      },
      data: {
        createForm: {
          source: { type: { kind: "PlatformObjectType", id: ATTRIBUTE } },
          read: "createForm",
          params: { values: { input: "values" }, changedField: { input: "changedField" } },
        },
      },
      operations: {
        save: { operation: { kind: "PlatformOperation", id: `${ATTRIBUTE}.save` } },
      },
    };
    const manifest: DirectPanelManifest = {
      state: {
        parentClass: { type: { kind: "object", objectType: OBJECT_TYPE }, personal: false, deepLink: false, external: false },
      },
      members: {
        createAttr: { target: { projectionId: createProjection.id } },
      },
    };

    const confirmLeaveUnsaved = vi.fn(async () => false);
    const mount = mountDirectPanel({
      manifest,
      run: {
        ...directRun({
          pageKey: "classes",
          url: () => "/classes",
          label: () => "Classes",
          initial: { parentClass: { className: OBJECT_TYPE, primaryKey: "Order" } },
        }),
        confirmLeaveUnsaved,
      },
      messages: {},
      locale: ref("en"),
      defaultLocale: "en",
      requests: { request: async () => Response.json({ projection: createProjection }) },
      use: { applicationId: "app", useId: "classes" },
      expandPageComposer: noOperations.expandPageComposer,
      navigate: noOperations.navigate,
      nested: noOperations.nested,
      confirmOperation: noOperations.confirmOperation,
      read: async (request): Promise<ProductPanelReadResponse> =>
        request.operations
          ? {
              status: "ready",
              value: {
                save: {
                  kind: "form.save",
                  handlerRef: `${ATTRIBUTE}.save`,
                  label: "Save",
                  effect: "write",
                  target: { source: "draft", slot: "createAttr" },
                  inputSchema: {},
                  resultSchema: {},
                  batch: false,
                },
              } as never,
            }
          : {
              status: "ready",
              value: {
                fields,
                values: { name: "", className: "" },
                errors: [],
                revision: 1,
                save: { method: "POST", path: "/attrs", bodySchema: {} },
              } as never,
            },
    });

    const { app, element } = mountView(() => mount.member("createAttr"));

    await vi.waitFor(() => expect(element.querySelector('[data-field="/name"] input')).not.toBeNull());
    const nameInput = element.querySelector<HTMLInputElement>('[data-field="/name"] input')!;
    nameInput.value = "draft_col";
    nameInput.dispatchEvent(new Event("input"));
    await vi.waitFor(() => expect(mount.instance.forms.dirty("createAttr")).toBe(true));

    // Delete the parent class; the create draft bound via fixedFields to parentClass is discarded cleanly.
    mount.refresh(null, {
      objects: [{ objectType: OBJECT_TYPE, primaryKey: "Order" }],
      objectTypes: [OBJECT_TYPE],
      removed: [{ objectType: OBJECT_TYPE, primaryKey: "Order" }],
    });
    await nextTick();
    await nextTick();

    expect(confirmLeaveUnsaved).not.toHaveBeenCalled();
    expect(document.querySelector(".el-message-box")).toBeNull();
    expect(mount.instance.state.values.value.parentClass).toBeNull();
    expect(mount.instance.forms.dirty("createAttr")).toBe(false);
    expect(mount.instance.forms.handle("createAttr")?.dirty.value).toBe(false);

    app.unmount();
    mount.dispose();
  });
});
