import { afterEach, describe, expect, it } from "vitest";
import { DELETE_FUNCTION, FUNCTION } from "@ontomato/contracts/panel-client-requests";
import { platformPanelHost } from "../../../../../packages/platform-web/src/panel-host";
import { ignoreChanges, inside, installPlatform, leaveFrame, nothingAt, panelFrame, panelUse, registered, type Sent } from "./panel-frame";
import { codePanelRecord, connectBridge, projectionRecord } from "./host-bridge-records";

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

const functionInput = { kind: "object" as const, objectType: FUNCTION };
const projections = Object.fromEntries([
  projectionRecord({
    id: "direct-functions", componentId: "@ontomato/sdk:ObjectList",
    data: { rows: { source: { type: { kind: "PlatformObjectType", id: FUNCTION } }, read: "list", params: {} } },
  }),
  projectionRecord({
    id: "direct-summary", componentId: "@ontomato/sdk:ObjectSummary", inputs: { definition: functionInput },
    data: { record: { source: { object: { input: "definition" } }, read: "record", params: {} } },
  }),
  projectionRecord({
    id: "direct-delete", componentId: "@ontomato/sdk:OperationButton", inputs: { definition: functionInput }, config: { operation: "remove" },
    data: {}, operations: { remove: { operation: { kind: "PlatformOperation", id: DELETE_FUNCTION }, target: { input: "definition" } } },
  }),
].map((projection) => [projection.id, projection]));
const panel = codePanelRecord("panel-q", { functions: "direct-functions", summary: "direct-summary", remove: "direct-delete" });
const use = panelUse("use-q", "q", panel.id, "/applications/app-q/q");
const list = "/function/queryList";
const record = "/function/queryById";
const remove = "/function/delete";

function answer(request: Sent) {
  const projection = /^\/api\/product-projections\/(.+)$/.exec(request.path);
  if (projection && projections[projection[1]!]) return Response.json({ projection: projections[projection[1]!] });
  if (request.method === "POST" && [list, record, remove].some(path => request.path === `/api/data-query${path}`))
    return Response.json({ success: true });
  return nothingAt(request);
}

afterEach(leaveFrame);

describe("a code panel's frame reading direct projections", () => {
  it("admits what each projection's declared read sources reach, and nothing before it is read", async () => {
    installPlatform(answer);
    const frame = panelFrame();
    platformPanelHost("app-q", use, ignoreChanges).frame(frame, registered("app-q", use, panel), true);
    inside(frame);
    const invoke = connectBridge();
    const request = (path: string, method = "GET", service = "/data-query") =>
      invoke("request", { path, service, method, headers: [], body: method === "GET" ? null : "{}" });

    // Before the frame read X, nothing of its type is admitted.
    await expect(request(list, "POST")).rejects.toThrow("Outside what this panel's projections declare");

    // A type source: its list.
    await expect(request("/product-projections/direct-functions", "GET", "")).resolves.toMatchObject({ status: 200 });
    await expect(request(list, "POST")).resolves.toMatchObject({ status: 200 });
    // An operation the frame has not read the projection naming yet: refused.
    await expect(request(remove, "POST")).rejects.toThrow("Outside what this panel's projections declare");

    // An object source (by an object input), and an operation the projection names.
    await request("/product-projections/direct-summary", "GET", "");
    await expect(request(record, "POST")).resolves.toMatchObject({ status: 200 });
    await request("/product-projections/direct-delete", "GET", "");
    await expect(request(remove, "POST")).resolves.toMatchObject({ status: 200 });

    // What none of the sources reaches stays refused.
    await expect(request("/function/execute", "POST")).rejects.toThrow("Outside what this panel's projections declare");
  });
});
