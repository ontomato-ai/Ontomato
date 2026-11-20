import { afterEach, expect, it, vi } from "vitest";
import { createApp, h } from "vue";
import { createI18n } from "vue-i18n";
import ElementPlus from "element-plus";
import publicEn from "@ontomato/workbench-ui/locales/en";
import { SCHEDULED_TASK } from "@ontomato/contracts/panel-client-requests";
import { definePanel, type DirectPanelManifest } from "@ontomato/contracts/panel-manifest";
import { productProjectionResponseSchema, type DirectProjection } from "@ontomato/contracts/product-panels";
import { createDirectPanelInstance } from "../../../../../packages/apps-sdk/src/panel/direct";
import PanelMember from "../../../../../packages/apps-sdk/src/panel/PanelMember.vue";
import { createPanelText } from "../../../../../packages/apps-sdk/src/panel/text";
import { mountPanel } from "../../../../../packages/apps-sdk/src/panel/mount";
import { platformPanelHost } from "../../../../../packages/platform-web/src/panel-host";
import projectionsAnswered from "./fixtures/direct-panel-host-http.json";
import ownerAnswered from "./fixtures/scheduled-task-panel-http.json";
import {
  ignoreChanges, inside, installPlatform, leaveFrame, noOperations, nothingAt, panelFrame, panelOf, panelRecord,
  panelUse, registered, task, writePanelDocument, type Sent,
} from "./panel-frame";

/*
 * What the scheduled task owner names in the reader's language reaches the reader as the owner said it, wherever the
 * trial's projections are drawn: the names of a task's fields in the summary, the run-now button's name, and what the
 * owner said of a run it started. The owner's answers are what Node answered over HTTP for a reader in Chinese
 * (`fixtures/scheduled-task-panel-http.json`, recorded by B2 against PostgreSQL) and the projections what Node answered
 * for the trial's material (`fixtures/direct-panel-host-http.json`).
 *
 * What this rules out (128, 2026-11-20): field keys shown where the owner gave names; a button named by the projection's
 * own English name rather than the owner's; the run record a write returns laid out as JSON instead of the owner's words;
 * and a code panel's frame that shows a task's field keys where its owner names them. This edition reads in English only,
 * so the frame is checked in English; the words are the owner's one set, which Node answers from too.
 */

const projection = (id: keyof typeof projectionsAnswered.projections) =>
  productProjectionResponseSchema.parse(projectionsAnswered.projections[id]).projection as DirectProjection;
const summary = projection("projection-schedules-summary");
const run = projection("projection-schedules-run");
const named = ownerAnswered.record.value.fieldLabels;
const selected = { className: SCHEDULED_TASK, primaryKey: ownerAnswered.record.value.primaryKey };
/** The field names a summary shows, in the order it shows them. */
const shownNames = (root: Document | HTMLElement) => [...root.querySelectorAll(".sdk-object-summary dt")].map((term) => term.textContent?.trim());
const expectedNames = (summary.config as { fields: (keyof typeof named)[] }).fields.map((field) => named[field]);

afterEach(leaveFrame);

it("draws the owner's field names, button name and run message in a directly rendered panel", async () => {
  const manifest: DirectPanelManifest = {
    state: { selectedTask: { type: { kind: "object", objectType: SCHEDULED_TASK }, personal: false, deepLink: true, external: false } },
    members: {
      summary: { target: { projectionId: summary.id }, inputs: { task: { state: "selectedTask" } } },
      run: { target: { projectionId: run.id }, inputs: { task: { state: "selectedTask" } } },
    },
    events: {},
  };
  const instance = createDirectPanelInstance(manifest, {
    pageKey: "tasks", url: () => "/tasks", label: () => "Tasks", initial: { selectedTask: selected },
    text: createPanelText({}, { value: "en" } as never, "en"),
    operations: {
      ...noOperations.operations,
      prepare: async (operationId) => ({ intentId: ownerAnswered.runNowReceipt.intentId, operationId, label: operationId, confirmation: { kind: "none" } }),
    },
    expandPageComposer: noOperations.expandPageComposer, navigate: noOperations.navigate,
    confirmOperation: async () => ({ decision: "confirm", response: ownerAnswered.runNowReceipt as never }),
    recordDraftCreated: async () => {},
    readProjection: async (id) => (id === summary.id ? summary : run),
    read: async ({ dataName }) => (dataName === "record" ? ownerAnswered.record : ownerAnswered.operation) as never,
  });
  const element = document.createElement("div");
  document.body.append(element);
  const app = createApp({ render: () => h("div", [h(PanelMember, { instance, member: "summary" }), h(PanelMember, { instance, member: "run" })]) });
  app.use(createI18n({ legacy: false, locale: "en", messages: { en: publicEn } })).use(ElementPlus).mount(element);

  await vi.waitFor(() => expect(shownNames(element)).toEqual(expectedNames));
  const button = await vi.waitFor(() => {
    const found = element.querySelector<HTMLButtonElement>(".sdk-operation-button button");
    if (!found || found.disabled) throw new Error("Run now is not ready");
    return found;
  });
  expect(button.textContent?.trim()).toBe(ownerAnswered.operation.value.runNow.label);
  button.click();
  await vi.waitFor(() => expect(element.querySelector(".sdk-operation-button [data-outcome=success]")?.textContent)
    .toBe(ownerAnswered.runNowReceipt.outcome.message));
  // The run the owner returned is its record of the write, not something to show.
  expect(element.querySelector(".sdk-operation-result")).toBeNull();
  expect(element.textContent).not.toContain(ownerAnswered.runNowReceipt.outcome.data.id);
  app.unmount();
});

it("names a task's fields in a code panel's frame by the owner's words, in the reader's language", async () => {
  const application = "app-panels-trial-b";
  const q = panelRecord("panel-schedules-summary", "Task summary (trial)", definePanel({
    state: { selectedTask: { type: { kind: "object", objectType: SCHEDULED_TASK }, deepLink: true } },
    members: { summary: { target: { projectionId: summary.id }, inputs: { task: { state: "selectedTask" } } } },
    events: {},
  }));
  const use = panelUse("use-trial-b-summary", "panels-trial-b-summary", q.id, `/applications/${application}/summary`);
  installPlatform((request: Sent) => {
    if (request.path === `/api/product-projections/${summary.id}`) return Response.json(projectionsAnswered.projections["projection-schedules-summary"]);
    if (request.path === `/api/data-query/platform/scheduled-tasks/${task.id}`) return Response.json(task);
    return nothingAt(request);
  });
  const frame = panelFrame();
  platformPanelHost(application, use, ignoreChanges).frame(frame, registered(application, use, q), true);
  writePanelDocument(registered(application, use, q), use.path, { selectedTask: { className: SCHEDULED_TASK, primaryKey: task.id } });
  inside(frame);
  await mountPanel(panelOf("summary"));
  await vi.waitFor(() => expect(document.querySelector(".sdk-object-summary-title")?.textContent).toBe(task.title));
  expect(shownNames(document)).toEqual(["Application", "Settings", "Status", "Next run"]);
});
