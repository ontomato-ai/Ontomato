import { afterEach, expect, it, vi } from "vitest";
import { createApp, ref } from "vue";
import { createI18n } from "vue-i18n";
import ElementPlus from "element-plus";
import publicEn from "@ontomato/workbench-ui/locales/en";
import type { DirectPanelManifest } from "@ontomato/contracts/panel-manifest";
import type { DirectProjection } from "@ontomato/contracts/product-panels";
import type { ProductPanelReadResponse } from "@ontomato/contracts/panel-host";
import { ATTRIBUTE, FUNCTION, OBJECT_TYPE } from "@ontomato/contracts/platform-object-types";
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
const field = (path: string, label: string) => ({ path, label, control: { kind: "text" as const }, valueSchema: {}, required: false, readOnly: false });
const saveOf = (type: string, input: string) => ({
  kind: "form.save", handlerRef: `${type}.save`, label: "Save", effect: "write", target: { source: "input", input }, inputSchema: {}, resultSchema: {}, batch: false,
});

/** A form as one member of the page: the type it binds, the state it edits, and its owner's objects and draft operation. */
interface FormMember { member: string; type: string; input: string; state: string; keys: string[]; draftOperation: string }

afterEach(() => {
  document.body.innerHTML = "";
});

function mountForms(forms: readonly FormMember[], initial: Record<string, unknown>) {
  const failed: unknown[] = [];
  const asked: string[] = [];
  const projections = new Map(forms.map((form) => [form.member, formOf(`${form.member}-form`, form.type, form.input)]));
  const manifest: DirectPanelManifest = {
    state: Object.fromEntries(forms.map((form) => [form.state, { type: { kind: "object", objectType: form.type }, personal: false, deepLink: true, external: false }])),
    members: Object.fromEntries(forms.map((form) => [form.member, { target: { projectionId: `${form.member}-form` }, inputs: { [form.input]: { state: form.state } } }])),
    commands: {},
  };
  const mount = mountDirectPanel({
    manifest,
    run: {
      pageKey: "page", url: () => "/page", label: () => "Page", initial: initial as never,
      state: () => {}, context: () => {}, operations: () => {}, dirty: () => {}, draftSettled: () => {},
      failed: (reason) => failed.push(reason),
    },
    messages: {}, locale: ref("en"), defaultLocale: "en",
    requests: { request: async (path) => Response.json({ projection: [...projections.values()].find((projection) => path.endsWith(projection.id)) }) },
    use: { applicationId: "app", useId: "page" },
    expandPageComposer: noOperations.expandPageComposer, navigate: noOperations.navigate, nested: noOperations.nested,
    confirmOperation: noOperations.confirmOperation,
    read: async (request): Promise<ProductPanelReadResponse> => {
      const form = forms.find(({ input }) => input in request.inputs)!;
      const object = request.inputs[form.input] as { primaryKey: string };
      if (request.operations) return { status: "ready", value: { save: saveOf(form.type, form.input) } as never };
      asked.push(`${form.member}:${object.primaryKey}`);
      if (!form.keys.includes(object.primaryKey)) return { status: "error", message: `No ${form.input} '${object.primaryKey}'` };
      const values = (request.inputs.values as Record<string, string> | undefined) ?? { name: object.primaryKey };
      return { status: "ready", value: {
        fields: [field("/name", "Name")], values, errors: [], revision: 1,
        save: { method: "PUT", path: `/${form.input}/:id`, bodySchema: {}, draftOperation: form.draftOperation },
      } as never };
    },
  });
  const element = document.createElement("div");
  document.body.append(element);
  const app = createApp({ render: () => forms.map((form) => mount.member(form.member)) });
  app.use(createI18n({ legacy: false, locale: "en", messages: { en: publicEn } })).use(ElementPlus).mount(element);
  const named = () => [...element.querySelectorAll<HTMLInputElement>('[data-field="/name"] input')].map((input) => input.value);
  const link = { sessionId: "7d1c1a2e-6a0b-4f8e-9a51-0c6f3e2b1d01", runId: "7d1c1a2e-6a0b-4f8e-9a51-0c6f3e2b1d02", path: "outputs/drafts/edit.page-draft.json" };
  const receive = (draft: object) => receivePanelDraft("page", mount.instance.forms, { readPageDraft: async () => ({ pageKey: "page", ...draft }) as never }, link, mount.instance.receiveDraft);
  return { mount, app, element, named, receive, asked, failed };
}

it("hands an attribute's draft to the attribute form and leaves the class form as it was", async () => {
  const { mount, app, element, named, receive, asked, failed } = mountForms([
    { member: "classForm", type: OBJECT_TYPE, input: "cls", state: "selectedClass", keys: ["person"], draftOperation: `${OBJECT_TYPE}.save` },
    { member: "attributeForm", type: ATTRIBUTE, input: "attribute", state: "selectedAttribute", keys: ["person.name"], draftOperation: `${ATTRIBUTE}.save` },
  ], { selectedClass: { className: OBJECT_TYPE, primaryKey: "person" }, selectedAttribute: { className: ATTRIBUTE, primaryKey: "person.name" } });
  await vi.waitFor(() => expect(named()).toEqual(["person", "person.name"]));

  await receive({ operation: `${ATTRIBUTE}.save`, target: { objectType: ATTRIBUTE, id: "person.name" }, form: { name: "full name" } });

  await vi.waitFor(() => expect(named()).toEqual(["person", "full name"]));
  expect(asked.filter((key) => key === "classForm:person.name")).toEqual([]);
  expect(element.querySelector(".sdk-owner-form-refusal")).toBeNull();
  expect(failed).toEqual([]);
  app.unmount();
  mount.dispose();
});

// Forms of one type differ by the draft operation their owner names (the application catalogue's identity and entries
// forms, overall designer 2026-11-21): the draft goes to the form whose operation it names, whichever registered first.
it("hands a draft to the form of its type whose owner names its operation, not the one that registered first", async () => {
  // A type the test harness reads forms of; the owner names two draft operations for it, as the application catalogue does.
  const APPLICATION = FUNCTION;
  const { mount, app, element, named, receive, failed } = mountForms([
    { member: "identityForm", type: APPLICATION, input: "identity", state: "identityApp", keys: ["app-1"], draftOperation: "application.saveIdentity" },
    { member: "entriesForm", type: APPLICATION, input: "entries", state: "entriesApp", keys: ["app-1"], draftOperation: "application.saveEntries" },
  ], { identityApp: { className: APPLICATION, primaryKey: "app-1" }, entriesApp: { className: APPLICATION, primaryKey: "app-1" } });
  await vi.waitFor(() => expect(named()).toEqual(["app-1", "app-1"]));

  await receive({ operation: "application.saveEntries", target: { objectType: APPLICATION, id: "app-1" }, form: { name: "entries changed" } });

  await vi.waitFor(() => expect(named()).toEqual(["app-1", "entries changed"]));
  expect(element.querySelector(".sdk-owner-form-refusal")).toBeNull();
  expect(failed).toEqual([]);
  app.unmount();
  mount.dispose();
});
