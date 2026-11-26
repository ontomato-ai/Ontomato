import { afterEach, describe, expect, it, vi } from "vitest";
import { IMPORT_SKILL } from "@ontomato/contracts/panel-client-requests";
import { platformPanelHost } from "../../../../../packages/platform-web/src/panel-host";
import { ignoreChanges, READER, inside, installPlatform, leaveFrame, nothingAt, panelFrame, panelUse, registered, type Sent } from "./panel-frame";
import { codePanelRecord, connectBridge, projectionRecord } from "./host-bridge-records";

/*
 * A frame's multipart body (shared parts design, U11) through the platform's real host and bridge: the frame hands the
 * bridge form entries, and the host sends them as multipart to the registered operation's upload entry, with the
 * reader's credential. The frame speaks the bridge's wire format directly, as any SDK version does.
 *
 * What this rules out: a frame's own Content-Type reaching the owner with the multipart body, so the boundary the owner
 * parses is the frame's word instead of the one the browser wrote into the body.
 */

const importProjection = projectionRecord({
  id: "projection-skill-import",
  componentId: "@ontomato/sdk:OperationButton",
  config: { operation: "import" },
  data: {},
  operations: { import: { operation: { kind: "PlatformOperation", id: IMPORT_SKILL } } },
});
const panel = codePanelRecord("panel-skills", { import: importProjection.id });
const use = panelUse("use-skills", "skills", panel.id, "/applications/app-skills/skills");
const uploads = "/panel-operations/uploads";

function answer(request: Sent) {
  if (request.path === `/api/product-projections/${importProjection.id}`) return Response.json({ projection: importProjection });
  if (request.path === `/api${uploads}`) return Response.json({});
  return nothingAt(request);
}

afterEach(leaveFrame);

describe("a frame's multipart body", () => {
  it("goes to an admitted owner path as multipart whose boundary only the browser writes", async () => {
    installPlatform(answer);
    const frame = panelFrame();
    platformPanelHost("app-skills", use, ignoreChanges).frame(frame, registered("app-skills", use, panel), true);
    inside(frame);
    const invoke = connectBridge();
    await invoke("request", { path: `/product-projections/${importProjection.id}`, service: "", method: "GET", headers: [], body: null });

    await expect(invoke("request", {
      path: uploads,
      service: "",
      method: "POST",
      headers: [["content-type", "multipart/form-data; boundary=chosen-by-the-frame"]],
      body: { form: [["file", "demo package"]] },
    })).resolves.toMatchObject({ status: 200 });

    const [, init] = vi.mocked(fetch).mock.calls.find(([input]) => String(input).endsWith(uploads))!;
    const headers = new Headers(init!.headers);
    expect(init!.body).toBeInstanceOf(FormData);
    expect((init!.body as FormData).get("file")).toBe("demo package");
    expect(headers.get("content-type")).toBeNull();
    expect(headers.get("tk")).toBe(READER);
  });
});
