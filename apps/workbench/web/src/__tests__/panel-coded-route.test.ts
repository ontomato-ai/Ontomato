import { afterEach, expect, it, vi } from "vitest";
import { h } from "vue";
import { createMemoryHistory, createRouter, RouterView } from "vue-router";
import type { DisplayPageAddressInput } from "@ontomato/contracts/agent-presentation";
import { panelAddress, panelAddressState } from "@ontomato/contracts/panel-host";
import { platformRoutes } from "@ontomato/platform-shell/routes";
import PanelApplicationRoute from "../../../../../packages/platform-web/src/pages/PanelApplicationRoute.vue";
import { pilotPageResolver } from "../../../../../packages/platform-web/src/pilot-pages";
import {
  formSaveCalls, humanIntents, installPlatform, leaveFrame, manifestP, mountPlatformPage, nothingAt, panelAnswer, panelRecord,
  panelSnapshot, panelUse, projections, READER, SCHEDULED_TASK, task, type Sent,
} from "./panel-frame";

/*
 * A panel written with code at its application's address, and beside a conversation (user's ruling, 2026-11-20: every
 * panel runs in the platform's document). Its module runs on the platform's Vue and SDK; its members read through
 * Node's read entry within the application use the page opened, as the reader; a person's save goes through the
 * coordinator once; and a page beside the conversation reports its state to the conversation instead of moving.
 *
 * Real route, panel host, module loader, SDK instance and components; the network is a stand-in.
 *
 * What this rules out: a panel written with code that cannot read, save or run beside a conversation now that no frame
 * runs it; and two panels open at once reading or writing as each other's application use.
 */

const appA = "app-coded-a";
const appB = "app-coded-b";
const panel = panelRecord("panel-coded-tasks", "Tasks", manifestP);
const useA = panelUse("use-coded-a", "coded-a", panel.id, `/applications/${appA}/tasks`);
const useB = panelUse("use-coded-b", "coded-b", panel.id, `/applications/${appB}/tasks`);
const secondTask = { ...task, id: "ac186b00-a3dd-46d2-b404-72065d877a34", title: "Second scheduled task" };
const selected = { selectedTask: { className: SCHEDULED_TASK, primaryKey: task.id } };
const field = (path: string, label: string) => ({ path, label, control: { kind: "text" as const }, valueSchema: {}, required: false, readOnly: false });

type Read = { source: unknown; dataName: string; inputs: { task?: { primaryKey: string } }; runtimeParams?: { values?: { name: string } } };
const intents = humanIntents(() => ({
  kind: "success", data: {}, affected: { objects: [{ objectType: SCHEDULED_TASK, primaryKey: task.id }], objectTypes: [SCHEDULED_TASK] },
}));
function answer(request: Sent) {
  const prepared = intents(request);
  if (prepared) return prepared;
  for (const [application, use] of [[appA, useA], [appB, useB]] as const) {
    if (request.path === `/api/data-query/platform/applications/${application}/panel-uses`)
      return Response.json({ data: { applicationId: application, entry: { path: `/applications/${application}`, renderer: "panels" }, panelUses: [use] } });
  }
  if (request.path === `/api/product-panels/${panel.id}`) return panelAnswer(panel, request);
  if (request.path === `/api/product-panels/${panel.id}/snapshot`) return panelSnapshot(panel, projections, request);
  const projection = Object.values(projections).find(one => request.path === `/api/product-projections/${one.id}`);
  if (projection) return Response.json({ projection });
  if (request.path === "/api/product-panels/read") {
    const { dataName, inputs, runtimeParams } = request.body as Read;
    const value = dataName === "rows" ? [task, secondTask].map(one => ({ primaryKey: one.id, label: one.title, fields: {} }))
      : dataName === "record" ? { primaryKey: inputs.task!.primaryKey, label: task.title, fields: {} }
      : dataName === "operation"
        ? { handlerRef: "schedules.runNow", label: "Run now", effect: "write", target: { source: "input", input: "task" }, inputSchema: {}, resultSchema: {}, batch: false }
        : {
          fields: [field("/name", "Name")], values: runtimeParams?.values ?? { name: "Nightly" }, errors: [], revision: 3,
          save: { method: "PUT" as const, path: "/tasks/:id", bodySchema: {}, draftOperation: `${SCHEDULED_TASK}.save` },
        };
    return Response.json({ status: "ready", value });
  }
  return nothingAt(request);
}

const reads = (sent: Sent[]) => sent.filter(request => request.path === "/api/product-panels/read").map(request => request.body as Read);
const member = (root: ParentNode, name: string) => root.querySelector<HTMLElement>(`.panel-host-coded [data-member='${name}']`);

async function openPage(address: string) {
  const router = createRouter({ history: createMemoryHistory(), routes: [{
    path: "/applications/:applicationId/:panelPath(.*)?",
    component: PanelApplicationRoute,
    props: route => ({ applicationId: String(route.params.applicationId) }),
  }] });
  await router.push(address);
  return { ...mountPlatformPage(() => h(RouterView), router), router };
}

afterEach(leaveFrame);

it("reads its members within the use the page opened, as the reader, and saves through the coordinator once", async () => {
  const sent = installPlatform(answer);
  const { app, element } = await openPage(panelAddress(useA.path, selected));
  try {
    await vi.waitFor(() => expect(member(element, "summary")?.querySelector(".sdk-object-summary-title")?.textContent).toBe(task.title));
    expect(element.querySelector("iframe")).toBeNull();
    expect(reads(sent).every(read => JSON.stringify(read.source) === JSON.stringify({ kind: "registered", applicationId: appA, useId: useA.id }))).toBe(true);
    expect(sent.filter(request => request.path.startsWith("/api/")).every(request => request.credential === READER)).toBe(true);

    const name = await vi.waitFor(() => {
      const input = member(element, "form")?.querySelector<HTMLInputElement>("[data-field='/name'] input");
      if (!input) throw new Error("The form is not drawn yet");
      return input;
    });
    name.value = "Renamed by the reader";
    name.dispatchEvent(new Event("input"));
    const save = await vi.waitFor(() => {
      const button = [...member(element, "form")!.querySelectorAll<HTMLButtonElement>("button")].find(one => one.textContent?.trim() === "Save");
      if (!button || button.disabled) throw new Error("Nothing to save yet");
      return button;
    });
    const formReads = () => reads(sent).filter(read => read.dataName === "form").length;
    const before = formReads();
    save.click();
    await vi.waitFor(() => expect(formSaveCalls(sent)).toEqual([
      expect.objectContaining({ target: { kind: "object", objectType: SCHEDULED_TASK, primaryKey: task.id } }),
    ]));
    // What the owner reports changed is read again.
    await vi.waitFor(() => expect(formReads()).toBeGreaterThan(before));
    expect(formSaveCalls(sent)).toHaveLength(1);
  } finally {
    app.unmount();
  }
});

it("runs beside a conversation, reporting its state to the conversation, while another application's page reads as its own", async () => {
  const sent = installPlatform(answer);
  const full = await openPage(useA.path);
  const router = createRouter({ history: createMemoryHistory(), routes: [{ ...platformRoutes.chat, component: { render: () => null } }] });
  await router.push({ path: platformRoutes.chat.path, query: { page: useB.path } });
  const updates: DisplayPageAddressInput[] = [];
  const navigate = vi.fn();
  const resolved = pilotPageResolver(navigate)(useB.path)!;
  const beside = mountPlatformPage(() => h(resolved.component, {
    ...resolved.props,
    onDisplayAddress: (update: DisplayPageAddressInput) => updates.push(update),
  }), router);
  try {
    const option = await vi.waitFor(() => {
      const found = member(beside.element, "tasks")?.querySelector<HTMLButtonElement>("[role='option']");
      if (!found) throw new Error("The list is not drawn yet");
      return found;
    });
    option.click();
    // The page beside the conversation does not move: its state goes to the conversation.
    await vi.waitFor(() => expect(panelAddressState(updates.at(-1)?.address ?? "")).toEqual(selected));
    expect(navigate).not.toHaveBeenCalled();
    await vi.waitFor(() => expect(member(beside.element, "summary")?.querySelector(".sdk-object-summary-title")?.textContent).toBe(task.title));

    // Each page reads as the application use it shows, never as the other's.
    await vi.waitFor(() => expect(member(full.element, "tasks")?.querySelector("[role='option']")).not.toBeNull());
    const sources = new Set(reads(sent).map(read => JSON.stringify(read.source)));
    expect(sources).toEqual(new Set([
      JSON.stringify({ kind: "registered", applicationId: appA, useId: useA.id }),
      JSON.stringify({ kind: "registered", applicationId: appB, useId: useB.id }),
    ]));
    // Two instances of the same panel, each with its own element and its own CSS scope.
    const instances = [...document.querySelectorAll<HTMLElement>(".panel-host-direct[data-panel-instance]")].map(one => one.dataset.panelInstance);
    expect(new Set(instances).size).toBe(2);
  } finally {
    beside.app.unmount();
    full.app.unmount();
  }
});
