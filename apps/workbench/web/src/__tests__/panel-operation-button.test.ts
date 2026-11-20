import { afterEach, expect, it, vi } from "vitest";
import { nextTick } from "vue";
import { definePanel } from "@ontomato/contracts/panel-manifest";
import type { ProductProjection } from "@ontomato/contracts/product-panels";
import { BUSINESS_KNOWLEDGE, DELETE_KNOWLEDGE } from "@ontomato/contracts/platform-object-types";
import type { PanelOperationDescriptor } from "../../../../../packages/apps-sdk/src/panel/human-operations";
import { platformPanelHost } from "../../../../../packages/platform-web/src/panel-host";
import {
  inside, installPlatform, leaveFrame, nothingAt, panelFrame, panelOf, panelRecord, panelUse, registered, writePanelDocument, type Sent,
} from "./panel-frame";

import { randomId } from "@ontomato/contracts/random-id";
/*
 * A person's operations from the panel's buttons, through the platform's real host, bridge and admission, with Node's
 * coordinator answered here: the button reads the owner's description and prepares one intent that the host confirms
 * in its own dialog and dispatches once, for one entry or for the checked entries.
 *
 * The mistakes these catch: a write the frame runs itself; a delete sent before
 * the reader saw what it removes, or after they cancelled; a batch that asks once per object or loses which ones failed;
 * a list that forgets the checked objects a batch did not change.
 */

const APPLICATION = "app-knowledge";
const knowledge = (primaryKey: string) => ({ objectType: BUSINESS_KNOWLEDGE, primaryKey });
const entry = { kind: "object", objectType: BUSINESS_KNOWLEDGE } as const;
const entries = { kind: "list", items: entry } as const;
const record = (id: string, inputs: ProductProjection["inputs"], config: ProductProjection["config"] = {}): ProductProjection => ({
  domainId: "domain-1", ownerId: "owner-1", revision: 1, createdAt: "2026-11-19T00:00:00.000Z",
  updatedAt: "2026-11-19T00:00:00.000Z", editable: false, visibility: "domain",
  id, name: id, description: "", componentId: "@ontomato/sdk:OperationButton", inputs, outputs: {}, config,
  data: { operation: {
    source: { operation: { kind: "PlatformOperation", id: DELETE_KNOWLEDGE } }, read: "describe", params: {},
  } },
});
const projections: Record<string, ProductProjection> = {
  "knowledge-remove": record("knowledge-remove", { entry }),
  "knowledge-remove-all": record("knowledge-remove-all", { entry: entries }, { checked: "entry" }),
};
const manifest = definePanel({
  state: {
    selectedKnowledge: { type: entry },
    checkedKnowledge: { type: entries },
  },
  members: {
    remove: { target: { projectionId: "knowledge-remove" }, inputs: { entry: { state: "selectedKnowledge" } } },
    removeAll: { target: { projectionId: "knowledge-remove-all" }, inputs: { entry: { state: "checkedKnowledge" } } },
  },
  events: {},
});
const panel = panelRecord("panel-knowledge-operations", "Business knowledge", manifest);
const use = panelUse("use-knowledge-operations", "knowledge-operations", panel.id, "/applications/app-knowledge/entries");

const impact = {
  summary: "Removing the shipping note also removes its two references.", total: 1,
  objects: [{ target: knowledge("a"), label: "Shipping note" }],
};
/** The owner's descriptions, by the panel's operation ID. */
const descriptions: Record<string, PanelOperationDescriptor> = {
  "remove.delete": {
    handlerRef: DELETE_KNOWLEDGE, label: "Delete", effect: "write", target: { source: "input", input: "entry" }, inputSchema: {}, resultSchema: {},
    batch: false, inspectImpact: { handlerRef: "knowledge.delete.impact" },
  },
  "removeAll.delete": {
    handlerRef: DELETE_KNOWLEDGE, label: "Delete all", effect: "write", target: { source: "input", input: "entry" }, inputSchema: {}, resultSchema: {},
    batch: true, inspectImpact: { handlerRef: "knowledge.delete.impact" },
  },
};
const deleted = { kind: "success", data: {}, affected: { objects: [knowledge("a")], objectTypes: [BUSINESS_KNOWLEDGE] } };
const batchOutcome = {
  kind: "batch",
  items: [
    { target: knowledge("a"), outcome: { kind: "success", data: {} } },
    { target: knowledge("b"), outcome: { kind: "refusal", code: "IN_USE", message: "Another entry uses this note" } },
    { target: knowledge("c"), outcome: { kind: "failure", code: "OWNER_FAILED", message: "The knowledge service failed" } },
  ],
  affected: { objects: [knowledge("a")], objectTypes: [BUSINESS_KNOWLEDGE] },
};

/** Node's coordinator, as the frame and its host reach it. */
function coordinator() {
  const intents = new Map<string, Record<string, unknown>>();
  return (request: Sent): Response => {
    const projected = /^\/api\/product-projections\/(.+)$/.exec(request.path);
    if (projected) return Response.json({ projection: projections[projected[1]!] });
    if (request.path === "/api/panel-operations/descriptor")
      return Response.json(descriptions[new URLSearchParams(request.search).get("operationId")!]);
    if (request.method === "POST" && request.path === "/api/panel-operations/intents") {
      const body = request.body as { operationId: string; calls?: { target: { primaryKey: string } }[] };
      const intentId = randomId();
      const confirmation = body.calls
        ? {
          kind: "batch", impact,
          targets: {
            total: body.calls.length,
            objects: body.calls.map(({ target }) => ({ target: knowledge(target.primaryKey), label: target.primaryKey })),
          },
        }
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
  // What the host hears an operation changed, at its one refresh port.
  const hostChanges: unknown[] = [];
  platformPanelHost(APPLICATION, use, (change) => hostChanges.push(change)).frame(frame, registered(APPLICATION, use, panel), true);
  writePanelDocument(registered(APPLICATION, use, panel), use.path, state as never);
  inside(frame);
  const mounted = await mountPanel(panelOf(...slots));
  const changed: unknown[] = [];
  mounted.context.instance.onObjectChanged((object) => changed.push(object));
  return { ...mounted, sent, changed, hostChanges };
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

it("names what a delete removes in the host's dialog first, writes nothing on cancel, and dispatches once on confirm", async () => {
  const { sent, changed, hostChanges } = await open({ selectedKnowledge: { className: BUSINESS_KNOWLEDGE, primaryKey: "a" } }, "remove");
  await click(0);
  let box = await dialog();
  expect(box.textContent).toContain(impact.summary);
  expect(box.textContent).toContain("Shipping note");
  dialogButton(box, "Cancel").click();
  await vi.waitFor(() => expect(buttonOf(0).querySelector("button")!.disabled).toBe(false));
  // Prepared and abandoned: the owner's delete was never dispatched.
  expect(writes(sent)).toEqual(["/api/panel-operations/intents"]);
  expect(sent.find((request) => request.path === "/api/panel-operations/intents")!.body).toEqual({
    applicationId: APPLICATION, useId: use.id, operationId: "remove.delete",
    call: { target: { kind: "object", ...knowledge("a") }, input: {} },
  });

  await vi.waitFor(() => expect(document.querySelector(".el-message-box")).toBeNull());
  await click(0);
  box = await dialog();
  dialogButton(box, "Delete").click();
  await vi.waitFor(() => expect(buttonOf(0).querySelector("[data-outcome=success]")?.textContent).toBe("Done"));
  expect(writes(sent).filter((path) => path.endsWith("/dispatch"))).toHaveLength(1);
  // What the owner reported changed goes to the host's refresh port once; the frame rereads nothing from the receipt.
  expect(hostChanges).toEqual([{ target: null, affected: { objects: [knowledge("a")], objectTypes: [BUSINESS_KNOWLEDGE] } }]);
  expect(changed).toEqual([]);
});

it("runs one batch over the checked objects, reports each, and keeps checked the ones it did not change", async () => {
  const checked = ["a", "b", "c"].map((primaryKey) => ({ className: BUSINESS_KNOWLEDGE, primaryKey }));
  const { context, sent } = await open({}, "removeAll");
  context.instance.state.set("checkedKnowledge", checked);
  await nextTick();
  await click(0);
  dialogButton(await dialog(), "Delete").click();
  await vi.waitFor(() => expect(buttonOf(0).querySelector(".sdk-operation-batch")?.textContent).toContain("1 of 3 done"));
  // One intent, one dispatch, all three calls.
  expect(sent.filter((request) => request.path === "/api/panel-operations/intents").map((request) => request.body)).toEqual([{
    applicationId: APPLICATION, useId: use.id, operationId: "removeAll.delete",
    calls: ["a", "b", "c"].map((primaryKey) => ({ target: { kind: "object", ...knowledge(primaryKey) }, input: {} })),
  }]);
  expect(writes(sent).filter((path) => path.endsWith("/dispatch"))).toHaveLength(1);
  const items = [...buttonOf(0).querySelectorAll("li")].map((item) => [item.getAttribute("data-outcome"), item.textContent]);
  expect(items).toEqual([
    ["success", "a: Done"], ["refusal", "b: Another entry uses this note"], ["failure", "c: The knowledge service failed"],
  ]);
  expect(context.instance.state.values.value.checkedKnowledge).toEqual(checked.slice(1));
});
