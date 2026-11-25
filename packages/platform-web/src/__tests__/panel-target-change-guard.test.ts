import { flushPromises, mount } from "@vue/test-utils";
import { computed, defineComponent, h, nextTick, shallowRef, watch } from "vue";
import { createI18n } from "vue-i18n";
import { describe, expect, it, vi } from "vitest";
import { panelManifestSchema, type PanelManifest } from "@ontomato/contracts/panel-manifest";
import type { PanelOwnerOperationDescriptor } from "@ontomato/contracts/panel-operations";
import type { PanelFormDescription } from "@ontomato/contracts/panel-projection";
import type { ProductProjection } from "@ontomato/contracts/product-panels";
import * as platformShell from "@ontomato/platform-shell";
import ObjectForm from "../../../apps-sdk/src/base/ObjectForm.vue";
import ObjectList from "../../../apps-sdk/src/base/ObjectList.vue";
import { panelContextKey, projectionKey, type PanelContext } from "../../../apps-sdk/src/panel/context";
import { createPanelInstance, type PanelInstance, type PanelWriteResult } from "../../../apps-sdk/src/panel/instance";
import { panelMemberKey, type PanelMemberContext } from "../../../apps-sdk/src/panel/member";
import type { MemberOperationsState } from "../../../apps-sdk/src/panel/member-operations";

const objectType = "Customer";
const refOf = (primaryKey: string) => ({ className: objectType, primaryKey });

function formDescription(name: string): PanelFormDescription {
  return {
    values: { name },
    fields: [
      { path: "/name", label: "Name", valueSchema: { type: "string" }, required: false, readOnly: false, control: { kind: "text" } },
    ],
    errors: [],
    save: { method: "POST", path: "/save", bodySchema: {} },
  };
}

function saveSuccess(): PanelWriteResult {
  return {
    decision: "confirm",
    named: [],
    response: {
      kind: "dispatched",
      intentId: "save-intent",
      outcome: { kind: "success", data: {}, message: "Saved" },
    },
  };
}

function saveRefusal(): PanelWriteResult {
  return {
    decision: "confirm",
    named: [],
    response: {
      kind: "dispatched",
      intentId: "save-intent",
      outcome: { kind: "refusal", code: "VALIDATION_FAILED", message: "Invalid name" },
    },
  };
}

function makeInstance(
  manifest: PanelManifest,
  options: {
    initial?: Record<string, unknown>;
    confirmLeaveUnsaved?: () => Promise<boolean>;
    write?: ReturnType<typeof vi.fn<Parameters<PanelInstance["writeOperation"]>, ReturnType<PanelInstance["writeOperation"]>>>;
  } = {},
) {
  const base = createPanelInstance(manifest, {
    pageKey: "pack9-test",
    url: () => "/test",
    label: () => "Pack 9 Test",
    initial: options.initial as Record<string, never> | undefined,
    readProjection: async (id) => {
      throw new Error(`unexpected readProjection(${id})`);
    },
    text: (key: string) => key,
    operations: {
      describe: async () => { throw new Error("unexpected describe"); },
      prepare: async () => { throw new Error("unexpected prepare"); },
      read: async () => { throw new Error("unexpected read"); },
      cancel: async () => {},
      upload: async () => { throw new Error("unexpected upload"); },
    },
    confirmOperation: async () => { throw new Error("unexpected confirm"); },
    confirmLeaveUnsaved: options.confirmLeaveUnsaved,
  });
  const write = options.write
    ?? vi.fn<Parameters<PanelInstance["writeOperation"]>, ReturnType<PanelInstance["writeOperation"]>>()
      .mockResolvedValue(saveSuccess());
  const instance: PanelInstance = { ...base, writeOperation: write };
  return { instance, write };
}

function registerSimpleDirtyForm(
  instance: PanelInstance,
  slot: string,
  inputStateKeys: readonly string[],
  options: {
    initialDirty?: boolean;
    targetKey?: string;
    unsavedSwitchMode?: "discard-or-cancel" | "save-discard-cancel";
    saveResult?: boolean;
  } = {},
) {
  let isDirty = options.initialDirty ?? true;
  const discard = vi.fn(() => {
    isDirty = false;
  });
  const saveBeforeSwitch = vi.fn(async () => {
    if (options.saveResult === false) return false;
    isDirty = false;
    return true;
  });
  const unregister = instance.forms.register(slot, {
    handle: {
      fields: computed(() => []),
      values: computed(() => ({})),
      errors: computed(() => ({})),
      changed: computed(() => new Set<string>()),
      dirtyFields: computed(() => new Set<string>()),
      dirty: computed(() => isDirty),
      busy: computed(() => false),
      canSubmit: computed(() => isDirty),
      submitting: computed(() => false),
      set: () => {},
      submit: async () => ({}),
      reset: async () => { isDirty = false; return true; },
      refreshDraft: async () => {},
    },
    submit: async () => ({}),
    saveBeforeSwitch,
    unsavedSwitchMode: () => options.unsavedSwitchMode ?? "discard-or-cancel",
    dirty: () => isDirty,
    discard,
    editingTarget: () => ({ kind: "object", objectType, primaryKey: options.targetKey ?? "a" }),
    draft: {
      identity: () => `${slot}:${options.targetKey ?? "a"}`,
      inputStateKeys: () => inputStateKeys,
      capture: () => ({
        ownerOpened: formDescription("A"),
        ownerShown: formDescription("A"),
        values: { name: "Edited" },
        changed: new Set(["/name"]),
        submitted: new Set(["/name"]),
        invalid: {},
        errors: {},
        refusal: null,
        editedPaths: new Set(["/name"]),
        userEditedPaths: new Set(["/name"]),
        agentFilledPaths: new Set<string>(),
      }),
      restore: () => {
        isDirty = true;
      },
    },
  });
  return {
    setDirty: (next: boolean) => { isDirty = next; },
    isDirty: () => isDirty,
    discard,
    saveBeforeSwitch,
    unregister,
  };
}

describe("Pack 9: pre-mutation target-change guard in PanelInstance", () => {
  it("guards affected state changes before mutation with zero flicker on cancel, and commits unrelated keys synchronously", async () => {
    const manifest = panelManifestSchema.parse({
      state: {
        selected: { type: { kind: "object", objectType } },
        search: { type: { kind: "scalar", type: "string" } },
      },
      members: {
        form: { target: { projectionId: "p-form" }, inputs: { target: { state: "selected" } } },
      },
    });
    let resolveConfirm!: (value: boolean) => void;
    const confirmLeaveUnsaved = vi.fn(() => new Promise<boolean>((resolve) => { resolveConfirm = resolve; }));
    const { instance } = makeInstance(manifest, {
      initial: { selected: refOf("a"), search: "" },
      confirmLeaveUnsaved,
    });
    const form = registerSimpleDirtyForm(instance, "form", ["selected"]);

    // Unrelated key commits synchronously without prompting.
    expect(instance.state.set("search", "hello")).toBe(true);
    expect(instance.state.values.value.search).toBe("hello");
    expect(confirmLeaveUnsaved).not.toHaveBeenCalled();

    // Watch `selected` to prove zero flicker during confirmation and on cancel.
    const seenSelections: unknown[] = [];
    const stopWatch = watch(() => instance.state.values.value.selected, (val) => seenSelections.push(val), { flush: "sync" });

    const pendingCancel = instance.state.set("selected", refOf("b"));
    expect(pendingCancel).toBeInstanceOf(Promise);
    expect(confirmLeaveUnsaved).toHaveBeenCalledTimes(1);
    expect(instance.state.values.value.selected).toEqual(refOf("a"));
    expect(seenSelections).toEqual([]);

    resolveConfirm(false);
    await expect(pendingCancel).resolves.toBe(false);
    expect(instance.state.values.value.selected).toEqual(refOf("a"));
    expect(seenSelections).toEqual([]);
    expect(form.isDirty()).toBe(true);
    expect(form.discard).not.toHaveBeenCalled();

    // Auto source silently skips without prompting when it would affect a dirty form.
    await expect(instance.requestStateChange({ selected: refOf("b") }, { source: "auto" }))
      .resolves.toMatchObject({ ok: false, reason: "skipped_auto" });
    expect(confirmLeaveUnsaved).toHaveBeenCalledTimes(1);
    expect(instance.state.values.value.selected).toEqual(refOf("a"));

    // Confirming discards the draft and commits the new target.
    const pendingConfirm = instance.state.set("selected", refOf("b"));
    resolveConfirm(true);
    await expect(pendingConfirm).resolves.toBe(true);
    expect(form.discard).toHaveBeenCalledTimes(1);
    expect(form.isDirty()).toBe(false);
    expect(instance.state.values.value.selected).toEqual(refOf("b"));
    expect(seenSelections).toEqual([refOf("b")]);
    stopWatch();
  });

  it("prompts once when an atomic setState affects multiple dirty forms and settles both together", async () => {
    const manifest = panelManifestSchema.parse({
      state: {
        left: { type: { kind: "object", objectType } },
        right: { type: { kind: "object", objectType } },
      },
      members: {
        leftForm: { target: { projectionId: "p-left" }, inputs: { target: { state: "left" } } },
        rightForm: { target: { projectionId: "p-right" }, inputs: { target: { state: "right" } } },
      },
    });
    const confirmLeaveUnsaved = vi.fn<[], Promise<boolean>>();
    const { instance } = makeInstance(manifest, {
      initial: { left: refOf("a1"), right: refOf("b1") },
      confirmLeaveUnsaved,
    });
    const leftForm = registerSimpleDirtyForm(instance, "leftForm", ["left"], { targetKey: "a1" });
    const rightForm = registerSimpleDirtyForm(instance, "rightForm", ["right"], { targetKey: "b1" });

    // Cancel leaves both fields untouched and asks only once.
    confirmLeaveUnsaved.mockResolvedValueOnce(false);
    await expect(instance.state.setState({ left: refOf("a2"), right: refOf("b2") })).resolves.toBe(false);
    expect(confirmLeaveUnsaved).toHaveBeenCalledTimes(1);
    expect(instance.state.values.value).toEqual({ left: refOf("a1"), right: refOf("b1") });
    expect(leftForm.isDirty()).toBe(true);
    expect(rightForm.isDirty()).toBe(true);

    // Confirm discards both and updates both atomically with one prompt.
    confirmLeaveUnsaved.mockResolvedValueOnce(true);
    await expect(instance.state.setState({ left: refOf("a2"), right: refOf("b2") })).resolves.toBe(true);
    expect(confirmLeaveUnsaved).toHaveBeenCalledTimes(2);
    expect(leftForm.discard).toHaveBeenCalledTimes(1);
    expect(rightForm.discard).toHaveBeenCalledTimes(1);
    expect(instance.state.values.value).toEqual({ left: refOf("a2"), right: refOf("b2") });
  });

  it("supports three-state save-discard-cancel confirmation and aborts switch when save fails", async () => {
    const manifest = panelManifestSchema.parse({
      state: { selected: { type: { kind: "object", objectType } } },
      members: { form: { target: { projectionId: "p-form" }, inputs: { target: { state: "selected" } } } },
    });
    const switchSpy = vi.spyOn(platformShell, "confirmUnsavedSwitch");
    try {
      const { instance } = makeInstance(manifest, { initial: { selected: refOf("a") } });
      const failingForm = registerSimpleDirtyForm(instance, "form", ["selected"], {
        unsavedSwitchMode: "save-discard-cancel",
        saveResult: false,
      });

      switchSpy.mockResolvedValueOnce("save");
      await expect(instance.state.set("selected", refOf("b"))).resolves.toBe(false);
      expect(failingForm.saveBeforeSwitch).toHaveBeenCalledTimes(1);
      expect(instance.state.values.value.selected).toEqual(refOf("a"));
      expect(failingForm.isDirty()).toBe(true);

      // Re-register with succeeding save.
      failingForm.unregister();
      instance.forms.discard("form");
      const savingForm = registerSimpleDirtyForm(instance, "form", ["selected"], {
        unsavedSwitchMode: "save-discard-cancel",
        saveResult: true,
      });
      switchSpy.mockResolvedValueOnce("save");
      await expect(instance.state.set("selected", refOf("b"))).resolves.toBe(true);
      expect(savingForm.saveBeforeSwitch).toHaveBeenCalledTimes(1);
      expect(savingForm.discard).not.toHaveBeenCalled();
      expect(instance.state.values.value.selected).toEqual(refOf("b"));
    } finally {
      switchSpy.mockRestore();
    }
  });

  it("guards hidden (tab-stashed) dirty drafts and preserves them when cancelled", async () => {
    const manifest = panelManifestSchema.parse({
      state: {
        selected: { type: { kind: "object", objectType } },
        tab: { type: { kind: "scalar", type: "string" } },
      },
      members: {
        form: { target: { projectionId: "p-form" }, inputs: { target: { state: "selected" } } },
      },
    });
    const confirmLeaveUnsaved = vi.fn<[], Promise<boolean>>();
    const { instance } = makeInstance(manifest, {
      initial: { selected: refOf("a"), tab: "basic" },
      confirmLeaveUnsaved,
    });
    const form = registerSimpleDirtyForm(instance, "form", ["selected"]);

    // Switching tabs is unrelated to `selected`: commits synchronously; form unmounts and stashes its draft.
    expect(instance.state.set("tab", "advanced")).toBe(true);
    form.unregister();
    expect(instance.forms.hasStashedDraft("form")).toBe(true);
    expect(instance.dirty()).toBe(true);

    // Changing `selected` while the form is hidden still prompts and protects the stashed draft.
    confirmLeaveUnsaved.mockResolvedValueOnce(false);
    await expect(instance.state.set("selected", refOf("b"))).resolves.toBe(false);
    expect(confirmLeaveUnsaved).toHaveBeenCalledTimes(1);
    expect(instance.state.values.value.selected).toEqual(refOf("a"));
    expect(instance.forms.hasStashedDraft("form")).toBe(true);

    // Returning to the original tab can consume the preserved stashed draft.
    const stashed = instance.forms.takeStashedDraft("form", "form:a");
    expect(stashed).toBeDefined();
    expect(instance.forms.hasStashedDraft("form")).toBe(false);
  });

  it("blocks agent state writes without opening human dialogs and returns structured blockedForms", async () => {
    const manifest = panelManifestSchema.parse({
      state: {
        selected: { type: { kind: "object", objectType } },
        tab: { type: { kind: "scalar", type: "string" } },
      },
      members: {
        form: { target: { projectionId: "p-form" }, inputs: { target: { state: "selected" } } },
      },
    });
    const confirmLeaveUnsaved = vi.fn(async () => true);
    const { instance } = makeInstance(manifest, {
      initial: { selected: refOf("a"), tab: "overview" },
      confirmLeaveUnsaved,
    });
    registerSimpleDirtyForm(instance, "form", ["selected"], { targetKey: "a" });

    // Agent changing an unrelated state field succeeds.
    expect(await instance.checkAgentStateChange({ tab: "history" })).toEqual({ ok: true });
    await expect(instance.requestStateChange({ tab: "history" }, { source: "agent" }))
      .resolves.toEqual({ ok: true, changed: true });
    expect(instance.state.values.value.tab).toBe("history");

    // Agent changing `selected` is blocked without invoking human confirmLeaveUnsaved.
    const check = await instance.checkAgentStateChange({ selected: refOf("b") });
    expect(check).toEqual({
      ok: false,
      blockedForms: [
        { member: "form", target: { kind: "object", objectType, primaryKey: "a" } },
      ],
    });
    await expect(instance.requestStateChange({ selected: refOf("b") }, { source: "agent" }))
      .resolves.toMatchObject({ ok: false, reason: "blocked_unsaved" });
    expect(instance.state.values.value.selected).toEqual(refOf("a"));
    expect(confirmLeaveUnsaved).not.toHaveBeenCalled();
  });

  it("tracks bindInputState and indirect output->input dependencies as well as nested panel forms", async () => {
    const manifest = panelManifestSchema.parse({
      state: {
        mode: { type: { kind: "scalar", type: "string" } },
        filter: { type: { kind: "scalar", type: "string" } },
        childTarget: { type: { kind: "object", objectType } },
      },
      members: {
        source: { target: { projectionId: "p-source" }, inputs: { filter: { state: "filter" } } },
        form: { target: { projectionId: "p-form" }, inputs: { upstream: { output: { member: "source", name: "selected" } } } },
        nested: { target: { panelId: "child-panel" }, inputs: { target: { state: "childTarget" } } },
      },
    });
    const confirmLeaveUnsaved = vi.fn(async () => false);
    const { instance } = makeInstance(manifest, {
      initial: { mode: "edit", filter: "active", childTarget: refOf("c1") },
      confirmLeaveUnsaved,
    });
    registerSimpleDirtyForm(instance, "form", []);
    instance.forms.bindInputState("form", "mode");

    // Explicit bindInputState catches `mode`.
    await expect(instance.state.set("mode", "create")).resolves.toBe(false);
    expect(confirmLeaveUnsaved).toHaveBeenCalledTimes(1);
    expect(instance.state.values.value.mode).toBe("edit");

    // Indirect `filter` -> `source` output -> `form` input dependency catches `filter`.
    await expect(instance.state.set("filter", "archived")).resolves.toBe(false);
    expect(confirmLeaveUnsaved).toHaveBeenCalledTimes(2);
    expect(instance.state.values.value.filter).toBe("active");

    // Nested panel dirty form catches parent state mapped into nested member's `inputs`.
    const childDiscard = vi.fn();
    let childDirty = true;
    instance.publish("nested", computed(() => ({
      instanceId: "child-instance-1",
      context: { url: "/child", label: "Child", state: {}, selection: [] },
      operations: [],
      dirty: () => childDirty,
      discardAll: () => { childDirty = false; childDiscard(); },
      formRegistries: () => [],
      findAffectedDirtyForms: (changedKeys) => {
        if (!childDirty || !changedKeys.has("target")) return [];
        return [{
          memberPath: ["nested", "childForm"],
          entry: {
            slot: "childForm",
            mounted: true,
            inputStateKeys: ["target"],
            editingTarget: { kind: "object", objectType, primaryKey: "c1" },
            unsavedSwitchMode: "discard-or-cancel",
            stillDirty: () => childDirty,
            discard: () => { childDirty = false; childDiscard(); },
          },
        }];
      },
      allDirtyForms: () => [],
    })));
    await expect(instance.state.set("childTarget", refOf("c2"))).resolves.toBe(false);
    expect(confirmLeaveUnsaved).toHaveBeenCalledTimes(3);
    expect(instance.state.values.value.childTarget).toEqual(refOf("c1"));
  });

  it("defers ObjectList update:selected and choose until dirty ObjectForm switch confirmation resolves", async () => {
    const manifest = panelManifestSchema.parse({
      state: { selected: { type: { kind: "object", objectType } } },
      members: {
        list: { target: { projectionId: "p-list" }, inputs: { selected: { state: "selected" } } },
        form: { target: { projectionId: "p-form" }, inputs: { target: { state: "selected" } } },
      },
    });
    const listProjection: ProductProjection = {
      id: "p-list", name: "Customers", description: "", visibility: "domain",
      domainId: "d", ownerId: "o", editable: true, revision: 1, createdAt: "", updatedAt: "",
      componentId: "@ontomato/sdk:ObjectList",
      inputs: { selected: { kind: "object", objectType } },
      outputs: {},
      config: {},
      data: {
        rows: { read: "list", source: { type: { kind: "ObjectType", id: objectType } }, params: {} },
      },
    };
    const saveOp: PanelOwnerOperationDescriptor = {
      kind: "action", handlerRef: "actions.execute", effect: "write", target: { source: "input", input: "target" },
      batch: false, label: "Save", inputSchema: { type: "object", properties: { values: { type: "object", properties: { name: {} } } } },
      resultSchema: {},
    };
    const formProjection: ProductProjection = {
      id: "p-form", name: "Customer form", description: "", visibility: "domain",
      domainId: "d", ownerId: "o", editable: true, revision: 1, createdAt: "", updatedAt: "",
      componentId: "@ontomato/sdk:ObjectForm",
      inputs: { target: { kind: "object", objectType } },
      outputs: {},
      config: {},
      data: {
        form: { read: "form", source: { object: { input: "target" } }, params: {} },
      },
      operations: {
        save: { operation: { kind: "Action", id: "save-customer" }, target: { input: "target" } },
      },
    };

    const confirmLeaveUnsaved = vi.fn<[], Promise<boolean>>();
    const { instance } = makeInstance(manifest, {
      initial: { selected: refOf("a") },
      confirmLeaveUnsaved,
      write: vi.fn<Parameters<PanelInstance["writeOperation"]>, ReturnType<PanelInstance["writeOperation"]>>()
        .mockResolvedValue(saveRefusal()),
    });
    const panel = {
      instance,
      manifest,
      notify: vi.fn(),
      navigate: vi.fn(async () => {}),
      confirmLeaveUnsaved,
    } as unknown as PanelContext;

    const rows = [
      { className: objectType, primaryKey: "a", label: "Alpha", fields: {} },
      { className: objectType, primaryKey: "b", label: "Beta", fields: {} },
    ];
    const listMember: PanelMemberContext = {
      key: "list",
      projection: listProjection,
      inputs: computed(() => ({ selected: instance.state.values.value.selected })),
      operations: computed(() => ({ status: "ready", value: {} })),
      data: {
        read: async () => ({ status: "ready", value: rows }),
        use: () => computed(() => ({ status: "ready", value: rows })),
      },
    };
    const formOperations = shallowRef<MemberOperationsState>({ status: "ready", value: { save: saveOp } });
    const formMember: PanelMemberContext = {
      key: "form",
      projection: formProjection,
      inputs: computed(() => ({ target: instance.state.values.value.selected })),
      operations: computed(() => formOperations.value),
      data: {
        read: async () => ({
          status: "ready",
          value: formDescription(
            (instance.state.values.value.selected as { primaryKey: string } | null)?.primaryKey === "b" ? "Beta" : "Alpha",
          ),
        }),
        use: () => computed(() => ({ status: "awaiting" })),
      },
    };

    const chosen: unknown[] = [];
    const updated: unknown[] = [];
    const Host = defineComponent({
      setup() {
        return () => h("div", [
          h(defineComponent({
            provide: {
              [panelMemberKey as symbol]: () => listMember,
              [projectionKey as symbol]: { slot: "list", projection: listProjection, inputs: {} },
            },
            setup: () => () => h(ObjectList, {
              layout: "list",
              onChoose: (val: unknown) => chosen.push(val),
              "onUpdate:selected": (val: unknown) => updated.push(val),
            }),
          })),
          h(defineComponent({
            provide: {
              [panelMemberKey as symbol]: () => formMember,
              [projectionKey as symbol]: { slot: "form", projection: formProjection, inputs: {} },
            },
            setup: () => () => h(ObjectForm, {}, { default: () => "Form body" }),
          })),
        ]);
      },
    });

    const wrapper = mount(Host, {
      global: {
        plugins: [createI18n({ legacy: false, locale: "en", missingWarn: false, fallbackWarn: false })],
        provide: { [panelContextKey]: panel },
      },
    });
    await flushPromises();

    // Edit the form so it becomes dirty on Alpha.
    const formHandle = instance.forms.handle("form")!;
    formHandle.set("/name", "Alpha edited");
    await nextTick();
    expect(formHandle.dirty.value).toBe(true);

    // Click Beta row and cancel: state stays on Alpha, choose and update:selected do NOT fire.
    confirmLeaveUnsaved.mockResolvedValueOnce(false);
    const items = wrapper.findAll(".sdk-object-list-item-btn");
    const betaItem = items.find((el) => el.text().includes("Beta"))!;
    expect(betaItem).toBeTruthy();
    await betaItem.trigger("click");
    await flushPromises();
    expect(confirmLeaveUnsaved).toHaveBeenCalledTimes(1);
    expect(instance.state.values.value.selected).toEqual(refOf("a"));
    expect(chosen).toEqual([]);
    expect(updated).toEqual([]);
    expect(formHandle.values.value.name).toBe("Alpha edited");

    // Click Beta row and confirm: draft is discarded, state switches to Beta, choose and update:selected fire.
    confirmLeaveUnsaved.mockResolvedValueOnce(true);
    await betaItem.trigger("click");
    await flushPromises();
    expect(confirmLeaveUnsaved).toHaveBeenCalledTimes(2);
    expect(instance.state.values.value.selected).toEqual(refOf("b"));
    expect(chosen).toEqual([refOf("b")]);
    expect(updated).toEqual([refOf("b")]);
    expect(formHandle.values.value.name).toBe("Beta");
    expect(formHandle.dirty.value).toBe(false);
    wrapper.unmount();
  });
});
