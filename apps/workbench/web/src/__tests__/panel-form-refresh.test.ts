import { afterEach, expect, it, vi } from "vitest";
import { nextTick } from "vue";
import { definePanel } from "@ontomato/contracts/panel-manifest";
import { PANEL_HOST_CHANNEL } from "@ontomato/contracts/panel-host";
import { platformPanelHost } from "../../../../../packages/platform-web/src/panel-host";
import { ignoreChanges,
  SCHEDULED_TASK, inside, inspectionTaskForm, installPlatform, leaveFrame, nothingAt, panelFrame, panelOf, panelRecord,
  panelUse, projections, registered, task, writePanelDocument, type Sent,
} from "./panel-frame";

/*
 * A refresh of the object a clean form shows — the conversation's stream connecting, the tab coming back — reads the
 * object again without taking the form away from the reader: the fields stay where they are, and a reader who starts
 * typing while the read is on its way keeps what they typed; the read that came back over it waits until the form is
 * saved or discarded, and is made then. On 128 a refresh replaced the input the reader was typing in and put the old
 * instruction back (the app recovery demo, 2026-11-19).
 */

const formProjection = projections["projection-schedules-form"]!;
const panel = panelRecord("panel-schedules-form", "Task form", definePanel({
  state: { selectedTask: { type: { kind: "object", objectType: SCHEDULED_TASK }, deepLink: true } },
  members: { form: { target: { projectionId: formProjection.id }, inputs: { task: { state: "selectedTask" } } } },
  events: {},
}));
const use = panelUse("use-trial-a-tasks", "panels-trial-a-tasks", panel.id, "/applications/app-panels-trial-a/tasks");
const taskPath = `/api/data-query/platform/scheduled-tasks/${task.id}`;
const formPath = `/api/data-query/platform/scheduled-tasks/applications/${task.appId}/form`;
/** The task as an inspection with its saved instruction. */
const inspection = { ...task, content: { operation: "inspection", instruction: "Inspect last night's failures" } };

/** The platform answering for the form; each form read waits for `release` when the test holds it. */
function opened() {
  let held: ((value: void) => void) | null = null;
  let hold = false;
  /** Holds only the next form read; the reads after it are answered at once. */
  let holdOne = false;
  const sent = installPlatform(async (request: Sent) => {
    if (request.path === `/api/product-projections/${formProjection.id}`) return Response.json({ projection: formProjection });
    if (request.path === taskPath && request.method === "GET") return Response.json(inspection);
    if (request.path === formPath) {
      if (hold || holdOne) {
        holdOne = false;
        await new Promise((resolve) => { held = resolve; });
      }
      return Response.json({ ...inspectionTaskForm, values: inspection.content, submittable: true });
    }
    if (request.path === taskPath && request.method === "PUT")
      return Response.json({ ...inspection, revision: inspection.revision + 1, content: (request.body as { content: object }).content });
    return nothingAt(request);
  });
  const frame = panelFrame();
  platformPanelHost("app-panels-trial-a", use, ignoreChanges).frame(frame, registered("app-panels-trial-a", use, panel), true);
  writePanelDocument(registered("app-panels-trial-a", use, panel), "/applications/app-panels-trial-a/tasks", { selectedTask: { className: SCHEDULED_TASK, primaryKey: task.id } });
  inside(frame);
  return {
    sent, frame,
    /** The frame's own SDK, fresh for this frame as a frame's modules are. */
    async mount(...slots: string[]) {
      const { mountPanel } = await import("../../../../../packages/apps-sdk/src/panel/mount");
      return mountPanel(panelOf(...slots));
    },
    holdReads() { hold = true; },
    holdNextRead() { holdOne = true; },
    /** Waits until the held read is on its way. */
    async onItsWay() {
      await vi.waitFor(() => expect(held).not.toBeNull());
    },
    async release() {
      await vi.waitFor(() => expect(held).not.toBeNull());
      hold = false;
      held!();
      held = null;
    },
    /** The refresh the platform's panel host sends for every object (`refresh(null)`). */
    refresh() { frame.postMessage({ channel: PANEL_HOST_CHANNEL, kind: "object-changed", target: null }, "*"); },
  };
}

const instruction = () => document.querySelector<HTMLTextAreaElement>('[data-field="/instruction"] textarea');
const formReads = (sent: Sent[]) => sent.filter((request) => request.path === formPath).length;

/** Watches the form for a skeleton standing in for its fields. */
function skeletons() {
  const seen: string[] = [];
  const observer = new MutationObserver(() => {
    if (document.querySelector(".sdk-owner-form .el-skeleton")) seen.push("skeleton");
  });
  observer.observe(document.body, { childList: true, subtree: true });
  return { seen, stop: () => observer.disconnect() };
}

async function typed(input: HTMLTextAreaElement, text: string) {
  input.focus();
  input.value = text;
  input.dispatchEvent(new Event("input"));
  await nextTick();
}

afterEach(() => {
  leaveFrame();
  vi.resetModules();
});

it("keeps a clean form's fields in place while the object is read again", { timeout: 15000 }, async () => {
  const platform = opened();
  await platform.mount("form");
  await vi.waitFor(() => expect(instruction()?.value).toBe(inspection.content.instruction), { timeout: 5000 });
  const input = instruction()!;
  const reads = formReads(platform.sent);
  const watched = skeletons();

  platform.refresh();
  await vi.waitFor(() => expect(formReads(platform.sent)).toBe(reads + 1));
  await new Promise((resolve) => setTimeout(resolve, 20));
  watched.stop();
  // The same input, never replaced by a skeleton.
  expect(instruction()).toBe(input);
  expect(watched.seen).toEqual([]);
});

it("keeps what the reader typed while a read is on its way, saves it, and reads again once the form is saved", { timeout: 15000 }, async () => {
  const platform = opened();
  const { context } = await platform.mount("form");
  await vi.waitFor(() => expect(instruction()?.value).toBe(inspection.content.instruction), { timeout: 5000 });
  const input = instruction()!;

  platform.holdReads();
  platform.refresh();
  await platform.onItsWay();
  await typed(input, "Inspect this morning's failures");
  // The read comes back with the instruction as it was saved.
  await platform.release();
  await new Promise((resolve) => setTimeout(resolve, 20));
  expect(instruction()).toBe(input);
  expect(instruction()!.value).toBe("Inspect this morning's failures");
  expect(context.instance.dirty()).toBe(true);

  const reads = formReads(platform.sent);
  const save = context.instance.operations.value.find((operation) => operation.kind === "form.save")!;
  await context.instance.invoke(save.id);
  const put = platform.sent.find((request) => request.method === "PUT")!;
  expect((put.body as { content: object }).content).toEqual({ operation: "inspection", instruction: "Inspect this morning's failures" });
  // The read the typing held back is made now the form is saved.
  await vi.waitFor(() => expect(formReads(platform.sent)).toBeGreaterThan(reads));
});

it("reads again once the reader discards what they typed while a read was on its way", { timeout: 15000 }, async () => {
  const platform = opened();
  await platform.mount("form");
  await vi.waitFor(() => expect(instruction()?.value).toBe(inspection.content.instruction), { timeout: 5000 });

  platform.holdReads();
  platform.refresh();
  await platform.onItsWay();
  await typed(instruction()!, "Something else");
  await platform.release();
  await new Promise((resolve) => setTimeout(resolve, 20));
  const reads = formReads(platform.sent);
  expect(instruction()!.value).toBe("Something else");

  [...document.querySelectorAll<HTMLButtonElement>(".sdk-owner-form-actions button")].find((button) => button.textContent?.trim() === "Discard")!.click();
  await vi.waitFor(() => expect(formReads(platform.sent)).toBe(reads + 1));
  await vi.waitFor(() => expect(instruction()!.value).toBe(inspection.content.instruction));
});

it("keeps what the reader typed when a refresh during the first read is answered before it", { timeout: 15000 }, async () => {
  // A page opened, or reloaded, and sent to the background and back at once: the host's refresh reaches the form while
  // its first read is still on its way, the refresh's own read comes back first and the reader starts typing; the first
  // read, answered last with the instruction as it was saved, must not put that back.
  const platform = opened();
  platform.holdNextRead();
  const { context } = await platform.mount("form");
  await platform.onItsWay();
  platform.refresh();
  await vi.waitFor(() => expect(instruction()?.value).toBe(inspection.content.instruction), { timeout: 5000 });
  const input = instruction()!;
  await typed(input, "Inspect this morning's failures");

  await platform.release();
  await new Promise((resolve) => setTimeout(resolve, 30));
  expect(instruction()).toBe(input);
  expect(instruction()!.value).toBe("Inspect this morning's failures");
  expect(context.instance.dirty()).toBe(true);
});
