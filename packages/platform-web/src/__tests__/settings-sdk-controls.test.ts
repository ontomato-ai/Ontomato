import { flushPromises, mount } from "@vue/test-utils";
import { computed, defineComponent, h, nextTick, shallowRef } from "vue";
import { createI18n } from "vue-i18n";
import { describe, expect, it, vi } from "vitest";
import { ElMessageBox } from "element-plus/es/components/message-box/index";
import type { PanelFormDescription } from "@ontomato/contracts/panel-projection";
import { panelManifestSchema } from "@ontomato/contracts/panel-manifest";
import type { PanelOwnerOperationDescriptor } from "@ontomato/contracts/panel-operations";
import type { ProductProjection } from "@ontomato/contracts/product-panels";
import OperationResult from "../../../apps-sdk/src/base/OperationResult.vue";
import ObjectForm from "../../../apps-sdk/src/base/ObjectForm.vue";
import PageHeader from "../../../apps-sdk/src/base/PageHeader.vue";
import { SdkButton } from "../../../apps-sdk/src/ui/SdkButton";
import { panelContextKey, projectionKey, type PanelContext } from "../../../apps-sdk/src/panel/context";
import { usePanelFormDraft } from "../../../apps-sdk/src/panel/form-draft";
import { PanelFormAdapters } from "../../../apps-sdk/src/panel/forms";
import { createPanelInstance, type PanelInstance, type PanelWriteResult } from "../../../apps-sdk/src/panel/instance";
import { panelMemberKey, type PanelMemberContext } from "../../../apps-sdk/src/panel/member";
import type { MemberOperationsState } from "../../../apps-sdk/src/panel/member-operations";
import { createPanelState } from "../../../apps-sdk/src/panel/state";

function makeI18n() {
  return createI18n({
    legacy: false,
    locale: "zh-CN",
    messages: {
      "zh-CN": {
        platform: {
          addItem: "添加",
          formAdd: "添加",
          formRemove: "删除",
          formMoveUp: "上移",
          formMoveDown: "下移",
          remove: "删除",
          save: "保存",
          create: "保存",
          saving: "保存中",
          discard: "放弃",
          discardChangesTitle: "放弃未保存修改",
          discardChangesPrompt: "确定放弃当前未保存的修改吗？",
          confirm: "确定",
          cancel: "取消",
          formSections: "分区目录",
          formFieldsNeedChanges: "有 {n} 项需要修改",
          formChangedCount: "已修改 {n} 项",
          panelDraftChanged: "已修改：{fields}",
          moveUp: "上移",
          moveDown: "下移",
          moreOptions: "更多选项",
        },
        settings: {
          dataAdapters: {
            testSucceeded: "连接成功",
            testFailed: "连接失败",
            duration: "耗时",
            database: "数据库",
            driver: "驱动",
            engine: "引擎",
            cluster: "集群",
            discoveredTables: "已发现数据表（{count}）",
            discoveredIndices: "已发现索引（{count}）",
            noTables: "未发现任何数据表",
            noIndices: "未发现任何索引",
          },
        },
      },
    },
  });
}

function mountObjectForm({
  initialForm,
  props = {},
  slots = {},
  onReload,
  onSave,
}: {
  initialForm: PanelFormDescription;
  props?: Record<string, unknown>;
  slots?: Record<string, unknown>;
  onReload?: (values: Record<string, unknown>) => PanelFormDescription;
  onSave?: (values: Record<string, unknown>) => Promise<PanelWriteResult>;
}) {
  const className = "platform:SystemSettings";
  const type = { kind: "PlatformObjectType" as const, id: className };
  const saveOperation: PanelOwnerOperationDescriptor = {
    kind: "form.save",
    handlerRef: `${className}.save`,
    effect: "write",
    target: { source: "draft", slot: "form" },
    batch: false,
    label: "Save settings",
    inputSchema: {},
    resultSchema: {},
  };
  const projection: ProductProjection = {
    id: "proj-settings",
    name: "settings",
    description: "",
    visibility: "domain",
    domainId: "default",
    ownerId: "owner",
    editable: true,
    revision: 1,
    createdAt: "2026-11-25T00:00:00Z",
    updatedAt: "2026-11-25T00:00:00Z",
    componentId: "@ontomato/sdk:ObjectForm",
    inputs: {},
    outputs: {},
    config: {},
    data: {
      form: { read: "form", source: { type }, params: {} },
    },
    operations: {
      persist: { operation: { kind: "PlatformOperation", id: saveOperation.handlerRef } },
    },
  };
  const manifest = panelManifestSchema.parse({
    state: {},
    members: { form: { target: { projectionId: projection.id } } },
  });
  const state = createPanelState(manifest, {});
  const forms = new PanelFormAdapters();
  const read: PanelMemberContext["data"]["read"] = async (_name, extra) => {
    const draftValues = extra?.values;
    if (onReload && draftValues && typeof draftValues === "object" && !Array.isArray(draftValues)) {
      return { status: "ready", value: onReload(draftValues as Record<string, unknown>) };
    }
    return { status: "ready", value: initialForm };
  };
  const write = vi.fn<Parameters<PanelInstance["writeOperation"]>, ReturnType<PanelInstance["writeOperation"]>>(
    async (_op, invocation) => {
      if (onSave) {
        const rawInput = "call" in invocation ? invocation.call.input : {};
        const vals = (rawInput && typeof rawInput === "object" && "values" in rawInput ? rawInput.values : rawInput) as Record<string, unknown>;
        return onSave(vals);
      }
      return {
        decision: "confirm",
        named: [],
        response: { kind: "dispatched", intentId: "i1", outcome: { kind: "success", data: {} } },
      } satisfies PanelWriteResult;
    },
  );
  const instance = {
    state,
    forms,
    writeOperation: write,
    onObjectChanged: () => () => {},
    onOperationCompleted: () => () => {},
    operationIdOf: (slot: string, name: string) => `${slot}.${name}`,
    memberPathOf: (member: string) => [{ member }],
    registerActionHandler: () => () => {},
    objectName: () => null,
  } as unknown as PanelInstance;
  const panel = { instance, manifest, notify: vi.fn() } as unknown as PanelContext;
  const operations = shallowRef<MemberOperationsState>({
    status: "ready",
    value: { persist: saveOperation },
  });
  const member: PanelMemberContext = {
    key: "form",
    projection,
    scoped: true,
    operations: computed(() => operations.value),
    inputs: computed(() => ({})),
    data: { read, use: () => computed(() => ({ status: "awaiting" })) },
  };

  const wrapper = mount(ObjectForm, {
    props,
    slots: slots as Record<string, never>,
    global: {
      plugins: [makeI18n()],
      provide: {
        [panelContextKey as symbol]: panel,
        [projectionKey as symbol]: { slot: "form", projection, inputs: {} },
        [panelMemberKey as symbol]: () => member,
      },
    },
  });
  return { wrapper };
}

describe("Settings & Data Adapter SDK controls (Package 1)", () => {
  it("supports showRequiredMark=false, number stepper presentation, showToc=false, two-column grid + full span + clearable", async () => {
    const initialForm: PanelFormDescription = {
      values: { name: "Demo", timeoutSeconds: 60, notes: "hello" },
      sections: [
        { key: "general", title: "基本配置" },
        { key: "extra", title: "扩展配置" },
      ],
      fields: [
        {
          path: "/name",
          label: "名称",
          section: "general",
          valueSchema: { type: "string" },
          required: true,
          readOnly: false,
          control: { kind: "text", clearable: true },
        },
        {
          path: "/timeoutSeconds",
          label: "超时（秒）",
          section: "general",
          valueSchema: { type: "number" },
          required: true,
          readOnly: false,
          control: { kind: "number", presentation: "stepper", min: 5, max: 600, step: 5 },
        },
        {
          path: "/notes",
          label: "备注",
          section: "extra",
          fullWidth: true,
          valueSchema: { type: "string" },
          required: false,
          readOnly: false,
          control: { kind: "text" },
        },
      ],
      errors: [],
      save: { method: "POST", path: "/save", bodySchema: {} },
    };

    const { wrapper } = mountObjectForm({
      initialForm,
      props: { showRequiredMark: false, showToc: false, columns: 2 },
    });
    await flushPromises();

    // GS-02: hide required asterisk
    expect(wrapper.find(".el-form-item.is-required").exists()).toBe(false);
    expect(wrapper.findComponent({ name: "ElForm" }).props("hideRequiredAsterisk")).toBe(true);

    // DA-03: no sticky TOC nav when showToc=false
    expect(wrapper.find(".sdk-owner-form-contents").exists()).toBe(false);
    expect(wrapper.find(".sdk-owner-form-sectioned").classes()).toContain("is-no-toc");

    // GS-03: el-input-number stepper control
    const stepper = wrapper.findComponent({ name: "ElInputNumber" });
    expect(stepper.exists()).toBe(true);
    expect(stepper.props("min")).toBe(5);
    expect(stepper.props("step")).toBe(5);
    expect(stepper.classes()).toContain("sdk-form-field-number-stepper");

    // DA-04: two-column field list + full-width field + clearable text input
    expect(wrapper.find(".sdk-owner-form-field-list.is-two-col").exists()).toBe(true);
    expect(wrapper.find(".sdk-form-field-full-width").exists()).toBe(true);
    const inputs = wrapper.findAllComponents({ name: "ElInput" });
    expect(inputs[0]?.props("clearable")).toBe(true);
  });

  it("renders inline compact object-array rows (EM-06), fixed-row table editor (DA-07), and per-card array-item-footer slot (DA-05)", async () => {
    const initialForm: PanelFormDescription = {
      values: {
        headers: [{ name: "Authorization", value: "Bearer ***" }],
        routes: [{ className: "Order", sourceId: "pg-main" }],
        sources: [{ id: "pg-main", host: "127.0.0.1" }],
      },
      fields: [
        {
          path: "/headers",
          label: "自定义请求头",
          valueSchema: { type: "array" },
          required: false,
          readOnly: false,
          control: {
            kind: "object-array",
            presentation: "inline",
            itemFields: [
              { path: "name", label: "Header Name", valueSchema: { type: "string" }, required: false, readOnly: false, control: { kind: "text" } },
              { path: "value", label: "Header Value", valueSchema: { type: "string" }, required: false, readOnly: false, control: { kind: "text" } },
            ],
          },
        },
        {
          path: "/routes",
          label: "类路由",
          valueSchema: { type: "array" },
          required: false,
          readOnly: false,
          control: {
            kind: "object-array",
            presentation: "table",
            fixedRows: true,
            itemFields: [
              { path: "className", label: "类", valueSchema: { type: "string" }, required: false, readOnly: true, control: { kind: "text" } },
              { path: "sourceId", label: "数据源", valueSchema: { type: "string" }, required: false, readOnly: false, control: { kind: "text" } },
            ],
          },
        },
        {
          path: "/sources",
          label: "数据源列表",
          valueSchema: { type: "array" },
          required: false,
          readOnly: false,
          control: {
            kind: "object-array",
            itemFields: [
              { path: "id", label: "ID", valueSchema: { type: "string" }, required: true, readOnly: false, control: { kind: "text" } },
              { path: "host", label: "主机", valueSchema: { type: "string" }, required: false, readOnly: false, control: { kind: "text" } },
            ],
          },
        },
      ],
      errors: [],
      save: { method: "POST", path: "/save", bodySchema: {} },
    };

    const { wrapper } = mountObjectForm({
      initialForm,
      slots: {
        "array-item-footer-sources": ({ item, index }: { item: { id: string }; index: number }) =>
          h("div", { class: "custom-source-test" }, `test:${index}:${item.id}`),
      },
    });
    await flushPromises();

    // EM-06: inline grid rows + link-style primary add button
    expect(wrapper.find(".sdk-form-inline-row.has-remove").exists()).toBe(true);
    expect(wrapper.find(".sdk-form-add-inline").exists()).toBe(true);

    // DA-07: fixed-row table editor has table headers & no add/remove buttons inside table wrap
    expect(wrapper.find(".sdk-form-table").exists()).toBe(true);
    expect(wrapper.find(".sdk-form-table-wrap .sdk-form-add").exists()).toBe(false);
    expect(wrapper.find(".sdk-form-table-actions-cell").exists()).toBe(false);

    // DA-05: per-card item footer slot receives row item & index
    expect(wrapper.find(".sdk-form-row-footer .custom-source-test").text()).toBe("test:0:pg-main");
  });

  it("auto-derives aggregated red el-alert problems list from structured details.problems without a prop switch (DA-08)", async () => {
    const initialForm: PanelFormDescription = {
      values: { host: "bad" },
      fields: [
        { path: "/host", label: "主机", valueSchema: { type: "string" }, required: true, readOnly: false, control: { kind: "text" } },
      ],
      errors: [],
      save: { method: "POST", path: "/save", bodySchema: {} },
    };

    const { wrapper } = mountObjectForm({
      initialForm,
      onSave: async () => ({
        decision: "confirm",
        named: [],
        response: {
          kind: "dispatched",
          intentId: "i-refuse",
          outcome: {
            kind: "refusal",
            code: "validation_failed",
            message: "多源配置校验失败",
            errors: [
              { field: "/sources/0/host", code: "required", message: "主机不能为空" },
              { field: "/routes/0/sourceId", code: "invalid_option", message: "引用了不存在的数据源" },
            ],
            details: {
              problems: [
                { path: "dataSources[crm]", message: "主机不能为空" },
                { path: "classDef[Order]", message: "引用了不存在的数据源" },
              ],
            },
          },
        },
      }),
    });
    await flushPromises();

    // Trigger edit so Save is enabled
    await wrapper.find("input").setValue("127.0.0.1");
    await flushPromises();
    const saveBtn = wrapper.findAll("button").find((b) => b.text().includes("保存"));
    expect(saveBtn).toBeDefined();
    await saveBtn!.trigger("click");
    await flushPromises();

    const alert = wrapper.findComponent({ name: "ElAlert" });
    expect(alert.exists()).toBe(true);
    expect(alert.props("type")).toBe("error");
    expect(alert.props("title")).toBe("多源配置校验失败");
    const items = wrapper.findAll(".sdk-owner-form-refusal-problems li");
    expect(items).toHaveLength(2);
    expect(items[0]?.text()).toContain("主机不能为空");
    expect(items[1]?.text()).toContain("引用了不存在的数据源");

    // Plain field validation refusal without structured details.problems renders standard summary (no ElAlert).
    const plain = mountObjectForm({
      initialForm,
      onSave: async () => ({
        decision: "confirm",
        named: [],
        response: {
          kind: "dispatched",
          intentId: "i-plain-refuse",
          outcome: {
            kind: "refusal",
            code: "validation_failed",
            message: "字段校验失败",
            errors: [
              { field: "/host", code: "required", message: "主机不能为空" },
            ],
          },
        },
      }),
    });
    await flushPromises();
    await plain.wrapper.find("input").setValue("127.0.0.1");
    await flushPromises();
    const plainSaveBtn = plain.wrapper.findAll("button").find((b) => b.text().includes("保存"));
    await plainSaveBtn!.trigger("click");
    await flushPromises();
    expect(plain.wrapper.findComponent({ name: "ElAlert" }).exists()).toBe(false);
    expect(plain.wrapper.find(".sdk-owner-form-refusal-count").exists()).toBe(true);
  });

  it("preserves unsaved per-branch edits locally when refreshOnChange switches branches (DA-09)", async () => {
    const makeBranchForm = (mode: "single" | "multi", valuesOverride: Record<string, unknown> = {}): PanelFormDescription => ({
      values: mode === "single"
        ? { mode: "single", singleHost: "pg-default", ...valuesOverride }
        : { mode: "multi", multiNote: "multi-default", ...valuesOverride },
      fields: [
        {
          path: "/mode",
          label: "模式",
          valueSchema: { type: "string" },
          required: true,
          readOnly: false,
          refreshOnChange: true,
          control: {
            kind: "select",
            options: [
              { value: "single", label: "单源", description: null, disabled: false, disabledReason: null },
              { value: "multi", label: "多源", description: null, disabled: false, disabledReason: null },
            ],
          },
        },
        mode === "single"
          ? { path: "/singleHost", label: "单源主机", valueSchema: { type: "string" }, required: false, readOnly: false, control: { kind: "text" } }
          : { path: "/multiNote", label: "多源说明", valueSchema: { type: "string" }, required: false, readOnly: false, control: { kind: "text" } },
      ],
      errors: [],
      save: { method: "POST", path: "/save", bodySchema: {} },
    });

    const { wrapper } = mountObjectForm({
      initialForm: makeBranchForm("single"),
      onReload: (values) => makeBranchForm(values.mode === "multi" ? "multi" : "single"),
    });
    await flushPromises();

    // Edit singleHost on "single" branch
    const singleInput = wrapper.find('[data-field="/singleHost"] input');
    await singleInput.setValue("pg-custom-draft");
    await flushPromises();
    expect((wrapper.find('[data-field="/singleHost"] input').element as HTMLInputElement).value).toBe("pg-custom-draft");

    // Switch mode to "multi"
    const select = wrapper.findComponent({ name: "ElSelect" });
    select.vm.$emit("update:modelValue", "multi");
    await flushPromises();
    await nextTick();
    expect((wrapper.find('[data-field="/multiNote"] input').element as HTMLInputElement).value).toBe("multi-default");

    // Switch back to "single" — previously edited draft must be restored!
    const selectAfter = wrapper.findComponent({ name: "ElSelect" });
    selectAfter.vm.$emit("update:modelValue", "single");
    await flushPromises();
    await nextTick();
    expect((wrapper.find('[data-field="/singleHost"] input').element as HTMLInputElement).value).toBe("pg-custom-draft");
  });

  it("uses unified usePanelFormDraft + ObjectForm.reset({ confirm: true }) for header discard confirmation (GS-04 / DA-10)", async () => {
    const confirmSpy = vi.spyOn(ElMessageBox, "confirm");
    const reset = vi.fn(async (options?: { confirm?: boolean }) => {
      if (options?.confirm) {
        try {
          await ElMessageBox.confirm("确定放弃当前未保存的修改吗？", "放弃", {});
        } catch {
          return false;
        }
      }
      dirty.value = false;
      return true;
    });
    const dirty = shallowRef(true);
    const forms = new PanelFormAdapters();
    forms.register("settings", {
      handle: {
        fields: computed(() => []),
        values: computed(() => ({})),
        errors: computed(() => ({})),
        changed: computed(() => new Set<string>()),
        busy: computed(() => false),
        dirty: computed(() => dirty.value),
        dirtyFields: computed(() => new Set<string>()),
        submitting: computed(() => false),
        canSubmit: computed(() => dirty.value),
        set: vi.fn(),
        submit: vi.fn(async () => ({ ok: true as const })),
        reset,
        refreshDraft: vi.fn(async () => {}),
      },
    } as unknown as Parameters<PanelFormAdapters["register"]>[1]);

    const manifest = panelManifestSchema.parse({ state: {}, members: {} });
    const panel = {
      manifest,
      instance: { forms, manifest } as unknown as PanelInstance,
      t: (k: string) => k,
    } as unknown as PanelContext;

    const Host = defineComponent({
      setup() {
        const draft = usePanelFormDraft("settings");
        return () => h(PageHeader, { title: "通用设置", draft: draft.value });
      },
    });

    // 1. User cancels confirmation -> reset({ confirm: true }) was called and dirty stays true.
    confirmSpy.mockRejectedValueOnce("cancel");
    const wrapper = mount(Host, {
      global: {
        plugins: [makeI18n()],
        provide: { [panelContextKey as symbol]: panel },
      },
    });

    const discardBtn = wrapper.findAll("button").find((b) => b.text().includes("放弃"));
    expect(discardBtn).toBeDefined();
    await discardBtn!.trigger("click");
    await flushPromises();
    expect(reset).toHaveBeenCalledWith({ confirm: true });
    expect(confirmSpy).toHaveBeenCalledTimes(1);
    expect(dirty.value).toBe(true);

    // 2. User confirms -> reset({ confirm: true }) clears dirty.
    confirmSpy.mockResolvedValueOnce("confirm" as never);
    await discardBtn!.trigger("click");
    await flushPromises();
    expect(confirmSpy).toHaveBeenCalledTimes(2);
    expect(dirty.value).toBe(false);
    confirmSpy.mockRestore();
  });

  it("resolves standard icon names on SdkButton and tracks refreshingObjects during PanelInstance.refreshObjects (PM-04)", async () => {
    const btnWrapper = mount(SdkButton, {
      props: { icon: "RefreshCw" },
      slots: { default: () => "刷新" },
    });
    expect(btnWrapper.find("svg").exists()).toBe(true);

    const manifest = panelManifestSchema.parse({ state: {}, members: {} });
    const instance = createPanelInstance(manifest, {
      panelId: "test-panel",
      readProjection: async () => {
        throw new Error("unused");
      },
      operations: {
        describe: async () => {
          throw new Error("unused");
        },
        read: async () => ({ kind: "json", value: null }),
        upload: async () => {
          throw new Error("unused");
        },
        prepare: async () => {
          throw new Error("unused");
        },
      },
    } as unknown as Parameters<typeof createPanelInstance>[1]);
    let release!: () => void;
    instance.onObjectChanged(() => new Promise<void>((resolve) => { release = resolve; }));

    expect(instance.refreshing.value).toBe(false);
    const pending = instance.refreshObjects();
    expect(instance.refreshing.value).toBe(true);
    release();
    await pending;
    expect(instance.refreshing.value).toBe(false);
  });

  it("renders stacked OperationResult with banner, bordered fields, and compact record list (DA-06)", () => {
    const sqlWrapper = mount(OperationResult, {
      props: {
        layout: "stacked",
        result: {
          kind: "sections",
          banner: { tone: "success", title: "Connection test succeeded" },
          sections: [
            {
              id: "summary",
              label: "Summary",
              kind: "fields",
              items: [
                { label: "Duration", value: "42 ms" },
                { label: "Database", value: "PostgreSQL 16.2" },
                { label: "Driver", value: "pg-jdbc 42.7" },
                { label: "Catalog", value: "analytics_db" },
                { label: "Schema", value: "public" },
              ],
            },
            {
              id: "objects",
              label: "Tables and views (2)",
              kind: "records",
              columns: [
                { key: "name", label: "Name" },
                { key: "type", label: "Type" },
              ],
              rows: [
                { name: "public.orders", type: "TABLE" },
                { name: "order_items", type: "VIEW" },
              ],
              emptyText: "No tables or views visible to this connection.",
            },
          ],
        },
      },
      global: { plugins: [makeI18n()] },
    });
    expect(sqlWrapper.findComponent({ name: "ElAlert" }).props("type")).toBe("success");
    expect(sqlWrapper.text()).toContain("42 ms");
    expect(sqlWrapper.text()).toContain("PostgreSQL 16.2");
    expect(sqlWrapper.text()).toContain("analytics_db");
    expect(sqlWrapper.text()).toContain("public.orders");
    expect(sqlWrapper.text()).toContain("TABLE");
    expect(sqlWrapper.findAll(".sdk-operation-record-list li")).toHaveLength(2);

    const searchWrapper = mount(OperationResult, {
      props: {
        layout: "stacked",
        result: {
          kind: "sections",
          banner: { tone: "success", title: "Connection test succeeded" },
          sections: [
            {
              id: "summary",
              label: "Summary",
              kind: "fields",
              items: [
                { label: "Duration", value: "18 ms" },
                { label: "Search engine", value: "Elasticsearch 8.14" },
                { label: "Cluster", value: "ontomato-search" },
              ],
            },
            {
              id: "objects",
              label: "Indices (2)",
              kind: "records",
              columns: [{ key: "name", label: "Name" }],
              rows: [{ name: "orders-2026" }, { name: "customers-v2" }],
              emptyText: "No indices visible to this connection.",
            },
          ],
        },
      },
      global: { plugins: [makeI18n()] },
    });
    expect(searchWrapper.text()).toContain("Elasticsearch 8.14");
    expect(searchWrapper.text()).toContain("ontomato-search");
    expect(searchWrapper.text()).toContain("orders-2026");

    const errWrapper = mount(OperationResult, {
      props: {
        layout: "stacked",
        result: {
          kind: "sections",
          banner: { tone: "danger", title: "Connection failed", detail: "ECONNREFUSED 127.0.0.1:5432" },
          sections: [
            { id: "objects", label: "Tables and views (0)", kind: "records", columns: [{ key: "name", label: "Name" }], rows: [], emptyText: "No tables" },
          ],
        },
      },
      global: { plugins: [makeI18n()] },
    });
    expect(errWrapper.findComponent({ name: "ElAlert" }).props("type")).toBe("error");
    expect(errWrapper.text()).toContain("ECONNREFUSED 127.0.0.1:5432");
    expect(errWrapper.text()).toContain("No tables");
  });
});
