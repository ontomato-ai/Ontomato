import { afterEach, describe, expect, it, vi } from "vitest";
import { APP_BRIDGE_CHANNEL } from "@ontomato/contracts/app-bridge";
import { definePanel } from "@ontomato/contracts/panel-manifest";
import { IMPORT_SKILL } from "@ontomato/contracts/panel-client-requests";
import type { ProductProjection } from "@ontomato/contracts/product-panels";
import { platformPanelHost } from "../../../../../packages/platform-web/src/panel-host";
import { ignoreChanges, READER, inside, installPlatform, leaveFrame, nothingAt, panelFrame, panelRecord, panelUse, registered, type Sent } from "./panel-frame";

/*
 * A panel's upload (shared parts design, U11) through the platform's real host and bridge: the frame hands the bridge
 * the reader's file as form entries, and the host sends it as multipart to the owner path its projection declares, with
 * the reader's credential. The frame speaks the bridge's wire format directly, as any SDK version does.
 *
 * What this rules out: a frame's own Content-Type reaching the owner with the multipart body, so the boundary the owner
 * parses is the frame's word instead of the one the browser wrote into the body.
 */

const importProjection: ProductProjection = {
  id: "projection-skill-import",
  name: "Import",
  description: "Import",
  componentId: "FileUploadControl",
  binding: { kind: "PlatformOperation", id: IMPORT_SKILL },
  inputs: {},
  display: {},
  domainId: "domain-1",
  ownerId: "owner-1",
  revision: 1,
  createdAt: "2026-11-19T00:00:00.000Z",
  updatedAt: "2026-11-19T00:00:00.000Z",
  editable: false,
  visibility: "domain",
};
const panel = panelRecord("panel-skills", "Skills", definePanel({
  state: {},
  slots: { importSkill: { projectionId: importProjection.id, inputs: {} } },
  operations: [],
}));
const use = panelUse("use-skills", "skills", panel.id, "/applications/app-skills/skills");

function answer(request: Sent) {
  if (request.path === `/api/product-projections/${importProjection.id}`) return Response.json({ projection: importProjection });
  if (request.path === "/api/skills/import") return Response.json({ id: "demo" });
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

describe("a panel's upload", () => {
  it("goes to the declared owner path as multipart whose boundary only the browser writes", async () => {
    installPlatform(answer);
    const frame = panelFrame();
    platformPanelHost("app-skills", use, ignoreChanges).frame(frame, registered("app-skills", use, panel), true);
    inside(frame);
    const invoke = connect();
    await invoke("request", { path: `/product-projections/${importProjection.id}`, service: "", method: "GET", headers: [], body: null });

    await expect(invoke("request", {
      path: "/skills/import",
      service: "",
      method: "POST",
      headers: [["content-type", "multipart/form-data; boundary=chosen-by-the-frame"]],
      body: { form: [["file", "demo package"]] },
    })).resolves.toMatchObject({ status: 200 });

    const [, init] = vi.mocked(fetch).mock.calls.find(([input]) => String(input).endsWith("/skills/import"))!;
    const headers = new Headers(init!.headers);
    expect(init!.body).toBeInstanceOf(FormData);
    expect((init!.body as FormData).get("file")).toBe("demo package");
    expect(headers.get("content-type")).toBeNull();
    expect(headers.get("tk")).toBe(READER);
  });
});
