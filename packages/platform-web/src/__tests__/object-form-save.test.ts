import { flushPromises, mount } from "@vue/test-utils";
import { computed, nextTick, shallowRef } from "vue";
import { createI18n } from "vue-i18n";
import { describe, expect, it, vi } from "vitest";
import type { PanelFormDescription, ProjectionOperationParam } from "@ontomato/contracts/panel-projection";
import { panelManifestSchema } from "@ontomato/contracts/panel-manifest";
import type { PanelOwnerOperationDescriptor } from "@ontomato/contracts/panel-operations";
import type { ProductProjection } from "@ontomato/contracts/product-panels";
import ReferenceChoice from "../../../apps-sdk/src/base/ReferenceChoice.vue";
import ObjectForm from "../../../apps-sdk/src/base/ObjectForm.vue";
import { panelContextKey, projectionKey, type PanelContext } from "../../../apps-sdk/src/panel/context";
import { resolveFormSaveAnswer } from "../../../apps-sdk/src/panel/member-forms";
import { createPanelInstance, PanelConfirmationDeferred, PanelOperationDeferred, type PanelInstance, type PanelWriteResult } from "../../../apps-sdk/src/panel/instance";
import { panelMemberKey, type PanelMemberContext } from "../../../apps-sdk/src/panel/member";
import type { MemberOperationsState } from "../../../apps-sdk/src/panel/member-operations";

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
    save: { method: "POST", path: "/save", bodySchema: {} },
  };
}

function receipt(primaryKey: string | null = null, affectedKeys = primaryKey === null ? [] : ["existing-customer", primaryKey]): PanelWriteResult {
  return {
    decision: "confirm",
    named: [],
    response: {
      kind: "dispatched", intentId: "save-intent",
      outcome: {
        kind: "success", data: { savedName: "Customer" }, message: "Customer created",
        ...(primaryKey === null ? {} : { created: { objectType: customerType, primaryKey } }),
        affected: {
          objects: affectedKeys.map(primaryKey => ({ objectType: customerType, primaryKey })),
          objectTypes: [customerType],
        },
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

function openForm({ platform = false, auxiliary = false, campus, actions, createForm = description(""), renderFields = false, confirmLeaveUnsaved }: {
  platform?: boolean;
  auxiliary?: boolean;
  campus?: ProjectionOperationParam;
  actions?: {
    declared: NonNullable<ProductProjection["operations"]>;
    admitted: Record<string, PanelOwnerOperationDescriptor>;
  };
  createForm?: PanelFormDescription;
  renderFields?: boolean;
  confirmLeaveUnsaved?: () => Promise<boolean>;
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
  const selectedRead = deferred<PanelFormDescription>();
  const read: PanelMemberContext["data"]["read"] = async name => ({
    status: "ready", value: name === "createForm" ? createForm : await selectedRead.promise,
  });
  const write = vi.fn<Parameters<PanelInstance["writeOperation"]>, ReturnType<PanelInstance["writeOperation"]>>()
    .mockResolvedValue(receipt());
  const notify = vi.fn();
  const baseInstance = createPanelInstance(manifest, {
    pageKey: "test-page",
    url: () => "/test",
    label: () => "Test",
    initial: { campus: "North" },
    readProjection: async () => projection,
    text: (key: string) => key,
    operations: {
      describe: async () => { throw new Error("unexpected describe"); },
      prepare: async () => { throw new Error("unexpected prepare"); },
      read: async () => { throw new Error("unexpected read"); },
      cancel: async () => {},
      upload: async () => { throw new Error("unexpected upload"); },
    },
    confirmOperation: async () => { throw new Error("unexpected confirm"); },
    notify,
    confirmLeaveUnsaved,
  });
  const instance = { ...baseInstance, writeOperation: write };
  const state = instance.state;
  const forms = instance.forms;
  const panel = { instance, manifest, notify, confirmLeaveUnsaved } satisfies Pick<PanelContext, "manifest" | "notify" | "confirmLeaveUnsaved"> & { instance: typeof instance };
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
    slots: renderFields ? {} : { default: () => "Customer editor" },
    global: {
      plugins: [createI18n({ legacy: false, locale: "en", missingWarn: false, fallbackWarn: false })],
      provide: {
        [panelContextKey]: panel,
        [panelMemberKey]: () => member,
        [projectionKey]: { slot: "form", projection, inputs: {} },
      },
    },
  });
  return { wrapper, state, write, selectedRead, notify, operations, forms, panel, member, form: forms.handle("form")! };
}

const affectedKeys = [[], ["existing-customer"], ["existing-customer", "another-customer"]];

describe("resolveFormSaveAnswer", () => {
  const draft = { kind: "draft" } as const;

  it.each([customerType, null])("returns the declared key for form type %s even with two affected objects", type => {
    expect(resolveFormSaveAnswer(receipt("new-customer"), draft, type))
      .toEqual({ primaryKey: "new-customer", message: "Customer created", data: { savedName: "Customer" } });
  });

  it.each(affectedKeys.map(keys => [keys.length, keys] as const))("returns no key with %i affected objects and no created identity", (_, keys) => {
    expect(resolveFormSaveAnswer(receipt(null, keys), draft, customerType))
      .toEqual({ primaryKey: null, message: "Customer created", data: { savedName: "Customer" } });
  });

  it("ignores a created identity for a different form type", () => {
    expect(resolveFormSaveAnswer(receipt("new-customer"), draft, platformType))
      .toEqual({ primaryKey: null, message: "Customer created", data: { savedName: "Customer" } });
  });

  it("keeps the selected object's key on edit", () => {
    const target = { kind: "object", objectType: customerType, primaryKey: "selected-customer" } as const;
    expect(resolveFormSaveAnswer(receipt("new-customer"), target, customerType))
      .toEqual({ primaryKey: "selected-customer", message: "Customer created", data: { savedName: "Customer" } });
  });
});

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
    expect(wrapper.emitted("saved")).toEqual([[{ className: customerType, primaryKey }, expect.objectContaining({ data: { savedName: "Customer" } })]]);
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
    expect(write.mock.calls[0]?.slice(0, 2)).toEqual(["form.create", {
      call: { target: null, input: { values: { name: "Ada", campus: "North" } } },
    }]);
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
    expect(write.mock.calls[0]?.slice(0, 2)).toEqual(["form.create", {
      call: { target: null, input: { values: { name: "Ada", campus: "Owner default" } } },
    }]);

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
    expect(write.mock.calls[0]?.slice(0, 2)).toEqual(["form.persist", {
      call: {
        target: { kind: "object", objectType: platformType, primaryKey: "article" },
        input: { values: { name: "Updated article", campus: "North", note: "" }, submittedFields: ["/name", "/campus"] },
      },
    }]);
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
    expect(write.mock.calls[0]?.slice(0, 2)).toEqual(["form.create", {
      call: {
        target: null,
        input: { values: {
          campus: "North", name: "Ada", customer_note: "", contact_json: JSON.stringify({ grade: "B", phone: null }),
        } },
      },
    }]);
    wrapper.unmount();
  });

  it.each(affectedKeys.map(keys => [keys.length, keys] as const))("resets to the create baseline and reports success with %i affected objects and no created identity", async (_, keys) => {
    const baseline = description("New customer");
    const { wrapper, form, state, write, notify } = openForm({ createForm: baseline });
    write.mockResolvedValueOnce(receipt(null, keys));
    await flushPromises();
    form.set("/name", "Ada");
    expect(form.dirty.value).toBe(true);

    await expect(form.submit()).resolves.toEqual({ primaryKey: null, message: "Customer created", data: { savedName: "Customer" } });
    expect(state.values.value.selected).toBeNull();
    expect(form.values.value).toEqual(baseline.values);
    expect(form.dirty.value).toBe(false);
    expect(wrapper.emitted("saved")).toEqual([[{ className: customerType, primaryKey: null }, expect.objectContaining({ data: { savedName: "Customer" } })]]);
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
    expect(wrapper.emitted("saved")).toEqual([[{ className: customerType, primaryKey: "new-customer" }, expect.objectContaining({ data: { savedName: "Customer" } })]]);
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
    expect(wrapper.emitted("saved")).toEqual([[selected, expect.objectContaining({ data: { savedName: "Customer" } })]]);
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

  it("marks all non-hidden platform form fields read-only without Action copy when form.save is not admitted, and unlocks once admitted", async () => {
    const ownerReason = "Owner locked field";
    const platformSave: PanelOwnerOperationDescriptor = {
      kind: "form.save",
      handlerRef: `${platformType}.save`,
      effect: "write",
      target: { source: "draft", slot: "form" },
      batch: false,
      label: "Save knowledge",
      inputSchema: {},
      resultSchema: {},
    };
    const createForm: PanelFormDescription = {
      values: {
        locked: "Fixed",
        secret: "hidden-val",
        name: "Knowledge A",
        meta: { summary: "Summary" },
        items: [{ title: "Row 1" }],
      },
      fields: [
        { path: "/locked", label: "Locked", valueSchema: { type: "string" }, required: false, readOnly: true, readOnlyReason: ownerReason, control: { kind: "text" } },
        { path: "/secret", label: "Secret", valueSchema: { type: "string" }, required: false, readOnly: false, control: { kind: "hidden" } },
        { path: "/name", label: "Name", valueSchema: { type: "string" }, required: true, readOnly: false, control: { kind: "text" } },
        {
          path: "/meta",
          label: "Meta",
          valueSchema: { type: "object" },
          required: false,
          readOnly: false,
          control: {
            kind: "object",
            fields: [{ path: "/summary", label: "Summary", valueSchema: { type: "string" }, required: false, readOnly: false, control: { kind: "text" } }],
          },
        },
        {
          path: "/items",
          label: "Items",
          valueSchema: { type: "array" },
          required: false,
          readOnly: false,
          control: {
            kind: "object-array",
            itemFields: [{ path: "/title", label: "Title", valueSchema: { type: "string" }, required: false, readOnly: false, control: { kind: "text" } }],
          },
        },
      ],
      errors: [],
      save: { method: "POST", path: "/knowledge", bodySchema: {} },
    };

    const { wrapper, form, operations, write } = openForm({
      platform: true,
      createForm,
      actions: {
        declared: {
          review: { operation: { kind: "Action", id: "review-knowledge" } },
        },
        admitted: {
          review: customerAction({ source: "none" }, { name: {} }),
        },
      },
    });
    // Simulate lacking permission for `persist` (`platform: true` adds `persist` to declared & admitted by default, so strip it from admitted).
    operations.value = {
      status: "ready",
      value: { review: customerAction({ source: "none" }, { name: {} }) },
    };
    await flushPromises();

    // Every non-hidden field (including nested object & object-array children) is read-only without Action copy.
    expect(form.fields.value.find((f) => f.path === "/locked")?.readOnly).toBe(true);
    expect(form.fields.value.find((f) => f.path === "/locked")?.readOnlyReason).toBe(ownerReason);
    expect(form.fields.value.find((f) => f.path === "/secret")?.readOnly).toBe(false);
    const nameField = form.fields.value.find((f) => f.path === "/name")!;
    expect(nameField.readOnly).toBe(true);
    expect(nameField.readOnlyReason).toBeUndefined();
    const metaField = form.fields.value.find((f) => f.path === "/meta")!;
    expect(metaField.readOnly).toBe(true);
    expect(metaField.readOnlyReason).toBeUndefined();
    expect(metaField.control.kind === "object" && metaField.control.fields[0]?.readOnly).toBe(true);
    const itemsField = form.fields.value.find((f) => f.path === "/items")!;
    expect(itemsField.readOnly).toBe(true);
    expect(itemsField.readOnlyReason).toBeUndefined();
    expect(itemsField.control.kind === "object-array" && itemsField.control.itemFields[0]?.readOnly).toBe(true);
    expect(wrapper.text()).not.toContain("Not modified by the current save action");

    expect(form.canSubmit.value).toBe(false);
    const createBtn = wrapper.findAll(".sdk-owner-form-actions button").at(-1)!;
    expect((createBtn.element as HTMLButtonElement).disabled).toBe(true);
    await expect(form.submit()).rejects.toThrow("admits no save");
    expect(write).not.toHaveBeenCalled();

    // Granting platform `form.save` unlocks editable fields while preserving owner-declared read-only reasons.
    operations.value = {
      status: "ready",
      value: { persist: platformSave, review: customerAction({ source: "none" }, { name: {} }) },
    };
    await flushPromises();

    expect(form.fields.value.find((f) => f.path === "/locked")?.readOnly).toBe(true);
    expect(form.fields.value.find((f) => f.path === "/locked")?.readOnlyReason).toBe(ownerReason);
    expect(form.fields.value.find((f) => f.path === "/name")?.readOnly).toBe(false);
    const unlockedMeta = form.fields.value.find((f) => f.path === "/meta")!;
    expect(unlockedMeta.readOnly).toBe(false);
    expect(unlockedMeta.control.kind === "object" && unlockedMeta.control.fields[0]?.readOnly).toBe(false);
    const unlockedItems = form.fields.value.find((f) => f.path === "/items")!;
    expect(unlockedItems.readOnly).toBe(false);
    expect(unlockedItems.control.kind === "object-array" && unlockedItems.control.itemFields[0]?.readOnly).toBe(false);
    expect((wrapper.findAll(".sdk-owner-form-actions button").at(-1)!.element as HTMLButtonElement).disabled).toBe(false);

    form.set("/name", "Knowledge B");
    await nextTick();
    expect(form.canSubmit.value).toBe(true);
    write.mockResolvedValueOnce({
      decision: "confirm",
      named: [],
      response: {
        kind: "dispatched",
        intentId: "save-intent",
        outcome: {
          kind: "success",
          data: {},
          message: "Knowledge created",
          created: { objectType: platformType, primaryKey: "bk-new" },
          affected: { objects: [{ objectType: platformType, primaryKey: "bk-old" }, { objectType: platformType, primaryKey: "bk-new" }], objectTypes: [platformType] },
        },
      },
    });
    await expect(form.submit()).resolves.toMatchObject({ primaryKey: "bk-new" });
    expect(write.mock.calls[0]?.[0]).toBe("form.persist");
    wrapper.unmount();
  });
});

function fieldSaveDescription(): PanelFormDescription {
  const form = description("Existing");
  return {
    ...form,
    submitOn: "blur",
    fields: form.fields.map(field => field.path === "/campus" ? { ...field, submitOn: "change" }
      : field.path === "/note" ? { ...field, submitOn: "manual" } : field),
  };
}

describe("Automatic field save", () => {
  it("queues blur and change writes, saves just their paths, and keeps the manual draft", async () => {
    const { wrapper, form, state, write, selectedRead } = openForm({ platform: true, renderFields: true });
    const before = fieldSaveDescription();
    state.set("selected", objectRef(platformType, "article"));
    selectedRead.resolve(before);
    await flushPromises();

    form.set("/note", "Unsaved");
    const first = deferred<PanelWriteResult>();
    const second = deferred<PanelWriteResult>();
    write.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    const name = wrapper.get('[data-field="/name"] input');
    await name.setValue("New name");
    expect(write).not.toHaveBeenCalled();
    const blurred = name.trigger("focusout");
    form.setFromControl!("/campus", "New campus");
    await blurred;
    await flushPromises();

    expect(form.submitting.value).toBe(true);
    expect(write).toHaveBeenCalledTimes(1);
    expect(write.mock.calls[0]?.[1]).toMatchObject({ call: { input: {
      submittedFields: ["/name"],
      values: { name: "New name", campus: before.values.campus, note: "" },
    } } });
    before.values.name = "New name";
    first.resolve(receipt());
    await flushPromises();
    expect(write.mock.calls[1]?.[1]).toMatchObject({ call: { input: {
      submittedFields: ["/campus"],
      values: { campus: "New campus", note: "" },
    } } });
    second.resolve({ decision: "cancel", named: [] });
    await flushPromises();
    expect(form.values.value).toMatchObject({ name: "New name", campus: before.values.campus, note: "Unsaved" });
    expect(form.dirty.value).toBe(true);
    expect(form.submitting.value).toBe(false);
    wrapper.unmount();
  });

  it("holds a requested target switch while saving and preserves a refused field edit", async () => {
    const confirmLeaveUnsaved = vi.fn(async () => false);
    const { wrapper, form, state, write, selectedRead } = openForm({ platform: true, confirmLeaveUnsaved });
    const original = objectRef(platformType, "article");
    state.set("selected", original);
    selectedRead.resolve(fieldSaveDescription());
    await flushPromises();

    const pending = deferred<PanelWriteResult>();
    write.mockReturnValueOnce(pending.promise);
    form.setFromControl!("/campus", "Unaccepted");
    state.set("selected", objectRef(platformType, "other"));
    await flushPromises();
    expect(form.submitting.value).toBe(true);
    expect(confirmLeaveUnsaved).not.toHaveBeenCalled();
    pending.resolve({
      decision: "confirm", named: [],
      response: { kind: "dispatched", intentId: "save-intent", outcome: { kind: "refusal", code: "VALIDATION_FAILED", message: "Rejected field" } },
    });
    await flushPromises();
    expect(confirmLeaveUnsaved).toHaveBeenCalledOnce();
    expect(state.values.value.selected).toEqual(original);
    expect(form.dirty.value).toBe(true);
    expect(form.values.value.campus).toBe("Unaccepted");
    wrapper.unmount();
  });

  it.each([false, true])("stages an agent field write until the confirmation is answered (approve: %s)", async (approve) => {
    const { wrapper, form, forms, state, write, selectedRead } = openForm({ platform: true });
    const before = fieldSaveDescription();
    state.set("selected", objectRef(platformType, "article"));
    selectedRead.resolve(before);
    await flushPromises();
    const cancel = vi.fn(async () => {});
    const dispatch = vi.fn(async () => {
      expect(write.mock.calls[0]?.[2]?.evaluateSubmission?.("confirm")?.ok).toBe(true);
      before.values.name = "Proposed";
      return receipt();
    });
    const preparation = {
      intentId: "save-intent", questionId: "confirm-save", operationId: "form.persist", label: "Save",
      confirmation: { kind: "none" },
    } satisfies ConstructorParameters<typeof PanelOperationDeferred>[0]["preparation"];
    write.mockRejectedValueOnce(new PanelOperationDeferred({
      preparation, named: [], isStillValid: () => ({ ok: true }), dispatchNow: dispatch, cancelNow: cancel,
    }));

    const filled = await forms.fill("form", { "/name": "Proposed", "/note": "Manual draft" }, {
      executeWrite: async (operation, submit) => {
        try {
          await submit({ agentRun: { sessionId: "session", runId: "run", toolCallId: "tool" } });
          throw new Error("Expected a deferred save");
        } catch (error) {
          if (!(error instanceof PanelConfirmationDeferred)) throw error;
          return { ok: true, kind: "awaiting_confirmation", operation, ...preparation, confirmation: error.confirmation };
        }
      },
    });
    expect(write.mock.calls[0]?.[1]).toMatchObject({ call: { input: {
      submittedFields: ["/name"], values: { name: "Proposed", note: "" },
    } } });
    expect(filled).toMatchObject({ ok: true, write: { kind: "awaiting_confirmation" } });
    expect(form.values.value).toMatchObject({ name: "Existing", note: "Manual draft" });
    if (filled.ok && filled.write?.ok && filled.write.kind === "awaiting_confirmation") {
      if (approve) {
        await expect(filled.write.confirmation.dispatch()).resolves.toMatchObject({ ok: true });
      } else {
        await filled.write.confirmation.cancel({ code: "OPERATION_CANCELLED", message: "Cancelled" });
      }
    }
    expect(cancel).toHaveBeenCalledTimes(approve ? 0 : 1);
    expect(dispatch).toHaveBeenCalledTimes(approve ? 1 : 0);
    expect(form.values.value).toMatchObject({ name: approve ? "Proposed" : "Existing", note: "Manual draft" });
    wrapper.unmount();
  });
});

describe("ReferenceChoice refresh", () => {
  it("keeps the active keyword, selected value and loaded options across failure and retry", async () => {
    const { wrapper: formWrapper, form, panel, member } = openForm({ platform: true });
    await flushPromises();
    form.set("/name", "held");
    form.set("/note", "unsaved");
    const option = { primaryKey: "held", value: "held", label: "Selected item", unavailable: { reason: "Owner reason" } };
    type Read = PanelMemberContext["data"]["read"];
    const read = vi.fn<Parameters<Read>, ReturnType<Read>>()
      .mockResolvedValue({ status: "ready", value: { options: [option] } });
    const projection = { ...member.projection, config: { refreshable: true } };
    const wrapper = mount(ReferenceChoice, {
      props: { formSlot: "form", path: "/name" },
      global: {
        plugins: [createI18n({ legacy: false, locale: "en", missingWarn: false, fallbackWarn: false })],
        provide: {
          [panelContextKey]: panel,
          [panelMemberKey]: () => ({ ...member, projection, data: { ...member.data, read } }),
          [projectionKey]: { slot: "reference", projection, inputs: {} },
        },
      },
    });
    await flushPromises();
    const select = wrapper.findComponent({ name: "ElSelect" });
    await (select.props("remoteMethod") as (word: string) => Promise<void>)("needle");
    read.mockRejectedValueOnce(new Error("private transport detail"))
      .mockResolvedValueOnce({ status: "error", message: "private owner detail" });
    await wrapper.get('button[aria-label="common.refresh"]').trigger("click");
    await flushPromises();
    expect(wrapper.get('[role="alert"]').text()).not.toContain("private");
    expect(select.props("modelValue")).toBe("held");
    expect(wrapper.findComponent({ name: "ElOption" }).props("disabled")).toBe(true);
    await wrapper.get('[role="alert"] button').trigger("click");
    await flushPromises();
    expect(wrapper.find('[role="alert"]').exists()).toBe(false);
    expect(read.mock.calls.at(-2)).toMatchObject(["options", { keyword: "needle" }]);
    expect(read.mock.calls.at(-1)).toEqual(["selected", { values: ["held"] }]);
    expect(form.values.value).toMatchObject({ name: "held", note: "unsaved" });
    wrapper.unmount();
    formWrapper.unmount();
  });
});
