import { afterEach, expect, it, vi } from "vitest";
import { createApp, h, nextTick, ref, watch } from "vue";
import { createI18n } from "vue-i18n";
import ElementPlus from "element-plus";
import publicEn from "@ontomato/workbench-ui/locales/en";
import type { RuntimeJsonValue } from "@ontomato/contracts/agent-runtime-values";
import type { DirectPanelManifest } from "@ontomato/contracts/panel-manifest";
import type { DirectProjection } from "@ontomato/contracts/product-panels";
import type { ProductPanelReadResponse } from "@ontomato/contracts/panel-host";
import type { PanelHumanOperationPreparation } from "@ontomato/contracts/panel-agent";
import { ATTRIBUTE, OBJECT_TYPE } from "@ontomato/contracts/platform-object-types";
import { createDirectPanelInstance, type PanelMemberReadRequest } from "../../../../../packages/apps-sdk/src/panel/direct";
import PanelMember from "../../../../../packages/apps-sdk/src/panel/PanelMember.vue";
import { createPanelText } from "../../../../../packages/apps-sdk/src/panel/text";
import { noOperations } from "./panel-frame";

/*
 * A form opened under a parent (M4's class details, 2026-11-21): "new attribute" in a class creates one of that class,
 * yet the owner's create form offers the class as a choice, for it does not know which page it is in. The page fixes
 * the field through `fixedFields`, from the class its state holds (the object reference's `/primaryKey`): the form shows
 * the page's value read-only, nothing the reader or the page's code does changes it, and every save submits it for the
 * owner to check like any other value. With no class chosen the field is the owner's, as it would be anywhere.
 *
 * The mistakes these catch: a fixed field the reader can still change; a fixed value the save leaves out (the owner
 * keeps its own default); a field that does not follow the state it is fixed from; a field still locked, or still
 * holding the last class, once no class is chosen.
 */

const meta = { domainId: "d", ownerId: "o", revision: 1, createdAt: "", updatedAt: "", editable: false, visibility: "domain" as const, description: "" };
const attribute = { kind: "object", objectType: ATTRIBUTE } as const;
const formParams = { values: { input: "values" }, changedField: { input: "changedField" } };
const projection: DirectProjection = {
  ...meta, id: "attribute-form", name: "Attribute", componentId: "@ontomato/sdk:ObjectForm",
  inputs: { attribute, values: { kind: "json" }, changedField: { kind: "scalar", type: "string" } }, outputs: {},
  config: { fixedFields: { "/className": { state: "objectType", path: "/primaryKey" } } },
  data: {
    form: { source: { object: { input: "attribute" } }, read: "form", params: formParams },
    createForm: { source: { type: { kind: "PlatformObjectType", id: ATTRIBUTE } }, read: "createForm", params: formParams },
  },
  operations: { save: { operation: { kind: "PlatformOperation", id: `${ATTRIBUTE}.save` }, target: { input: "attribute" } } },
};
const manifest: DirectPanelManifest = {
  state: {
    attribute: { type: attribute, personal: false, deepLink: true, external: false },
    objectType: { type: { kind: "object", objectType: OBJECT_TYPE }, personal: false, deepLink: true, external: false },
    className: { type: { kind: "scalar", type: "string" }, personal: false, deepLink: false, external: false },
  },
  members: { form: { target: { projectionId: projection.id }, inputs: { attribute: { state: "attribute" } } } },
};
const choice = (value: string) => ({ value, label: value, description: null, disabled: false, disabledReason: null });
const classes = [choice("Device"), choice("Site")];
const createForm = {
  fields: [
    { path: "/className", label: "Owner object type", control: { kind: "select", options: classes }, valueSchema: {}, required: true, readOnly: false },
    { path: "/name", label: "Name", control: { kind: "text" }, valueSchema: {}, required: true, readOnly: false },
  ],
  values: { className: "", name: "" }, errors: [],
  save: { method: "POST" as const, path: "/ontology/model/attribute/create", bodySchema: {} },
};
const save = {
  kind: "form.save", handlerRef: `${ATTRIBUTE}.save`, label: "Save", effect: "write", target: { source: "input", input: "attribute" },
  inputSchema: {}, resultSchema: {}, batch: false,
};
const ready = (value: unknown): ProductPanelReadResponse => ({ status: "ready", value: value as never });

const objectType = (primaryKey: string) => ({ className: OBJECT_TYPE, primaryKey });
type FormRead = Extract<PanelMemberReadRequest, { dataName: string }>;

function describeInputs({ inputs }: FormRead) {
  return { changedField: inputs.changedField, values: inputs.values };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

let unmount: (() => void) | undefined;
function open(
  initial: Record<string, RuntimeJsonValue>,
  options: {
    confirmLeaveUnsaved?: () => Promise<boolean>;
    describe?: (request: FormRead) => ProductPanelReadResponse | Promise<ProductPanelReadResponse>;
    fixedFields?: Record<string, { state: string; path?: string }>;
  } = {},
) {
  const prepared: unknown[] = [];
  const prepare = vi.fn(async (operationId: string, invocation: unknown): Promise<PanelHumanOperationPreparation> => {
    prepared.push(invocation);
    return { intentId: "5f0c1a2e-6a0b-4f8e-9a51-0c6f3e2b1d05", operationId, label: operationId, confirmation: { kind: "none" } };
  });
  const instance = createDirectPanelInstance(manifest, {
    readComponentPackage: noOperations.readComponentPackage,
    pageKey: "classes", url: () => "/classes", label: () => "Classes", initial,
    text: createPanelText({}, ref("en"), "en"),
    operations: { ...noOperations.operations, prepare },
    expandPageComposer: noOperations.expandPageComposer, navigate: noOperations.navigate, nested: noOperations.nested,
    confirmOperation: async ({ intentId }) => ({ decision: "confirm", response: { kind: "dispatched", intentId, outcome: {
      kind: "success", data: {}, created: { objectType: ATTRIBUTE, primaryKey: "Device.site_id" },
      affected: { objects: [{ objectType: ATTRIBUTE, primaryKey: "Device.site_id" }], objectTypes: [ATTRIBUTE] },
    } as never } }),
    readProjection: async () => options.fixedFields
      ? { ...projection, config: { fixedFields: options.fixedFields } }
      : projection,
    confirmLeaveUnsaved: options.confirmLeaveUnsaved,
    read: async (request) => request.operations ? ready({ save }) : options.describe?.(request) ?? ready(createForm),
  });
  const element = document.createElement("div");
  document.body.append(element);
  const app = createApp({ render: () => h(PanelMember, { instance, member: "form" }) })
    .use(createI18n({ legacy: false, locale: "en", messages: { en: publicEn } })).use(ElementPlus);
  app.mount(element);
  unmount = () => app.unmount();
  return { instance, element, prepared };
}

afterEach(() => {
  unmount?.();
  unmount = undefined;
  document.body.innerHTML = "";
});

function describeAttributes(request: FormRead) {
  const { changedField, values } = request.inputs;
  const fixed = values as Record<string, RuntimeJsonValue> | undefined;
  // The owner describes around the supplied values only in its dynamic read mode.
  const className = changedField === "/className" ? fixed?.className : "";
  const options = className ? [choice(`${className}.id`)] : [];
  return ready({
    ...createForm,
    fields: [...createForm.fields.map((field) => field.path === "/className" ? { ...field, refreshOnChange: true } : field), {
      path: "/referenceAttribute", label: "Reference", control: { kind: "select", options },
      valueSchema: {}, required: false, readOnly: !className,
    }],
    values: { ...createForm.values, className, name: className ? `${className}_default` : "", referenceAttribute: options[0]?.value ?? "" },
  });
}

it("keeps a dirty create form on its original parent and lets the panel resync derived state", async () => {
  const decision = deferred<boolean>();
  const confirmLeaveUnsaved = vi.fn(() => decision.promise);
  const { instance } = open({ objectType: objectType("Device"), className: "Device" }, { confirmLeaveUnsaved });
  const parent = instance.state.field("objectType");
  const stop = watch(parent, async (value) => {
    const key = (value as ReturnType<typeof objectType>).primaryKey;
    await Promise.resolve();
    instance.state.set("className", key);
  });
  try {
    await vi.waitFor(() => expect(instance.forms.handle("form")?.values.value.className).toBe("Device"));
    const form = instance.forms.handle("form")!;
    form.set("/name", "draft");
    const pending = instance.state.set("objectType", objectType("Site"));
    await vi.waitFor(() => expect(confirmLeaveUnsaved).toHaveBeenCalledTimes(1));
    expect(instance.state.values.value).toMatchObject({ objectType: objectType("Device"), className: "Device" });
    expect(form.values.value).toMatchObject({ className: "Device", name: "draft" });
    decision.resolve(false);
    await expect(pending).resolves.toBe(false);
    expect(instance.state.values.value).toMatchObject({ objectType: objectType("Device"), className: "Device" });
    expect(form.values.value).toMatchObject({ className: "Device", name: "draft" });
    expect(form.dirty.value).toBe(true);
    expect(confirmLeaveUnsaved).toHaveBeenCalledTimes(1);
  } finally {
    stop();
  }
});

it("discards the draft and replaces its baseline when the reader accepts a new parent", async () => {
  const confirmLeaveUnsaved = vi.fn(async () => true);
  const { instance } = open({ objectType: objectType("Device") }, { confirmLeaveUnsaved, describe: describeAttributes });
  await vi.waitFor(() => expect(instance.forms.handle("form")?.values.value.referenceAttribute).toBe("Device.id"));
  const form = instance.forms.handle("form")!;
  form.set("/name", "draft");
  instance.state.set("objectType", objectType("Site"));
  await vi.waitFor(() => expect(form.values.value).toMatchObject({ className: "Site", name: "Site_default", referenceAttribute: "Site.id" }));
  expect(confirmLeaveUnsaved).toHaveBeenCalledTimes(1);
  expect(form.dirty.value).toBe(false);
  form.set("/name", "new edit");
  await form.reset();
  expect(form.values.value.name).toBe("Site_default");
});

it.each(["same patch", "following microtask"])("asks once for edit-target and fixed-input changes in the %s", async (timing) => {
  const oldAttribute = { className: ATTRIBUTE, primaryKey: "Device.old" };
  const nextAttribute = { className: ATTRIBUTE, primaryKey: "Site.new" };
  const decision = deferred<boolean>();
  const confirmLeaveUnsaved = vi.fn(() => decision.promise);
  const { instance } = open({ objectType: objectType("Device"), attribute: oldAttribute }, { confirmLeaveUnsaved });
  await vi.waitFor(() => expect(instance.forms.handle("form")?.values.value.className).toBe("Device"));
  const form = instance.forms.handle("form")!;
  form.set("/name", "draft");
  if (timing === "same patch") {
    instance.state.setState({ objectType: objectType("Site"), attribute: nextAttribute });
  } else {
    instance.state.set("objectType", objectType("Site"));
    await nextTick();
    instance.state.set("attribute", nextAttribute);
  }
  await vi.waitFor(() => expect(confirmLeaveUnsaved).toHaveBeenCalledTimes(1));
  decision.resolve(false);
  await vi.waitFor(() => expect(instance.state.values.value).toMatchObject({ objectType: objectType("Device"), attribute: oldAttribute }));
  expect(form.values.value).toMatchObject({ className: "Device", name: "draft" });
  expect(form.dirty.value).toBe(true);
  expect(confirmLeaveUnsaved).toHaveBeenCalledTimes(1);
});

it("preflights direct and derived agent changes without mutating state or prompting the user", async () => {
  const confirmLeaveUnsaved = vi.fn(async () => true);
  const { instance } = open({ objectType: objectType("Device"), className: "Device" }, { confirmLeaveUnsaved });
  await vi.waitFor(() => expect(instance.forms.handle("form")?.values.value.className).toBe("Device"));
  const form = instance.forms.handle("form")!;
  form.set("/name", "draft");
  expect(instance.findBlockedForms({ objectType: objectType("Site") }).length).toBeGreaterThan(0);
  expect(instance.findBlockedForms({ className: "Site" })).toEqual([]);
  instance.forms.bindInputState("form", "className");
  const stop = watch(instance.state.field("className"), async (value) => {
    await Promise.resolve();
    instance.state.set("objectType", objectType(value as string));
  });
  try {
    expect(await instance.checkAgentStateChange({ className: "Site" })).toMatchObject({ ok: false });
    expect(instance.state.values.value).toMatchObject({ objectType: objectType("Device"), className: "Device" });
    expect(form.values.value).toMatchObject({ className: "Device", name: "draft" });
    expect(form.dirty.value).toBe(true);
    expect(confirmLeaveUnsaved).not.toHaveBeenCalled();
  } finally {
    stop();
  }
});

it.each(["createForm", "form"])("preserves the owner's complete values with a non-refreshing fixed field in %s", async (dataName) => {
  const name = dataName === "form" ? "stored_attribute" : "owner_default";
  const describe = vi.fn((request: FormRead) => ready({
    ...createForm,
    values: request.inputs.values ?? { className: "", name },
  }));
  const initial: Record<string, RuntimeJsonValue> = { objectType: objectType("Device") };
  if (dataName === "form") initial.attribute = { className: ATTRIBUTE, primaryKey: "Device.stored_attribute" };
  const { instance } = open(initial, { describe });
  await vi.waitFor(() => expect(instance.forms.handle("form")?.values.value).toMatchObject({ className: "Device", name }));
  expect(describe).toHaveBeenCalledTimes(1);
  const [request] = describe.mock.calls[0]!;
  expect(request.dataName).toBe(dataName);
  expect(request.inputs).not.toHaveProperty("values");
  expect(request.inputs.changedField).toBeNull();
});

it("opens and reloads a clean form with the owner's dependent options for the fixed input", async () => {
  const confirmLeaveUnsaved = vi.fn(async () => true);
  const describe = vi.fn(describeAttributes);
  const { instance } = open({ objectType: objectType("Device") }, { confirmLeaveUnsaved, describe });
  const expectDescription = (parent: string) => {
    const form = instance.forms.handle("form")!;
    expect(form.fields.value.find(({ path }) => path === "/referenceAttribute")).toMatchObject({
      readOnly: false, control: { options: [choice(`${parent}.id`)] },
    });
    expect(form.values.value).toMatchObject({ className: parent, referenceAttribute: `${parent}.id` });
    expect(form.dirty.value).toBe(false);
  };
  await vi.waitFor(() => expectDescription("Device"));
  instance.state.set("objectType", objectType("Site"));
  await vi.waitFor(() => expectDescription("Site"));
  expect(describe.mock.calls.map(([request]) => describeInputs(request))).toEqual([
    { changedField: null, values: undefined },
    { changedField: "/className", values: { className: "Device", name: "", referenceAttribute: "" } },
    { changedField: null, values: undefined },
    { changedField: "/className", values: { className: "Site", name: "", referenceAttribute: "" } },
  ]);
  expect(confirmLeaveUnsaved).not.toHaveBeenCalled();
});

it("refreshes both fixed endpoints in order, carrying forward the owner's values", async () => {
  const defaults = { name: "owner_default", fromclass: "", toclass: "", fromField: "", toField: "" };
  const describe = vi.fn(({ inputs }: FormRead) => {
    const values = { ...((inputs.values as typeof defaults | undefined) ?? defaults) };
    // This owner refreshes only the side named by changedField.
    if (inputs.changedField === "/fromclass") values.fromField = `${values.fromclass}.id`;
    if (inputs.changedField === "/toclass") values.toField = `${values.toclass}.id`;
    return ready({
      ...createForm,
      fields: [
        { ...createForm.fields[0], path: "/fromclass", refreshOnChange: true },
        { ...createForm.fields[0], path: "/toclass", refreshOnChange: true },
        { ...createForm.fields[1], path: "/name" },
        ...(["fromField", "toField"] as const).map((key) => ({
          ...createForm.fields[0], path: `/${key}`, control: { kind: "select", options: values[key] ? [choice(values[key])] : [] },
        })),
      ],
      values,
    });
  });
  const { instance } = open({ objectType: objectType("Device"), className: "Site" }, {
    describe,
    fixedFields: {
      "/fromclass": { state: "objectType", path: "/primaryKey" },
      "/toclass": { state: "className" },
    },
  });
  const fixed = { ...defaults, fromclass: "Device", toclass: "Site" };
  await vi.waitFor(() => expect(instance.forms.handle("form")?.values.value).toMatchObject({
    ...fixed, fromField: "Device.id", toField: "Site.id",
  }));
  const form = instance.forms.handle("form")!;
  expect(form.fields.value.find(({ path }) => path === "/fromField")?.control).toMatchObject({ options: [choice("Device.id")] });
  expect(form.fields.value.find(({ path }) => path === "/toField")?.control).toMatchObject({ options: [choice("Site.id")] });
  expect(form.dirty.value).toBe(false);
  expect(describe.mock.calls.map(([request]) => describeInputs(request))).toEqual([
    { changedField: null, values: undefined },
    { changedField: "/fromclass", values: fixed },
    { changedField: "/toclass", values: { ...fixed, fromField: "Device.id" } },
  ]);
});

it("keeps a late owner edit answer out of the baseline for the next parent", async () => {
  const oldAsk = deferred<ProductPanelReadResponse>();
  const describe = vi.fn((request: FormRead) => {
    if (request.inputs.changedField === "/name") return oldAsk.promise;
    if ((request.inputs.values as { className: string } | undefined)?.className === "Device") {
      return ready({
        ...createForm,
        fields: createForm.fields.map((field) => field.path === "/name" ? { ...field, refreshOnChange: true } : field),
      });
    }
    return describeAttributes(request);
  });
  const { instance } = open({ objectType: objectType("Device") }, { confirmLeaveUnsaved: async () => true, describe });
  await vi.waitFor(() => expect(instance.forms.handle("form")?.values.value.className).toBe("Device"));
  const form = instance.forms.handle("form")!;
  form.set("/name", "old draft");
  await vi.waitFor(() => expect(describe).toHaveBeenCalledWith(expect.objectContaining({
    inputs: expect.objectContaining({ changedField: "/name" }),
  })));
  instance.state.set("objectType", objectType("Site"));
  await vi.waitFor(() => expect(form.values.value.referenceAttribute).toBe("Site.id"));
  form.set("/name", "new draft");
  expect(form.canSubmit.value).toBe(true);
  oldAsk.resolve(ready({ ...createForm, values: { className: "Device", name: "old draft" } }));
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(form.values.value).toMatchObject({ className: "Site", name: "new draft", referenceAttribute: "Site.id" });
  expect(form.canSubmit.value).toBe(true);
});

it("shows the page's fixed field read-only, keeps it from the reader, and submits it with the save", async () => {
  const { instance, element, prepared } = open({ objectType: objectType("Device") });
  const ownerType = () => element.querySelector('[data-field="/className"]');
  await vi.waitFor(() => expect(ownerType()?.textContent).toContain("Device"));
  // Read-only: the select the reader would change it with is disabled, and the form will not take it from code either.
  expect(ownerType()!.querySelector(".el-select.is-disabled, .el-select__wrapper.is-disabled")).not.toBeNull();
  const form = instance.forms.handle("form")!;
  expect(() => form.set("/className", "Site")).toThrow("The page fixes the field /className");
  expect(form.values.value.className).toBe("Device");

  // The page moves to another class: the field follows its state.
  instance.state.set("objectType", objectType("Site"));
  await vi.waitFor(() => expect(form.values.value.className).toBe("Site"));

  const name = element.querySelector<HTMLInputElement>('[data-field="/name"] input')!;
  name.value = "site_id";
  name.dispatchEvent(new Event("input"));
  await nextTick();
  await instance.invoke("form.save");
  expect(prepared).toEqual([{
    call: {
      target: { kind: "draft" },
      input: { values: { className: "Site", name: "site_id" }, submittedFields: ["/name", "/className"] },
    },
  }]);
});

it("leaves the field to the owner while no class is chosen, fixes it once one is, and gives it back when none is", async () => {
  const { instance, element, prepared } = open({});
  const ownerType = () => element.querySelector('[data-field="/className"]');
  const locked = () => ownerType()!.querySelector(".el-select.is-disabled, .el-select__wrapper.is-disabled") !== null;
  await vi.waitFor(() => expect(ownerType()).not.toBeNull());
  const form = instance.forms.handle("form")!;
  expect(locked()).toBe(false);
  expect(form.values.value.className).toBe("");

  instance.state.set("objectType", objectType("Device"));
  await vi.waitFor(() => expect(locked()).toBe(true));
  expect(form.values.value.className).toBe("Device");

  instance.state.set("objectType", null);
  await vi.waitFor(() => expect(locked()).toBe(false));
  // The owner's own value again, and nothing left to save.
  expect(form.values.value.className).toBe("");
  expect(instance.forms.dirty()).toBe(false);
  form.set("/name", "site_id");
  await instance.invoke("form.save");
  expect(prepared).toEqual([{
    call: { target: { kind: "draft" }, input: { values: { className: "", name: "site_id" }, submittedFields: ["/name"] } },
  }]);
});
