import { afterEach, expect, it, vi } from "vitest";
import { definePanel } from "@ontomato/contracts/panel-manifest";
import { PANEL_HOST_CHANNEL } from "@ontomato/contracts/panel-host";
import { platformPanelHost } from "../../../../../packages/platform-web/src/panel-host";
import {
  SCHEDULED_TASK, inside, installPlatform, leaveFrame, nothingAt, panelFrame, panelOf, panelRecord, panelUse, projections,
  registered, task, writePanelDocument, type Sent,
} from "./panel-frame";

/*
 * A retained panel the reader does not see — another page is shown, its tab is hidden, its place is collapsed — reads
 * nothing on its own (A's activity contract, E's frame retention). What would have made it read again meanwhile is held,
 * and when it is active again each object is read once, however often it changed, and a changed projection is read
 * once at its latest revision.
 */

const summary = projections["projection-schedules-summary"]!;
const panel = panelRecord("panel-schedules-summary", "Task summary", definePanel({
  state: { selectedTask: { kind: "object", objectType: SCHEDULED_TASK, deepLink: true } },
  slots: { summary: { projectionId: summary.id, inputs: { task: { state: "selectedTask" } } } },
  operations: [],
}));
const use = panelUse("use-trial-b-summary", "panels-trial-b-summary", panel.id, "/applications/app-panels-trial-b/summary");
const taskPath = `/api/data-query/platform/scheduled-tasks/${task.id}`;

async function opened() {
  const sent = installPlatform((request: Sent) => {
    if (request.path === `/api/product-projections/${summary.id}`) return Response.json({ projection: summary });
    if (request.path === taskPath) return Response.json(task);
    return nothingAt(request);
  });
  const frame = panelFrame();
  platformPanelHost("app-panels-trial-b", use).frame(frame, registered("app-panels-trial-b", use, panel), true);
  writePanelDocument(panel, use, "/applications/app-panels-trial-b/summary", { selectedTask: { className: SCHEDULED_TASK, primaryKey: task.id } });
  inside(frame);
  const { mountPanel } = await import("../../../../../packages/apps-sdk/src/panel/mount");
  await mountPanel(panelOf("summary"));
  await vi.waitFor(() => expect(document.querySelector(".sdk-object-summary-title")?.textContent).toBe(task.title), { timeout: 5000 });
  const post = (message: object) => frame.postMessage({ channel: PANEL_HOST_CHANNEL, ...message }, "*");
  const reads = (path: string) => sent.filter((request) => request.path === path).length;
  /** Lets every message posted so far reach the frame and everything it starts settle. */
  const settled = () => new Promise((resolve) => setTimeout(resolve, 30));
  return { post, reads, settled };
}

afterEach(() => {
  leaveFrame();
  vi.resetModules();
});

it("reads nothing while inactive, and reads each changed object once when active again", { timeout: 15000 }, async () => {
  const { post, reads, settled } = await opened();
  const target = { objectType: SCHEDULED_TASK, primaryKey: task.id };
  const before = reads(taskPath);

  post({ kind: "activity", active: false });
  post({ kind: "object-changed", target });
  post({ kind: "object-changed", target });
  post({ kind: "object-changed", target: null });
  await settled();
  expect(reads(taskPath)).toBe(before);

  post({ kind: "activity", active: true });
  await settled();
  expect(reads(taskPath)).toBe(before + 1);

  // Active again, each refresh reads as it did before.
  post({ kind: "object-changed", target });
  await settled();
  expect(reads(taskPath)).toBe(before + 2);
});

it("reads a projection that changed while inactive once, at its latest revision, when active again", { timeout: 15000 }, async () => {
  const { post, reads, settled } = await opened();
  const projectionPath = `/api/product-projections/${summary.id}`;
  const before = reads(projectionPath);

  post({ kind: "activity", active: false });
  post({ kind: "projections-changed", projections: [{ id: summary.id, revision: summary.revision + 1 }] });
  post({ kind: "projections-changed", projections: [{ id: summary.id, revision: summary.revision + 2 }] });
  await settled();
  expect(reads(projectionPath)).toBe(before);

  post({ kind: "activity", active: true });
  await settled();
  expect(reads(projectionPath)).toBe(before + 1);
});
