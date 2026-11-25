import { flushPromises, mount } from "@vue/test-utils";
import { computed, defineComponent, h, nextTick, ref, shallowRef, type Ref } from "vue";
import { createI18n } from "vue-i18n";
import { describe, expect, it, vi } from "vitest";
import { panelManifestSchema } from "@ontomato/contracts/panel-manifest";
import type { PanelOwnerOperationDescriptor, PanelReadOperationResult } from "@ontomato/contracts/panel-operations";
import type { PanelObjectListRowActions } from "@ontomato/contracts/panel-projection";
import type { ProductProjection } from "@ontomato/contracts/product-panels";
import { curatedIcon } from "@ontomato/platform-shell";
import ObjectList from "../../../apps-sdk/src/base/ObjectList.vue";
import ObjectSummary from "../../../apps-sdk/src/base/ObjectSummary.vue";
import ObjectTitle from "../../../apps-sdk/src/base/ObjectTitle.vue";
import OperationButton from "../../../apps-sdk/src/base/OperationButton.vue";
import type { ObjectListStateSnapshot } from "../../../apps-sdk/src/base/object-list-types";
import { createSdkOverlay } from "../../../apps-sdk/src/ui/SdkOverlay";
import { panelContextKey, projectionKey, type PanelContext } from "../../../apps-sdk/src/panel/context";
import { PanelFormAdapters } from "../../../apps-sdk/src/panel/forms";
import { createPanelInstance, type PanelInstance, type PanelWriteResult } from "../../../apps-sdk/src/panel/instance";
import { panelMemberKey, type PanelMemberContext } from "../../../apps-sdk/src/panel/member";
import type { MemberOperationsState } from "../../../apps-sdk/src/panel/member-operations";
import type { PlatformObjectRecord } from "../../../apps-sdk/src/panel/platform-objects";
import { createPanelState } from "../../../apps-sdk/src/panel/state";

type MemberDataState = Awaited<ReturnType<PanelMemberContext["data"]["read"]>>;

const APP_TYPE = "platform:Application";
const AGENT_TYPE = "platform:AgentDefinition";
const TOOL_TYPE = "platform:McpTool";

function createTestI18n() {
  return createI18n({
    legacy: false,
    locale: "en",
    missingWarn: false,
    fallbackWarn: false,
    messages: {
      en: {
        common: { copy: "Copy", copied: "Copied", more: "More" },
        platform: {
          dataEmpty: "No data",
          dataUnreachable: "Service unreachable",
          dataNoMatch: "No matches",
          readerLoading: "Loading...",
          retry: "Retry",
          listSelectAll: "Select all",
          listClearFilters: "Clear filters",
        },
        gallery: {
          pin: "Pin",
          askAgent: "Ask agent",
          askPrompt: "Inspect {label} ({primaryKey})",
          probe: "Test connection",
          delete: "Delete",
          edit: "Edit",
          refresh: "Refresh",
          fallbackTitle: "Untitled resource",
          schemaLabel: "Input Schema",
        },
      },
    },
  });
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function writeSuccess(message = "Done"): PanelWriteResult {
  return {
    decision: "confirm",
    named: [],
    response: {
      kind: "dispatched",
      intentId: "intent-1",
      outcome: { kind: "success", data: {}, message },
    },
  };
}

function readSuccess(value: Record<string, unknown> = { reachable: true }): PanelReadOperationResult {
  return {
    kind: "json",
    value: value as never,
  };
}

interface MountListOptions {
  slotKey?: string;
  objectType?: string;
  props?: Record<string, unknown>;
  slots?: Record<string, (...args: unknown[]) => unknown>;
  datumState?: Ref<MemberDataState>;
  admittedOps?: Record<string, PanelOwnerOperationDescriptor>;
  declaredOps?: ProductProjection["operations"];
  writeOperation?: PanelInstance["writeOperation"];
  readOperation?: PanelInstance["readOperation"];
  expandPageComposer?: PanelContext["expandPageComposer"];
  refresh?: () => void;
  stateInit?: Record<string, unknown>;
  bindSelected?: boolean;
  sharedInstance?: PanelInstance;
}

function mountObjectList(options: MountListOptions = {}) {
  const slotKey = options.slotKey ?? "list";
  const objectType = options.objectType ?? APP_TYPE;
  const datumState = options.datumState ?? shallowRef<MemberDataState>({ status: "ready", value: [] });
  const writeOperation = options.writeOperation ?? vi.fn<Parameters<PanelInstance["writeOperation"]>, ReturnType<PanelInstance["writeOperation"]>>().mockResolvedValue(writeSuccess());
  const readOperation = options.readOperation ?? vi.fn<Parameters<PanelInstance["readOperation"]>, ReturnType<PanelInstance["readOperation"]>>().mockResolvedValue(readSuccess());
  const expandPageComposer = options.expandPageComposer ?? vi.fn<Parameters<PanelContext["expandPageComposer"]>, ReturnType<PanelContext["expandPageComposer"]>>().mockResolvedValue(undefined);
  const refresh = options.refresh ?? vi.fn();

  const projection: ProductProjection = {
    id: `${slotKey}-projection`,
    name: "Test list",
    description: "",
    visibility: "domain",
    domainId: "domain",
    ownerId: "owner",
    editable: true,
    revision: 1,
    createdAt: "",
    updatedAt: "",
    componentId: "@ontomato/sdk:ObjectList",
    inputs: {},
    outputs: options.bindSelected ? { selected: { kind: "object", objectType } } : {},
    config: {},
    data: {
      rows: { read: "list", source: { type: { kind: "PlatformObjectType", id: objectType } }, params: {} },
    },
    operations: options.declaredOps ?? {},
  };

  const manifest = panelManifestSchema.parse({
    state: options.bindSelected
      ? { selected: { type: { kind: "object", objectType } } }
      : {},
    members: {
      [slotKey]: {
        target: { projectionId: projection.id },
        ...(options.bindSelected ? { outputs: { selected: { state: "selected" } } } : {}),
      },
    },
  });

  const state = createPanelState(manifest, (options.stateInit ?? {}) as never);
  const forms = new PanelFormAdapters();
  const namedObjects = new Map<string, string>();
  const memberParams = new Map<string, Ref<unknown>>();
  const memberOutputStore = ref<Record<string, Record<string, unknown>>>({});
  const instance = options.sharedInstance ?? ({
    instanceId: `inst-${slotKey}-${Math.random().toString(36).slice(2, 8)}`,
    isDisposed: () => false,
    manifest,
    state,
    forms,
    writeOperation,
    isObjectWriteInFlight: () => false,
    readOperation,
    onObjectChanged: () => () => {},
    onOperationCompleted: () => () => {},
    operationIdOf: (s: string, name: string) => `${s}.${name}`,
    memberPathOf: (m: string) => [{ member: m }],
    ownParams: () => ({}),
    output: (_m: string, name: string, value: unknown) => {
      if (options.bindSelected && name === "selected") {
        state.set("selected", value as never);
      }
    },
    memberParam: (m: string, name: string) => {
      const key = `${m}:${name}`;
      let store = memberParams.get(key);
      if (!store) {
        store = ref<unknown>(null);
        memberParams.set(key, store);
      }
      return {
        value: computed(() => store!.value),
        set(next: unknown) {
          store!.value = next;
          if (options.bindSelected && name === "selected") {
            state.set("selected", next as never);
          }
        },
      };
    },
    registerActionHandler: () => () => {},
    nameObjects: (className: string, records: readonly { primaryKey: string; label?: string }[]) => {
      for (const r of records) {
        if (r.label) namedObjects.set(`${className}:${r.primaryKey}`, r.label);
      }
    },
    nameChildObjects: () => {},
    objectName: (className: string, primaryKey: string) => namedObjects.get(`${className}:${primaryKey}`) ?? null,
    setMemberOutput: (s: string, name: string, value: unknown) => {
      memberOutputStore.value = {
        ...memberOutputStore.value,
        [s]: { ...(memberOutputStore.value[s] ?? {}), [name]: value },
      };
    },
    get outputs() {
      return memberOutputStore.value;
    },
  } as unknown as PanelInstance);

  const i18n = createTestI18n();
  const panel = {
    instance,
    manifest: options.sharedInstance?.manifest ?? manifest,
    notify: vi.fn(),
    navigate: vi.fn(),
    expandPageComposer,
    t: (key: string, params?: Record<string, unknown>) =>
      (i18n.global.te(key) ? (params ? i18n.global.t(key, params) : i18n.global.t(key)) : key),
  } as unknown as PanelContext;

  const operations = shallowRef<MemberOperationsState>({
    status: "ready",
    value: options.admittedOps ?? {},
  });

  const member: PanelMemberContext = {
    key: slotKey,
    projection,
    scoped: true,
    operations: computed(() => operations.value),
    inputs: computed(() => ({})),
    data: {
      read: async () => datumState.value,
      use: () => computed(() => datumState.value),
      refresh,
    },
  };

  const wrapper = mount(ObjectList, {
    props: options.props ?? {},
    slots: options.slots as never,
    global: {
      plugins: [i18n],
      provide: {
        [panelContextKey as symbol]: panel,
        [panelMemberKey as symbol]: () => member,
        [projectionKey as symbol]: { slot: slotKey, projection, inputs: {} },
      },
      stubs: {
        ElSkeleton: defineComponent({
          name: "ElSkeleton",
          props: { rows: Number, animated: Boolean },
          setup(p) {
            return () => h("div", { class: "el-skeleton-stub", "data-rows": p.rows, "data-animated": String(Boolean(p.animated)) });
          },
        }),
        ElAlert: defineComponent({
          name: "ElAlert",
          props: { title: String, type: String, closable: { type: Boolean, default: true } },
          emits: ["close"],
          setup(p, { slots, emit }) {
            return () => h("div", { class: "el-alert-stub", "data-type": p.type }, [
              h("span", { class: "el-alert-title" }, p.title),
              p.closable ? h("button", { type: "button", class: "el-alert__close-btn", onClick: () => emit("close") }, "×") : null,
              slots.default?.(),
            ]);
          },
        }),
        ElButton: defineComponent({
          name: "ElButton",
          emits: ["click"],
          setup(_p, { slots, emit }) {
            return () => h("button", { type: "button", class: "el-button-stub", onClick: (e: MouseEvent) => emit("click", e) }, slots.default?.());
          },
        }),
      },
    },
  });

  return { wrapper, state, panel, instance, datumState, writeOperation, readOperation, expandPageComposer, refresh };
}

function makeRecord(overrides: Partial<PlatformObjectRecord> & { primaryKey: string; label: string }): PlatformObjectRecord {
  const { primaryKey, label, className, subtitle, fields, fieldLabels, tones } = overrides;
  return {
    primaryKey,
    label,
    ...(className ? { className } : {}),
    ...(subtitle ? { subtitle } : {}),
    fields: fields ?? {},
    ...(fieldLabels ? { fieldLabels } : {}),
    ...(tones ? { tones } : {}),
  };
}

describe("ObjectList / ObjectSummary / ObjectTitle / SdkOverlay parity pack", () => {
  it("G-02 & G-08: renders cards with native combined title tooltip and enriches #card scoped slot", async () => {
    const rows: PlatformObjectRecord[] = [
      makeRecord({
        primaryKey: "app-1",
        className: APP_TYPE,
        label: "Analytics Studio",
        fields: {
          description: "Explore live operational KPIs across departments",
          icon: "bar-chart-3",
        },
      }),
      makeRecord({
        primaryKey: "app-2",
        className: APP_TYPE,
        label: "Plain Workspace",
        fields: {
          icon: "app-window",
        },
      }),
    ];

    const { wrapper } = mountObjectList({
      datumState: shallowRef<MemberDataState>({ status: "ready", value: rows as never }),
      props: {
        layout: "cards",
        subtitleField: "description",
        leadingIconField: "icon",
      },
    });
    await flushPromises();

    const cards = wrapper.findAll(".sdk-object-list-card");
    expect(cards).toHaveLength(2);
    const mains = wrapper.findAll(".sdk-object-list-card-main");
    expect(mains[0].attributes("title")).toBe("Analytics Studio\nExplore live operational KPIs across departments");
    expect(mains[1].attributes("title")).toBe("Plain Workspace");

    const capturedSlotProps: Record<string, unknown>[] = [];
    const { wrapper: customWrapper } = mountObjectList({
      datumState: shallowRef<MemberDataState>({ status: "ready", value: [rows[0]] as never }),
      props: {
        layout: "cards",
        subtitleField: "description",
        leadingIconField: "icon",
      },
      slots: {
        card: (scope: unknown) => {
          capturedSlotProps.push(scope as Record<string, unknown>);
          const s = scope as { title: string; description: string; icon: string };
          return h("div", { class: "custom-card-body" }, `${s.title}::${s.description}::${s.icon}`);
        },
      },
    });
    await flushPromises();
    expect(customWrapper.find(".custom-card-body").text()).toBe("Analytics Studio::Explore live operational KPIs across departments::bar-chart-3");
    expect(capturedSlotProps[0]).toMatchObject({
      title: "Analytics Studio",
      subtitle: "Explore live operational KPIs across departments",
      description: "Explore live operational KPIs across departments",
      icon: "bar-chart-3",
    });
    expect(typeof capturedSlotProps[0].runOperation).toBe("function");
    expect(typeof capturedSlotProps[0].triggerAction).toBe("function");
    expect(Array.isArray(capturedSlotProps[0].rowActions)).toBe(true);
  });

  it("G-06: renders 6 card skeletons by default, honors skeletonCount and #loading override", async () => {
    const loadingState = shallowRef<MemberDataState>({ status: "loading" });

    const { wrapper: defaultCards } = mountObjectList({
      datumState: loadingState,
      props: { layout: "cards" },
    });
    await flushPromises();
    expect(defaultCards.findAll(".sdk-object-list-card-skeleton")).toHaveLength(6);

    const { wrapper: customCount } = mountObjectList({
      datumState: loadingState,
      props: { layout: "cards", skeletonCount: 3 },
    });
    await flushPromises();
    expect(customCount.findAll(".sdk-object-list-card-skeleton")).toHaveLength(3);

    const { wrapper: customSlot } = mountObjectList({
      datumState: loadingState,
      props: { layout: "cards" },
      slots: {
        loading: () => h("div", { class: "custom-loading-probe" }, "Custom skeleton"),
      },
    });
    await flushPromises();
    expect(customSlot.find(".custom-loading-probe").exists()).toBe(true);
    expect(customSlot.findAll(".sdk-object-list-card-skeleton")).toHaveLength(0);
  });

  it("G-07: enforces platform-level same-object same-write-operation in-flight mutex across sibling lists and renders dismissible top error banner for actionErrorPlacement='top'", async () => {
    const pendingConfirm = deferred<{ decision: "confirm"; response: { kind: "dispatched"; intentId: string; outcome: { kind: "success"; data: Record<string, never>; message: string } } }>();
    const prepare = vi.fn().mockImplementation(async (operationId: string) => ({
      intentId: `intent-${operationId}`,
      operationId,
      label: "Pin",
      confirmation: { required: false, message: "", targets: [] },
      hasSecretInput: false,
    }));
    const confirmOperation = vi.fn()
      .mockReturnValueOnce(pendingConfirm.promise)
      .mockRejectedValueOnce(new Error("Pin service unavailable"));

    const sharedManifest = panelManifestSchema.parse({
      state: {},
      members: {
        appsList: { target: { projectionId: "appsList-projection" } },
        favoritesList: { target: { projectionId: "favoritesList-projection" } },
      },
    });
    const sharedInstance = createPanelInstance(sharedManifest, {
      pageKey: "gallery",
      url: () => "/gallery",
      label: () => "Gallery",
      readProjection: async () => { throw new Error("unused"); },
      text: (k: string) => k,
      operations: {
        describe: async () => { throw new Error("unused"); },
        read: async () => ({ kind: "json", value: null }),
        upload: async () => { throw new Error("unused"); },
        prepare,
      },
      confirmOperation,
    });

    const opDescriptor: PanelOwnerOperationDescriptor = {
      kind: "action",
      handlerRef: "workspace.pin",
      effect: "write",
      target: { source: "row" },
      batch: false,
      label: "Pin",
      inputSchema: {},
      resultSchema: {},
    };
    const rowActions: PanelObjectListRowActions = {
      placement: "header",
      items: [{ kind: "operation", operation: "pin", labelKey: "gallery.pin", icon: "star", iconOnly: true }],
    };

    const rowA = makeRecord({ primaryKey: "app-a", className: APP_TYPE, label: "App A" });
    const rowB = makeRecord({ primaryKey: "app-b", className: APP_TYPE, label: "App B" });

    // Mount two sibling lists on the SAME panel instance with ZERO lock group configuration.
    const listA = mountObjectList({
      slotKey: "appsList",
      sharedInstance,
      datumState: shallowRef<MemberDataState>({ status: "ready", value: [rowA] as never }),
      declaredOps: { pin: { operation: { kind: "PlatformOperation", id: "workspace.pin" }, target: { row: true } } },
      admittedOps: { pin: opDescriptor },
      props: { layout: "cards", rowActions, actionErrorPlacement: "top" },
    });
    const listB = mountObjectList({
      slotKey: "favoritesList",
      sharedInstance,
      datumState: shallowRef<MemberDataState>({ status: "ready", value: [rowA, rowB] as never }),
      declaredOps: { pin: { operation: { kind: "PlatformOperation", id: "workspace.pin" }, target: { row: true } } },
      admittedOps: { pin: opDescriptor },
      props: { layout: "cards", rowActions, actionErrorPlacement: "top" },
    });
    await flushPromises();

    const btnA = listA.wrapper.find(".sdk-object-list-action-btn");
    const listBButtons = listB.wrapper.findAll(".sdk-object-list-action-btn");
    const btnBSameObject = listBButtons[0];
    const btnBOtherObject = listBButtons[1];

    await btnA.trigger("click");
    await nextTick();

    // Same object + same handlerRef automatically becomes busy/disabled in BOTH lists; other object stays idle.
    expect(btnA.attributes("aria-busy")).toBe("true");
    expect(btnBSameObject.attributes("aria-busy")).toBe("true");
    expect(btnBSameObject.attributes("disabled")).toBeDefined();
    expect(btnBOtherObject.attributes("aria-busy")).toBeUndefined();
    expect(btnBOtherObject.attributes("disabled")).toBeUndefined();

    // Direct platform-layer duplicate dispatch for the same (objectType, primaryKey, handlerRef) is refused without calling prepare.
    const dupAnswer = await sharedInstance.writeOperation(
      "favoritesList.pin",
      { call: { target: { kind: "object", objectType: APP_TYPE, primaryKey: "app-a" }, input: {} } },
      { handlerRef: "workspace.pin" },
    );
    expect(dupAnswer).toMatchObject({
      decision: "confirm",
      response: { kind: "not-dispatched", code: "OPERATION_IN_FLIGHT" },
    });
    expect(prepare).toHaveBeenCalledTimes(1);

    pendingConfirm.resolve({
      decision: "confirm",
      response: {
        kind: "dispatched",
        intentId: "intent-appsList.pin",
        outcome: { kind: "success", data: {}, message: "Done" },
      },
    });
    await flushPromises();

    expect(btnA.attributes("aria-busy")).toBeUndefined();
    expect(btnBSameObject.attributes("aria-busy")).toBeUndefined();
    expect(btnBSameObject.attributes("disabled")).toBeUndefined();

    // Trigger error on list B: unified dismissible error banner renders at top, inline error alert is suppressed.
    await btnBOtherObject.trigger("click");
    await flushPromises();

    expect(prepare).toHaveBeenCalledTimes(2);
    const topAlert = listB.wrapper.findComponent({ name: "ElAlert" });
    expect(topAlert.exists()).toBe(true);
    expect(topAlert.classes()).toContain("sdk-object-list-op-top-alert");
    expect(topAlert.props("closable")).toBe(true);
    expect(topAlert.props("title")).toBe("Pin service unavailable");
    expect(listB.wrapper.find(".sdk-object-list-op-alert").exists()).toBe(false);

    // Dismissing the top banner clears the error alert.
    topAlert.vm.$emit("close");
    await nextTick();
    expect(listB.wrapper.find(".sdk-object-list-op-top-alert").exists()).toBe(false);
  });

  it("G-09 & W-14: renders generic leadingIconField with default/custom size and exposes #item-leading slot on cards", async () => {
    const mixedRows: PlatformObjectRecord[] = [
      makeRecord({
        primaryKey: "agent-1",
        className: AGENT_TYPE,
        label: "Ops Copilot",
        fields: { icon: "bot", description: "Investigates alerts" },
      }),
      makeRecord({
        primaryKey: "app-1",
        className: APP_TYPE,
        label: "Order Center",
        fields: { icon: "layers", description: "Manage orders" },
      }),
    ];

    const { wrapper } = mountObjectList({
      datumState: shallowRef<MemberDataState>({ status: "ready", value: mixedRows as never }),
      props: {
        layout: "cards",
        leadingIconField: "icon",
      },
    });
    await flushPromises();

    const leadings = wrapper.findAll(".sdk-object-list-card-leading");
    expect(leadings).toHaveLength(2);
    expect(leadings[0].attributes("data-icon-size")).toBe("16");
    expect(leadings[1].attributes("data-icon-size")).toBe("16");

    const { wrapper: customSized } = mountObjectList({
      datumState: shallowRef<MemberDataState>({ status: "ready", value: mixedRows as never }),
      props: {
        layout: "cards",
        leadingIconField: "icon",
        leadingIconSize: 28,
      },
    });
    await flushPromises();
    const sizedLeadings = customSized.findAll(".sdk-object-list-card-leading");
    expect(sizedLeadings[0].attributes("data-icon-size")).toBe("28");
    expect(sizedLeadings[1].attributes("data-icon-size")).toBe("28");

    const { wrapper: slotted } = mountObjectList({
      datumState: shallowRef<MemberDataState>({ status: "ready", value: mixedRows as never }),
      props: {
        layout: "cards",
        leadingIconField: "icon",
      },
      slots: {
        "item-leading": (scope: unknown) => {
          const s = scope as { ref: { className: string; primaryKey: string }; icon: string | null };
          return h("span", { class: "custom-leading-probe" }, `${s.ref.className}:${s.icon}`);
        },
      },
    });
    await flushPromises();
    const probes = slotted.findAll(".custom-leading-probe").map((el) => el.text());
    expect(probes).toEqual([`${AGENT_TYPE}:bot`, `${APP_TYPE}:layers`]);
  });

  it("W-09: executes kind='conversation' row action with row object ref context via expandPageComposer", async () => {
    const row = makeRecord({
      primaryKey: "doc-42",
      className: "platform:WorkspaceResource",
      label: "Quarterly Revenue Report",
    });
    const rowActions: PanelObjectListRowActions = {
      items: [
        {
          kind: "conversation",
          id: "ask",
          labelKey: "gallery.askAgent",
          prefillKey: "gallery.askPrompt",
          target: { kind: "id", id: "analyst-agent" },
          submit: false,
          newSession: true,
        },
      ],
    };

    const { wrapper, expandPageComposer } = mountObjectList({
      slotKey: "resources",
      objectType: "platform:WorkspaceResource",
      datumState: shallowRef<MemberDataState>({ status: "ready", value: [row] as never }),
      props: { layout: "list", rowActions },
    });
    await flushPromises();

    const btn = wrapper.find(".sdk-object-list-action-btn");
    expect(btn.exists()).toBe(true);
    expect(btn.text()).toContain("Ask agent");
    expect(btn.find(".sdk-object-list-action-icon").exists()).toBe(true);

    await btn.trigger("click");
    await flushPromises();

    expect(expandPageComposer).toHaveBeenCalledTimes(1);
    const call = (expandPageComposer as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(call.slot).toBe("resources");
    expect(call.target).toEqual({ kind: "id", id: "analyst-agent" });
    expect(call.prefill).toContain("Quarterly Revenue Report");
    expect(call.prefill).toContain("doc-42");
    expect(call.prefill).toContain("platform:WorkspaceResource");
    expect(call.submit).toBe(false);
    expect(call.newSession).toBe(true);
  });

  it("W-15: resolves ObjectTitle from selected slot, explicit target, and fallback", async () => {
    const row = makeRecord({
      primaryKey: "res-9",
      className: APP_TYPE,
      label: "Customer Portal",
      subtitle: "External self-service app",
    });
    const { wrapper, panel } = mountObjectList({
      slotKey: "resources",
      objectType: APP_TYPE,
      bindSelected: true,
      datumState: shallowRef<MemberDataState>({ status: "ready", value: [row] as never }),
      props: { layout: "list" },
    });
    await flushPromises();

    await wrapper.find(".sdk-object-list-item-btn").trigger("click");
    await flushPromises();

    const i18n = createTestI18n();
    const titleFromSlot = mount(ObjectTitle, {
      props: { slot: "resources", fallbackKey: "gallery.fallbackTitle" },
      global: {
        plugins: [i18n],
        provide: { [panelContextKey as symbol]: panel },
      },
    });
    expect(titleFromSlot.text()).toBe("Customer Portal");

    const titleFromTarget = mount(ObjectTitle, {
      props: { target: { className: APP_TYPE, primaryKey: "res-9" }, tag: "h3" },
      global: {
        plugins: [i18n],
        provide: { [panelContextKey as symbol]: panel },
      },
    });
    expect(titleFromTarget.element.tagName).toBe("H3");
    expect(titleFromTarget.text()).toBe("Customer Portal");

    const titleFallback = mount(ObjectTitle, {
      props: { target: { className: APP_TYPE, primaryKey: "missing-id" }, fallbackKey: "gallery.fallbackTitle" },
      global: {
        plugins: [i18n],
        provide: { [panelContextKey as symbol]: panel },
      },
    });
    expect(titleFallback.text()).toBe("Untitled resource");
  });

  it("AL-06 & AL-07: renders #status, preserves prior rows on error with retry bar, and applies table border/stripe", async () => {
    const rows = [
      makeRecord({ primaryKey: "log-1", label: "Login", fields: { actor: "alice", status: "ok" } }),
      makeRecord({ primaryKey: "log-2", label: "Update", fields: { actor: "bob", status: "ok" } }),
    ];
    const retryFn = vi.fn();
    const firstReady = {
      status: "ready" as const,
      value: { rows, total: 12 } as never,
    };
    const datumState = shallowRef<MemberDataState>(firstReady);

    const { wrapper } = mountObjectList({
      datumState,
      props: {
        layout: "table",
        columns: [{ key: "actor", label: "Actor" }, { key: "status", label: "Status" }],
        border: true,
        stripe: true,
      },
      slots: {
        status: (scope: unknown) => {
          const s = scope as ObjectListStateSnapshot;
          return h("span", { class: "status-probe" }, `count=${s.count};total=${s.total};error=${s.error ?? "none"};refreshing=${s.refreshing}`);
        },
      },
    });
    await flushPromises();

    const table = wrapper.find("table.sdk-object-list-table");
    expect(table.classes()).toContain("is-bordered");
    expect(table.classes()).toContain("is-striped");
    expect(table.attributes("data-border")).toBe("true");
    expect(table.attributes("data-stripe")).toBe("true");
    expect(wrapper.find(".status-probe").text()).toBe("count=2;total=12;error=none;refreshing=false");

    // Transition to error carrying `previous`: rows stay rendered and top error alert with retry appears automatically.
    datumState.value = { status: "error", message: "Audit query timed out", retry: retryFn, previous: firstReady };
    await flushPromises();

    expect(wrapper.findAll("tbody tr")).toHaveLength(2);
    const alert = wrapper.find(".sdk-object-list-preserved-error");
    expect(alert.exists()).toBe(true);
    expect(alert.text()).toContain("Audit query timed out");
    expect(wrapper.find(".status-probe").text()).toBe("count=2;total=12;error=Audit query timed out;refreshing=false");

    await alert.find("button").trigger("click");
    expect(retryFn).toHaveBeenCalledTimes(1);

    // Retry loading carrying `previous`: rows stay visible with refreshing indicator (no blank flash).
    datumState.value = { status: "loading", previous: firstReady };
    await flushPromises();
    expect(wrapper.findAll("tbody tr")).toHaveLength(2);
    expect(wrapper.find(".sdk-object-list").attributes("data-refreshing")).toBe("true");
    expect(wrapper.find(".status-probe").text()).toBe("count=2;total=12;error=none;refreshing=true");

    // Error without `previous` (e.g. after target switch or forbidden): no stale rows or preserved-error banner.
    datumState.value = { status: "error", message: "Fatal target error" };
    await flushPromises();
    expect(wrapper.findAll("tbody tr")).toHaveLength(0);
    expect(wrapper.find(".sdk-object-list-preserved-error").exists()).toBe(false);
  });

  it("AL-08: renders ObjectSummary in presentation='pre' mode and restores trigger focus after SdkOverlay closes", async () => {
    const record: PlatformObjectRecord = makeRecord({
      primaryKey: "evt-1",
      label: "Audit Entry",
      fields: {
        detail: "{\n  \"action\": \"delete\",\n  \"ok\": true\n}",
        summary: "fallback text",
      },
    });
    const projection: ProductProjection = {
      id: "summary-proj",
      name: "Summary",
      description: "",
      visibility: "domain",
      domainId: "domain",
      ownerId: "owner",
      editable: true,
      revision: 1,
      createdAt: "",
      updatedAt: "",
      componentId: "@ontomato/sdk:ObjectSummary",
      inputs: {},
      outputs: {},
      config: {},
      data: { record: { read: "detail", source: { object: { literal: { className: APP_TYPE, primaryKey: "evt-1" } } }, params: {} } },
      operations: {},
    };
    const manifest = panelManifestSchema.parse({ state: {}, members: { detail: { target: { projectionId: projection.id } } } });
    const state = createPanelState(manifest, {});
    const i18n = createTestI18n();
    const panel = {
      instance: {
        state,
        forms: new PanelFormAdapters(),
        nameObjects: () => {},
        objectName: () => null,
      },
      manifest,
      notify: vi.fn(),
      navigate: vi.fn(),
      t: (k: string) => k,
    } as unknown as PanelContext;
    const member: PanelMemberContext = {
      key: "detail",
      projection,
      scoped: true,
      operations: computed(() => ({ status: "ready", value: {} })),
      inputs: computed(() => ({})),
      data: {
        read: async () => ({ status: "ready", value: record as never }),
        use: () => computed<MemberDataState>(() => ({ status: "ready", value: record as never })),
      },
    };

    const summaryWrapper = mount(ObjectSummary, {
      props: { presentation: "pre", fields: ["detail"] },
      global: {
        plugins: [i18n],
        provide: {
          [panelContextKey as symbol]: panel,
          [panelMemberKey as symbol]: () => member,
          [projectionKey as symbol]: { slot: "detail", projection, inputs: {} },
        },
      },
    });
    await flushPromises();

    const pre = summaryWrapper.find("pre.sdk-object-summary-pre");
    expect(pre.exists()).toBe(true);
    expect(pre.attributes("tabindex")).toBe("0");
    expect(pre.text()).toContain("\"action\": \"delete\"");
    expect(summaryWrapper.find("dl").exists()).toBe(false);

    // Verify SdkOverlay restores focus to the trigger element on `closed`.
    const FakeOverlay = defineComponent({
      name: "FakeOverlay",
      props: { modelValue: Boolean },
      emits: ["closed", "update:modelValue"],
      setup(_p, { slots }) {
        return () => h("div", { class: "fake-overlay" }, slots.default?.());
      },
    });
    const WrappedDialog = createSdkOverlay({ name: "SdkDialog", target: FakeOverlay, kind: "dialog" });

    const triggerBtn = document.createElement("button");
    triggerBtn.textContent = "Open detail";
    document.body.appendChild(triggerBtn);
    triggerBtn.focus();
    expect(document.activeElement).toBe(triggerBtn);

    const open = ref(false);
    const Host = defineComponent({
      setup() {
        return () => h(WrappedDialog, {
          modelValue: open.value,
          "onUpdate:modelValue": (v: boolean) => { open.value = v; },
        }, { default: () => h("input", { class: "dialog-input" }) });
      },
    });
    const hostWrapper = mount(Host, { attachTo: document.body });

    open.value = true;
    await nextTick();
    const dialogInput = hostWrapper.find(".dialog-input").element as HTMLInputElement;
    dialogInput.focus();
    expect(document.activeElement).toBe(dialogInput);

    open.value = false;
    await nextTick();
    hostWrapper.findComponent(FakeOverlay).vm.$emit("closed");
    await nextTick();

    expect(document.activeElement).toBe(triggerBtn);
    hostWrapper.unmount();
    triggerBtn.remove();
  });

  it("PM-03 & EM-07: renders layout='accordion' driven by expandedKeys/rowExpandMode with columns and #row-detail", async () => {
    const tools: PlatformObjectRecord[] = [
      makeRecord({
        primaryKey: "search_orders",
        className: TOOL_TYPE,
        label: "Search Orders",
        fields: {
          name: "orders.search",
          description: "Find orders matching customer or date range",
          inputSchema: { kind: "json", value: { type: "object", properties: { query: { type: "string" } } } },
        },
      }),
      makeRecord({
        primaryKey: "raw_tool",
        className: TOOL_TYPE,
        label: "Raw Tool",
        fields: {
          name: "custom.code",
          description: "Custom description text",
          inputSchema: "{\"limit\":10}",
        },
      }),
    ];

    const { wrapper } = mountObjectList({
      objectType: TOOL_TYPE,
      datumState: shallowRef<MemberDataState>({ status: "ready", value: tools as never }),
      props: {
        layout: "accordion",
        subtitleField: "name",
        rowExpandMode: "single",
        columns: [
          { key: "description" },
          { key: "inputSchema", labelKey: "gallery.schemaLabel" },
        ],
      },
    });
    await flushPromises();

    const items = wrapper.findAll(".sdk-object-list-accordion-item");
    expect(items).toHaveLength(2);
    expect(items[0].find(".sdk-object-list-accordion-arrow").exists()).toBe(true);
    expect(items[0].find(".sdk-object-list-accordion-title").text()).toBe("Search Orders");
    expect(items[0].find("code.sdk-object-list-accordion-code").text()).toBe("orders.search");
    expect(items[0].find(".sdk-object-list-accordion-summary").attributes("aria-expanded")).toBe("false");
    expect(items[0].find(".sdk-object-list-accordion-body").exists()).toBe(false);

    // Click first item header to expand.
    await items[0].find(".sdk-object-list-accordion-summary").trigger("click");
    await nextTick();
    expect(items[0].attributes("data-expanded")).toBe("true");
    expect(items[0].find(".sdk-object-list-accordion-summary").attributes("aria-expanded")).toBe("true");
    expect(items[0].find(".sdk-object-list-accordion-desc").text()).toBe("Find orders matching customer or date range");
    expect(items[0].find(".sdk-object-list-accordion-detail-label").text()).toBe("Input Schema");
    expect(items[0].find("pre.sdk-object-list-accordion-pre").text()).toBe(
      JSON.stringify({ type: "object", properties: { query: { type: "string" } } }, null, 2),
    );

    // Single-expand mode collapses item 0 when item 1 expands.
    await items[1].find(".sdk-object-list-accordion-summary").trigger("click");
    await nextTick();
    expect(items[0].find(".sdk-object-list-accordion-body").exists()).toBe(false);
    expect(items[1].attributes("data-expanded")).toBe("true");
    expect(items[1].find("pre.sdk-object-list-accordion-pre").text()).toBe(JSON.stringify({ limit: 10 }, null, 2));

    // Multiple-expand mode with unified #row-detail slot (never exposes raw row.fields).
    const detailScopes: Record<string, unknown>[] = [];
    const { wrapper: multiSlot } = mountObjectList({
      objectType: TOOL_TYPE,
      datumState: shallowRef<MemberDataState>({ status: "ready", value: tools as never }),
      props: {
        layout: "accordion",
        rowExpandMode: "multiple",
      },
      slots: {
        "row-detail": (scope: unknown) => {
          const s = scope as Record<string, unknown> & { ref: { primaryKey: string }; collapse: () => void };
          detailScopes.push(s);
          return h("div", { class: "custom-accordion-detail" }, `detail:${s.ref.primaryKey}`);
        },
      },
    });
    await flushPromises();
    const multiItems = multiSlot.findAll(".sdk-object-list-accordion-item");
    await multiItems[0].find(".sdk-object-list-accordion-summary").trigger("click");
    await multiItems[1].find(".sdk-object-list-accordion-summary").trigger("click");
    await nextTick();
    expect(multiSlot.findAll(".custom-accordion-detail").map((n) => n.text())).toEqual([
      "detail:search_orders",
      "detail:raw_tool",
    ]);
    expect(detailScopes[0]).not.toHaveProperty("fields");
    expect(detailScopes[0]).toHaveProperty("operationResults");
    expect(typeof detailScopes[0].clearOperationResult).toBe("function");
    expect(typeof detailScopes[0].collapse).toBe("function");
  });

  it("EM-04 & EM-05: supports per-(rowKey, actionId) busy isolation, declarative column.resultFrom, platform readOperation message toast, curated icons, and 5-level tone buttons", async () => {
    expect(curatedIcon("RefreshCw")).not.toBeNull();
    expect(curatedIcon("Plug")).not.toBeNull();
    expect(curatedIcon("Pencil")).not.toBeNull();
    expect(curatedIcon("Trash2")).not.toBeNull();

    const pendingProbe1 = deferred<PanelReadOperationResult>();
    const pendingProbe2 = deferred<PanelReadOperationResult>();
    const readOpMock = vi.fn()
      .mockReturnValueOnce(pendingProbe1.promise)
      .mockReturnValueOnce(pendingProbe2.promise);
    const notifyMock = vi.fn();

    const sharedManifest = panelManifestSchema.parse({
      state: {},
      members: { list: { target: { projectionId: "list-projection" } } },
    });
    const sharedInstance = createPanelInstance(sharedManifest, {
      pageKey: "mcp-servers",
      url: () => "/mcp-servers",
      label: () => "MCP Servers",
      text: (key) => key,
      readProjection: () => Promise.reject(new Error("unused")),
      notify: notifyMock,
      operations: {
        describe: () => Promise.reject(new Error("unused")),
        read: readOpMock,
        upload: () => Promise.reject(new Error("unused")),
        prepare: () => Promise.reject(new Error("unused")),
        cancel: () => Promise.resolve(),
      },
      confirmOperation: () => Promise.resolve({ decision: "cancel" as const }),
    });

    const probeOp: PanelOwnerOperationDescriptor = {
      kind: "action",
      handlerRef: "mcp.probe",
      effect: "read",
      target: { source: "row" },
      batch: false,
      label: "Probe",
      inputSchema: {},
      resultSchema: {},
    };
    const deleteOp: PanelOwnerOperationDescriptor = {
      kind: "action",
      handlerRef: "mcp.delete",
      effect: "write",
      target: { source: "row" },
      batch: false,
      label: "Delete",
      inputSchema: {},
      resultSchema: {},
    };

    const rowActions: PanelObjectListRowActions = {
      maxVisible: 3,
      items: [
        { kind: "operation", operation: "probe", labelKey: "gallery.probe", icon: "Plug", tone: "primary" },
        { kind: "operation", operation: "remove", labelKey: "gallery.delete", icon: "Trash2", iconOnly: true, tone: "danger" },
      ],
    };

    const rows = [
      makeRecord({ primaryKey: "srv-1", className: APP_TYPE, label: "Server 1", fields: { status: "unknown" } }),
      makeRecord({ primaryKey: "srv-2", className: APP_TYPE, label: "Server 2", fields: { status: "unknown" } }),
    ];

    const { wrapper } = mountObjectList({
      sharedInstance,
      datumState: shallowRef<MemberDataState>({ status: "ready", value: rows as never }),
      declaredOps: {
        probe: { operation: { kind: "PlatformOperation", id: "mcp.probe" } },
        remove: { operation: { kind: "PlatformOperation", id: "mcp.delete" } },
      },
      admittedOps: { probe: probeOp, remove: deleteOp },
      props: {
        layout: "table",
        columns: [
          {
            key: "status",
            label: "Status",
            resultFrom: { operation: "probe", field: "status" },
          },
        ],
        rowActions,
      },
    });
    await flushPromises();

    const tableRows = wrapper.findAll("tbody tr");
    expect(tableRows).toHaveLength(2);
    expect(tableRows[0].find("td").text()).toContain("unknown");

    const row1Buttons = tableRows[0].findAll(".sdk-object-list-action-btn");
    const row2Buttons = tableRows[1].findAll(".sdk-object-list-action-btn");

    // Verify 5-level tone classes on regular primary button and iconOnly danger trash button.
    expect(row1Buttons[0].classes()).toContain("is-primary");
    const deleteBtn = row1Buttons[1];
    expect(deleteBtn.classes()).toContain("is-icon-only");
    expect(deleteBtn.classes()).toContain("is-danger");
    expect(deleteBtn.attributes("aria-label")).toBe("Delete");
    expect(deleteBtn.attributes("title")).toBe("Delete");
    expect(deleteBtn.text().trim()).toBe("");
    expect(deleteBtn.find(".sdk-object-list-action-icon").exists()).toBe(true);

    // Click probe on row 1: only row 1 probe button is busy and row 1 status cell shows loading state.
    await row1Buttons[0].trigger("click");
    await nextTick();
    expect(row1Buttons[0].attributes("aria-busy")).toBe("true");
    expect(row1Buttons[1].attributes("aria-busy")).toBeUndefined();
    expect(row2Buttons[0].attributes("aria-busy")).toBeUndefined();
    expect(wrapper.findAll("tbody tr")[0].find("td").text()).toContain("Loading...");
    expect(readOpMock).toHaveBeenCalledTimes(1);

    // Resolve with toned object value and top-level read `message`:
    // cell derives display text and value-carried tone, bottom JSON dump is suppressed, and platform layer notifies toast.
    pendingProbe1.resolve({
      kind: "json",
      value: { reachable: true, status: { label: "Reachable", tone: "success" } },
      message: "Connection verified",
    });
    await flushPromises();

    expect(row1Buttons[0].attributes("aria-busy")).toBeUndefined();
    const row1Tag = wrapper.findAll("tbody tr")[0].find(".sdk-object-list-tag");
    expect(row1Tag.exists()).toBe(true);
    expect(row1Tag.text()).toBe("Reachable");
    expect(row1Tag.attributes("data-tone")).toBe("success");
    expect(wrapper.findAll("tbody tr")[1].find("td").text()).toContain("unknown");
    expect(wrapper.find(".sdk-object-list-op-feedback").exists()).toBe(false);
    expect(notifyMock).toHaveBeenCalledTimes(1);
    expect(notifyMock).toHaveBeenCalledWith({ kind: "success", text: "Connection verified" });

    // Trigger probe on row 2 and fail: row 2 cell shows error message with automatic `danger` tone.
    await row2Buttons[0].trigger("click");
    pendingProbe2.reject(new Error("Connection timed out"));
    await flushPromises();

    const row2Tag = wrapper.findAll("tbody tr")[1].find(".sdk-object-list-tag");
    expect(row2Tag.exists()).toBe(true);
    expect(row2Tag.text()).toBe("Connection timed out");
    expect(row2Tag.attributes("data-tone")).toBe("danger");
  });

  it("PanelInstance.readOperation notifies result.message uniformly across OperationButton and honors notifySuccess: false", async () => {
    const readOpMock = vi.fn()
      .mockResolvedValueOnce({ kind: "json", value: { ok: true }, message: "Dry run passed" } satisfies PanelReadOperationResult)
      .mockResolvedValueOnce({ kind: "json", value: { ok: true }, message: "Suppressed message" } satisfies PanelReadOperationResult)
      .mockResolvedValueOnce({ kind: "json", value: { ok: true } } satisfies PanelReadOperationResult);
    const notifyMock = vi.fn();

    const projection: ProductProjection = {
      id: "check-op-proj",
      name: "Check",
      description: "",
      visibility: "domain",
      domainId: "domain",
      ownerId: "owner",
      editable: true,
      revision: 1,
      createdAt: "",
      updatedAt: "",
      componentId: "@ontomato/sdk:OperationButton",
      inputs: {},
      outputs: {},
      config: {},
      data: {},
      operations: {
        dryRun: { operation: { kind: "PlatformOperation", id: "demo.dryRun" } },
      },
    };
    const manifest = panelManifestSchema.parse({
      state: {},
      members: { check: { target: { projectionId: projection.id } } },
    });
    const instance = createPanelInstance(manifest, {
      pageKey: "demo-check",
      url: () => "/demo-check",
      label: () => "Demo",
      text: (key) => key,
      readProjection: () => Promise.reject(new Error("unused")),
      notify: notifyMock,
      operations: {
        describe: () => Promise.reject(new Error("unused")),
        read: readOpMock,
        upload: () => Promise.reject(new Error("unused")),
        prepare: () => Promise.reject(new Error("unused")),
        cancel: () => Promise.resolve(),
      },
      confirmOperation: () => Promise.resolve({ decision: "cancel" as const }),
    });

    const dryRunOp: PanelOwnerOperationDescriptor = {
      kind: "action",
      handlerRef: "demo.dryRun",
      effect: "read",
      target: { source: "none" },
      batch: false,
      label: "Dry run",
      inputSchema: {},
      resultSchema: {},
    };
    const i18n = createTestI18n();
    const panel = {
      instance,
      manifest,
      notify: notifyMock,
      navigate: vi.fn(),
      t: (key: string) => key,
    } as unknown as PanelContext;
    const member: PanelMemberContext = {
      key: "check",
      projection,
      scoped: true,
      operations: computed(() => ({ status: "ready", value: { dryRun: dryRunOp } })),
      inputs: computed(() => ({})),
      data: {
        read: async () => ({ status: "empty" }),
        use: () => computed<MemberDataState>(() => ({ status: "empty" })),
      },
    };

    const mountButton = (notifySuccess?: boolean) =>
      mount(OperationButton, {
        props: { operation: "dryRun", ...(notifySuccess !== undefined ? { notifySuccess } : {}) },
        global: {
          plugins: [i18n],
          provide: {
            [panelContextKey as symbol]: panel,
            [panelMemberKey as symbol]: () => member,
            [projectionKey as symbol]: { slot: "check", projection },
          },
        },
      });

    // 1. Default notifySuccess (true): read result with `message` triggers platform toast.
    const w1 = mountButton();
    await flushPromises();
    await w1.find("button").trigger("click");
    await flushPromises();
    expect(notifyMock).toHaveBeenCalledTimes(1);
    expect(notifyMock).toHaveBeenCalledWith({ kind: "success", text: "Dry run passed" });
    w1.unmount();

    // 2. notifySuccess: false suppresses read result toast.
    const w2 = mountButton(false);
    await flushPromises();
    await w2.find("button").trigger("click");
    await flushPromises();
    expect(notifyMock).toHaveBeenCalledTimes(1);
    w2.unmount();

    // 3. Read result without `message` stays silent.
    const w3 = mountButton();
    await flushPromises();
    await w3.find("button").trigger("click");
    await flushPromises();
    expect(notifyMock).toHaveBeenCalledTimes(1);
    w3.unmount();
  });
});
