import { afterEach, describe, expect, it, vi } from "vitest";
import { RUN_NOW } from "@ontomato/contracts/panel-client-requests";
import { platformPanelHost } from "../../../../../packages/platform-web/src/panel-host";
import { ignoreChanges, READER, inside, installPlatform, leaveFrame, nothingAt, panelFrame, panelUse, registered, task, type Sent } from "./panel-frame";
import { codePanelRecord, connectBridge, projectionRecord } from "./host-bridge-records";

/*
 * A frame's multipart body (shared parts design, U11) through the platform's real host and bridge: the frame hands the
 * bridge form entries, and the host sends them as multipart to an owner path its projection's reads reach, with the
 * reader's credential. The frame speaks the bridge's wire format directly, as any SDK version does.
 *
 * What this rules out: a frame's own Content-Type reaching the owner with the multipart body, so the boundary the owner
 * parses is the frame's word instead of the one the browser wrote into the body.
 */

const runProjection = projectionRecord({
  id: "projection-task-run",
  componentId: "@ontomato/sdk:OperationButton",
  config: { operation: "runNow" },
  data: {},
  operations: { runNow: { operation: { kind: "PlatformOperation", id: RUN_NOW } } },
});
const panel = codePanelRecord("panel-tasks", { run: runProjection.id });
const use = panelUse("use-tasks", "tasks", panel.id, "/applications/app-tasks/tasks");
const runs = `/platform/scheduled-tasks/${task.id}/runs`;

function answer(request: Sent) {
  if (request.path === `/api/product-projections/${runProjection.id}`) return Response.json({ projection: runProjection });
  if (request.path === `/api/data-query${runs}`) return Response.json({});
  return nothingAt(request);
}

afterEach(leaveFrame);

describe("a frame's multipart body", () => {
  it("goes to an admitted owner path as multipart whose boundary only the browser writes", async () => {
    installPlatform(answer);
    const frame = panelFrame();
    platformPanelHost("app-tasks", use, ignoreChanges).frame(frame, registered("app-tasks", use, panel), true);
    inside(frame);
    const invoke = connectBridge();
    await invoke("request", { path: `/product-projections/${runProjection.id}`, service: "", method: "GET", headers: [], body: null });

    await expect(invoke("request", {
      path: runs,
      service: "/data-query",
      method: "POST",
      headers: [["content-type", "multipart/form-data; boundary=chosen-by-the-frame"]],
      body: { form: [["file", "demo package"]] },
    })).resolves.toMatchObject({ status: 200 });

    const [, init] = vi.mocked(fetch).mock.calls.find(([input]) => String(input).endsWith(runs))!;
    const headers = new Headers(init!.headers);
    expect(init!.body).toBeInstanceOf(FormData);
    expect((init!.body as FormData).get("file")).toBe("demo package");
    expect(headers.get("content-type")).toBeNull();
    expect(headers.get("tk")).toBe(READER);
  });
});
