import { afterEach, describe, expect, it, vi } from "vitest";
import { platformPanelHost } from "../../../../../packages/platform-web/src/panel-host";
import { contextTransport } from "../../../../../packages/apps-sdk/src/context";
import { connectAppContext } from "../../../../../packages/apps-sdk/src/hosted-context";
import { mountPanel } from "../../../../../packages/apps-sdk/src/panel/mount";
import {
  READER,
  SCHEDULED_TASK,
  inside,
  installPlatform,
  leaveFrame,
  manifestQ,
  nothingAt,
  panelFrame,
  panelOf,
  panelRecord,
  panelUse,
  projections,
  task,
  writePanelDocument,
  registered,
  type Sent,
} from "./panel-frame";

/*
 * A panel's frame and the platform, joined by the real message bridge at both ends (overall design 3.4, 5.1): the
 * platform's own app host and bridge as the shell installs them, the frame registered by the platform's own panel host,
 * and on the frame's side the SDK's own `mountPanel` and `connectAppContext`.
 *
 * What this rules out: a panel frame the bridge does not answer (the frame was registered without its application); a
 * panel whose reads never reach the platform, or reach it as anything but the reader; a frame nobody registered getting
 * a port; and a port that keeps answering for one application once its frame is another's.
 */

const summary = projections["projection-schedules-summary"]!;
const panelQ = panelRecord("panel-schedules-summary", "Task summary (trial)", manifestQ);
const useOfQ = panelUse("use-trial-b-summary", "panels-trial-b-summary", panelQ.id, "/applications/app-panels-trial-b/summary");
const useOfP = panelUse("use-trial-a-tasks", "panels-trial-a-tasks", "panel-schedules-trial", "/applications/app-panels-trial-a/tasks");

function answer(request: Sent) {
  if (request.path === `/api/product-projections/${summary.id}`) return Response.json({ projection: summary });
  if (request.path === `/api/data-query/platform/scheduled-tasks/${task.id}`) return Response.json(task);
  return nothingAt(request);
}

/** What a connect came to within a while: the frame's context, or nothing at all. */
async function connectWithin(milliseconds: number) {
  return Promise.race([
    connectAppContext().then(
      () => "connected",
      (reason: unknown) => `failed: ${(reason as Error).message}`,
    ),
    new Promise<string>((resolve) => setTimeout(() => resolve("no answer"), milliseconds)),
  ]);
}

afterEach(leaveFrame);

describe("a panel frame and the platform's message bridge", () => {
  it("connects as its application's frame, and reads its projection and its task as the reader", { timeout: 15000 }, async () => {
    const sent = installPlatform(answer);
    const frame = panelFrame();
    // B's page shows Q: B's panel host registers the frame it draws, and writes Q opened at one task into it.
    platformPanelHost("app-panels-trial-b", useOfQ).frame(frame, registered("app-panels-trial-b", useOfQ, panelQ), true);
    writePanelDocument(registered("app-panels-trial-b", useOfQ, panelQ), "/applications/app-panels-trial-b/summary", {
      selectedTask: { className: SCHEDULED_TASK, primaryKey: task.id },
    });

    inside(frame);
    const { appContext } = await mountPanel(panelOf("summary"));

    // The handshake: the frame came up with the platform's own snapshot, as a live frame.
    expect(appContext.executionContext).toEqual({ kind: "live" });
    expect(appContext.locale.value).toBe("en");
    // The SDK drew X from its current record and the task the address named, both read through the platform.
    await vi.waitFor(
      () => expect(document.querySelector(".sdk-object-summary-title")?.textContent).toBe(task.title),
      { timeout: 5000 },
    );
    expect(sent.map(({ method, path, credential }) => ({ method, path, credential }))).toEqual([
      { method: "GET", path: `/api/product-projections/${summary.id}`, credential: READER },
      { method: "GET", path: `/api/data-query/platform/scheduled-tasks/${task.id}`, credential: READER },
    ]);

    // What Q may ask for is what Q declares: P's run-now projection and the run it would start are not Q's, even though
    // the reader may run the task in P.
    const transport = contextTransport(appContext);
    for (const [path, init, service] of [
      ["/product-projections/projection-schedules-run", {}, ""],
      [`/platform/scheduled-tasks/${task.id}/runs`, { method: "POST" }, "/data-query"],
      [`/product-panels/${panelQ.id}`, {}, ""],
      ["/dsl/executeV1", { method: "POST", body: "{}" }, "/data-query"],
    ] as const)
      await expect(transport.request(path, init, service)).rejects.toThrow("Outside what this panel's projections declare");
    expect(sent).toHaveLength(2);
  });

  it("gives no port to a frame no panel host registered, and one once a panel host does", { timeout: 15000 }, async () => {
    const sent = installPlatform(answer);
    const frame = panelFrame();
    inside(frame);

    expect(await connectWithin(500)).toBe("no answer");
    expect(sent).toEqual([]);

    // The same frame, once A's panel host has drawn it.
    platformPanelHost("app-panels-trial-a", useOfP).frame(frame, registered("app-panels-trial-a", useOfP, panelQ), true);
    expect(await connectWithin(5000)).toBe("connected");
  });

  it("stops answering for one application once the frame is another's", { timeout: 15000 }, async () => {
    const sent = installPlatform(answer);
    const frame = panelFrame();
    platformPanelHost("app-panels-trial-b", useOfQ).frame(frame, registered("app-panels-trial-b", useOfQ, panelQ), true);
    inside(frame);
    const asB = contextTransport(await connectAppContext());
    expect(await (await asB.request(`/product-projections/${summary.id}`, {}, "")).json()).toEqual({ projection: summary });

    // The frame is now A's: the port B's page was given refuses, and nothing more goes out for it.
    platformPanelHost("app-panels-trial-a", useOfP).frame(frame, registered("app-panels-trial-a", useOfP, panelQ), true);
    await expect(asB.request(`/product-projections/${summary.id}`, {}, "")).rejects.toThrow("no longer registered");
    expect(sent).toHaveLength(1);

    // As A's frame it connects again, and is answered.
    const asA = contextTransport(await connectAppContext());
    expect((await asA.request(`/product-projections/${summary.id}`, {}, "")).ok).toBe(true);
    expect(sent.map((request) => request.credential)).toEqual([READER, READER]);
  });
});
