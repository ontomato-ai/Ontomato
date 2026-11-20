import { afterEach, expect, it, vi } from "vitest";
import { createApp, h, nextTick, ref } from "vue";
import { createI18n } from "vue-i18n";
import ElementPlus from "element-plus";
import publicEn from "@ontomato/workbench-ui/locales/en";
import type { DirectPanelManifest } from "@ontomato/contracts/panel-manifest";
import type { DirectProjection } from "@ontomato/contracts/product-panels";
import type { ProductPanelReadRequest, ProductPanelReadResponse } from "@ontomato/contracts/panel-host";
import { SCHEDULED_TASK } from "@ontomato/contracts/panel-client-requests";
import { panelAddress } from "@ontomato/contracts/panel-host";
import { mountDirectPanel, type DirectPanelMount } from "../../../../../packages/apps-sdk/src/direct";
import { noOperations } from "./panel-frame";

/*
 * A directly rendered panel run beside the platform's host by the same rules as a frame's: it reports its deep-linkable
 * state and page context, follows an address the host gives it, reads nothing while the reader does not see it, reads
 * again only the data an operation reports changed, and draws a member anew when its projection's definition changed.
 *
 * The mistakes these catch: a panel that keeps reading behind another tab; a refresh that rereads everything for one
 * changed object (or nothing); a changed projection that keeps the old definition on screen; an address that the
 * instance does not follow.
 */

const task = (primaryKey: string) => ({ className: SCHEDULED_TASK, primaryKey });
const base = { domainId: "d", ownerId: "o", createdAt: "", updatedAt: "", editable: false, visibility: "domain" as const, description: "" };
let summaryName = "Run now";
const projections: Record<string, () => DirectProjection> = {
  "task-run": () => ({
    ...base, id: "task-run", revision: summaryName === "Run now" ? 1 : 2, name: summaryName, componentId: "@ontomato/sdk:OperationButton",
    inputs: { task: { kind: "object", objectType: SCHEDULED_TASK } }, outputs: {}, config: {},
    data: { operation: { source: { operation: { kind: "PlatformOperation", id: "schedules.runNow" } }, read: "describe", params: {} } },
  }),
};
const manifest: DirectPanelManifest = {
  state: { selectedTask: { type: { kind: "object", objectType: SCHEDULED_TASK }, personal: false, deepLink: true, external: false } },
  members: { run: { target: { projectionId: "task-run" }, inputs: { task: { state: "selectedTask" } } } },
  events: {},
};
const runNow = { handlerRef: "schedules.runNow", label: "Run now", effect: "write", target: { source: "input", input: "task" }, inputSchema: {}, resultSchema: {}, batch: false };

function open() {
  const reads: Omit<ProductPanelReadRequest, "source">[] = [];
  const reports = { state: [] as unknown[], context: [] as unknown[], dirty: [] as boolean[] };
  // The platform's request path, as the reader: here only projection records are read through it.
  const readProjection = vi.fn((id: string) => projections[id]!());
  const requests = {
    request: async (path: string) => {
      const projected = /^\/product-projections\/(.+)$/.exec(path);
      if (!projected) throw new Error(`Nothing at ${path}`);
      return Response.json({ projection: readProjection(decodeURIComponent(projected[1]!)) });
    },
  };
  const mount: DirectPanelMount = mountDirectPanel({
    manifest,
    run: {
      pageKey: "tasks", url: () => "/tasks", label: () => "Tasks", initial: {},
      state: (state) => reports.state.push(state), context: (context) => reports.context.push(context),
      operations: () => {}, dirty: (dirty) => reports.dirty.push(dirty), draftSettled: () => {}, failed: (reason) => { throw reason; },
    },
    messages: {}, locale: ref("en"), defaultLocale: "en",
    requests, use: { applicationId: "app-tasks", useId: "tasks" },
    expandPageComposer: noOperations.expandPageComposer,
    confirmOperation: noOperations.confirmOperation,
    read: async (request): Promise<ProductPanelReadResponse> => {
      reads.push(request);
      return { status: "ready", value: runNow as never };
    },
  });
  const element = document.createElement("div");
  document.body.append(element);
  const app = createApp({ render: () => h("div", [mount.member("run")]) });
  app.use(createI18n({ legacy: false, locale: "en", messages: { en: publicEn } })).use(ElementPlus).mount(element);
  return { mount, element, reads, reports, readProjection };
}

afterEach(() => {
  document.body.innerHTML = "";
  summaryName = "Run now";
});

it("follows the host's address and reports its state, reading only while the reader sees it", async () => {
  const { mount, element, reads, reports } = open();
  await vi.waitFor(() => expect(element.querySelector(".sdk-operation-button button")).toBeTruthy());
  const first = reads.length;
  mount.activate(false);
  mount.address(panelAddress("/tasks", { selectedTask: task("t-2") }));
  await nextTick();
  // Unseen: the address is held and nothing is read.
  expect(mount.values.value.selectedTask).toBeNull();
  expect(reads.length).toBe(first);

  mount.activate(true);
  await vi.waitFor(() => expect(mount.values.value.selectedTask).toEqual(task("t-2")));
  expect(reports.state.at(-1)).toEqual({ selectedTask: task("t-2") });
});

it("reads again only the data an operation reports changed, and everything on an untargeted refresh", async () => {
  const { mount, element, reads } = open();
  await vi.waitFor(() => expect(element.querySelector(".sdk-operation-button button")).toBeTruthy());
  const before = reads.length;
  // The run's description is read from the operation, not from a task: a changed task leaves it as it is.
  mount.refresh(null, { objects: [{ objectType: SCHEDULED_TASK, primaryKey: "t-1" }], objectTypes: [SCHEDULED_TASK] });
  await nextTick();
  expect(reads.length).toBe(before);
  mount.refresh(null);
  await vi.waitFor(() => expect(reads.length).toBe(before + 1));
});

it("draws a member anew from its projection's newer definition", async () => {
  const { mount, element, readProjection } = open();
  const drawn = await vi.waitFor(() => {
    const found = element.querySelector(".sdk-operation-button button");
    if (!found) throw new Error("The member is not drawn yet");
    return found;
  });
  summaryName = "Run it now";
  mount.projectionsChanged([{ id: "task-run", revision: 2 }]);
  // Read again at the newer revision and drawn anew: the button is another one.
  await vi.waitFor(() => expect(readProjection).toHaveBeenCalledTimes(2));
  await vi.waitFor(() => {
    const now = element.querySelector(".sdk-operation-button button");
    expect(now).not.toBeNull();
    expect(now).not.toBe(drawn);
  });
});
