import { afterEach, expect, it, vi } from "vitest";
import { createApp, ref } from "vue";
import { createI18n } from "vue-i18n";
import ElementPlus from "element-plus";
import publicEn from "@ontomato/workbench-ui/locales/en";
import type { DirectPanelManifest } from "@ontomato/contracts/panel-manifest";
import type { DirectProjection } from "@ontomato/contracts/product-panels";
import type { ProductPanelReadResponse } from "@ontomato/contracts/panel-host";
import { SCHEDULED_TASK } from "@ontomato/contracts/panel-client-requests";
import { mountDirectPanel } from "../../../../../packages/apps-sdk/src/panel/direct-mount";
import { receivePanelDraft } from "../../../../../packages/apps-sdk/src/panel/draft";
import { noOperations } from "./panel-frame";

/*
 * A draft a directly run panel's owner refuses is said where it was meant to go: on its form, with the owner's reason at
 * its top and the field messages beside their fields (the agent settings page, redone 2026-11-21) — the rest of the panel
 * goes on. A draft no form of the panel takes still fails the panel, through the run's own report.
 *
 * What this rules out: a refused draft dropped without a word; one form's refusal taking down the whole panel.
 */

const record = { domainId: "d", ownerId: "o", revision: 1, createdAt: "", updatedAt: "", editable: false, visibility: "domain" as const, description: "" };
const taskForm: DirectProjection = {
  ...record, id: "task-form", name: "Task form", componentId: "@ontomato/sdk:ObjectForm",
  inputs: { task: { kind: "object", objectType: SCHEDULED_TASK }, values: { kind: "json" }, changedField: { kind: "scalar", type: "string" } },
  outputs: {}, config: {},
  data: { form: { source: { object: { input: "task" } }, read: "form", params: { values: { input: "values" }, changedField: { input: "changedField" } } } },
  operations: { save: { operation: { kind: "PlatformOperation", id: `${SCHEDULED_TASK}.save` }, target: { input: "task" } } },
};
const manifest: DirectPanelManifest = {
  state: { selectedTask: { type: { kind: "object", objectType: SCHEDULED_TASK }, personal: false, deepLink: true, external: false } },
  members: { form: { target: { projectionId: taskForm.id }, inputs: { task: { state: "selectedTask" } } } },
  commands: {},
};
const field = (path: string, label: string) => ({ path, label, control: { kind: "text" as const }, valueSchema: {}, required: false, readOnly: false });
const form = { fields: [field("/name", "Name"), field("/note", "Note")], values: { name: "t-1", note: "" }, errors: [], revision: 3,
  save: { method: "PUT" as const, path: "/tasks/:id", bodySchema: {}, draftOperation: `${SCHEDULED_TASK}.save` } };
const errors = [{ field: "/note", code: "value_too_long", message: "A note is a sentence" }];
/** The owner's save of the chosen task, as it admits it. */
const save = {
  kind: "form.save", handlerRef: `${SCHEDULED_TASK}.save`, label: "Save", effect: "write", target: { source: "input", input: "task" },
  inputSchema: {}, resultSchema: {}, batch: false,
};

afterEach(() => {
  document.body.innerHTML = "";
});

it("says the owner's refusal of a draft on its form, and does not fail the panel", async () => {
  const failed: unknown[] = [];
  const mount = mountDirectPanel({
    manifest,
    run: {
      pageKey: "tasks", url: () => "/tasks", label: () => "Tasks", initial: { selectedTask: { className: SCHEDULED_TASK, primaryKey: "t-1" } },
      state: () => {}, context: () => {}, operations: () => {}, dirty: () => {}, draftSettled: () => {},
      failed: (reason) => failed.push(reason),
    },
    messages: {}, locale: ref("en"), defaultLocale: "en",
    requests: { request: async () => Response.json({ projection: taskForm }) },
    use: { applicationId: "app-tasks", useId: "tasks" },
    expandPageComposer: noOperations.expandPageComposer, navigate: noOperations.navigate, nested: noOperations.nested,
    confirmOperation: noOperations.confirmOperation,
    // The owner checks the draft's values and answers its form with what it does not accept.
    read: async (request): Promise<ProductPanelReadResponse> =>
      ({ status: "ready", value: (request.operations ? { save } : request.inputs.values ? { ...form, values: request.inputs.values, errors } : form) as never }),
  });
  const element = document.createElement("div");
  document.body.append(element);
  const app = createApp({ render: () => mount.member("form") });
  app.use(createI18n({ legacy: false, locale: "en", messages: { en: publicEn } })).use(ElementPlus).mount(element);
  await vi.waitFor(() => expect(element.querySelector<HTMLInputElement>('[data-field="/name"] input')?.value).toBe("t-1"));

  const link = { sessionId: "7d1c1a2e-6a0b-4f8e-9a51-0c6f3e2b1d01", runId: "7d1c1a2e-6a0b-4f8e-9a51-0c6f3e2b1d02", path: "outputs/drafts/task.page-draft.json" };
  await receivePanelDraft("tasks", mount.instance.forms, {
    readPageDraft: async () => ({ pageKey: "tasks", operation: `${SCHEDULED_TASK}.save`, target: { objectType: SCHEDULED_TASK, id: "t-1" }, form: { name: "t-1", note: "x" } }),
  }, link, mount.instance.receiveDraft);
  await vi.waitFor(() => expect(element.querySelector(".sdk-owner-form-refusal")?.textContent).toBe("A note is a sentence"));
  expect(failed).toEqual([]);
  app.unmount();
  mount.dispose();
});

// The schedules page, 2026-11-21 (B2): an agent wrote a value the owner cannot read at all, and its check of the draft
// failed instead of naming fields. That is still the owner not taking this form's draft: said on the form, the panel on.
it("says on its form an owner's failure to check a draft's values, and does not fail the panel", async () => {
  const failed: unknown[] = [];
  const mount = mountDirectPanel({
    manifest,
    run: {
      pageKey: "tasks", url: () => "/tasks", label: () => "Tasks", initial: { selectedTask: { className: SCHEDULED_TASK, primaryKey: "t-1" } },
      state: () => {}, context: () => {}, operations: () => {}, dirty: () => {}, draftSettled: () => {},
      failed: (reason) => failed.push(reason),
    },
    messages: {}, locale: ref("en"), defaultLocale: "en",
    requests: { request: async () => Response.json({ projection: taskForm }) },
    use: { applicationId: "app-tasks", useId: "tasks" },
    expandPageComposer: noOperations.expandPageComposer, navigate: noOperations.navigate, nested: noOperations.nested,
    confirmOperation: noOperations.confirmOperation,
    read: async (request): Promise<ProductPanelReadResponse> =>
      request.operations ? { status: "ready", value: { save } as never }
        : request.inputs.values ? { status: "error", message: "content: Expected string, received object" }
          : { status: "ready", value: form as never },
  });
  const element = document.createElement("div");
  document.body.append(element);
  const app = createApp({ render: () => mount.member("form") });
  app.use(createI18n({ legacy: false, locale: "en", messages: { en: publicEn } })).use(ElementPlus).mount(element);
  await vi.waitFor(() => expect(element.querySelector<HTMLInputElement>('[data-field="/name"] input')?.value).toBe("t-1"));

  const link = { sessionId: "7d1c1a2e-6a0b-4f8e-9a51-0c6f3e2b1d01", runId: "7d1c1a2e-6a0b-4f8e-9a51-0c6f3e2b1d02", path: "outputs/drafts/task.page-draft.json" };
  await receivePanelDraft("tasks", mount.instance.forms, {
    readPageDraft: async () => ({ pageKey: "tasks", operation: `${SCHEDULED_TASK}.save`, target: { objectType: SCHEDULED_TASK, id: "t-1" }, form: { content: { title: "x" } } }),
  }, link, mount.instance.receiveDraft);
  await vi.waitFor(() => expect(element.querySelector(".sdk-owner-form-refusal")?.textContent).toBe("content: Expected string, received object"));
  // The form still shows the task as its owner holds it.
  expect(element.querySelector<HTMLInputElement>('[data-field="/name"] input')?.value).toBe("t-1");
  expect(failed).toEqual([]);
  app.unmount();
  mount.dispose();
});
