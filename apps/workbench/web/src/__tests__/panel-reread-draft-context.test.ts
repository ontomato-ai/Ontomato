import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { computed, createApp, defineComponent, effectScope, h, nextTick, provide, ref } from "vue";
import { ElMessageBox } from "element-plus";
import { definePanel } from "@ontomato/contracts/panel-manifest";
import type { DirectProjection } from "@ontomato/contracts/product-panels";
import type { ProductPanelReadResponse } from "@ontomato/contracts/panel-host";
import { createDirectPanelInstance, directPanelContext, type PanelReadPort } from "../../../../../packages/apps-sdk/src/panel/direct";
import { frameMemberData } from "../../../../../packages/apps-sdk/src/panel/frame-member";
import { panelContextKey } from "../../../../../packages/apps-sdk/src/panel/context";
import { createPanelInstance } from "../../../../../packages/apps-sdk/src/panel/instance";
import { listRowSlotKey } from "../../../../../packages/apps-sdk/src/panel/slot-context";
import {
  computeDraftBaselineHash,
  createMemoryLocalDraftStore,
  objectDraftKey,
  stripSecretDraftValues,
  typeDraftKey,
} from "../../../../../packages/apps-sdk/src/panel/local-drafts";
import { usePanelFormDraft } from "../../../../../packages/apps-sdk/src/panel/form-draft";
import Projection from "../../../../../packages/apps-sdk/src/panel/Projection.vue";

const RUN_TYPE = "platform:Trigger";

const runProjection: DirectProjection = {
  id: "proj-run-status",
  domainId: "domain-1",
  ownerId: "user-1",
  editable: true,
  name: "Run status",
  description: "",
  visibility: "domain",
  componentId: "@ontomato/sdk:ObjectList",
  inputs: {},
  outputs: {},
  config: {},
  operations: {},
  data: {
    status: {
      source: { type: { kind: "PlatformObjectType", id: RUN_TYPE } },
      read: "list",
      params: {},
    },
  },
  revision: 1,
  createdAt: "2026-11-25T00:00:00.000Z",
  updatedAt: "2026-11-25T00:00:00.000Z",
};

function listValue(step: number, phase = "running") {
  return [{
    primaryKey: "run-1",
    label: "Run 1",
    fields: { phase, step },
  }];
}

const runManifest = definePanel({
  state: {},
  members: {
    runs: { target: { projectionId: runProjection.id } },
  },
});

const text = Object.assign((key: string) => key, {
  locale: ref("en"),
});

const noOperations = {
  operations: {
    describe: async () => { throw new Error("unused"); },
    prepare: async () => { throw new Error("unused"); },
    execute: async () => { throw new Error("unused"); },
    read: async () => { throw new Error("unused"); },
    upload: async () => { throw new Error("unused"); },
  },
  confirmOperation: async () => { throw new Error("unused"); },
};

async function flushPromises() {
  for (let i = 0; i < 6; i += 1) {
    await Promise.resolve();
  }
  await nextTick();
}

function mountComponent(component: ReturnType<typeof defineComponent>) {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const app = createApp(component);
  app.mount(host);
  return {
    unmount() {
      app.unmount();
      host.remove();
    },
  };
}

function setVisibilityState(state: "visible" | "hidden") {
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    get: () => state,
  });
  document.dispatchEvent(new Event("visibilitychange"));
}

describe("Gap 1: platform auto-reread scheduling (rereadAfterMs)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    setVisibilityState("visible");
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    setVisibilityState("visible");
  });

  it("rereads silently on rereadAfterMs, stops on terminal state, pauses on hidden/inactive, resumes on visible/active, and cleans up on dispose", async () => {
    const responses: ProductPanelReadResponse[] = [
      { status: "ready", value: listValue(1) as never, rereadAfterMs: 2000 },
      { status: "ready", value: listValue(2) as never, rereadAfterMs: 2000 },
      { status: "ready", value: listValue(3) as never, rereadAfterMs: 2000 },
      { status: "ready", value: listValue(4, "done") as never },
    ];
    let callCount = 0;
    const read = vi.fn<Parameters<PanelReadPort>, ReturnType<PanelReadPort>>(async () => {
      const next = responses[Math.min(callCount, responses.length - 1)]!;
      callCount += 1;
      return next;
    });

    const instance = createDirectPanelInstance(runManifest, {
      pageKey: "runs-page",
      url: () => "/runs",
      label: () => "Runs",
      initial: {},
      text,
      readProjection: async () => runProjection,
      read,
      ...noOperations,
      translate: (key) => key,
      expandPageComposer: () => {},
      navigate: async () => {},
      nested: async () => { throw new Error("unused"); },
      readComponentPackage: async () => { throw new Error("unused"); },
    });

    const placing = await instance.placing("runs");
    if (placing.kind !== "projection") throw new Error("expected projection placing");
    const statuses: string[] = [];
    const scope = effectScope();
    const datum = scope.run(() => placing.context.data.use("status"))!;

    await flushPromises();
    expect(read).toHaveBeenCalledTimes(1);
    expect(datum.value).toMatchObject({ status: "ready", value: listValue(1), rereadAfterMs: 2000 });

    // Advance 2s -> triggers silent reread (status stays ready while in-flight, never flashes loading).
    vi.advanceTimersByTime(2000);
    statuses.push(datum.value.status);
    await flushPromises();
    expect(statuses).toEqual(["ready"]);
    expect(read).toHaveBeenCalledTimes(2);
    expect(datum.value).toMatchObject({ status: "ready", value: listValue(2), rereadAfterMs: 2000 });

    // Background tab pauses timer; advancing 10s must NOT trigger reread.
    setVisibilityState("hidden");
    vi.advanceTimersByTime(10_000);
    await flushPromises();
    expect(read).toHaveBeenCalledTimes(2);

    // Returning to foreground immediately rereads to resume tracking.
    setVisibilityState("visible");
    await flushPromises();
    expect(read).toHaveBeenCalledTimes(3);
    expect(datum.value).toMatchObject({ status: "ready", value: listValue(3), rereadAfterMs: 2000 });

    // Deactivating panel pauses timer; reactivating immediately resumes.
    instance.setActive(false);
    vi.advanceTimersByTime(10_000);
    await flushPromises();
    expect(read).toHaveBeenCalledTimes(3);

    instance.setActive(true);
    await flushPromises();
    expect(read).toHaveBeenCalledTimes(4);
    expect(datum.value).toMatchObject({ status: "ready", value: listValue(4, "done") });

    // Terminal state has no rereadAfterMs -> advancing time triggers nothing further.
    vi.advanceTimersByTime(10_000);
    await flushPromises();
    expect(read).toHaveBeenCalledTimes(4);

    scope.stop();
  });

  it("stops auto-reread on error and clears pending timers on scope dispose", async () => {
    let calls = 0;
    const read = vi.fn(async (): Promise<ProductPanelReadResponse> => {
      calls += 1;
      if (calls === 1) return { status: "ready", value: listValue(1) as never, rereadAfterMs: 1500 };
      return { status: "error", message: "Backend unavailable" };
    });

    const instance = createDirectPanelInstance(runManifest, {
      pageKey: "runs-page",
      url: () => "/runs",
      label: () => "Runs",
      initial: {},
      text,
      readProjection: async () => runProjection,
      read,
      ...noOperations,
      translate: (key) => key,
      expandPageComposer: () => {},
      navigate: async () => {},
      nested: async () => { throw new Error("unused"); },
      readComponentPackage: async () => { throw new Error("unused"); },
    });

    const placing = await instance.placing("runs");
    if (placing.kind !== "projection") throw new Error("expected projection placing");
    const scope = effectScope();
    const datum = scope.run(() => placing.context.data.use("status"))!;
    await flushPromises();
    expect(read).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(1500);
    await flushPromises();
    expect(read).toHaveBeenCalledTimes(2);
    expect(datum.value.status).toBe("error");

    // Error stops automatic reread; advancing time does not retry automatically.
    vi.advanceTimersByTime(10_000);
    await flushPromises();
    expect(read).toHaveBeenCalledTimes(2);

    scope.stop();
  });

  it("schedules auto-reread in frameMemberData and cancels timer on scope dispose", async () => {
    const read = vi.fn(async (): Promise<ProductPanelReadResponse> => ({
      status: "ready",
      value: listValue(1) as never,
      rereadAfterMs: 1000,
    }));
    const baseInstance = createPanelInstance(runManifest, {
      pageKey: "frame-runs",
      url: () => "/runs",
      label: () => "Runs",
      initial: {},
      text,
      readProjection: async () => runProjection,
      ...noOperations,
    });
    const scope = effectScope();
    const data = scope.run(() => frameMemberData(runProjection, "runs", baseInstance, () => ({}), read))!;
    const state = scope.run(() => data.use("status"))!;
    await flushPromises();
    expect(read).toHaveBeenCalledTimes(1);
    expect(state.value.status).toBe("ready");

    vi.advanceTimersByTime(1000);
    await flushPromises();
    expect(read).toHaveBeenCalledTimes(2);

    scope.stop();
    vi.advanceTimersByTime(10_000);
    await flushPromises();
    expect(read).toHaveBeenCalledTimes(2);
  });
});

describe("Gap 2 & Gap 4: local drafts helpers, PanelContext.hasLocalDraft, and currentUser", () => {
  it("computes stable baseline hashes and strips nested/array secret paths without mutating input", () => {
    const hashA = computeDraftBaselineHash({ b: 2, a: { y: true, x: "hi" } });
    const hashB = computeDraftBaselineHash({ a: { x: "hi", y: true }, b: 2 });
    expect(hashA).toBe(hashB);

    const original = {
      name: "Conn",
      apiKey: "secret-top",
      auth: { password: "secret-nested", mode: "basic" },
      headers: [
        { key: "X-Token", token: "secret-0" },
        { key: "X-Other", token: "secret-1" },
      ],
    };
    const sanitized = stripSecretDraftValues(original, ["apiKey", "auth.password", "headers[].token"]);
    expect(sanitized).toEqual({
      name: "Conn",
      auth: { mode: "basic" },
      headers: [{ key: "X-Token" }, { key: "X-Other" }],
    });
    // JSON Pointer paths (including wildcard array segments) are stripped identically.
    expect(stripSecretDraftValues(original, ["/apiKey", "/auth/password", "/headers/*/token"])).toEqual({
      name: "Conn",
      auth: { mode: "basic" },
      headers: [{ key: "X-Token" }, { key: "X-Other" }],
    });
    // Original object must remain untouched.
    expect(original.apiKey).toBe("secret-top");
    expect(original.auth.password).toBe("secret-nested");
    expect(original.headers[0]!.token).toBe("secret-0");
  });

  it("exposes reactive hasLocalDraft(ref) and currentUser on DirectPanelInstance and PanelContext", () => {
    const store = createMemoryLocalDraftStore();
    const userName = ref<string | null>("  Bob Chen  ");
    const instance = createDirectPanelInstance(runManifest, {
      pageKey: "draft-page",
      url: () => "/drafts",
      label: () => "Drafts",
      initial: {},
      text,
      readProjection: async () => runProjection,
      read: async () => ({ status: "ready", value: {} as never }),
      ...noOperations,
      translate: (key) => key,
      expandPageComposer: () => {},
      navigate: async () => {},
      nested: async () => { throw new Error("unused"); },
      readComponentPackage: async () => { throw new Error("unused"); },
      localDrafts: store,
      currentUser: () => (userName.value ? { displayName: userName.value } : null),
    });

    const context = directPanelContext(instance);
    expect(context.currentUser.value).toEqual({ displayName: "Bob Chen" });
    userName.value = "   ";
    expect(context.currentUser.value).toBeNull();

    const hasDraft = computed(() => context.hasLocalDraft({ className: "demo:Task", primaryKey: "t-1" }));
    expect(hasDraft.value).toBe(false);

    const formKey = objectDraftKey("demo:Task", "t-1", "proj-edit");
    const createKey = typeDraftKey("demo:Task", "proj-create");
    expect(formKey).toBe("object:demo:Task:t-1:proj-edit");
    expect(createKey).toBe("form:demo:Task:proj-create");

    store.write(formKey, { values: { title: "Edited" }, baselineHash: "h1", updatedAt: 1 });
    expect(hasDraft.value).toBe(true);

    store.remove(formKey);
    expect(hasDraft.value).toBe(false);
  });
});

describe("Gap 5 precondition: Projection.vue row-scoped isolation", () => {
  it("does not overwrite top-level panel.instance.register when mounted inside listRowSlotKey", async () => {
    const baseInstance = createPanelInstance(runManifest, {
      pageKey: "list-page",
      url: () => "/list",
      label: () => "List",
      initial: {},
      text,
      readProjection: async () => runProjection,
      ...noOperations,
    });
    const registerSpy = vi.spyOn(baseInstance, "register");

    const wrapper = mountComponent(defineComponent({
      setup() {
        provide(panelContextKey, {
          panel: { content: { html: "", module: "" }, manifest: runManifest },
          manifest: runManifest,
          instance: baseInstance,
          projection: async () => runProjection,
          invoke: async () => null,
          resources: async () => {},
          readPanelData: async () => ({ status: "ready", value: {} as never }),
          projectionsChanged: () => () => {},
          t: (k) => k,
          navigate: async () => {},
          navigateBack: async () => {},
          notify: () => {},
          holdUnsaved: () => () => {},
          expandPageComposer: async () => {},
          currentEntry: computed(() => null),
          entryMenu: computed(() => null),
          currentUser: computed(() => null),
          hasLocalDraft: () => false,
        });
        provide(listRowSlotKey, {
          listSlot: "runs",
          ref: computed(() => ({ className: RUN_TYPE, primaryKey: "r-1" })),
          itemKey: computed(() => ({ className: RUN_TYPE, primaryKey: "r-1" })),
          index: computed(() => 0),
          operations: computed(() => ({})),
          runOperation: async () => {},
        });
        return () => h(Projection, { slot: "runs" });
      },
    }));

    await flushPromises();
    expect(registerSpy).not.toHaveBeenCalled();
    wrapper.unmount();
  });
});

describe("D5-2: PanelInstance three-state save-discard-cancel switch guard", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("handles save (proceed only on success), discard (reset without confirm), and cancel", async () => {
    const switchManifest = definePanel({
      state: { selected: { type: { kind: "scalar", type: "string" } } },
      members: { edit: { target: { projectionId: runProjection.id }, inputs: { target: { state: "selected" } } } },
    });
    const baseInstance = createPanelInstance(switchManifest, {
      pageKey: "form-page",
      url: () => "/form",
      label: () => "Form",
      initial: { selected: "item-1" },
      text,
      readProjection: async () => runProjection,
      ...noOperations,
    });
    const dirty = ref(true);
    const submit = vi.fn(async () => {
      dirty.value = false;
      return true as unknown;
    });
    const reset = vi.fn(async (_opts?: { confirm?: boolean }) => {
      dirty.value = false;
      return true;
    });
    baseInstance.forms.register("edit", {
      dirty: () => dirty.value,
      unsavedSwitchMode: () => "save-discard-cancel",
      submit,
      discard: () => { void reset({ confirm: false }); },
      editingTarget: () => null,
      fill: async () => ({ ok: false, reason: "form_not_ready", message: "none" }),
      draft: {
        identity: () => "edit:1",
        inputStateKeys: () => ["selected"],
        capture: () => null,
        restore: () => {},
      },
      handle: {
        dirty: computed(() => dirty.value),
        submitting: computed(() => false),
        canSubmit: computed(() => true),
        submit,
        reset,
        refreshDraft: async () => {},
      } as never,
    });

    let controlsRef!: ReturnType<typeof usePanelFormDraft>;
    const Child = defineComponent({
      setup() {
        controlsRef = usePanelFormDraft("edit");
        return () => h("div");
      },
    });
    const wrapper = mountComponent(defineComponent({
      setup() {
        provide(panelContextKey, {
          panel: { content: { html: "", module: "" }, manifest: switchManifest },
          manifest: switchManifest,
          instance: baseInstance,
          projection: async () => runProjection,
          invoke: async () => null,
          resources: async () => {},
          readPanelData: async () => ({ status: "ready", value: {} as never }),
          projectionsChanged: () => () => {},
          t: (k) => k,
          navigate: async () => {},
          navigateBack: async () => {},
          notify: () => {},
          holdUnsaved: () => () => {},
          expandPageComposer: async () => {},
          currentEntry: computed(() => null),
          entryMenu: computed(() => null),
          currentUser: computed(() => null),
          hasLocalDraft: () => false,
        });
        return () => h(Child);
      },
    }));

    expect(controlsRef.value?.dirty).toBe(true);
    const confirmSpy = vi.spyOn(ElMessageBox, "confirm");

    // 1) Save succeeds -> proceeds and commits new state
    confirmSpy.mockResolvedValueOnce("confirm" as never);
    await expect(baseInstance.state.set("selected", "item-2")).resolves.toBe(true);
    expect(submit).toHaveBeenCalledTimes(1);
    expect(baseInstance.state.values.value.selected).toBe("item-2");

    // 2) Save fails (returns null) -> aborts switch and keeps state
    dirty.value = true;
    submit.mockResolvedValueOnce(null);
    confirmSpy.mockResolvedValueOnce("confirm" as never);
    await expect(baseInstance.state.set("selected", "item-3")).resolves.toBe(false);
    expect(baseInstance.state.values.value.selected).toBe("item-2");

    // 3) Discard -> calls reset({ confirm: false }) and proceeds
    confirmSpy.mockRejectedValueOnce("cancel");
    await expect(baseInstance.state.set("selected", "item-3")).resolves.toBe(true);
    expect(reset).toHaveBeenCalledWith({ confirm: false });
    expect(baseInstance.state.values.value.selected).toBe("item-3");

    // 4) Close/Esc -> aborts without submit or reset
    dirty.value = true;
    confirmSpy.mockRejectedValueOnce("close");
    await expect(baseInstance.state.set("selected", "item-4")).resolves.toBe(false);
    expect(baseInstance.state.values.value.selected).toBe("item-3");

    // 5) Not dirty -> proceeds immediately without prompting
    dirty.value = false;
    await nextTick();
    expect(baseInstance.state.set("selected", "item-4")).toBe(true);
    expect(baseInstance.state.values.value.selected).toBe("item-4");
    expect(confirmSpy).toHaveBeenCalledTimes(4);

    wrapper.unmount();
  });
});
