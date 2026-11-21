import { afterEach, expect, it, vi } from "vitest";
import { createApp, ref } from "vue";
import { createI18n } from "vue-i18n";
import ElementPlus from "element-plus";
import publicEn from "@ontomato/workbench-ui/locales/en";
import type { DirectPanelManifest } from "@ontomato/contracts/panel-manifest";
import type { DirectProjection } from "@ontomato/contracts/product-panels";
import type { ProductPanelReadResponse } from "@ontomato/contracts/panel-host";
import { ATTRIBUTE, OBJECT_TYPE } from "@ontomato/contracts/platform-object-types";
import { mountDirectPanel } from "../../../../../packages/apps-sdk/src/panel/direct-mount";
import { receivePanelDraft } from "../../../../../packages/apps-sdk/src/panel/draft";
import { noOperations } from "./panel-frame";

/*
 * Two forms on one page — the object type page's class form and attribute form (M4, 2026-11-21) — and a draft for one of
 * them. The draft names the object it is for, type and all (overall designer, 2026-11-21), so each form takes only a
 * draft of the type it binds: the attribute form takes an attribute's draft and the class form is not asked about an
 * object that is not a class. Only a refusal by the form whose type it is ends the draft.
 *
 * What this rules out: the class form asking its owner about the attribute's key, the owner refusing, and the whole
 * draft dropped — which made the page fold one form away while the other was open.
 */

const record = { domainId: "d", ownerId: "o", revision: 1, createdAt: "", updatedAt: "", editable: false, visibility: "domain" as const, description: "" };
const formOf = (id: string, type: string, input: string): DirectProjection => ({
  ...record, id, name: id, componentId: "@ontomato/sdk:ObjectForm",
  inputs: { [input]: { kind: "object", objectType: type }, values: { kind: "json" }, changedField: { kind: "scalar", type: "string" } },
  outputs: {}, config: {},
  data: { form: { source: { object: { input } }, read: "form", params: { values: { input: "values" }, changedField: { input: "changedField" } } } },
  operations: { save: { operation: { kind: "PlatformOperation", id: `${type}.save` }, target: { input } } },
});
const classForm = formOf("class-form", OBJECT_TYPE, "cls");
const attributeForm = formOf("attribute-form", ATTRIBUTE, "attribute");
const manifest: DirectPanelManifest = {
  state: {
    selectedClass: { type: { kind: "object", objectType: OBJECT_TYPE }, personal: false, deepLink: true, external: false },
    selectedAttribute: { type: { kind: "object", objectType: ATTRIBUTE }, personal: false, deepLink: true, external: false },
  },
  members: {
    classForm: { target: { projectionId: classForm.id }, inputs: { cls: { state: "selectedClass" } } },
    attributeForm: { target: { projectionId: attributeForm.id }, inputs: { attribute: { state: "selectedAttribute" } } },
  },
  commands: {},
};
const field = (path: string, label: string) => ({ path, label, control: { kind: "text" as const }, valueSchema: {}, required: false, readOnly: false });
/** Each owner's form of its own objects; the class owner knows no object by an attribute's key. */
const owners: Record<string, { keys: string[]; values: (key: string) => Record<string, string> }> = {
  cls: { keys: ["person"], values: (key) => ({ name: key }) },
  attribute: { keys: ["person.name"], values: (key) => ({ name: key }) },
};
const saveOf = (type: string, input: string) => ({
  kind: "form.save", handlerRef: `${type}.save`, label: "Save", effect: "write", target: { source: "input", input }, inputSchema: {}, resultSchema: {}, batch: false,
});

afterEach(() => {
  document.body.innerHTML = "";
});

it("hands an attribute's draft to the attribute form and leaves the class form as it was", async () => {
  const failed: unknown[] = [];
  const asked: string[] = [];
  const mount = mountDirectPanel({
    manifest,
    run: {
      pageKey: "object-types", url: () => "/object-types", label: () => "Object types",
      initial: { selectedClass: { className: OBJECT_TYPE, primaryKey: "person" }, selectedAttribute: { className: ATTRIBUTE, primaryKey: "person.name" } },
      state: () => {}, context: () => {}, operations: () => {}, dirty: () => {}, draftSettled: () => {},
      failed: (reason) => failed.push(reason),
    },
    messages: {}, locale: ref("en"), defaultLocale: "en",
    requests: { request: async (path) => Response.json({ projection: path.includes(attributeForm.id) ? attributeForm : classForm }) },
    use: { applicationId: "app-ontology", useId: "object-types" },
    expandPageComposer: noOperations.expandPageComposer, navigate: noOperations.navigate, nested: noOperations.nested,
    confirmOperation: noOperations.confirmOperation,
    read: async (request): Promise<ProductPanelReadResponse> => {
      const [input, object] = Object.entries(request.inputs).find(([name]) => name in owners) as [string, { className: string; primaryKey: string }];
      const type = input === "cls" ? OBJECT_TYPE : ATTRIBUTE;
      if (request.operations) return { status: "ready", value: { save: saveOf(type, input) } as never };
      asked.push(`${input}:${object.primaryKey}`);
      if (!owners[input]!.keys.includes(object.primaryKey)) return { status: "error", message: `No ${input} '${object.primaryKey}'` };
      const values = (request.inputs.values as Record<string, string> | undefined) ?? owners[input]!.values(object.primaryKey);
      return { status: "ready", value: {
        fields: [field("/name", "Name")], values, errors: [], revision: 1,
        save: { method: "PUT", path: `/${input}/:id`, bodySchema: {}, draftOperation: `${type}.save` },
      } as never };
    },
  });
  const element = document.createElement("div");
  document.body.append(element);
  const app = createApp({ render: () => [mount.member("classForm"), mount.member("attributeForm")] });
  app.use(createI18n({ legacy: false, locale: "en", messages: { en: publicEn } })).use(ElementPlus).mount(element);
  const named = () => [...element.querySelectorAll<HTMLInputElement>('[data-field="/name"] input')].map((input) => input.value);
  await vi.waitFor(() => expect(named()).toEqual(["person", "person.name"]));

  const link = { sessionId: "7d1c1a2e-6a0b-4f8e-9a51-0c6f3e2b1d01", runId: "7d1c1a2e-6a0b-4f8e-9a51-0c6f3e2b1d02", path: "outputs/drafts/attribute.page-draft.json" };
  await receivePanelDraft("object-types", mount.instance.forms, {
    readPageDraft: async () => ({ pageKey: "object-types", operation: `${ATTRIBUTE}.save`, target: { objectType: ATTRIBUTE, id: "person.name" }, form: { name: "full name" } }) as never,
  }, link, mount.instance.receiveDraft);

  await vi.waitFor(() => expect(named()).toEqual(["person", "full name"]));
  expect(asked.filter((key) => key === "cls:person.name")).toEqual([]);
  expect(element.querySelector(".sdk-owner-form-refusal")).toBeNull();
  expect(failed).toEqual([]);
  app.unmount();
  mount.dispose();
});
