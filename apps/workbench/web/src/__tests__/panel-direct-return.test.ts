import { noOperations } from "./panel-frame";
import { afterEach, expect, it, vi } from "vitest";
import { createApp, h, nextTick, ref } from "vue";
import { createI18n } from "vue-i18n";
import ElementPlus from "element-plus";
import publicEn from "@ontomato/workbench-ui/locales/en";
import type { DirectPanelManifest } from "@ontomato/contracts/panel-manifest";
import type { DirectProjection } from "@ontomato/contracts/product-panels";
import type { ProductPanelReadResponse } from "@ontomato/contracts/panel-host";
import { SCHEDULED_TASK } from "@ontomato/contracts/panel-client-requests";
import { mountDirectPanel } from "../../../../../packages/apps-sdk/src/panel/direct-mount";

/*
 * A directly rendered page coming back to the foreground while the reader is about to type into its clean form: the
 * host reads the objects again (the form's own read included) and checks the definitions beside that, with the panel's
 * snapshot, which names every projection at the revision it has. On 128 one such return in 16 put the instruction the
 * reader was typing back to what it was (pilot batch, 2026-11-20): two form reads in that window.
 *
 * The mistakes this catches: a projection the snapshot names at the revision the member already shows taken for a
 * changed one, so the member is drawn anew and its form read again under the reader's fingers; and the form's read,
 * made while it was clean and answered once the reader had started typing, put over what they typed.
 */

const task = { className: SCHEDULED_TASK, primaryKey: "t-1" };
const base = { domainId: "d", ownerId: "o", createdAt: "", updatedAt: "", editable: false, visibility: "domain" as const, description: "" };
const formProjection: DirectProjection = {
  ...base, id: "task-form", revision: 4, name: "Task form", componentId: "@ontomato/sdk:ObjectForm",
  inputs: { task: { kind: "object", objectType: SCHEDULED_TASK } }, outputs: {}, config: {},
  data: { form: { source: { object: { input: "task" } }, read: "form", params: {} } },
  operations: { save: { operation: { kind: "PlatformOperation", id: `${SCHEDULED_TASK}.save` }, target: { input: "task" } } },
};
/** The owner's save of the chosen task, as it admits it. */
const admitted: ProductPanelReadResponse = { status: "ready", value: { save: {
  kind: "form.save", handlerRef: `${SCHEDULED_TASK}.save`, label: "Save", effect: "write", target: { source: "input", input: "task" },
  inputSchema: {}, resultSchema: {}, batch: false,
} } };

const manifest: DirectPanelManifest = {
  state: { selectedTask: { type: { kind: "object", objectType: SCHEDULED_TASK }, personal: false, deepLink: true, external: false } },
  members: { form: { target: { projectionId: "task-form" }, inputs: { task: { state: "selectedTask" } } } },
  events: {},
};
const description = {
  fields: [{ path: "/instruction", label: "Instruction", control: { kind: "text" as const, multiline: true }, valueSchema: {}, required: false, readOnly: false }],
  values: { instruction: "Inspect last night's failures" }, errors: [], revision: 2,
  save: { method: "PUT" as const, path: "/tasks/:id", bodySchema: {}, draftOperation: `${SCHEDULED_TASK}.save` },
};
const ready = (): ProductPanelReadResponse => ({ status: "ready", value: description as never });

afterEach(() => {
  document.body.innerHTML = "";
});

it("keeps what the reader types into a clean form as the page comes back, its definitions unchanged", async () => {
  const projectionReads = vi.fn();
  let formReads = 0;
  let held: (() => void) | null = null;
  let holdNext = false;
  const mount = mountDirectPanel({
    manifest,
    run: {
      pageKey: "tasks", url: () => "/tasks", label: () => "Tasks", initial: { selectedTask: task },
      state: () => {}, context: () => {}, operations: () => {}, dirty: () => {}, draftSettled: () => {}, failed: (reason) => { throw reason; },
    },
    requests: {
      request: async (path: string) => {
        projectionReads(path);
        return Response.json({ projection: formProjection });
      },
    },
    use: { applicationId: "app-tasks", useId: "tasks" }, messages: {}, locale: ref("en"), defaultLocale: "en",
    expandPageComposer: noOperations.expandPageComposer, navigate: noOperations.navigate, nested: noOperations.nested,
    confirmOperation: async () => { throw new Error("Nothing is saved here"); },
    read: async (request): Promise<ProductPanelReadResponse> => {
      if (request.operations) return admitted;
      formReads += 1;
      if (!holdNext) return ready();
      holdNext = false;
      return new Promise((resolve) => { held = () => resolve(ready()); });
    },
  });
  const element = document.createElement("div");
  document.body.append(element);
  createApp({ render: () => h("div", [mount.member("form")]) })
    .use(createI18n({ legacy: false, locale: "en", messages: { en: publicEn } })).use(ElementPlus).mount(element);
  const instruction = () => element.querySelector<HTMLTextAreaElement>('[data-field="/instruction"] textarea');
  await vi.waitFor(() => expect(instruction()?.value).toBe("Inspect last night's failures"));
  const input = instruction()!;
  input.focus();
  const reads = formReads;

  // Away and back: the objects are read again (the form's read is answered only later), and the snapshot names the
  // form's projection at the revision it is drawn at — both while the form is still clean.
  mount.activate(false);
  mount.activate(true);
  holdNext = true;
  mount.refresh(null);
  mount.projectionsChanged([{ id: "task-form", revision: formProjection.revision }]);
  await vi.waitFor(() => expect(held).not.toBeNull());
  await nextTick();

  // The reader types, and only then is the form's read answered, with the instruction as it was saved.
  input.value = "Inspect this morning's failures";
  input.dispatchEvent(new Event("input"));
  await nextTick();
  held!();
  await new Promise((resolve) => setTimeout(resolve, 20));

  expect(instruction()).toBe(input);
  expect(input.value).toBe("Inspect this morning's failures");
  expect(mount.instance.dirty()).toBe(true);
  // One read of the form for the return, and the unchanged definition is not read again.
  expect(formReads).toBe(reads + 1);
  expect(projectionReads).toHaveBeenCalledTimes(1);
});
