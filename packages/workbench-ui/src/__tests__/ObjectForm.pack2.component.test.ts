import { flushPromises, mount, enableAutoUnmount } from "@vue/test-utils";
import { computed, createCommentVNode, h, nextTick, ref, shallowRef } from "vue";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ElForm } from "element-plus/es/components/form/index";
import type { RuntimeJsonValue } from "@ontomato/contracts/agent-runtime-values";
import type { PanelFormDescription } from "@ontomato/contracts/panel-projection";
import { panelManifestSchema } from "@ontomato/contracts/panel-manifest";
import type { PanelOwnerOperationDescriptor } from "@ontomato/contracts/panel-operations";
import type { ProductProjection } from "@ontomato/contracts/product-panels";
import ObjectForm from "../../../apps-sdk/src/base/ObjectForm.vue";
import { panelContextKey, projectionKey, type PanelContext } from "../../../apps-sdk/src/panel/context";
import { PanelFormAdapters } from "../../../apps-sdk/src/panel/forms";
import type { PanelInstance } from "../../../apps-sdk/src/panel/instance";
import { panelMemberKey, type PanelMemberContext } from "../../../apps-sdk/src/panel/member";
import type { MemberOperationsState } from "../../../apps-sdk/src/panel/member-operations";
import { createPanelState } from "../../../apps-sdk/src/panel/state";
import { workbenchI18n } from "../i18n";

enableAutoUnmount(afterEach);

const settingsType = "platform:WorkspaceSettings";

function makeDescription(overrides: Partial<PanelFormDescription> = {}): PanelFormDescription {
  return {
    values: {
      embeddingModel: "text-embedding-3-small",
      modelSelection: { modelId: "gpt-4o" },
      items: [{ skillId: "sql-query" }],
    },
    fields: [
      {
        path: "/embeddingModel",
        label: "Embedding model",
        help: "Vector model used for semantic search",
        valueSchema: { type: "string" },
        required: false,
        readOnly: false,
        control: { kind: "text" },
      },
      {
        path: "/modelSelection",
        label: "Model selection",
        valueSchema: { type: "object" },
        required: true,
        readOnly: false,
        control: {
          kind: "object",
          fields: [
            {
              path: "/modelId",
              label: "Model ID",
              valueSchema: { type: "string" },
              required: false,
              readOnly: false,
              control: { kind: "text" },
            },
          ],
        },
      },
      {
        path: "/items",
        label: "Skill bindings",
        valueSchema: { type: "array" },
        required: false,
        readOnly: false,
        control: {
          kind: "object-array",
          itemFields: [
            {
              path: "/skillId",
              label: "Skill",
              valueSchema: { type: "string" },
              required: false,
              readOnly: false,
              control: { kind: "text" },
            },
          ],
        },
      },
    ],
    errors: [],
    save: { method: "POST", path: "/save", bodySchema: {} },
    ...overrides,
  };
}

function mountObjectForm(options: {
  props?: Record<string, unknown>;
  config?: Record<string, RuntimeJsonValue>;
  slots?: Record<string, (...args: any[]) => any>;
  description?: PanelFormDescription;
} = {}) {
  const formDesc = options.description ?? makeDescription();
  const type = { kind: "PlatformObjectType" as const, id: settingsType };
  const projection: ProductProjection = {
    id: "workspace-settings-form",
    name: "Workspace settings",
    description: "",
    visibility: "domain",
    domainId: "domain",
    ownerId: "owner",
    editable: true,
    revision: 1,
    createdAt: "",
    updatedAt: "",
    componentId: "@ontomato/sdk:ObjectForm",
    inputs: {},
    outputs: {},
    config: options.config ?? {},
    data: {
      form: { read: "form", source: { type }, params: {} },
    },
    operations: {
      persist: { operation: { kind: "PlatformOperation", id: `${settingsType}.save` } },
    },
  };
  const manifest = panelManifestSchema.parse({
    state: {},
    members: { form: { target: { projectionId: projection.id }, inputs: {} } },
  });
  const state = createPanelState(manifest, {});
  const forms = new PanelFormAdapters();
  const saveDescriptor: PanelOwnerOperationDescriptor = {
    kind: "form.save",
    handlerRef: `${settingsType}.save`,
    effect: "write",
    target: { source: "draft", slot: "form" },
    batch: false,
    label: "Save",
    inputSchema: {},
    resultSchema: {},
  };
  const instance = {
    state,
    forms,
    writeOperation: vi.fn(),
    onObjectChanged: () => () => {},
    onOperationCompleted: () => () => {},
    operationIdOf: (slot, name) => `${slot}.${name}`,
    memberPathOf: (member) => [{ member }],
    registerActionHandler: () => () => {},
    objectName: () => null,
  } satisfies Pick<
    PanelInstance,
    | "state"
    | "forms"
    | "writeOperation"
    | "onObjectChanged"
    | "onOperationCompleted"
    | "operationIdOf"
    | "memberPathOf"
    | "registerActionHandler"
    | "objectName"
  >;
  const panel = { instance, manifest, notify: vi.fn() } satisfies Pick<PanelContext, "manifest" | "notify"> & {
    instance: typeof instance;
  };
  const operations = shallowRef<MemberOperationsState>({
    status: "ready",
    value: { persist: saveDescriptor },
  });
  const member: PanelMemberContext = {
    key: "form",
    projection,
    scoped: true,
    operations: computed(() => operations.value),
    inputs: computed(() => ({})),
    data: {
      read: async () => ({ status: "ready", value: formDesc }),
      use: () => computed(() => ({ status: "awaiting" })),
    },
  };
  const wrapper = mount(ObjectForm, {
    props: options.props,
    slots: options.slots,
    attachTo: document.body,
    global: {
      plugins: [workbenchI18n()],
      provide: {
        [panelContextKey as symbol]: panel,
        [panelMemberKey as symbol]: () => member,
        [projectionKey as symbol]: { slot: "form", projection, inputs: {} },
      },
    },
  });
  return { wrapper, form: forms.handle("form")! };
}

describe("ObjectForm Group E Pack 2B (TR-08 & MU-05)", () => {
  it("supports labelPosition and labelWidth via props, defaults to 96px, and normalizes numeric widths", async () => {
    const withWidth = mountObjectForm({
      props: { labelPosition: "left", labelWidth: "110px" },
    });
    await flushPromises();
    const elForm = withWidth.wrapper.findComponent(ElForm);
    expect(elForm.props("labelPosition")).toBe("left");
    expect(elForm.props("labelWidth")).toBe("110px");
    expect(withWidth.wrapper.classes()).toContain("is-label-left");
    expect(withWidth.wrapper.classes()).not.toContain("is-label-right");

    const defaultWidth = mountObjectForm({
      props: { labelPosition: "left" },
    });
    await flushPromises();
    const defaultElForm = defaultWidth.wrapper.findComponent(ElForm);
    expect(defaultElForm.props("labelPosition")).toBe("left");
    expect(defaultElForm.props("labelWidth")).toBe("96px");

    const numericRight = mountObjectForm({
      props: { labelPosition: "right", labelWidth: 120 },
    });
    await flushPromises();
    const rightElForm = numericRight.wrapper.findComponent(ElForm);
    expect(rightElForm.props("labelPosition")).toBe("right");
    expect(rightElForm.props("labelWidth")).toBe("120px");
    expect(numericRight.wrapper.classes()).toContain("is-label-right");
  });

  it("reads labelPosition and labelWidth from member.projection.config (camelCase & kebab-case) and keeps layout='rows' unaffected", async () => {
    const camel = mountObjectForm({
      config: { labelPosition: "left", labelWidth: "110px" },
    });
    await flushPromises();
    expect(camel.wrapper.findComponent(ElForm).props("labelPosition")).toBe("left");
    expect(camel.wrapper.findComponent(ElForm).props("labelWidth")).toBe("110px");
    expect(camel.wrapper.classes()).toContain("is-label-left");

    const kebab = mountObjectForm({
      config: { "label-position": "right", "label-width": 132 },
    });
    await flushPromises();
    expect(kebab.wrapper.findComponent(ElForm).props("labelPosition")).toBe("right");
    expect(kebab.wrapper.findComponent(ElForm).props("labelWidth")).toBe("132px");
    expect(kebab.wrapper.classes()).toContain("is-label-right");

    const rowsForm = mountObjectForm({
      props: { layout: "rows", labelPosition: "left", labelWidth: "110px" },
    });
    await flushPromises();
    expect(rowsForm.wrapper.findComponent(ElForm).props("labelPosition")).toBe("top");
    expect(rowsForm.wrapper.findComponent(ElForm).props("labelWidth")).toBe("");
    expect(rowsForm.wrapper.classes()).not.toContain("is-label-left");
    expect(rowsForm.wrapper.find('.sdk-form-row-item[data-field="/embeddingModel"]').exists()).toBe(true);
  });

  it("renders #field-after-embeddingModel inside .sdk-form-row-control in rows layout alongside the default control with live scope props", async () => {
    const { wrapper, form } = mountObjectForm({
      props: { layout: "rows" },
      slots: {
        "field-after-embeddingModel": (scope: Record<string, any>) =>
          h("div", { class: "after-probe" }, [
            h("span", { class: "after-value" }, String(scope.value)),
            h("span", { class: "after-changed" }, String(scope.changed)),
            h("span", { class: "after-disabled" }, String(scope.disabled)),
            h("button", { type: "button", class: "after-set", onClick: () => scope.set("bge-m3") }, "Use bge-m3"),
          ]),
      },
    });
    await flushPromises();

    const row = wrapper.get('.sdk-form-row-item[data-field="/embeddingModel"]');
    const rowControl = row.get(".sdk-form-row-control");
    // Default input remains rendered inside .sdk-form-row-control.
    const input = rowControl.get<HTMLInputElement>("input");
    expect(input.element.value).toBe("text-embedding-3-small");

    // Trailing slot renders right inside .sdk-form-row-control beneath the control.
    const afterHost = rowControl.get('.sdk-owner-form-field-after[data-field-after="/embeddingModel"]');
    expect(afterHost.get(".after-value").text()).toBe("text-embedding-3-small");
    expect(afterHost.get(".after-changed").text()).toBe("false");
    expect(afterHost.get(".after-disabled").text()).toBe("false");

    await afterHost.get("button.after-set").trigger("click");
    await nextTick();
    expect(input.element.value).toBe("bge-m3");
    expect(afterHost.get(".after-value").text()).toBe("bge-m3");
    expect(form.dirtyFields.value.has("/embeddingModel")).toBe(true);
  });

  it("supports #field-after-* in stacked/left-label layout, nested dot-paths, array items, raw pointers, and ignores empty/comment slots", async () => {
    const showDynamicTip = ref(false);
    const { wrapper } = mountObjectForm({
      props: { layout: "stacked", labelPosition: "left", labelWidth: "100px" },
      slots: {
        "field-after-embeddingModel": () =>
          showDynamicTip.value
            ? [h("span", { class: "dynamic-tip" }, "Model ready")]
            : [createCommentVNode("v-if")],
        "field-after-modelSelection.modelId": (scope: Record<string, any>) =>
          h("span", { class: "nested-after" }, `Model=${scope.value}`),
        "field-after-items.*.skillId": (scope: Record<string, any>) =>
          h("span", { class: "array-item-after" }, `${scope.arrayPath}[${scope.index}]=${scope.value}`),
      },
    });
    await flushPromises();

    // Empty/comment slot does not render .sdk-owner-form-field-after initially.
    const embeddingField = wrapper.get('.sdk-form-field-frame[data-field="/embeddingModel"]');
    expect(embeddingField.find("input").exists()).toBe(true);
    expect(embeddingField.find('[data-field-after="/embeddingModel"]').exists()).toBe(false);

    // Becomes visible reactively when slot output becomes non-empty.
    showDynamicTip.value = true;
    await nextTick();
    const embeddingAfter = embeddingField.get('.sdk-owner-form-field-after[data-field-after="/embeddingModel"]');
    expect(embeddingAfter.get(".dynamic-tip").text()).toBe("Model ready");

    // Nested object dot-path renders inside the nested field's frame.
    const nestedField = wrapper.get('.sdk-form-field-frame[data-field="/modelSelection/modelId"]');
    expect(nestedField.get("input").element.value).toBe("gpt-4o");
    expect(nestedField.get('[data-field-after="/modelSelection/modelId"] .nested-after').text()).toBe("Model=gpt-4o");

    // Array item dot-path renders inside the array item field's frame.
    const arrayItemField = wrapper.get('.sdk-form-field-frame[data-field="/items/0/skillId"]');
    expect(arrayItemField.get('[data-field-after="/items/0/skillId"] .array-item-after').text()).toBe("/items[0]=sql-query");

    // Raw JSON Pointer slot name also resolves when dot-path slot is absent.
    const rawPointerForm = mountObjectForm({
      slots: {
        "field-after-/embeddingModel": (scope: Record<string, any>) =>
          h("span", { class: "raw-pointer-after" }, `Raw=${scope.value}`),
      },
    });
    await flushPromises();
    expect(rawPointerForm.wrapper.get('[data-field-after="/embeddingModel"] .raw-pointer-after').text()).toBe(
      "Raw=text-embedding-3-small",
    );
  });
});
