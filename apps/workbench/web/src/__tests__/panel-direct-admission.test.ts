import { afterEach, describe, expect, it } from "vitest";
import { APP_BRIDGE_CHANNEL } from "@ontomato/contracts/app-bridge";
import { definePanel } from "@ontomato/contracts/panel-manifest";
import { RUN_NOW, SCHEDULED_TASK } from "@ontomato/contracts/panel-client-requests";
import { directProjectionSchema, type DirectProjection } from "@ontomato/contracts/product-panels";
import { platformPanelHost } from "../../../../../packages/platform-web/src/panel-host";
import { ignoreChanges, inside, installPlatform, leaveFrame, nothingAt, panelFrame, panelRecord, panelUse, registered, task, type Sent } from "./panel-frame";

/*
 * A code panel's frame reading a direct projection (an older panel placing a declared projection, as Q places X in the
 * pilot): the frame reads the projection's record through the platform's real app host and bridge, and then reads its
 * data through the resource modules of the projection's read sources. Both platform ends are real; the frame speaks the
 * bridge's wire format.
 *
 * What this rules out: the host refusing to read a direct projection at all (it parsed every record as a code
 * projection), and a direct projection admitting requests its read sources do not reach — what it reads is admitted
 * from its declared data (a type, an object, an operation), never from a binding it does not have.
 */

const current = {
  domainId: "domain-1",
  ownerId: "owner-1",
  revision: 1,
  createdAt: "2026-11-20T00:00:00.000Z",
  updatedAt: "2026-11-20T00:00:00.000Z",
  editable: false,
  visibility: "domain" as const,
};
const direct = (id: string, fields: Pick<DirectProjection, "componentId" | "inputs" | "data">): DirectProjection =>
  directProjectionSchema.parse({ ...current, id, name: id, description: "", outputs: {}, config: {}, ...fields });

const taskInput = { kind: "object" as const, objectType: SCHEDULED_TASK };
const projections: Record<string, DirectProjection> = {
  "direct-tasks": direct("direct-tasks", {
    componentId: "@ontomato/sdk:ObjectList", inputs: {},
    data: { rows: { source: { type: { kind: "PlatformObjectType", id: SCHEDULED_TASK } }, read: "list", params: {} } },
  }),
  "direct-summary": direct("direct-summary", {
    componentId: "@ontomato/sdk:ObjectSummary", inputs: { task: taskInput },
    data: { record: { source: { object: { input: "task" } }, read: "record", params: {} } },
  }),
  "direct-run": direct("direct-run", {
    componentId: "@ontomato/sdk:OperationButton", inputs: { task: taskInput },
    data: { operation: { source: { operation: { kind: "PlatformOperation", id: RUN_NOW } }, read: "describe", params: {} } },
  }),
};
const slot = (projectionId: string) => ({ target: { projectionId }, inputs: {} });
const panel = panelRecord("panel-q", "Q", definePanel({
  state: {},
  members: { tasks: slot("direct-tasks"), summary: slot("direct-summary"), run: slot("direct-run") },
  events: {},
}));
const use = panelUse("use-q", "q", panel.id, "/applications/app-q/q");
const tasks = "/platform/scheduled-tasks";

function answer(request: Sent) {
  const projection = /^\/api\/product-projections\/(.+)$/.exec(request.path);
  if (projection && projections[projection[1]!]) return Response.json({ projection: projections[projection[1]!] });
  if (request.path === `/api/data-query${tasks}`) return Response.json({ tasks: [task], timeZone: task.timeZone });
  if (request.path === `/api/data-query${tasks}/${task.id}`) return Response.json(task);
  if (request.path === `/api/data-query${tasks}/${task.id}/runs`) return Response.json({});
  return nothingAt(request);
}

/** The frame's end of the bridge: one call per operation, answered with its result or refused with its error. */
function connect() {
  const channel = new MessageChannel();
  window.parent.postMessage({ channel: APP_BRIDGE_CHANNEL, operation: "connect" }, "*", [channel.port2]);
  channel.port1.start();
  let calls = 0;
  return (operation: string, payload?: unknown) =>
    new Promise<unknown>((resolve, reject) => {
      const id = `call-${++calls}`;
      const listener = (event: MessageEvent) => {
        if (event.data?.id !== id) return;
        channel.port1.removeEventListener("message", listener);
        if (event.data.error) reject(new Error(event.data.error));
        else resolve(event.data.result);
      };
      channel.port1.addEventListener("message", listener);
      channel.port1.postMessage({ channel: APP_BRIDGE_CHANNEL, id, operation, payload });
    });
}

afterEach(leaveFrame);

describe("a code panel's frame reading direct projections", () => {
  it("admits what each projection's declared read sources reach, and nothing before it is read", async () => {
    installPlatform(answer);
    const frame = panelFrame();
    platformPanelHost("app-q", use, ignoreChanges).frame(frame, registered("app-q", use, panel), true);
    inside(frame);
    const invoke = connect();
    const request = (path: string, method = "GET", service = "/data-query") =>
      invoke("request", { path, service, method, headers: [], body: method === "GET" ? null : "{}" });

    // Before the frame read X, nothing of its type is admitted.
    await expect(request(tasks)).rejects.toThrow("Outside what this panel's projections declare");

    // A type source: its list.
    await expect(request("/product-projections/direct-tasks", "GET", "")).resolves.toMatchObject({ status: 200 });
    await expect(request(tasks)).resolves.toMatchObject({ status: 200 });
    // An operation source the frame has not read yet: refused.
    await expect(request(`${tasks}/${task.id}/runs`, "POST")).rejects.toThrow("Outside what this panel's projections declare");

    // An object source (by an object input) and an operation source.
    await request("/product-projections/direct-summary", "GET", "");
    await expect(request(`${tasks}/${task.id}`)).resolves.toMatchObject({ status: 200 });
    await request("/product-projections/direct-run", "GET", "");
    await expect(request(`${tasks}/${task.id}/runs`, "POST")).resolves.toMatchObject({ status: 200 });

    // What none of the sources reaches stays refused.
    await expect(request(`${tasks}/${task.id}`, "DELETE")).rejects.toThrow("Outside what this panel's projections declare");
  });
});
