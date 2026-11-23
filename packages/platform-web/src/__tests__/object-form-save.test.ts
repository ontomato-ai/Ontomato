import { flushPromises, mount } from "@vue/test-utils";
import { computed, nextTick, shallowRef } from "vue";
import { createI18n } from "vue-i18n";
import { describe, expect, it, vi } from "vitest";
import type { PanelFormDescription, ProjectionOperationParam } from "@ontomato/contracts/panel-projection";
import { panelManifestSchema } from "@ontomato/contracts/panel-manifest";
import type { PanelOwnerOperationDescriptor } from "@ontomato/contracts/panel-operations";
import type { ProductProjection } from "@ontomato/contracts/product-panels";
import ObjectForm from "../../../apps-sdk/src/base/ObjectForm.vue";
import { panelContextKey, projectionKey, type PanelContext } from "../../../apps-sdk/src/panel/context";
import { PanelFormAdapters, type ReceivedPanelDraft } from "../../../apps-sdk/src/panel/draft";
import type { PanelInstance, PanelWriteResult } from "../../../apps-sdk/src/panel/instance";
import { panelMemberKey, type PanelMemberContext } from "../../../apps-sdk/src/panel/member";
import type { MemberOperationsState } from "../../../apps-sdk/src/panel/member-operations";
import { createPanelState } from "../../../apps-sdk/src/panel/state";

const customerType = "Customer";
const platformType = "platform:BusinessKnowledge";
const objectRef = (className: string, primaryKey: string) => ({ className, primaryKey });

function description(name: string): PanelFormDescription {
  return {
    values: { name, campus: "Owner default", note: "" },
    fields: ["name", "campus", "note"].map(key => ({
      path: `/${key}`, label: key, valueSchema: { type: "string" }, required: false, readOnly: false, control: { kind: "text" },
    })),
    errors: [],
    save: { method: "POST", path: "/save", bodySchema: {}, draftOperation: "save-customer" },
  };
}

function receipt(primaryKey: string | null = null): PanelWriteResult {
  return {
    decision: "confirm",
    named: [],
    response: {
      kind: "dispatched", intentId: "save-intent",
      outcome: {
        kind: "success", data: {}, message: "Customer created",
        ...(primaryKey === null ? {} : {
          affected: { objects: [{ objectType: customerType, primaryKey }], objectTypes: [customerType] },
        }),
      },
    },
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { resolve, promise };
}

function openForm({ platform = false, auxiliary = false, campus }: {
  platform?: boolean;
  auxiliary?: boolean;
  campus?: ProjectionOperationParam;
} = {}) {
  const className = platform ? platformType : customerType;
  const type = platform ? { kind: "PlatformObjectType" as const, id: className } : { kind: "ObjectType" as const, id: className };
  const article = objectRef(platformType, "article");
  const sideOperation: PanelOwnerOperationDescriptor = {
    kind: "action", handlerRef: "knowledge.approve", effect: "write", target: { source: "literal", literal: article },
    batch: true, label: "Approve", inputSchema: {}, resultSchema: {},
  };
  const action: PanelOwnerOperationDescriptor = {
    kind: "action", handlerRef: "actions.execute", effect: "write", target: { source: "none" },
    batch: false, label: "Create customer", resultSchema: {},
    inputSchema: { type: "object", properties: { values: { type: "object", properties: { name: {}, campus: {} } } } },
  };
  const platformSave: PanelOwnerOperationDescriptor = {
    kind: "form.save", handlerRef: `${platformType}.save`, effect: "write", target: { source: "draft", slot: "form" },
    batch: false, label: "Save knowledge", inputSchema: {}, resultSchema: {},
  };
  const projection: ProductProjection = {
    id: "customer-form", name: "Customer form", description: "", visibility: "domain",
    domainId: "domain", ownerId: "owner", editable: true, revision: 1, createdAt: "", updatedAt: "",
    componentId: "@ontomato/sdk:ObjectForm",
    inputs: { target: { kind: "object", objectType: className }, campus: { kind: "scalar", type: "string" } },
    outputs: {},
    config: campus ? { fixedFields: { "/campus": { state: "campus" } } } : {},
    data: {
      form: { read: "form", source: { object: { input: "target" } }, params: {} },
      createForm: { read: "createForm", source: { type }, params: {} },
    },
    operations: {
      create: { operation: { kind: "Action", id: "create-customer" }, params: campus ? { campus } : undefined },
      ...(auxiliary ? {
        approve: { operation: { kind: "PlatformOperation" as const, id: sideOperation.handlerRef }, target: { literal: article } },
      } : {}),
      ...(platform ? { persist: { operation: { kind: "PlatformOperation" as const, id: platformSave.handlerRef }, target: { input: "target" } } } : {}),
    },
  };
  const manifest = panelManifestSchema.parse({
    state: { selected: { type: { kind: "object", objectType: className } }, campus: { type: { kind: "scalar", type: "string" } } },
    members: { form: { target: { projectionId: projection.id }, inputs: { target: { state: "selected" }, campus: { state: "campus" } } } },
  });
  const state = createPanelState(manifest, { campus: "North" });
  const forms = new PanelFormAdapters();
  const selectedRead = deferred<PanelFormDescription>();
  const draft = shallowRef<ReceivedPanelDraft<Record<string, unknown>> | null>(null);
  const read: PanelMemberContext["data"]["read"] = async name => ({
    status: "ready", value: name === "createForm" ? description("") : await selectedRead.promise,
  });
  const write = vi.fn<Parameters<PanelInstance["writeOperation"]>, ReturnType<PanelInstance["writeOperation"]>>()
    .mockResolvedValue(receipt());
  const instance = {
    state, forms, draft, writeOperation: write,
    settleDraft: vi.fn(async () => { draft.value = null; }),
    onObjectChanged: () => () => {},
    onOperationCompleted: () => () => {},
    operationIdOf: (slot, name) => `${slot}.${name}`,
    notifyFormEdited: () => {},
    objectName: () => null,
  } satisfies Pick<PanelInstance, "state" | "forms" | "draft" | "writeOperation" | "settleDraft" | "onObjectChanged"
    | "onOperationCompleted" | "operationIdOf" | "notifyFormEdited" | "objectName">;
  const notify = vi.fn();
  const panel = { instance, manifest, notify } satisfies Pick<PanelContext, "manifest" | "notify"> & { instance: typeof instance };
  const operations = shallowRef<MemberOperationsState>({
    status: "ready", value: { create: action, ...(auxiliary ? { approve: sideOperation } : {}), ...(platform ? { persist: platformSave } : {}) },
  });
  const member: PanelMemberContext = {
    key: "form", projection, scoped: true, operations: computed(() => operations.value),
    inputs: computed(() => ({ campus: state.values.value.campus as string })),
    data: { read, use: () => computed(() => ({ status: "awaiting" })) },
  };
  const wrapper = mount(ObjectForm, {
    props: { fixedFields: projection.config.fixedFields as InstanceType<typeof ObjectForm>["$props"]["fixedFields"] },
    slots: { default: () => "Customer editor" },
    global: {
      plugins: [createI18n({ legacy: false, locale: "en", missingWarn: false, fallbackWarn: false })],
      provide: {
        [panelContextKey]: panel,
        [panelMemberKey]: () => member,
        [projectionKey]: { slot: "form", projection, inputs: {} },
      },
    },
  });
  return { wrapper, state, write, selectedRead, notify, draft, operations, settleDraft: instance.settleDraft, form: forms.handle("form")! };
}

describe("ObjectForm save", () => {
  it.each([null, "new-customer"])("keeps a newly selected row while a create returns %s", async primaryKey => {
    const { wrapper, form, state, write, selectedRead, notify } = openForm();
    await flushPromises();
    form.set("/name", "New customer");
    const pending = deferred<PanelWriteResult>();
    write.mockReturnValueOnce(pending.promise);
    const saving = form.submit();
    const selected = objectRef(customerType, "existing-customer");
    state.set("selected", selected);
    await nextTick();

    pending.resolve(receipt(primaryKey));
    await expect(saving).resolves.toMatchObject({ primaryKey });
    expect(state.values.value.selected).toEqual(selected);
    expect(wrapper.emitted("saved")).toEqual([[{ className: customerType, primaryKey }]]);
    expect(notify).toHaveBeenCalledWith(expect.objectContaining({ kind: "success" }));

    selectedRead.resolve(description("Existing customer"));
    await flushPromises();
    expect(form.values.value.name).toBe("Existing customer");
    wrapper.unmount();
  });

  it("settles the submitted draft without changing the selection after unmount", async () => {
    const { wrapper, form, state, write, draft, settleDraft } = openForm();
    await flushPromises();
    form.set("/name", "New customer");
    draft.value = {
      slot: "form", target: { objectType: customerType }, operation: "save-customer",
      changed: new Set(["/name"]), form: { name: "New customer" },
      link: { sessionId: "session", runId: "run", path: "outputs/drafts/customer.page-draft.json" },
    };
    const pending = deferred<PanelWriteResult>();
    write.mockReturnValueOnce(pending.promise);
    const saving = form.submit();
    wrapper.unmount();

    pending.resolve(receipt("new-customer"));
    await expect(saving).resolves.toMatchObject({ primaryKey: "new-customer" });
    expect(state.values.value.selected).toBeNull();
    expect(settleDraft).toHaveBeenCalledWith("form", "new-customer");
  });

  it.each([
    { literal: "North" },
    { input: "campus" },
  ])("submits fixed Action parameters with wiring %j", async campus => {
    const { wrapper, form, write } = openForm({ campus });
    await flushPromises();
    expect(form.fields.value.find(field => field.path === "/campus")?.readOnly).toBe(true);
    expect(form.values.value.campus).toBe("North");
    form.set("/name", "Ada");

    await form.submit();
    expect(write).toHaveBeenCalledWith("form.create", {
      call: { target: null, input: { values: { name: "Ada", campus: "North" } } },
    });
    wrapper.unmount();
  });

  it("keeps unwired fields read-only and refuses unwired changes before writing", async () => {
    const { wrapper, form, write, operations } = openForm({ auxiliary: true });
    await flushPromises();
    expect(form.fields.value.find(field => field.path === "/name")?.readOnly).toBe(false);
    expect(form.fields.value.find(field => field.path === "/note")?.readOnly).toBe(true);
    form.set("/note", "Keep this unsaved");

    await expect(form.submit()).rejects.toMatchObject({ fields: { "/note": expect.any(String) } });
    expect(write).not.toHaveBeenCalled();
    expect(form.values.value.note).toBe("Keep this unsaved");

    await form.reset();
    form.set("/name", "Ada");
    await form.submit();
    expect(write).toHaveBeenCalledWith("form.create", {
      call: { target: null, input: { values: { name: "Ada", campus: "Owner default" } } },
    });

    operations.value = { status: "loading" };
    await nextTick();
    expect(form.fields.value.find(field => field.path === "/name")?.readOnly).toBe(true);
    wrapper.unmount();
  });

  it("uses the owner's platform form save and submits its fixed field paths", async () => {
    const { wrapper, form, write, state, selectedRead } = openForm({ platform: true, campus: { literal: "North" } });
    state.set("selected", objectRef(platformType, "article"));
    selectedRead.resolve(description("Original article"));
    await flushPromises();
    expect(form.fields.value.find(field => field.path === "/note")?.readOnly).toBe(false);
    form.set("/name", "Updated article");

    await form.submit();
    expect(write).toHaveBeenCalledWith("form.persist", {
      call: {
        target: { kind: "object", objectType: platformType, primaryKey: "article" },
        input: { values: { name: "Updated article", campus: "North", note: "" }, submittedFields: ["/name", "/campus"] },
      },
    });
    wrapper.unmount();
  });
});
