import { afterEach, expect, it } from "vitest";
import { platformPanelHost } from "../../../../../packages/platform-web/src/panel-host";
import { buildExecutionContext } from "@ontomato/contracts/build-tests";
import { registerCandidateFrame } from "../../../../../packages/platform-web/src/app-host";
import { contextTransport } from "../../../../../packages/apps-sdk/src/context";
import { mountPanel } from "../../../../../packages/apps-sdk/src/panel/mount";
import {
  ignoreChanges, inside, installPlatform, leaveFrame, manifestP, nothingAt, panelFrame, panelOf, panelRecord, panelUse,
  projections, READER, registered, writePanelDocument, type Sent,
} from "./panel-frame";

/*
 * A panel written with code reads its members' data where a panel the platform draws reads it: at Node's one read entry
 * (`POST /api/product-panels/read`), through the real bridge. The frame names the member, the datum and its values; the
 * host names what it is read as — the application use the frame shows, or a candidate's workspace — and Node answers in
 * one of its four states, which reach the frame as Node gave them.
 *
 * What this rules out: a frame that reads its data some other way than Node's entry, and one that chooses which
 * application use, or which workspace, its data is read as.
 */

const panelP = panelRecord("panel-schedules-trial", "Scheduled tasks (trial)", manifestP);
const useOfP = panelUse("use-trial-a-tasks", "panels-trial-a-tasks", panelP.id, "/applications/app-panels-trial-a/tasks");
const asked = { memberPath: [{ member: "summary" }], dataName: "record", inputs: { task: null } };
const answered = { status: "empty" };

function answer(request: Sent) {
  const projection = /^\/api\/product-projections\/(.+)$/.exec(request.path);
  if (projection && projections[projection[1]!]) return Response.json({ projection: projections[projection[1]!] });
  if (request.method === "POST" && request.path === "/api/product-panels/read") return Response.json(answered);
  return nothingAt(request);
}

const read = (transport: ReturnType<typeof contextTransport>, body: unknown) => transport.request("/product-panels/read", {
  method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
}, "");
const reads = (sent: Sent[]) => sent.filter(request => request.method === "POST" && request.path === "/api/product-panels/read");

afterEach(leaveFrame);

it("reads a registered panel's member data at Node's read entry, as the application use the frame shows", async () => {
  const sent = installPlatform(answer);
  const frame = panelFrame();
  platformPanelHost("app-panels-trial-a", useOfP, ignoreChanges).frame(frame, registered("app-panels-trial-a", useOfP, panelP), true);
  writePanelDocument(registered("app-panels-trial-a", useOfP, panelP), useOfP.path, {});
  inside(frame);
  const { appContext } = await mountPanel(panelOf("summary"));
  const transport = contextTransport(appContext);

  const response = await read(transport, asked);
  expect(await response.json()).toEqual(answered);
  expect(reads(sent)).toEqual([expect.objectContaining({
    credential: READER,
    body: { ...asked, source: { kind: "registered", applicationId: "app-panels-trial-a", useId: useOfP.id } },
  })]);

  // Where the data is read as is the host's to say: a frame naming it is refused before anything is sent.
  await expect(read(transport, { ...asked, source: { kind: "registered", applicationId: "another-app", useId: "another-use" } }))
    .rejects.toThrow("A panel frame names its member and datum, not where it reads");
  expect(reads(sent)).toHaveLength(1);
});

it("reads a candidate preview's member data as its workspace, for Node to answer", async () => {
  const sent = installPlatform(answer);
  const frame = panelFrame();
  const workspace = { id: "7c9e6679-7425-40de-944b-e07fc1f90ae7", ref: "working" };
  registerCandidateFrame(frame, buildExecutionContext(workspace.id, null), workspace,
    { pageKey: "candidate", manifest: panelP.manifest }, true);
  writePanelDocument(registered("app-panels-trial-a", useOfP, panelP), useOfP.path, {});
  inside(frame);
  const { appContext } = await mountPanel(panelOf("summary"));

  await read(contextTransport(appContext), asked);
  expect(reads(sent).map(request => request.body)).toEqual([{ ...asked, source: { kind: "candidate", workspace } }]);
});
