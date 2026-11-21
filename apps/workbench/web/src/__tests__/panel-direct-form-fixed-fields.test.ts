import { afterEach, expect, it, vi } from "vitest";
import { createApp, h, nextTick } from "vue";
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
  },
  members: { form: { target: { projectionId: projection.id }, inputs: { attribute: { state: "attribute" } } } },
  events: {},
};
const choice = (value: string) => ({ value, label: value, description: null, disabled: false, disabledReason: null });
const classes = [choice("Device"), choice("Site")];
const createForm = {
  fields: [
    { path: "/className", label: "Owner object type", control: { kind: "select", options: classes }, valueSchema: {}, required: true, readOnly: false },
    { path: "/name", label: "Name", control: { kind: "text" }, valueSchema: {}, required: true, readOnly: false },
  ],
  values: { className: "", name: "" }, errors: [],
  save: { method: "POST" as const, path: "/ontology/model/attribute/create", bodySchema: {}, draftOperation: "attribute.create" },
};
const save = {
  kind: "form.save", handlerRef: `${ATTRIBUTE}.save`, label: "Save", effect: "write", target: { source: "input", input: "attribute" },
  inputSchema: {}, resultSchema: {}, batch: false,
};
const ready = (value: unknown): ProductPanelReadResponse => ({ status: "ready", value: value as never });

const objectType = (primaryKey: string) => ({ className: OBJECT_TYPE, primaryKey });

function open(initial: Record<string, RuntimeJsonValue>) {
  const prepared: unknown[] = [];
  const prepare = vi.fn(async (operationId: string, invocation: unknown): Promise<PanelHumanOperationPreparation> => {
    prepared.push(invocation);
    return { intentId: "5f0c1a2e-6a0b-4f8e-9a51-0c6f3e2b1d05", operationId, label: operationId, confirmation: { kind: "none" } };
  });
  const instance = createDirectPanelInstance(manifest, {
    pageKey: "classes", url: () => "/classes", label: () => "Classes", initial,
    text: createPanelText({}, { value: "en" } as never, "en"),
    operations: { ...noOperations.operations, prepare },
    expandPageComposer: noOperations.expandPageComposer, navigate: noOperations.navigate,
    confirmOperation: async ({ intentId }) => ({ decision: "confirm", response: { kind: "dispatched", intentId, outcome: {
      kind: "success", data: {}, affected: { objects: [{ objectType: ATTRIBUTE, primaryKey: "Device.site_id" }], objectTypes: [ATTRIBUTE] },
    } as never } }),
    recordDraftCreated: async () => {},
    readProjection: async () => projection,
    read: async (request: PanelMemberReadRequest) => (request.operations ? ready({ save }) : ready(createForm)),
  });
  const element = document.createElement("div");
  document.body.append(element);
  createApp({ render: () => h(PanelMember, { instance, member: "form" }) })
    .use(createI18n({ legacy: false, locale: "en", messages: { en: publicEn } })).use(ElementPlus).mount(element);
  return { instance, element, prepared };
}

afterEach(() => {
  document.body.innerHTML = "";
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
