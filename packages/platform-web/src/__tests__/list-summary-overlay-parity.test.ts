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
import type { ObjectListRowActionErrorEvent, ObjectListRowActionResultEvent, ObjectListSelectionRecord, ObjectListStateSnapshot } from "../../../apps-sdk/src/base/object-list-types";
import { createSdkOverlay } from "../../../apps-sdk/src/ui/SdkOverlay";
import { panelContextKey, projectionKey, type PanelContext } from "../../../apps-sdk/src/panel/context";
import { PanelFormAdapters } from "../../../apps-sdk/src/panel/forms";
import type { PanelInstance, PanelWriteResult } from "../../../apps-sdk/src/panel/instance";
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
  const instance = {
    instanceId: `inst-${slotKey}-${Math.random().toString(36).slice(2, 8)}`,
    isDisposed: false,
    manifest,
    state,
    forms,
    writeOperation,
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
  } as unknown as PanelInstance;

  const i18n = createTestI18n();
  const panel = {
    instance,
    manifest,
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
          props: { title: String, type: String },
          setup(p, { slots }) {
            return () => h("div", { class: "el-alert-stub", "data-type": p.type }, [
              h("span", { class: "el-alert-title" }, p.title),
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
        leadingIconKind: "application",
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
        leadingIconKind: "application",
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
      iconKind: "application",
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

  it("G-07: shares cross-list actionLockGroup mutex, sets aria-busy on active button, and routes errors via @row-action-error when inlineActionError is false", async () => {
    const pendingWrite = deferred<PanelWriteResult>();
    const writeA = vi.fn().mockReturnValueOnce(pendingWrite.promise);
    const writeB = vi.fn().mockRejectedValueOnce(new Error("Pin service unavailable"));

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

    const listA = mountObjectList({
      slotKey: "appsList",
      datumState: shallowRef<MemberDataState>({ status: "ready", value: [rowA] as never }),
      declaredOps: { pin: { operation: { kind: "PlatformOperation", id: "workspace.pin" } } },
      admittedOps: { pin: opDescriptor },
      writeOperation: writeA,
      props: { layout: "cards", rowActions, actionLockGroup: "gallery-pins", inlineActionError: false },
    });
    const listB = mountObjectList({
      slotKey: "agentsList",
      datumState: shallowRef<MemberDataState>({ status: "ready", value: [rowB] as never }),
      declaredOps: { pin: { operation: { kind: "PlatformOperation", id: "workspace.pin" } } },
      admittedOps: { pin: opDescriptor },
      writeOperation: writeB,
      props: { layout: "cards", rowActions, actionLockGroup: "gallery-pins", inlineActionError: false },
    });
    await flushPromises();

    const btnA = listA.wrapper.find(".sdk-object-list-action-btn");
    const btnB = listB.wrapper.find(".sdk-object-list-action-btn");

    await btnA.trigger("click");
    await nextTick();

    expect(btnA.attributes("aria-busy")).toBe("true");
    expect(btnB.attributes("disabled")).toBeDefined();

    // Clicking list B while list A holds the group lock must not dispatch writeB.
    await btnB.trigger("click");
    expect(writeB).not.toHaveBeenCalled();

    pendingWrite.resolve(writeSuccess());
    await flushPromises();

    expect(btnA.attributes("aria-busy")).toBeUndefined();
    expect(btnB.attributes("disabled")).toBeUndefined();

    // Now list B can run; verify error event emitted and inline alert suppressed.
    await btnB.trigger("click");
    await flushPromises();

    expect(writeB).toHaveBeenCalledTimes(1);
    const errorEvents = listB.wrapper.emitted("row-action-error") as [ObjectListRowActionErrorEvent][] | undefined;
    expect(errorEvents?.[0]?.[0]).toMatchObject({
      actionId: "pin",
      message: "Pin service unavailable",
      row: { className: APP_TYPE, primaryKey: "app-b", label: "App B" },
    });
    expect(listB.wrapper.find(".sdk-object-list-row-op-error").exists()).toBe(false);
  });

  it("G-09 & W-14: switches leading icon per row className in auto mode and applies default/custom leadingIconSize", async () => {
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
      makeRecord({
        primaryKey: "shortcut-agent",
        className: "platform:WorkspaceShortcut",
        label: "Pinned Copilot",
        fields: { targetClassName: AGENT_TYPE, icon: "bot" },
      }),
    ];

    const { wrapper } = mountObjectList({
      datumState: shallowRef<MemberDataState>({ status: "ready", value: mixedRows as never }),
      props: {
        layout: "cards",
        leadingIconKind: "auto",
        leadingIconField: "icon",
      },
    });
    await flushPromises();

    const leadings = wrapper.findAll(".sdk-object-list-card-leading");
    expect(leadings).toHaveLength(3);
    expect(leadings[0].attributes("data-icon-kind")).toBe("agent");
    expect(leadings[0].attributes("data-icon-size")).toBe("22");
    expect(leadings[1].attributes("data-icon-kind")).toBe("application");
    expect(leadings[1].attributes("data-icon-size")).toBe("16");
    expect(leadings[2].attributes("data-icon-kind")).toBe("agent");
    expect(leadings[2].attributes("data-icon-size")).toBe("22");

    const { wrapper: customSized } = mountObjectList({
      datumState: shallowRef<MemberDataState>({ status: "ready", value: [mixedRows[0], mixedRows[1]] as never }),
      props: {
        layout: "cards",
        leadingIconKind: "auto",
        leadingIconSize: 28,
      },
    });
    await flushPromises();
    const sizedLeadings = customSized.findAll(".sdk-object-list-card-leading");
    expect(sizedLeadings[0].attributes("data-icon-size")).toBe("28");
    expect(sizedLeadings[1].attributes("data-icon-size")).toBe("28");
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
          promptKey: "gallery.askPrompt",
          agent: "analyst-agent",
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

    const results = wrapper.emitted("row-action-result") as [ObjectListRowActionResultEvent][] | undefined;
    expect(results?.[0]?.[0]).toMatchObject({
      actionId: "ask",
      ok: true,
      row: { className: "platform:WorkspaceResource", primaryKey: "doc-42", label: "Quarterly Revenue Report" },
    });
  });

  it("W-15: emits @selection-record with display label/subtitle and resolves ObjectTitle from slot, target, and fallback", async () => {
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

    const emitted = wrapper.emitted("selection-record") as [ObjectListSelectionRecord | null][] | undefined;
    expect(emitted?.at(-1)?.[0]).toEqual({
      className: APP_TYPE,
      primaryKey: "res-9",
      label: "Customer Portal",
      subtitle: "External self-service app",
    });

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

  it("AL-06 & AL-07: emits @state-change, renders #status, preserves prior rows on error with retry bar, and applies table border/stripe", async () => {
    const rows = [
      makeRecord({ primaryKey: "log-1", label: "Login", fields: { actor: "alice", status: "ok" } }),
      makeRecord({ primaryKey: "log-2", label: "Update", fields: { actor: "bob", status: "ok" } }),
    ];
    const retryFn = vi.fn();
    const datumState = shallowRef<MemberDataState>({
      status: "ready",
      value: { rows, total: 12 } as never,
    });

    const { wrapper } = mountObjectList({
      datumState,
      props: {
        layout: "table",
        columns: [{ key: "actor", label: "Actor" }, { key: "status", label: "Status" }],
        border: true,
        stripe: true,
        preserveOnError: true,
      },
      slots: {
        status: (scope: unknown) => {
          const s = scope as ObjectListStateSnapshot;
          return h("span", { class: "status-probe" }, `count=${s.count};total=${s.total};error=${s.error ?? "none"}`);
        },
      },
    });
    await flushPromises();

    const table = wrapper.find("table.sdk-object-list-table");
    expect(table.classes()).toContain("is-bordered");
    expect(table.classes()).toContain("is-striped");
    expect(table.attributes("data-border")).toBe("true");
    expect(table.attributes("data-stripe")).toBe("true");
    expect(wrapper.find(".status-probe").text()).toBe("count=2;total=12;error=none");

    // Transition to error: rows stay rendered and top error alert with retry appears.
    datumState.value = { status: "error", message: "Audit query timed out", retry: retryFn };
    await flushPromises();

    expect(wrapper.findAll("tbody tr")).toHaveLength(2);
    const alert = wrapper.find(".sdk-object-list-preserved-error");
    expect(alert.exists()).toBe(true);
    expect(alert.text()).toContain("Audit query timed out");
    expect(wrapper.find(".status-probe").text()).toBe("count=2;total=12;error=Audit query timed out");

    await alert.find("button").trigger("click");
    expect(retryFn).toHaveBeenCalledTimes(1);

    const stateEvents = wrapper.emitted("state-change") as [ObjectListStateSnapshot][] | undefined;
    expect(stateEvents?.at(-1)?.[0]).toMatchObject({
      count: 2,
      total: 12,
      error: "Audit query timed out",
      loading: false,
    });
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
      props: { presentation: "pre", textField: "detail" },
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

  it("PM-03 & EM-07: renders layout='accordion' with chevron, code badge, description, and pretty-printed JSON detail", async () => {
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
          codeId: "custom.code",
          summary: "Custom description text",
          payload: "{\"limit\":10}",
        },
      }),
    ];

    const { wrapper } = mountObjectList({
      objectType: TOOL_TYPE,
      datumState: shallowRef<MemberDataState>({ status: "ready", value: [tools[0]] as never }),
      props: {
        layout: "accordion",
        accordionDetailLabelKey: "gallery.schemaLabel",
      },
    });
    await flushPromises();

    const item = wrapper.find("details.sdk-object-list-accordion-item");
    expect(item.exists()).toBe(true);
    expect(item.find(".sdk-object-list-accordion-arrow").exists()).toBe(true);
    expect(item.find(".sdk-object-list-accordion-title").text()).toBe("Search Orders");
    expect(item.find("code.sdk-object-list-accordion-code").text()).toBe("orders.search");
    expect(item.find(".sdk-object-list-accordion-desc").text()).toBe("Find orders matching customer or date range");
    expect(item.find(".sdk-object-list-accordion-detail-label").text()).toBe("Input Schema");
    expect(item.find("pre.sdk-object-list-accordion-pre").text()).toBe(
      JSON.stringify({ type: "object", properties: { query: { type: "string" } } }, null, 2),
    );

    const { wrapper: customFields } = mountObjectList({
      objectType: TOOL_TYPE,
      datumState: shallowRef<MemberDataState>({ status: "ready", value: [tools[1]] as never }),
      props: {
        layout: "accordion",
        accordionCodeField: "codeId",
        accordionDescriptionField: "summary",
        accordionDetailField: "payload",
      },
    });
    await flushPromises();
    expect(customFields.find("code.sdk-object-list-accordion-code").text()).toBe("custom.code");
    expect(customFields.find(".sdk-object-list-accordion-desc").text()).toBe("Custom description text");
    expect(customFields.find("pre.sdk-object-list-accordion-pre").text()).toBe(JSON.stringify({ limit: 10 }, null, 2));
  });

  it("EM-04 & EM-05: supports per-(rowKey, actionId) busy isolation, read-only operation dispatch, rowFieldOverrides, curated icons, and iconOnly danger buttons", async () => {
    expect(curatedIcon("RefreshCw")).not.toBeNull();
    expect(curatedIcon("Plug")).not.toBeNull();
    expect(curatedIcon("Pencil")).not.toBeNull();
    expect(curatedIcon("Trash2")).not.toBeNull();

    const pendingProbe = deferred<PanelReadOperationResult>();
    const readOperation = vi.fn().mockReturnValueOnce(pendingProbe.promise);
    const writeOperation = vi.fn().mockResolvedValue(writeSuccess());

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
        { kind: "operation", operation: "probe", labelKey: "gallery.probe", icon: "Plug" },
        { kind: "operation", operation: "remove", labelKey: "gallery.delete", icon: "Trash2", iconOnly: true, tone: "danger" },
      ],
    };

    const rows = [
      makeRecord({ primaryKey: "srv-1", className: APP_TYPE, label: "Server 1", fields: { status: "unknown" } }),
      makeRecord({ primaryKey: "srv-2", className: APP_TYPE, label: "Server 2", fields: { status: "unknown" } }),
    ];

    const { wrapper } = mountObjectList({
      datumState: shallowRef<MemberDataState>({ status: "ready", value: rows as never }),
      declaredOps: {
        probe: { operation: { kind: "PlatformOperation", id: "mcp.probe" } },
        remove: { operation: { kind: "PlatformOperation", id: "mcp.delete" } },
      },
      admittedOps: { probe: probeOp, remove: deleteOp },
      readOperation,
      writeOperation,
      props: {
        layout: "table",
        columns: [{ key: "status", label: "Status" }],
        rowActions,
        rowFieldOverrides: {},
      },
    });
    await flushPromises();

    const tableRows = wrapper.findAll("tbody tr");
    expect(tableRows).toHaveLength(2);

    const row1Buttons = tableRows[0].findAll(".sdk-object-list-action-btn");
    const row2Buttons = tableRows[1].findAll(".sdk-object-list-action-btn");

    // Verify iconOnly danger trash button has aria-label & title but no text label.
    const deleteBtn = row1Buttons[1];
    expect(deleteBtn.classes()).toContain("is-icon-only");
    expect(deleteBtn.classes()).toContain("is-danger");
    expect(deleteBtn.attributes("aria-label")).toBe("Delete");
    expect(deleteBtn.attributes("title")).toBe("Delete");
    expect(deleteBtn.text().trim()).toBe("");
    expect(deleteBtn.find(".sdk-object-list-action-icon").exists()).toBe(true);

    // Click probe on row 1: only row 1 probe button is busy; row 2 probe remains idle.
    await row1Buttons[0].trigger("click");
    await nextTick();
    expect(row1Buttons[0].attributes("aria-busy")).toBe("true");
    expect(row1Buttons[1].attributes("aria-busy")).toBeUndefined();
    expect(row2Buttons[0].attributes("aria-busy")).toBeUndefined();
    expect(readOperation).toHaveBeenCalledTimes(1);
    expect(writeOperation).not.toHaveBeenCalled();

    pendingProbe.resolve(readSuccess({ reachable: true, status: "Reachable" }));
    await flushPromises();

    expect(row1Buttons[0].attributes("aria-busy")).toBeUndefined();
    const results = wrapper.emitted("row-action-result") as [ObjectListRowActionResultEvent][] | undefined;
    expect(results?.[0]?.[0]).toMatchObject({
      actionId: "probe",
      ok: true,
      data: { reachable: true, status: "Reachable" },
      row: { className: APP_TYPE, primaryKey: "srv-1", label: "Server 1" },
    });

    // Apply rowFieldOverrides to update row 1 status cell in-place without reloading.
    await wrapper.setProps({
      rowFieldOverrides: {
        "srv-1": { status: "Reachable" },
      },
    });
    await nextTick();

    expect(wrapper.findAll("tbody tr")[0].find("td").text()).toContain("Reachable");
    expect(wrapper.findAll("tbody tr")[1].find("td").text()).toContain("unknown");
  });
});
