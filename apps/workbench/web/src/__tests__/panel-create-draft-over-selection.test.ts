import { afterEach, expect, it, vi } from "vitest";
import { createApp, nextTick, ref } from "vue";
import { createI18n } from "vue-i18n";
import ElementPlus from "element-plus";
import publicEn from "@ontomato/workbench-ui/locales/en";
import type { DirectPanelManifest } from "@ontomato/contracts/panel-manifest";
import type { DirectProjection } from "@ontomato/contracts/product-panels";
import type { ProductPanelReadResponse } from "@ontomato/contracts/panel-host";
import { FUNCTION } from "@ontomato/contracts/platform-object-types";
import { mountDirectPanel } from "../../../../../packages/apps-sdk/src/panel/direct-mount";
import { noOperations } from "./panel-frame";

/*
 * A new object's draft at a page whose form already shows an object (the business knowledge page on 128, 2026-11-22): the
 * form takes the draft as a new object — the draft's values in it, its changed fields marked — and keeps them when the
 * panel then moves itself to creating, as a panel does when it hears the draft. It never falls back to the object it
 * showed before, and it asks the reader nothing unless the reader has changed something of their own: the 128 page had
 * opened an earlier draft that changed nothing (a create draft already saved, reopened on its object), and moving on to
 * the next draft stopped at "discard your unsaved changes?" behind the hidden form, the old object left in the fields.
 */

const record = { domainId: "d", ownerId: "o", revision: 1, createdAt: "", updatedAt: "", editable: false, visibility: "domain" as const, description: "" };
const projection: DirectProjection = {
  ...record, id: "entry-form", name: "Entry form", componentId: "@ontomato/sdk:ObjectForm",
  inputs: { entry: { kind: "object", objectType: FUNCTION }, values: { kind: "json" }, changedField: { kind: "scalar", type: "string" } },
  outputs: {}, config: {},
  data: {
    form: { source: { object: { input: "entry" } }, read: "form", params: { values: { input: "values" }, changedField: { input: "changedField" } } },
    createForm: { source: { type: { kind: "PlatformObjectType", id: FUNCTION } }, read: "createForm", params: { values: { input: "values" }, changedField: { input: "changedField" } } },
  },
  operations: { save: { operation: { kind: "PlatformOperation", id: `${FUNCTION}.save` }, target: { input: "entry" } } },
};
const manifest: DirectPanelManifest = {
  state: { formTarget: { type: { kind: "object", objectType: FUNCTION }, personal: false, deepLink: false, external: false } },
  members: { form: { target: { projectionId: projection.id }, inputs: { entry: { state: "formTarget" } } } },
  commands: {},
};
const field = { path: "/title", label: "Title", control: { kind: "text" as const }, valueSchema: {}, required: false, readOnly: false };
const save = { kind: "form.save", handlerRef: `${FUNCTION}.save`, label: "Save", effect: "write", target: { source: "input", input: "entry" }, inputSchema: {}, resultSchema: {}, batch: false };

afterEach(() => {
  document.body.innerHTML = "";
});

async function openOn(saved: string) {
  const mount = mountDirectPanel({
    manifest,
    run: {
      pageKey: "entries", url: () => "/entries", label: () => "Entries", initial: { formTarget: { className: FUNCTION, primaryKey: "saved-1" } },
      state: () => {}, context: () => {}, operations: () => {}, dirty: () => {}, draftSettled: () => {}, draftRefused: () => {}, draftOpened: () => {},
      failed: (reason) => { throw reason; },
    },
    messages: {}, locale: ref("en"), defaultLocale: "en",
    requests: { request: async () => Response.json({ projection }) },
    use: { applicationId: "app", useId: "entries" },
    expandPageComposer: noOperations.expandPageComposer, navigate: noOperations.navigate, nested: noOperations.nested,
    confirmOperation: noOperations.confirmOperation,
    read: async (request): Promise<ProductPanelReadResponse> => {
      if (request.operations) return { status: "ready", value: { save } as never };
      const creating = request.dataName === "createForm";
      const values = (request.inputs.values as Record<string, string> | undefined)
        ?? (creating ? { title: "" } : { title: saved });
      return { status: "ready", value: {
        fields: [field], values, errors: [], revision: 1,
        save: { method: "PUT", path: "/entries/:id", bodySchema: {}, draftOperation: creating ? "entry.create" : "entry.update" },
      } as never };
    },
  });
  const element = document.createElement("div");
  document.body.append(element);
  const app = createApp({ render: () => mount.member("form") });
  app.use(createI18n({ legacy: false, locale: "en", messages: { en: publicEn } })).use(ElementPlus).mount(element);
  const title = () => element.querySelector<HTMLInputElement>('[data-field="/title"] input')?.value;
  await vi.waitFor(() => expect(title()).toBe(saved));

  return { mount, app, element, title };
}

const link = (run: string) => ({ sessionId: "7d1c1a2e-6a0b-4f8e-9a51-0c6f3e2b1d01", runId: run, path: "outputs/drafts/new.page-draft.json" });
async function receive(mount: Awaited<ReturnType<typeof openOn>>["mount"], run: string, draft: object) {
  const { receivePanelDraft } = await import("../../../../../packages/apps-sdk/src/panel/draft");
  await receivePanelDraft("entries", mount.instance.forms, { readPageDraft: async () => ({ pageKey: "entries", ...draft }) as never }, link(run), mount.instance.receiveDraft);
}
const fresh = { operation: "entry.create", target: { objectType: FUNCTION }, form: { title: "Only in the draft" } };

it("takes a new object's draft over the object it shows, and keeps it when the panel moves itself to creating", async () => {
  const { mount, app, title } = await openOn("The saved entry");
  await receive(mount, "7d1c1a2e-6a0b-4f8e-9a51-0c6f3e2b1d02", fresh);
  await vi.waitFor(() => expect(title()).toBe("Only in the draft"));
  await vi.waitFor(() => expect(mount.instance.draft.value?.changed).toEqual(new Set(["/title"])));
  // The panel hears the draft and moves itself to creating, as the knowledge page does.
  mount.instance.state.setState({ formTarget: null });
  await nextTick();
  await new Promise((resolve) => setTimeout(resolve, 50));
  expect(title()).toBe("Only in the draft");
  app.unmount();
  mount.dispose();
});

it("moves on from a draft that changed nothing to the next one without asking the reader", async () => {
  const { mount, app, title } = await openOn("The saved entry");
  // A create draft already saved: it reopens on the object it created, writing what that object already holds.
  await receive(mount, "7d1c1a2e-6a0b-4f8e-9a51-0c6f3e2b1d03", { operation: "entry.create", target: { objectType: FUNCTION }, created: { id: "saved-1" }, form: { title: "The saved entry" } });
  await new Promise((resolve) => setTimeout(resolve, 50));
  expect(title()).toBe("The saved entry");
  await receive(mount, "7d1c1a2e-6a0b-4f8e-9a51-0c6f3e2b1d04", fresh);
  await vi.waitFor(() => expect(title()).toBe("Only in the draft"));
  expect(document.querySelector(".el-message-box")).toBeNull();
  await vi.waitFor(() => expect(mount.instance.draft.value?.changed).toEqual(new Set(["/title"])));
  app.unmount();
  mount.dispose();
});
