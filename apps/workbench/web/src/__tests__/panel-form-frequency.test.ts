import { afterEach, expect, it, vi } from "vitest";
import { createApp, h, nextTick, ref } from "vue";
import { createI18n } from "vue-i18n";
import ElementPlus from "element-plus";
import publicEn from "@ontomato/workbench-ui/locales/en";
import type { DirectPanelManifest } from "@ontomato/contracts/panel-manifest";
import type { DirectProjection } from "@ontomato/contracts/product-panels";
import type { ProductPanelReadResponse } from "@ontomato/contracts/panel-host";
import { SCHEDULED_TASK } from "@ontomato/contracts/platform-object-types";
import { createDirectPanelInstance } from "../../../../../packages/apps-sdk/src/panel/direct";
import PanelMember from "../../../../../packages/apps-sdk/src/panel/PanelMember.vue";
import { createPanelText } from "../../../../../packages/apps-sdk/src/panel/text";
import { noOperations } from "./panel-frame";

/*
 * A frequency an owner's form names (the scheduled task's, 2026-11-21) is edited in the generic form as the scheduled
 * task page edits it — every interval, every day, week or month at a time, or a Cron expression — and written as the
 * owner's own frequency value.
 *
 * The mistakes these catch: the field drawn as "cannot be edited here", so a panel has to draw its own frequency; a
 * kind switched without its own values, so the owner gets `{kind: "weekly"}` with no weekday or time.
 */

const record = { domainId: "d", ownerId: "o", revision: 1, createdAt: "", updatedAt: "", editable: false, visibility: "domain" as const, description: "" };
const task = { className: SCHEDULED_TASK, primaryKey: "10000000-0000-4000-8000-000000000004" };
const projection: DirectProjection = {
  ...record, id: "task-form", name: "Task form", componentId: "@ontomato/sdk:ObjectForm",
  inputs: { task: { kind: "object", objectType: SCHEDULED_TASK }, values: { kind: "json" }, changedField: { kind: "scalar", type: "string" } },
  outputs: {}, config: {},
  data: { form: { source: { object: { input: "task" } }, read: "form", params: { values: { input: "values" }, changedField: { input: "changedField" } } } },
  operations: { save: { operation: { kind: "PlatformOperation", id: `${SCHEDULED_TASK}.save` }, target: { input: "task" } } },
};
const manifest: DirectPanelManifest = {
  state: { task: { type: { kind: "object", objectType: SCHEDULED_TASK }, personal: false, deepLink: true, external: false } },
  members: { form: { target: { projectionId: projection.id }, inputs: { task: { state: "task" } } } },
};
const field = (path: string, label: string, control: Record<string, unknown>) =>
  ({ path, label, control, valueSchema: {}, required: true, readOnly: false });
const description = {
  fields: [field("/title", "Title", { kind: "text" }), field("/frequency", "Frequency", { kind: "frequency" })],
  values: { title: "Weekly knowledge check", frequency: { kind: "daily", time: "09:00" } },
  errors: [], revision: 1,
  save: { method: "PUT", path: "/schedules/tasks/:id", bodySchema: {}, draftOperation: "schedule.update" },
};
const ready = (value: unknown): ProductPanelReadResponse => ({ status: "ready", value: value as never });

afterEach(() => {
  document.body.innerHTML = "";
});

/** Picks one choice of one of the frequency's lists the way a reader does: open the list and click the choice. */
async function pick(scope: Element, list: string, label: string) {
  const select = scope.querySelector<HTMLElement>(`[aria-label="${list}"]`)?.closest(".el-select");
  if (!select) throw new Error(`No list '${list}' is drawn`);
  select.querySelector<HTMLElement>(".el-select__wrapper")!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  const option = await vi.waitFor(() => {
    const found = [...document.querySelectorAll<HTMLElement>(".el-select-dropdown__item")].find((item) => item.textContent?.trim() === label);
    if (!found) throw new Error(`No choice '${label}' in '${list}'`);
    return found;
  });
  option.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  await nextTick();
}

it("edits an owner's frequency as the scheduled task page does, each kind with its own values", async () => {
  const instance = createDirectPanelInstance(manifest, {
    pageKey: "schedules", url: () => "/schedules", label: () => "Schedules", initial: { task },
    text: createPanelText({}, ref("en"), "en"), ...noOperations, recordDraftCreated: async () => {},
    readProjection: async () => projection,
    read: async (request) => (request.operations ? ready({}) : ready(description)),
  });
  const element = document.createElement("div");
  document.body.append(element);
  createApp({ render: () => h(PanelMember, { instance, member: "form" }) })
    .use(createI18n({ legacy: false, locale: "en", messages: { en: publicEn } })).use(ElementPlus).mount(element);
  const frequency = await vi.waitFor(() => {
    const found = element.querySelector<HTMLElement>('[data-field="/frequency"]');
    if (!found) throw new Error("The form is not drawn");
    return found;
  });
  const text = publicEn.platformSchedules.form;
  expect(frequency.textContent).not.toContain(publicEn.platform.formControlUnavailable);

  await pick(frequency, text.time, text.kind.weekly);
  await pick(frequency, text.weekday, "Wednesday");
  expect(instance.forms.handle("form")!.values.value.frequency).toEqual({ kind: "weekly", weekday: 3, time: "09:00" });
});
