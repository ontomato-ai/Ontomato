import { afterEach, expect, it, vi } from "vitest";
import { createApp, h, ref } from "vue";
import { createI18n } from "vue-i18n";
import ElementPlus from "element-plus";
import publicEn from "@ontomato/workbench-ui/locales/en";
import type { DirectPanelManifest, PanelMemberPath } from "@ontomato/contracts/panel-manifest";
import type { DirectProjection } from "@ontomato/contracts/product-panels";
import type { ProductPanelReadResponse } from "@ontomato/contracts/panel-host";
import { PRODUCT_PANEL, PRODUCT_PROJECTION, SCHEDULED_TASK } from "@ontomato/contracts/platform-object-types";
import {
  createDirectPanelInstance, PanelMemberUnavailable, type DirectPanelInstanceOptions, type PanelMemberReadRequest,
} from "../../../../../packages/apps-sdk/src/panel/direct";
import PanelMember from "../../../../../packages/apps-sdk/src/panel/PanelMember.vue";
import { createPanelText } from "../../../../../packages/apps-sdk/src/panel/text";
import { noOperations } from "./panel-frame";

/*
 * A member the panel's state places (big main's six rulings, 2026-11-21): the state holds a projection or a panel, and
 * the member draws what it holds in place. A projection is read and drawn as any member's; a panel is run by the host and
 * placed here, its operations published into this panel under their full path, its context beside this panel's, its
 * inputs and outputs wired to this panel's state. Every read and operation names the member by its path, the selection
 * that placed it included. Nothing chosen asks for a choice; what the reader may not use says so, in that place alone.
 *
 * The mistakes these catch: a placed member read or operated without the selection that placed it, which the platform
 * cannot admit; an old choice's panel, operations or reads left behind after another is chosen; a placed panel's
 * operations missing from the header's and the agent's list; a refusal that takes the whole panel down.
 */

const meta = { domainId: "d", ownerId: "o", revision: 1, createdAt: "", updatedAt: "", editable: false, visibility: "domain" as const, description: "" };
const task = (primaryKey: string) => ({ className: SCHEDULED_TASK, primaryKey });
const taskType = { kind: "object", objectType: SCHEDULED_TASK } as const;
const list = (id: string): DirectProjection => ({
  ...meta, id, name: id, componentId: "@ontomato/sdk:ObjectList", inputs: {}, outputs: {}, config: {},
  data: { rows: { source: { type: { kind: "PlatformObjectType", id: SCHEDULED_TASK } }, read: "list", params: {} } },
  operations: { runNow: { operation: { kind: "PlatformOperation", id: "schedules.runNow" } } },
});
const runNow = {
  kind: "action", handlerRef: "schedules.runNow", label: "Run now", effect: "write", target: { source: "none" },
  inputSchema: {}, resultSchema: {}, batch: false,
};
const ready = (value: unknown): ProductPanelReadResponse => ({ status: "ready", value: value as never });
const chosenProjection = (id: string) => ({ className: PRODUCT_PROJECTION, primaryKey: id });
const chosenPanel = (id: string) => ({ className: PRODUCT_PANEL, primaryKey: id });

function base(reads: PanelMemberReadRequest[], projections: Record<string, DirectProjection | Error>): Omit<DirectPanelInstanceOptions, "nested"> {
  return {
    pageKey: "p", url: () => "/p", label: () => "P", text: createPanelText({}, ref("en"), "en"),
    ...noOperations, recordDraftCreated: async () => {},
    readProjection: async (id) => {
      const found = projections[id];
      if (!found) throw new Error(`No projection ${id}`);
      if (found instanceof Error) throw found;
      return found;
    },
    read: async (request) => {
      reads.push(request);
      if (request.operations) return ready({ runNow });
      return ready([{ primaryKey: `row-of-${String((request.memberPath.at(-1)!.selection as { target: { projectionId: string } } | undefined)?.target.projectionId ?? request.memberPath.at(-1)!.member)}`, label: "Row", fields: {} }]);
    },
  };
}

function draw(instance: ReturnType<typeof createDirectPanelInstance>, member: string) {
  const element = document.createElement("div");
  document.body.append(element);
  createApp({ render: () => h(PanelMember, { instance, member, key: `${member}:${instance.projectionVersion(member)}` }) })
    .use(createI18n({ legacy: false, locale: "en", messages: { en: publicEn } })).use(ElementPlus).mount(element);
  return element;
}

afterEach(() => {
  document.body.innerHTML = "";
});

it("draws the projection the panel's state chooses, reads and operates it by the selection that placed it", async () => {
  const reads: PanelMemberReadRequest[] = [];
  const manifest: DirectPanelManifest = {
    state: { chosen: { type: { kind: "object", objectType: PRODUCT_PROJECTION }, personal: false, deepLink: true, external: false } },
    members: { preview: { target: { fromState: "chosen", candidates: { rule: "usable" } } } },
    commands: {},
  };
  const forbidden = new PanelMemberUnavailable(403, "Not yours");
  const instance = createDirectPanelInstance(manifest, {
    ...base(reads, { "tasks-a": list("tasks-a"), "tasks-b": list("tasks-b"), secret: forbidden }), initial: {}, nested: noOperations.nested,
  });
  const element = draw(instance, "preview");
  await vi.waitFor(() => expect(element.textContent).toContain(publicEn.platform.dataAwaiting));
  expect(reads).toEqual([]);

  const segment = (id: string) => ({ member: "preview", selection: { stateValue: chosenProjection(id), target: { projectionId: id } } });
  instance.state.set("chosen", chosenProjection("tasks-a"));
  await vi.waitFor(() => expect(reads.filter((read) => read.dataName === "rows").map((read) => read.memberPath)).toEqual([[segment("tasks-a")]]));
  await vi.waitFor(() => expect(instance.operations.value.map(({ id, memberPath }) => [id, memberPath])).toEqual([["preview.runNow", [segment("tasks-a")]]]));
  expect(reads.find((read) => read.operations)!.memberPath).toEqual([segment("tasks-a")]);

  // Another choice: the first projection is let go, the new one read and operated by its own selection.
  instance.state.set("chosen", chosenProjection("tasks-b"));
  await vi.waitFor(() => expect(instance.operations.value.map(({ id, memberPath }) => [id, memberPath])).toEqual([["preview.runNow", [segment("tasks-b")]]]));
  await vi.waitFor(() => expect(reads.filter((read) => read.dataName === "rows").at(-1)!.memberPath).toEqual([segment("tasks-b")]));

  // One the reader may not use says so in this place.
  instance.state.set("chosen", chosenProjection("secret"));
  await vi.waitFor(() => expect(element.textContent).toContain(publicEn.platform.dataForbidden));
  expect(instance.operations.value).toEqual([]);
});

it("runs the panel the state chooses in place, publishing its operations and context and wiring its inputs and outputs", async () => {
  const reads: PanelMemberReadRequest[] = [];
  const outerManifest: DirectPanelManifest = {
    state: {
      detailPanel: { type: { kind: "object", objectType: PRODUCT_PANEL }, personal: false, deepLink: true, external: false },
      task: { type: taskType, personal: false, deepLink: true, external: false },
      picked: { type: { kind: "scalar", type: "string" }, personal: false, deepLink: false, external: false },
    },
    members: {
      detail: {
        target: { fromState: "detailPanel", candidates: { rule: "usable" } },
        inputs: { task: { state: "task" } }, outputs: { note: { state: "picked" } },
        // The placement's theme: the host lays it over the placed panel's own, where it mounts that panel.
        theme: { light: { "--sdk-color-primary": "#0a7d4f" } },
      },
    },
    commands: {},
  };
  const innerManifest: DirectPanelManifest = {
    state: {
      task: { type: taskType, personal: false, deepLink: true, external: false },
      note: { type: { kind: "scalar", type: "string" }, personal: false, deepLink: false, external: false },
    },
    members: { approve: { target: { projectionId: "tasks-a" } } },
    commands: {},
  };
  const placed: { path: PanelMemberPath; initial: unknown; theme: unknown; inner: ReturnType<typeof createDirectPanelInstance>; dispose: ReturnType<typeof vi.fn> }[] = [];
  const outer = createDirectPanelInstance(outerManifest, {
    ...base(reads, { "tasks-a": list("tasks-a") }), initial: { detailPanel: chosenPanel("p-1"), task: task("t-1") },
    // The host runs the placed panel at the outer path plus the member's segment, as its own instance.
    nested: async (path, run) => {
      const inner = createDirectPanelInstance(innerManifest, {
        ...base(reads, { "tasks-a": list("tasks-a") }), initial: run.initial as never, memberPath: path as PanelMemberPath, nested: noOperations.nested,
      });
      void inner.placing("approve");
      const element = document.createElement("section");
      element.className = "inner-panel";
      element.textContent = `Panel ${(path[0]!.selection as { target: { panelId: string } }).target.panelId}`;
      const dispose = vi.fn();
      placed.push({ path: path as PanelMemberPath, initial: run.initial, theme: run.theme, inner, dispose });
      return { element, mount: { instance: inner, refresh: vi.fn(), projectionsChanged: vi.fn(), activate: vi.fn(), dispose } };
    },
  });
  const element = draw(outer, "detail");
  const segment = (id: string) => ({ member: "detail", selection: { stateValue: chosenPanel(id), target: { panelId: id } } });
  await vi.waitFor(() => expect(element.querySelector(".inner-panel")?.textContent).toBe("Panel p-1"));
  expect(placed.map(({ path, initial }) => [path, initial])).toEqual([[[segment("p-1")], { task: task("t-1") }]]);
  expect(placed[0]!.theme).toEqual({ light: { "--sdk-color-primary": "#0a7d4f" } });

  // Its operations are this panel's too, under their full path, found by it; its reads name the same path.
  const approvePath = [segment("p-1"), { member: "approve" }];
  await vi.waitFor(() => expect(outer.operations.value.map(({ id, memberPath }) => [id, memberPath])).toEqual([["detail.approve.runNow", approvePath]]));
  expect(reads.find((read) => read.operations)!.memberPath).toEqual(approvePath);
  // Its selection is in this panel's context, by its path.
  expect(outer.pageContext.value.selection).toContainEqual(expect.objectContaining({ memberPath: [segment("p-1")] }));

  // Inputs follow this panel's state; outputs write it.
  outer.state.set("task", task("t-2"));
  await vi.waitFor(() => expect(placed[0]!.inner.state.values.value.task).toEqual(task("t-2")));
  placed[0]!.inner.state.set("note", "checked");
  await vi.waitFor(() => expect(outer.state.values.value.picked).toBe("checked"));

  // Another panel chosen: the first is let go with its operations; the new one runs in its place.
  outer.state.set("detailPanel", chosenPanel("p-2"));
  await vi.waitFor(() => expect(placed[0]!.dispose).toHaveBeenCalledTimes(1));
  void outer.placing("detail");
  await vi.waitFor(() => expect(outer.operations.value.map(({ id, memberPath }) => [id, memberPath]))
    .toEqual([["detail.approve.runNow", [segment("p-2"), { member: "approve" }]]]));
});

it("asks for the chosen object's detail panel by the object alone, and the placed panel works under the panel the platform found", async () => {
  const reads: PanelMemberReadRequest[] = [];
  const outerManifest: DirectPanelManifest = {
    state: { chosenTask: { type: taskType, personal: false, deepLink: true, external: false } },
    members: { detail: { target: { fromState: "chosenTask", candidates: { rule: "objectDetail" } } } },
    commands: {},
  };
  const innerManifest: DirectPanelManifest = { state: {}, members: { approve: { target: { projectionId: "tasks-a" } } }, commands: {} };
  const asked: unknown[] = [];
  const outer = createDirectPanelInstance(outerManifest, {
    ...base(reads, { "tasks-a": list("tasks-a") }), initial: {},
    // The host reads the object's detail panel, then runs it under the segment completed by the panel the platform found.
    nested: async (path, run) => {
      asked.push(path);
      const found = { ...path[0]!, selection: { ...path[0]!.selection!, target: { panelId: "task-detail" } } } as PanelMemberPath[number];
      const inner = createDirectPanelInstance(innerManifest, {
        ...base(reads, { "tasks-a": list("tasks-a") }), initial: run.initial as never, memberPath: [found], nested: noOperations.nested,
      });
      void inner.placing("approve");
      const element = document.createElement("section");
      element.className = "inner-panel";
      return { element, mount: { instance: inner, refresh: vi.fn(), projectionsChanged: vi.fn(), activate: vi.fn(), dispose: vi.fn() } };
    },
  });
  const element = draw(outer, "detail");
  await vi.waitFor(() => expect(element.textContent).toContain(publicEn.platform.dataAwaiting));
  expect(asked).toEqual([]);

  outer.state.set("chosenTask", task("t-9"));
  await vi.waitFor(() => expect(element.querySelector(".inner-panel")).not.toBeNull());
  expect(asked).toEqual([[{ member: "detail", selection: { stateValue: task("t-9") } }]]);
  const found = { member: "detail", selection: { stateValue: task("t-9"), target: { panelId: "task-detail" } } };
  await vi.waitFor(() => expect(outer.operations.value.map(({ id, memberPath }) => [id, memberPath]))
    .toEqual([["detail.approve.runNow", [found, { member: "approve" }]]]));
  expect(reads.find((read) => read.operations)!.memberPath).toEqual([found, { member: "approve" }]);
});
