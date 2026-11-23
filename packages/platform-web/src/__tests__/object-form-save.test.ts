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
import { PanelFormAdapters } from "../../../apps-sdk/src/panel/forms";
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

function customerAction(
  target: PanelOwnerOperationDescriptor["target"] = { source: "none" },
  properties: PanelOwnerOperationDescriptor["inputSchema"] = { name: {}, campus: {} },
): PanelOwnerOperationDescriptor {
  return {
    kind: "action", handlerRef: "actions.execute", effect: "write", target,
    batch: false, label: "Customer action", resultSchema: {},
    inputSchema: { type: "object", properties: { values: { type: "object", properties } } },
  };
}

const editTarget = { input: "target" };
const updateCustomer = { operation: { kind: "Action", id: "update-customer" }, target: editTarget } as const;

function openForm({ platform = false, auxiliary = false, campus, actions, createForm = description("") }: {
  platform?: boolean;
  auxiliary?: boolean;
  campus?: ProjectionOperationParam;
  actions?: {
    declared: NonNullable<ProductProjection["operations"]>;
    admitted: Record<string, PanelOwnerOperationDescriptor>;
  };
  createForm?: PanelFormDescription;
} = {}) {
  const className = platform ? platformType : customerType;
  const type = platform ? { kind: "PlatformObjectType" as const, id: className } : { kind: "ObjectType" as const, id: className };
  const article = objectRef(platformType, "article");
  const sideOperation: PanelOwnerOperationDescriptor = {
    kind: "action", handlerRef: "knowledge.approve", effect: "write", target: { source: "literal", literal: article },
    batch: true, label: "Approve", inputSchema: {}, resultSchema: {},
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
      ...(actions?.declared ?? {
        create: { operation: { kind: "Action", id: "create-customer" }, params: campus ? { campus } : undefined },
      }),
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
  const read: PanelMemberContext["data"]["read"] = async name => ({
    status: "ready", value: name === "createForm" ? createForm : await selectedRead.promise,
  });
  const write = vi.fn<Parameters<PanelInstance["writeOperation"]>, ReturnType<PanelInstance["writeOperation"]>>()
    .mockResolvedValue(receipt());
  const instance = {
    state, forms, writeOperation: write,
    onObjectChanged: () => () => {},
    onOperationCompleted: () => () => {},
    operationIdOf: (slot, name) => `${slot}.${name}`,
    registerActionHandler: () => () => {},
    objectName: () => null,
  } satisfies Pick<PanelInstance, "state" | "forms" | "writeOperation" | "onObjectChanged"
    | "onOperationCompleted" | "operationIdOf" | "registerActionHandler" | "objectName">;
  const notify = vi.fn();
  const panel = { instance, manifest, notify } satisfies Pick<PanelContext, "manifest" | "notify"> & { instance: typeof instance };
  const operations = shallowRef<MemberOperationsState>({
    status: "ready",
    value: {
      ...(actions?.admitted ?? { create: customerAction() }),
      ...(auxiliary ? { approve: sideOperation } : {}),
      ...(platform ? { persist: platformSave } : {}),
    },
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
  return { wrapper, state, write, selectedRead, notify, operations, form: forms.handle("form")! };
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

  it("finishes saving without changing the selection after unmount", async () => {
    const { wrapper, form, state, write, notify } = openForm();
    await flushPromises();
    form.set("/name", "New customer");
    const pending = deferred<PanelWriteResult>();
    write.mockReturnValueOnce(pending.promise);
    const saving = form.submit();
    wrapper.unmount();

    pending.resolve(receipt("new-customer"));
    await expect(saving).resolves.toMatchObject({ primaryKey: "new-customer" });
    expect(state.values.value.selected).toBeNull();
    expect(notify).toHaveBeenCalledWith(expect.objectContaining({ kind: "success" }));
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

  it("makes an edit form read-only when the owner admits review but not its declared save", async () => {
    const { wrapper, form, write, state, selectedRead } = openForm({
      actions: {
        declared: {
          save: updateCustomer,
          submitReview: { operation: { kind: "Action", id: "submit-customer-review" }, target: editTarget },
        },
        admitted: { submitReview: customerAction({ source: "input", ...editTarget }) },
      },
    });
    state.set("selected", objectRef(customerType, "existing-customer"));
    selectedRead.resolve(description("Existing customer"));
    await flushPromises();

    expect(form.fields.value.length).toBeGreaterThan(0);
    expect(form.fields.value.every(field => field.readOnly)).toBe(true);
    form.set("/name", "Programmatic edit");
    expect(form.canSubmit.value).toBe(false);
    await expect(form.submit()).rejects.toBeInstanceOf(Error);
    expect(write).not.toHaveBeenCalled();
    wrapper.unmount();
  });

  it("makes an edit form read-only when its only admitted action creates without a target", async () => {
    const { wrapper, form, write, state, selectedRead } = openForm();
    state.set("selected", objectRef(customerType, "existing-customer"));
    selectedRead.resolve(description("Existing customer"));
    await flushPromises();

    expect(form.fields.value.length).toBeGreaterThan(0);
    expect(form.fields.value.every(field => field.readOnly)).toBe(true);
    form.set("/name", "Programmatic edit");
    expect(form.canSubmit.value).toBe(false);
    await expect(form.submit()).rejects.toBeInstanceOf(Error);
    expect(write).not.toHaveBeenCalled();
    wrapper.unmount();
  });

  it("submits all four Action wiring sources and preserves scalar and nested clears", async () => {
    const baseline = description("Original customer");
    const { wrapper, form, write } = openForm({
      createForm: {
        ...baseline,
        values: { ...baseline.values, note: "Original note", contact: { grade: "B", phone: "555-0100" } },
        fields: [
          ...baseline.fields.filter(field => field.path === "/name"),
          {
            path: "/note", label: "Note", valueSchema: { type: ["string", "null"] },
            required: false, readOnly: false, control: { kind: "text" },
          },
          {
            path: "/contact", label: "Contact", valueSchema: { type: "object" }, required: false, readOnly: false,
            control: {
              kind: "object",
              fields: ["grade", "phone"].map(key => ({
                path: `/${key}`, label: key, valueSchema: { type: "string" },
                required: false, readOnly: false, control: { kind: "text" },
              })),
            },
          },
        ],
      },
      actions: {
        declared: {
          create: {
            operation: { kind: "Action", id: "create-customer" },
            params: {
              campus: { literal: "North" },
              customer_note: { formField: "/note" },
              contact_json: { formFields: { grade: "/contact/grade", phone: "/contact/phone" } },
            },
          },
        },
        admitted: {
          create: customerAction({ source: "none" }, {
            campus: { type: "string" }, name: { type: "string" }, customer_note: { type: "string" },
            contact_json: { type: "string", contentMediaType: "application/json" },
          }),
        },
      },
    });
    await flushPromises();
    form.set("/name", "Ada");
    form.set("/note", null);
    form.set("/contact", { grade: "B" });

    await form.submit();
    expect(write).toHaveBeenCalledWith("form.create", {
      call: {
        target: null,
        input: { values: {
          campus: "North", name: "Ada", customer_note: "", contact_json: JSON.stringify({ grade: "B", phone: null }),
        } },
      },
    });
    wrapper.unmount();
  });

  it("resets to the create baseline and emits success when the receipt has no key", async () => {
    const baseline = description("New customer");
    const { wrapper, form, state, notify } = openForm({ createForm: baseline });
    await flushPromises();
    form.set("/name", "Ada");
    expect(form.dirty.value).toBe(true);

    await expect(form.submit()).resolves.toMatchObject({ primaryKey: null });
    expect(state.values.value.selected).toBeNull();
    expect(form.values.value).toEqual(baseline.values);
    expect(form.dirty.value).toBe(false);
    expect(wrapper.emitted("saved")).toEqual([[{ className: customerType, primaryKey: null }]]);
    expect(notify).toHaveBeenCalledWith(expect.objectContaining({ kind: "success" }));
    wrapper.unmount();
  });

  it("selects the created object and clears dirty state when the receipt has a key", async () => {
    const { wrapper, form, state, write, selectedRead } = openForm();
    await flushPromises();
    form.set("/name", "Ada");
    expect(form.dirty.value).toBe(true);
    write.mockResolvedValueOnce(receipt("new-customer"));
    selectedRead.resolve(description("Ada"));

    await expect(form.submit()).resolves.toMatchObject({ primaryKey: "new-customer" });
    await flushPromises();
    expect(state.values.value.selected).toEqual(objectRef(customerType, "new-customer"));
    expect(form.values.value.name).toBe("Ada");
    expect(form.dirty.value).toBe(false);
    expect(wrapper.emitted("saved")).toEqual([[{ className: customerType, primaryKey: "new-customer" }]]);
    wrapper.unmount();
  });

  it("keeps the submitted values and clears dirty state after an edit", async () => {
    const { wrapper, form, state, selectedRead } = openForm({
      actions: {
        declared: { save: updateCustomer },
        admitted: { save: customerAction({ source: "input", ...editTarget }) },
      },
    });
    const selected = objectRef(customerType, "existing-customer");
    state.set("selected", selected);
    selectedRead.resolve(description("Existing customer"));
    await flushPromises();
    form.set("/name", "Ada");
    expect(form.dirty.value).toBe(true);

    await expect(form.submit()).resolves.toMatchObject({ primaryKey: "existing-customer" });
    expect(state.values.value.selected).toEqual(selected);
    expect(form.values.value.name).toBe("Ada");
    expect(form.dirty.value).toBe(false);
    expect(wrapper.emitted("saved")).toEqual([[selected]]);
    wrapper.unmount();
  });

  it("notifies instead of leaking refusal errors onto another row when switched away during create", async () => {
    const { wrapper, form, state, write, selectedRead, notify } = openForm();
    await flushPromises();
    form.set("/name", "Customer A");
    const pending = deferred<PanelWriteResult>();
    write.mockReturnValueOnce(pending.promise);
    const saving = form.submit();

    // Switch to row B (which has its own field error) before A's save is refused.
    state.set("selected", objectRef(customerType, "customer-b"));
    selectedRead.resolve({
      ...description("Customer B"),
      errors: [{ field: "/note", code: "invalid_format", message: "B note warning" }],
    });
    await flushPromises();
    expect(form.values.value.name).toBe("Customer B");
    expect(form.errors.value).toEqual({ "/note": "B note warning" });

    pending.resolve({
      decision: "confirm",
      named: [],
      response: {
        kind: "dispatched",
        intentId: "save-intent",
        outcome: {
          kind: "refusal",
          code: "VALIDATION_FAILED",
          message: "Validation failed",
          errors: [{ field: "/name", code: "already_exists", message: "Customer A already exists" }],
        },
      },
    });
    await expect(saving).rejects.toMatchObject({
      message: "Validation failed",
      fields: { "/name": "Customer A already exists" },
    });
    await flushPromises();

    // Row B's error bar stays completely untouched; user is notified which save failed and why.
    expect(form.errors.value).toEqual({ "/note": "B note warning" });
    expect(wrapper.find(".sdk-owner-form-refusal").exists()).toBe(false);
    expect(notify).toHaveBeenCalledTimes(1);
    expect(notify).toHaveBeenCalledWith({
      kind: "error",
      text: expect.stringMatching(/Customer action.*Customer A.*Validation failed.*Customer A already exists/),
    });
    wrapper.unmount();
  });

  it("keeps refusal errors off the new row when save was triggered via button click before switching", async () => {
    const { wrapper, form, state, write, selectedRead, notify } = openForm();
    await flushPromises();
    form.set("/name", "Draft Alpha");
    const pending = deferred<PanelWriteResult>();
    write.mockReturnValueOnce(pending.promise);

    // Trigger via the form's Save/Create button (`saveFromForm`) rather than programmatic submit().
    const createBtn = wrapper.findAll(".sdk-owner-form-actions button").at(-1)!;
    await createBtn.trigger("click");

    state.set("selected", objectRef(customerType, "customer-b"));
    selectedRead.resolve(description("Customer B"));
    await flushPromises();

    pending.resolve({
      decision: "confirm",
      named: [],
      response: {
        kind: "dispatched",
        intentId: "save-intent",
        outcome: {
          kind: "refusal",
          code: "DUPLICATE_NAME",
          message: "Duplicate name",
          errors: [{ field: "/name", code: "already_exists", message: "Duplicate name" }],
        },
      },
    });
    await flushPromises();

    expect(form.errors.value).toEqual({});
    expect(wrapper.find(".sdk-owner-form-refusal").exists()).toBe(false);
    expect(notify).toHaveBeenCalledTimes(1);
    expect(notify).toHaveBeenCalledWith({
      kind: "error",
      text: expect.stringMatching(/Draft Alpha.*Duplicate name/),
    });
    wrapper.unmount();
  });

  it("shows refusal errors inline without toast when staying on the originating form, and notifies if unmounted", async () => {
    const first = openForm();
    await flushPromises();
    first.form.set("/name", "Inline Alpha");
    first.write.mockResolvedValueOnce({
      decision: "confirm",
      named: [],
      response: {
        kind: "dispatched",
        intentId: "save-intent",
        outcome: {
          kind: "refusal",
          code: "INVALID_NAME",
          message: "Invalid name",
          errors: [{ field: "/name", code: "invalid_format", message: "Inline refusal" }],
        },
      },
    });
    await expect(first.form.submit()).rejects.toMatchObject({ fields: { "/name": "Inline refusal" } });
    expect(first.form.errors.value).toEqual({ "/name": "Inline refusal" });
    expect(first.notify).not.toHaveBeenCalled();
    first.wrapper.unmount();

    const second = openForm();
    await flushPromises();
    second.form.set("/name", "Unmounted Alpha");
    const pending = deferred<PanelWriteResult>();
    second.write.mockReturnValueOnce(pending.promise);
    const saving = second.form.submit();
    second.wrapper.unmount();

    pending.resolve({
      decision: "confirm",
      named: [],
      response: {
        kind: "dispatched",
        intentId: "save-intent",
        outcome: { kind: "refusal", code: "REFUSED", message: "Server refused", errors: [] },
      },
    });
    await expect(saving).rejects.toMatchObject({ message: "Server refused" });
    expect(second.notify).toHaveBeenCalledWith({
      kind: "error",
      text: expect.stringMatching(/Unmounted Alpha.*Server refused/),
    });
  });
});
