import { afterEach, describe, expect, it, vi } from "vitest";
import { APP_BRIDGE_CHANNEL } from "@ontomato/contracts/app-bridge";
import { definePanel } from "@ontomato/contracts/panel-manifest";
import { AGENT_DEFINITION, DELETE_AGENT, RUN_NOW } from "@ontomato/contracts/panel-client-requests";
import type { ProductProjection } from "@ontomato/contracts/product-panels";
import { platformPanelHost } from "../../../../../packages/platform-web/src/panel-host";
import { inside, installPlatform, leaveFrame, nothingAt, panelFrame, panelRecord, panelUse, registered, type Sent } from "./panel-frame";

/*
 * A person's confirmation before an operation that cannot be undone (shared parts design U9, §3): the frame has prepared
 * a human intent at Node and asks the platform to confirm it. The platform reads the intent back from Node itself, names
 * the operation, the objects and their total as Node froze them in its own dialog, dispatches the intent once when the
 * person confirms, and answers the same bridge call with the decision. Both platform ends are real — the app host and the
 * message bridge as the shell installs them, the frame registered by the platform's panel host. The frame side speaks
 * the bridge's wire format.
 *
 * What this rules out: a dialog that shows what the frame says instead of what Node froze; a confirmation for an
 * operation the frame's declaration does not hold, or while its page is not the reader's; a cancel that writes
 * anything; a confirm that dispatches more than once or with anything in the body; and an owner's object name being
 * taken as markup.
 */

const removal = "projection-agent-remove";
const run = "projection-task-run";
const base = {
  description: "",
  inputs: {},
  display: {},
  domainId: "domain-1",
  ownerId: "owner-1",
  revision: 1,
  createdAt: "2026-11-19T00:00:00.000Z",
  updatedAt: "2026-11-19T00:00:00.000Z",
  editable: false,
  visibility: "domain" as const,
};
const projections: Record<string, ProductProjection> = {
  [removal]: { ...base, id: removal, name: "Remove", componentId: "OperationButton", binding: { kind: "PlatformOperation", id: DELETE_AGENT } },
  [run]: { ...base, id: run, name: "Run", componentId: "OperationButton", binding: { kind: "PlatformOperation", id: RUN_NOW } },
};
const panel = panelRecord("panel-agents", "Agents", definePanel({
  state: {},
  slots: { remove: { projectionId: removal, inputs: {} }, run: { projectionId: run, inputs: {} } },
  operations: [],
}));
const use = panelUse("use-agents", "agents", panel.id, "/applications/app-agents/agents");

const impact = {
  summary: "Removing these agents also removes their schedules.",
  total: 4,
  objects: [
    { target: { objectType: AGENT_DEFINITION, primaryKey: "a" }, label: "Assistant A" },
    { target: { objectType: AGENT_DEFINITION, primaryKey: "b" }, label: "<b>Assistant B</b>" },
  ],
};
const intentId = "6f1c2a4e-0b7d-4c1e-9a55-3d2f8e7b9c10";
/** What Node froze when the frame prepared the intent. */
const prepared = { intentId, operationId: "remove.delete", label: "Delete", impact };
/** What the frame sends: it may say anything, and the platform shows none of it. */
const confirmation = {
  ...prepared, label: "Rename",
  impact: { summary: "Nothing goes.", total: 0, objects: [] },
};

let stored: typeof prepared = prepared;
let dispatchAnswer: unknown = { kind: "dispatched", intentId, outcome: null };
function answer(request: Sent) {
  const projection = /^\/api\/product-projections\/(.+)$/.exec(request.path);
  if (projection && projections[projection[1]!]) return Response.json({ projection: projections[projection[1]!] });
  if (request.method === "GET" && request.path === `/api/panel-operation-intents/${intentId}`) return Response.json(stored);
  if (request.method === "POST" && request.path === `/api/panel-operations/intents/${intentId}/dispatch`) return Response.json(dispatchAnswer);
  return nothingAt(request);
}
const writes = (sent: Sent[]) => sent.filter((request) => request.method !== "GET");

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

function shownFrame() {
  const sent = installPlatform(answer);
  const frame = panelFrame();
  const registration = platformPanelHost("app-agents", use).frame(frame, registered("app-agents", use, panel), true);
  inside(frame);
  const invoke = connect();
  const read = (id: string) => invoke("request", { path: `/product-projections/${id}`, service: "", method: "GET", headers: [], body: null });
  return { sent, invoke, read, registration };
}

/** The platform's confirmation dialog, once it is shown. */
const dialog = () =>
  vi.waitFor(() => {
    const found = document.querySelector<HTMLElement>(".el-message-box");
    if (!found) throw new Error("No confirmation dialog is shown");
    return found;
  });
const button = (box: HTMLElement, text: string) =>
  [...box.querySelectorAll<HTMLButtonElement>("button")].find((element) => element.textContent?.trim() === text)!;

afterEach(() => {
  stored = prepared;
  dispatchAnswer = { kind: "dispatched", intentId, outcome: null };
  leaveFrame();
});

describe("a person's confirmation of a panel operation", () => {
  it("names what Node froze, dispatches once on confirm, and answers the same call with the decision", async () => {
    const { sent, invoke, read } = shownFrame();
    await read(removal);

    const cancelled = invoke("confirm-panel-operation", confirmation);
    let box = await dialog();
    expect(box.querySelector(".el-message-box__title")?.textContent).toContain("Delete");
    const names = [...box.querySelectorAll("li")].map((item) => item.textContent);
    expect(names).toEqual(["Assistant A", "<b>Assistant B</b>"]);
    expect(box.querySelector("li b")).toBeNull();
    expect(box.textContent).toContain(impact.summary);
    expect(box.textContent).toContain("4");
    expect(box.textContent).not.toContain("Nothing goes.");
    button(box, "Cancel").click();
    await expect(cancelled).resolves.toEqual({ decision: "cancel" });
    // Cancelling writes nothing.
    expect(writes(sent)).toEqual([]);

    await vi.waitFor(() => expect(document.querySelector(".el-message-box")).toBeNull());
    const confirmed = invoke("confirm-panel-operation", confirmation);
    box = await dialog();
    button(box, "Delete").click();
    await expect(confirmed).resolves.toEqual({ decision: "confirm" });
    expect(writes(sent).map(({ method, path, body }) => ({ method, path, body }))).toEqual([
      { method: "POST", path: `/api/panel-operations/intents/${intentId}/dispatch`, body: {} },
    ]);
    // Node reads the intent back only within the use this frame shows.
    const reads = sent.filter((request) => request.path === `/api/panel-operation-intents/${intentId}`);
    expect(reads.map((request) => request.search)).toEqual(["?applicationId=app-agents&useId=use-agents", "?applicationId=app-agents&useId=use-agents"]);
  });

  it("tells the frame when Node did not dispatch the confirmed intent", async () => {
    dispatchAnswer = { kind: "not-dispatched", intentId, code: "ALREADY_DISPATCHED", message: "This request was already sent." };
    const { invoke, read } = shownFrame();
    await read(removal);
    const confirmed = invoke("confirm-panel-operation", confirmation);
    button(await dialog(), "Delete").click();
    await expect(confirmed).rejects.toThrow("This request was already sent.");
  });

  it("shows no dialog for an intent outside the frame's declaration, or a page that is not shown", async () => {
    const { sent, invoke, read, registration } = shownFrame();
    // Not read through the platform yet: the platform knows no binding for the slot.
    await expect(invoke("confirm-panel-operation", confirmation)).rejects.toThrow("not declared");
    await read(removal);
    // What Node holds decides, whatever the frame names.
    for (const operationId of ["elsewhere.delete", "remove", "run.run"]) {
      stored = { ...prepared, operationId };
      await expect(invoke("confirm-panel-operation", confirmation), operationId).rejects.toThrow("not declared");
    }
    stored = prepared;
    registration.open(false);
    await expect(invoke("confirm-panel-operation", confirmation)).rejects.toThrow("not shown");
    expect(document.querySelector(".el-message-box")).toBeNull();
    expect(writes(sent)).toEqual([]);
  });
});
