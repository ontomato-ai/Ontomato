import { afterEach, expect, it, vi } from "vitest";
import { definePanel } from "@ontomato/contracts/panel-manifest";
import type { ProductProjection } from "@ontomato/contracts/product-panels";
import { AGENT_DEFINITION, DELETE_AGENT, FUNCTION, TEST_EXECUTE_METRIC_VIEW } from "@ontomato/contracts/panel-client-requests";
import { platformPanelHost } from "../../../../../packages/platform-web/src/panel-host";
import {
  ignoreChanges, inside, installPlatform, leaveFrame, nothingAt, panelFrame, panelOf, panelRecord, panelUse, registered, writePanelDocument, type Sent,
} from "./panel-frame";

import { randomId } from "@ontomato/contracts/random-id";
/*
 * A person's operations from the panel's buttons, through the platform's real host, bridge and admission, with Node's
 * coordinator answered here: the button reads the owner's description, runs a read there and returns what it read, and
 * for a write prepares one intent that the host confirms in its own dialog (where the owner or a batch asks) and
 * dispatches once. (U4 trial runs, U9 confirmation before a delete, U3 one batch over the checked objects.)
 *
 * The mistakes these catch: a write the frame runs itself; a trial that saves or reports a change; a delete sent before
 * the reader saw what it removes, or after they cancelled; a batch that asks once per object or loses which ones failed;
 * a list that forgets the checked objects a batch did not change.
 */

const APPLICATION = "app-agents";
const agent = (primaryKey: string) => ({ objectType: AGENT_DEFINITION, primaryKey });
const record = (id: string, componentId: string, binding: ProductProjection["binding"], inputs: ProductProjection["inputs"], display = {}): ProductProjection => ({
  domainId: "domain-1", ownerId: "owner-1", revision: 1, createdAt: "2026-11-19T00:00:00.000Z",
  updatedAt: "2026-11-19T00:00:00.000Z", editable: false, visibility: "domain",
  id, name: id, description: "", componentId, binding, inputs, display,
});
const remove = { kind: "PlatformOperation" as const, id: DELETE_AGENT };
const projections: Record<string, ProductProjection> = {
  "agent-remove": record("agent-remove", "OperationButton", remove, { agent: { kind: "object", objectType: AGENT_DEFINITION } }),
  "agents-remove": record("agents-remove", "OperationButton", remove,
    { agents: { kind: "object", objectType: AGENT_DEFINITION } }, { checked: "agents" }),
  "function-form": record("function-form", "ObjectForm", { kind: "PlatformObjectType", id: FUNCTION }, { fn: { kind: "object", objectType: FUNCTION } }),
  "function-trial": record("function-trial", "OperationButton", { kind: "PlatformOperation", id: TEST_EXECUTE_METRIC_VIEW },
    { fn: { kind: "object", objectType: FUNCTION } }),
};
const manifest = definePanel({
  state: {
    selectedAgent: { kind: "object", objectType: AGENT_DEFINITION, deepLink: false },
    checkedAgents: { kind: "object", objectType: AGENT_DEFINITION, deepLink: false },
    selectedFunction: { kind: "object", objectType: FUNCTION, deepLink: false },
    month: { kind: "scalar", type: "string", deepLink: false },
  },
  slots: {
    remove: { projectionId: "agent-remove", inputs: { agent: { state: "selectedAgent" } } },
    removeAll: { projectionId: "agents-remove", inputs: { agents: { state: "checkedAgents" } } },
    definition: { projectionId: "function-form", inputs: { fn: { state: "selectedFunction" } } },
    trial: {
      projectionId: "function-trial", inputs: { fn: { state: "selectedFunction" } },
      readOperationInputs: { testExecute: { parameters: { fields: { month: { state: "month" } } } } },
    },
  },
  operations: [],
});
const panel = panelRecord("panel-agents-operations", "Agents", manifest);
const use = panelUse("use-agents-operations", "agents-operations", panel.id, "/applications/app-agents/agents");

const impact = {
  summary: "Removing Analyst also removes its two schedules.", total: 1,
  objects: [{ target: agent("a"), label: "Analyst" }],
};
/** The owner's descriptions, by the panel's operation ID. */
const descriptions: Record<string, unknown> = {
  "remove.delete": {
    handlerRef: DELETE_AGENT, effect: "write", target: { source: "input", input: "agent" }, inputSchema: {}, resultSchema: {},
    batch: false, inspectImpact: { handlerRef: "agents.delete.impact" },
  },
  "removeAll.delete": {
    handlerRef: DELETE_AGENT, effect: "write", target: { source: "input", input: "agent" }, inputSchema: {}, resultSchema: {}, batch: true,
  },
  "trial.testExecute": {
    handlerRef: TEST_EXECUTE_METRIC_VIEW, effect: "read", target: { source: "draft", slot: "definition" },
    inputSchema: {}, resultSchema: {}, batch: false,
  },
};
const deleted = { kind: "success", data: {}, affected: { objects: [agent("a")], objectTypes: [AGENT_DEFINITION] } };
const batchOutcome = {
  kind: "batch",
  items: [
    { target: agent("a"), outcome: { kind: "success", data: {} } },
    { target: agent("b"), outcome: { kind: "refusal", code: "IN_USE", message: "Planner runs two schedules" } },
    { target: agent("c"), outcome: { kind: "failure", code: "OWNER_FAILED", message: "The definitions service failed" } },
  ],
  affected: { objects: [agent("a")], objectTypes: [AGENT_DEFINITION] },
};

/** Node's coordinator and the function owner, as the frame and its host reach them. */
function coordinator() {
  const intents = new Map<string, Record<string, unknown>>();
  return (request: Sent): Response => {
    const projected = /^\/api\/product-projections\/(.+)$/.exec(request.path);
    if (projected) return Response.json({ projection: projections[projected[1]!] });
    if (request.path === "/api/data-query/function/form")
      return Response.json({ success: true, data: {
        fields: [{ path: "/name", label: "Name", control: { kind: "text" }, valueSchema: {}, required: false, readOnly: false }],
        values: { id: "fn-1", name: "Revenue" },
        save: { method: "POST", path: "/function/save", bodySchema: {}, draftOperation: "function.update" },
      } });
    if (request.path === "/api/panel-operations/descriptor")
      return Response.json(descriptions[new URLSearchParams(request.search).get("operationId")!]);
    if (request.path === "/api/panel-operations/read") return Response.json({ kind: "markdown", markdown: "**42** orders in October" });
    if (request.method === "POST" && request.path === "/api/panel-operations/intents") {
      const body = request.body as { operationId: string; calls?: { target: { primaryKey: string } }[] };
      const intentId = randomId();
      const confirmation = body.calls
        ? { kind: "batch", targets: { total: body.calls.length, objects: body.calls.map(({ target }) => ({ target: agent(target.primaryKey), label: target.primaryKey })) } }
        : { kind: "impact", impact };
      const preparation = { intentId, operationId: body.operationId, label: "Delete", confirmation };
      intents.set(intentId, preparation);
      return Response.json(preparation);
    }
    const read = /^\/api\/panel-operation-intents\/([^/]+)$/.exec(request.path);
    if (read) return Response.json(intents.get(read[1]!));
    const dispatch = /^\/api\/panel-operations\/intents\/([^/]+)\/dispatch$/.exec(request.path);
    if (dispatch) {
      const { intentId, operationId } = intents.get(dispatch[1]!) as { intentId: string; operationId: string };
      return Response.json({ kind: "dispatched", intentId, outcome: operationId === "removeAll.delete" ? batchOutcome : deleted });
    }
    return nothingAt(request);
  };
}

async function open(state: Record<string, unknown>, ...slots: string[]) {
  const sent = installPlatform(coordinator());
  const { mountPanel } = await import("../../../../../packages/apps-sdk/src/panel/mount");
  const frame = panelFrame();
  platformPanelHost(APPLICATION, use, ignoreChanges).frame(frame, registered(APPLICATION, use, panel), true);
  writePanelDocument(registered(APPLICATION, use, panel), use.path, state as never);
  inside(frame);
  const mounted = await mountPanel(panelOf(...slots));
  const changed: unknown[] = [];
  mounted.context.instance.onObjectChanged((object) => changed.push(object));
  return { ...mounted, sent, changed };
}

const buttonOf = (slot: number) => document.querySelectorAll<HTMLElement>("#app .sdk-operation-button")[slot]!;
async function click(slot: number) {
  const button = await vi.waitFor(() => {
    const found = buttonOf(slot).querySelector<HTMLButtonElement>("button")!;
    if (found.disabled) throw new Error("The button is not ready");
    return found;
  }, { timeout: 5000 });
  button.click();
}
const dialog = () => vi.waitFor(() => {
  const found = document.querySelector<HTMLElement>(".el-message-box");
  if (!found) throw new Error("No confirmation dialog is shown");
  return found;
});
const dialogButton = (box: HTMLElement, text: string) =>
  [...box.querySelectorAll<HTMLButtonElement>("button")].find((element) => element.textContent?.trim() === text)!;
const writes = (sent: Sent[]) => sent.filter((request) => request.method !== "GET").map((request) => request.path);

afterEach(() => {
  document.querySelectorAll(".el-message-box__wrapper, .el-overlay").forEach((element) => element.remove());
  leaveFrame();
  vi.resetModules();
});

it("runs a trial from the form the owner targets and the inputs the slot declares, shows what it read, and changes nothing", async () => {
  const { context, sent, changed } = await open({ selectedFunction: { className: FUNCTION, primaryKey: "fn-1" }, month: "2026-10" }, "definition", "trial");
  await vi.waitFor(() => expect(context.instance.forms.handle("definition")?.values.value.name).toBe("Revenue"), { timeout: 5000 });
  context.instance.forms.handle("definition")!.set("/name", "Revenue (net)");
  await click(0);
  await vi.waitFor(() => expect(buttonOf(0).querySelector(".sdk-operation-result")?.textContent).toContain("42 orders in October"));
  // The reader's unsaved draft and the declared parameter, as the owner's read takes them.
  expect(sent.find((request) => request.path === "/api/panel-operations/read")!.body).toEqual({
    applicationId: APPLICATION, useId: use.id, operationId: "trial.testExecute",
    call: { target: { kind: "object", objectType: FUNCTION, primaryKey: "fn-1" }, input: { draft: { id: "fn-1", name: "Revenue (net)" }, parameters: { month: "2026-10" } } },
  });
  expect(writes(sent)).toEqual(["/api/data-query/function/form", "/api/panel-operations/read"]);
  expect(changed).toEqual([]);
});

it("names what a delete removes in the host's dialog first, writes nothing on cancel, and dispatches once on confirm", async () => {
  const { sent, changed } = await open({ selectedAgent: { className: AGENT_DEFINITION, primaryKey: "a" } }, "remove");
  await click(0);
  let box = await dialog();
  expect(box.textContent).toContain(impact.summary);
  expect(box.textContent).toContain("Analyst");
  dialogButton(box, "Cancel").click();
  await vi.waitFor(() => expect(buttonOf(0).querySelector("button")!.disabled).toBe(false));
  // Prepared and abandoned: the owner's delete was never dispatched.
  expect(writes(sent)).toEqual(["/api/panel-operations/intents"]);
  expect(sent.find((request) => request.path === "/api/panel-operations/intents")!.body).toEqual({
    applicationId: APPLICATION, useId: use.id, operationId: "remove.delete",
    call: { target: { kind: "object", ...agent("a") }, input: {} },
  });

  await vi.waitFor(() => expect(document.querySelector(".el-message-box")).toBeNull());
  await click(0);
  box = await dialog();
  dialogButton(box, "Delete").click();
  await vi.waitFor(() => expect(buttonOf(0).querySelector("[data-outcome=success]")?.textContent).toBe("Done"));
  expect(writes(sent).filter((path) => path.endsWith("/dispatch"))).toHaveLength(1);
  // What the owner reported it changed is read again.
  expect(changed).toEqual([agent("a")]);
});
