import { afterEach, expect, it, vi } from "vitest";
import { SCHEDULED_TASK } from "@ontomato/contracts/panel-client-requests";
import { definePanel } from "@ontomato/contracts/panel-manifest";
import { productProjectionResponseSchema } from "@ontomato/contracts/product-panels";
import { platformPanelHost } from "../../../../../packages/platform-web/src/panel-host";
import { mountPanel } from "../../../../../packages/apps-sdk/src/panel/mount";
import recorded from "./fixtures/direct-panel-host-http.json";
import {
  ignoreChanges, inside, installPlatform, leaveFrame, nothingAt, panelFrame, panelOf, panelRecord, panelUse, registered, task,
  writePanelDocument, type Sent,
} from "./panel-frame";

/*
 * A panel written with code keeps running in its frame while the projections it places become direct ones (direct
 * rendering design 5; the trial's Q places the summary X, which P draws directly). Its frame reads X through the
 * platform's bridge — the real app host and registration the panel host makes — and the summary shows the task its
 * address names. In a frame the record is read through the frame's own resource adapter, by the bridge the projection's
 * read sources admit — not through the platform's read entry, which is the direct instance's. X is answered with what
 * Node answered for it over HTTP (`fixtures/direct-panel-host-http.json`); the task's owner is a stand-in.
 *
 * What this rules out: a frame whose bridge refuses or cannot parse a direct projection it reads (128, 2026-11-22: Q's
 * summary failed with a ZodError in the bridge), and a direct projection whose datum the frame cannot read.
 */

const application = "app-panels-trial-b";
const answered = recorded.projections["projection-schedules-summary"];
const x = productProjectionResponseSchema.parse(answered).projection;
const q = panelRecord("panel-schedules-summary", "Task summary (trial)", definePanel({
  state: { selectedTask: { type: { kind: "object", objectType: SCHEDULED_TASK }, deepLink: true } },
  members: { summary: { target: { projectionId: x.id }, inputs: { task: { state: "selectedTask" } } } },
  events: {},
}));
const use = panelUse("use-trial-b-summary", "panels-trial-b-summary", q.id, `/applications/${application}/summary`);
function answer(request: Sent) {
  if (request.path === `/api/product-projections/${x.id}`) return Response.json(answered);
  if (request.path === `/api/data-query/platform/scheduled-tasks/${task.id}`) return Response.json(task);
  return nothingAt(request);
}

afterEach(leaveFrame);

it("reads a direct projection through the bridge in a coded panel's frame and shows its datum", async () => {
  const sent = installPlatform(answer);
  const frame = panelFrame();
  platformPanelHost(application, use, ignoreChanges).frame(frame, registered(application, use, q), true);
  writePanelDocument(registered(application, use, q), use.path, { selectedTask: { className: SCHEDULED_TASK, primaryKey: task.id } });
  inside(frame);
  await mountPanel(panelOf("summary"));
  await vi.waitFor(() => expect(document.querySelector(".sdk-object-summary-title")?.textContent).toBe(task.title));
  expect(sent.map(request => `${request.method} ${request.path}`)).toEqual([
    `GET /api/product-projections/${x.id}`,
    `GET /api/data-query/platform/scheduled-tasks/${task.id}`,
  ]);
});
