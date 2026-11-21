import { afterEach, expect, it, vi } from "vitest";
import { definePanel } from "@ontomato/contracts/panel-manifest";
import { BUSINESS_KNOWLEDGE, SCHEDULED_TASK } from "@ontomato/contracts/platform-object-types";
import type { ProductProjection } from "@ontomato/contracts/product-panels";
import { frameMemberData } from "../../../../../packages/apps-sdk/src/panel/frame-member";
import { createPanelInstance } from "../../../../../packages/apps-sdk/src/panel/instance";
import { registerPlatformObjectAdapter } from "../../../../../packages/apps-sdk/src/panel/platform-objects";
import { readPanelData } from "../../../../../packages/apps-sdk/src/panel/platform-requests";
import { noOperations } from "./panel-frame";
import type { PanelMemberReadRequest } from "../../../../../packages/apps-sdk/src/panel/direct";

/*
 * A code panel's member reads its data where a directly rendered one does (big main's ruling, 2026-11-20): through the
 * platform's read entry, from the owner's one adapter in Node. A type this release still has a resource module for keeps
 * reading through it until its page moves and the module goes; one it has none for (business knowledge) reads through
 * the platform already. The frame sends the member, the datum and its values over its request path, and never says
 * which panel it is: the host fills that in.
 *
 * What this rules out: a frame that cannot read a type whose owner has only a Node adapter; a frame that names its own
 * source; a type with a module of its own read twice, both ways.
 */

const record = { domainId: "d", ownerId: "o", revision: 1, createdAt: "", updatedAt: "", editable: false, visibility: "domain" as const, description: "" };
const knowledge: ProductProjection = {
  ...record, id: "knowledge-list", name: "Knowledge", componentId: "@ontomato/sdk:ObjectList",
  inputs: { status: { kind: "scalar", type: "string" } }, outputs: {}, config: {},
  data: { rows: { source: { type: { kind: "PlatformObjectType", id: BUSINESS_KNOWLEDGE } }, read: "query", params: { status: { input: "status" } } } },
};
const tasks: ProductProjection = {
  ...record, id: "tasks", name: "Tasks", componentId: "@ontomato/sdk:ObjectList", inputs: {}, outputs: {}, config: {},
  data: { rows: { source: { type: { kind: "PlatformObjectType", id: SCHEDULED_TASK } }, read: "list", params: {} } },
};
const panel = definePanel({
  state: { status: { type: { kind: "scalar", type: "string" } } },
  members: { list: { target: { projectionId: knowledge.id }, inputs: { status: { state: "status" } } }, tasks: { target: { projectionId: tasks.id } } },
  commands: {},
});
const instance = () => createPanelInstance(panel, {
  text: (key) => key, pageKey: "knowledge", url: () => "/knowledge", label: () => "Knowledge", initial: { status: "pending" }, ...noOperations,
  recordDraftCreated: async () => {}, readProjection: async () => { throw new Error("unused"); },
});

afterEach(() => {
  vi.resetModules();
});

it("reads a type with no resource module through the platform's read entry, over the frame's request path", async () => {
  const sent: { path: string; service: string; body: unknown }[] = [];
  const requests = {
    async request(path: string, init: { body?: unknown }, service: "" | "/data-query") {
      sent.push({ path, service, body: JSON.parse(String(init.body)) });
      return Response.json({ status: "ready", value: { rows: [{ primaryKey: "k-1", label: "Night cutoff", fields: {} }], total: 1 } });
    },
  };
  const read = (request: PanelMemberReadRequest) => readPanelData(requests, request);
  const data = frameMemberData(knowledge, "list", instance(), () => ({ status: "pending" }), read);

  expect(await data.read("rows", { cursor: "c-2", size: 20 })).toEqual({
    status: "ready", value: { rows: [{ primaryKey: "k-1", label: "Night cutoff", fields: {} }], total: 1 },
  });
  // The member, the datum, the author's input and the component's own page; no source, which the host gives.
  expect(sent).toEqual([{
    path: "/product-panels/read", service: "",
    body: { memberPath: [{ member: "list" }], dataName: "rows", inputs: { status: "pending" }, runtimeParams: { cursor: "c-2", size: 20 } },
  }]);
});

it("keeps reading a type through its resource module while the module is there, and reads nothing through the platform", async () => {
  registerPlatformObjectAdapter({ objectType: SCHEDULED_TASK, list: async () => [{ primaryKey: "t-1", label: "Nightly", fields: {} }] });
  const read = vi.fn(async () => { throw new Error("A type with a module reads through it"); });
  const data = frameMemberData(tasks, "tasks", instance(), () => ({}), read);
  expect(await data.read("rows", {})).toEqual({ status: "ready", value: [{ primaryKey: "t-1", label: "Nightly", fields: {} }] });
  expect(read).not.toHaveBeenCalled();
});
