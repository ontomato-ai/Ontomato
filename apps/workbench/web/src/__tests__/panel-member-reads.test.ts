import { afterEach, expect, it, vi } from "vitest";
import { effectScope, nextTick, type ComputedRef } from "vue";
import type { DirectPanelManifest } from "@ontomato/contracts/panel-manifest";
import type { DirectProjection } from "@ontomato/contracts/product-panels";
import type { ProductPanelReadRequest } from "@ontomato/contracts/panel-host";
import { ACTION, AGENT_DEFINITION, BUSINESS_KNOWLEDGE, MODEL_OPTION, ONTOLOGY_TYPE, USER } from "@ontomato/contracts/platform-object-types";
import { createDirectPanelInstance, type MemberDataState, type MemberInputs } from "../../../../../packages/apps-sdk/src/panel/direct";
import { frameMemberData } from "../../../../../packages/apps-sdk/src/panel/frame-member";
import { memberFormSource } from "../../../../../packages/apps-sdk/src/panel/member-forms";
import { createPanelInstance } from "../../../../../packages/apps-sdk/src/panel/instance";
import { platformOntologyAdapters } from "../../../../../packages/apps-sdk/src/panel/platform-ontology";
import { registerPlatformObjectAdapter, type PlatformRequests } from "../../../../../packages/apps-sdk/src/panel/platform-objects";
import { createPanelText } from "../../../../../packages/apps-sdk/src/panel/text";
import { definePanel } from "@ontomato/contracts/panel-manifest";
import { noOperations } from "./panel-frame";

/** A frame here reads through its resource modules; any read through the platform fails the test. */
const noPlatformRead = async (): Promise<never> => { throw new Error("This test reads through the frame's modules"); };

/*
 * The member data the reads A registered for the first stage's other panels give components, in the platform's document
 * and in a code panel's frame: the ontology's objects of a chosen type, its graph, a reference's choices and held values,
 * and a type's create form. A datum whose owner requires a parameter (a type to list, a node to expand) waits, unread,
 * until the parameter has a value.
 *
 * What these rule out: a read sent for no type or no node (the owner refuses it, and the reader sees an error instead of
 * "choose first"); graph answers in a frame that are not the shape the platform's read answers; a create form that cannot
 * be read or saved by a member.
 */

const record = { domainId: "d", ownerId: "o", revision: 1, createdAt: "", updatedAt: "", editable: false, visibility: "domain" as const, description: "" };
const ontology = (data: DirectProjection["data"], inputs: DirectProjection["inputs"]): DirectProjection => ({
  ...record, id: "ontology", name: "Ontology", componentId: "@ontomato/sdk:ObjectList", inputs, outputs: {}, config: {}, data,
});
const typeObjects = ontology(
  { objects: { source: { type: { kind: "PlatformObjectType", id: ONTOLOGY_TYPE } }, read: "objects", params: { type: { input: "type" }, keyword: { input: "keyword" }, page: { input: "page" } } } },
  { type: { kind: "scalar", type: "string" }, keyword: { kind: "scalar", type: "string" }, page: { kind: "json" } },
);
const graph = ontology(
  {
    counts: { source: { type: { kind: "PlatformObjectType", id: ONTOLOGY_TYPE } }, read: "counts", params: {} },
    start: { source: { type: { kind: "PlatformObjectType", id: ONTOLOGY_TYPE } }, read: "start", params: {} },
    neighbors: { source: { type: { kind: "PlatformObjectType", id: ONTOLOGY_TYPE } }, read: "neighbors", params: { node: { input: "node" } } },
  },
  { node: { kind: "json" } },
);
const objectsAnswer = (type: string, page: number, pageSize: number) => ({
  type, layer: "capability", status: "ok", items: [{ node: { className: type, primaryKey: "a-2" }, label: "Refund" }], total: 12, page, pageSize,
});
const user = { className: USER, primaryKey: "u-1", label: "Alice", layer: "governance" };

afterEach(() => {
  vi.resetModules();
});

it("reads nothing for a datum whose required parameter has no value, in the platform's document", async () => {
  const manifest: DirectPanelManifest = {
    state: { selectedType: { type: { kind: "scalar", type: "string" }, personal: false, deepLink: true, external: false } },
    members: { objects: { target: { projectionId: typeObjects.id }, inputs: { type: { state: "selectedType" } } } },
    events: {},
  };
  const reads: Omit<ProductPanelReadRequest, "source">[] = [];
  const instance = createDirectPanelInstance(manifest, {
    pageKey: "map", url: () => "/map", label: () => "Map", initial: {},
    text: createPanelText({}, { value: "en" } as never, "en"), ...noOperations, recordDraftCreated: async () => {},
    readProjection: async () => typeObjects,
    read: async (request) => {
      reads.push(request);
      return { status: "ready", value: objectsAnswer(ACTION, 1, 20) as never };
    },
  });
  const scope = effectScope();
  let objects!: ComputedRef<MemberDataState>;
  scope.run(() => {
    objects = instance.memberData("objects", typeObjects, () => ({ type: instance.state.values.value.selectedType ?? null }) as MemberInputs).use("objects");
  });
  await nextTick();
  expect(objects.value).toEqual({ status: "awaiting" });
  expect(reads).toEqual([]);

  instance.state.set("selectedType", ACTION);
  await vi.waitFor(() => expect(objects.value.status).toBe("ready"));
  expect(reads).toEqual([{ memberPath: [{ member: "objects" }], dataName: "objects", inputs: { type: ACTION } }]);
  scope.stop();
});

it("reads nothing for a required parameter the projection leaves unmapped or the panel's state leaves empty", async () => {
  // The business knowledge tabs count by a field the owner requires; nothing gives it here, or the state given is empty.
  const counts = (params: DirectProjection["data"][string]["params"]): DirectProjection => ({
    ...record, id: "knowledge-tabs", name: "Tabs", componentId: "@ontomato/sdk:SegmentedControl",
    inputs: { by: { kind: "scalar", type: "string" } }, outputs: {}, config: {},
    data: { counts: { source: { type: { kind: "PlatformObjectType", id: BUSINESS_KNOWLEDGE } }, read: "counts", params } },
  });
  for (const projection of [counts({}), counts({ by: { input: "by" } })]) {
    const reads: unknown[] = [];
    const instance = createDirectPanelInstance(definePanel({
      state: { by: { type: { kind: "scalar", type: "string" } } },
      members: { tabs: { target: { projectionId: projection.id }, inputs: { by: { state: "by" } } } },
      events: {},
    }), {
      pageKey: "knowledge", url: () => "/knowledge", label: () => "Knowledge", initial: {},
      text: createPanelText({}, { value: "en" } as never, "en"), ...noOperations, recordDraftCreated: async () => {},
      readProjection: async () => projection,
      read: async (request) => {
        reads.push(request);
        return { status: "ready", value: [] as never };
      },
    });
    const scope = effectScope();
    let tabs!: ComputedRef<MemberDataState>;
    scope.run(() => { tabs = instance.memberData("tabs", projection, () => ({ by: instance.state.values.value.by ?? null }) as MemberInputs).use("counts"); });
    await nextTick();
    expect(tabs.value).toEqual({ status: "awaiting" });
    expect(reads).toEqual([]);
    scope.stop();
  }
});

it("answers the ontology's reads in a code panel's frame as the platform's reads answer them", async () => {
  const sent: { path: string; body: unknown }[] = [];
  const requests: PlatformRequests = {
    async request(path, init) {
      sent.push({ path, body: typeof init.body === "string" ? JSON.parse(init.body) : undefined });
      if (path === "/platform-ontology/counts") return Response.json({ counts: [{ type: USER, layer: "governance", status: "ok", count: 4 }] });
      if (path === "/platform-ontology/start") return Response.json({ node: user });
      if (path === "/platform-ontology/neighbors")
        return Response.json({ node: user, neighbors: [], edges: [], relations: [] });
      if (path === "/platform-ontology/objects") {
        const body = JSON.parse(String(init.body));
        return Response.json(objectsAnswer(body.type, body.page, body.pageSize));
      }
      throw new Error(`Nothing at ${path}`);
    },
  };
  platformOntologyAdapters(requests).forEach(registerPlatformObjectAdapter);
  const instance = createPanelInstance(definePanel({ state: {}, members: {}, events: {} }), {
    text: (key) => key, pageKey: "map", url: () => "/map", label: () => "Map", initial: {}, ...noOperations,
    recordDraftCreated: async () => {}, readProjection: async () => { throw new Error("unused"); },
  });

  const graphData = frameMemberData(graph, "graph", instance, () => ({ node: null }), noPlatformRead);
  expect(await graphData.read("neighbors", {})).toEqual({ status: "awaiting" });
  expect(sent).toEqual([]);
  expect(await graphData.read("counts", {})).toEqual({ status: "ready", value: { counts: [{ type: USER, layer: "governance", status: "ok", count: 4 }] } });
  expect(await graphData.read("start", {})).toEqual({ status: "ready", value: { node: user } });
  expect(await graphData.read("neighbors", { node: { className: USER, primaryKey: "u-1" } }))
    .toEqual({ status: "ready", value: { node: user, neighbors: [], edges: [], relations: [] } });

  const objectData = frameMemberData(typeObjects, "objects", instance, () => ({ type: null }), noPlatformRead);
  expect(await objectData.read("objects", {})).toEqual({ status: "awaiting" });
  expect(await objectData.read("objects", { type: ACTION, keyword: "ref", page: { number: 2, size: 10 } }))
    .toEqual({ status: "ready", value: objectsAnswer(ACTION, 2, 10) });
  expect(sent.map(({ path, body }) => [path, body])).toEqual([
    ["/platform-ontology/counts", undefined],
    ["/platform-ontology/start", undefined],
    ["/platform-ontology/neighbors", { node: { className: USER, primaryKey: "u-1" } }],
    ["/platform-ontology/objects", { type: ACTION, keyword: "ref", page: 2, pageSize: 10 }],
  ]);
});

it("reads a reference's choices and held values, and a type's create form, as a member's data in a frame", async () => {
  const choice = { primaryKey: "gpt", value: "gpt", label: "GPT" };
  const list = vi.fn(async () => ({ options: [choice] }));
  const resolve = vi.fn(async () => [{ ...choice, unavailable: { reason: "Retired" } }]);
  registerPlatformObjectAdapter({ objectType: MODEL_OPTION, options: { list, resolve } });
  const description = {
    fields: [], values: { name: "" }, errors: [], revision: 1,
    save: { method: "POST" as const, path: "/agents", bodySchema: {}, draftOperation: `${AGENT_DEFINITION}.save` },
  };
  const describe = vi.fn(async () => description);
  registerPlatformObjectAdapter({ objectType: AGENT_DEFINITION, forms: { describe, save: vi.fn() } });
  const instance = createPanelInstance(definePanel({ state: {}, members: {}, events: {} }), {
    text: (key) => key, pageKey: "agents", url: () => "/agents", label: () => "Agents", initial: {}, ...noOperations,
    recordDraftCreated: async () => {}, readProjection: async () => { throw new Error("unused"); },
  });
  const picker: DirectProjection = {
    ...record, id: "model", name: "Model", componentId: "@ontomato/sdk:ReferencePicker",
    inputs: { values: { kind: "json" } }, outputs: {}, config: {},
    data: {
      options: { source: { type: { kind: "PlatformObjectType", id: MODEL_OPTION } }, read: "options", params: {} },
      selected: { source: { type: { kind: "PlatformObjectType", id: MODEL_OPTION } }, read: "resolve", params: { values: { input: "values" } } },
    },
  };
  const pickerData = frameMemberData(picker, "model", instance, () => ({}), noPlatformRead);
  expect(await pickerData.read("options", {})).toEqual({ status: "ready", value: { options: [choice] } });
  expect(await pickerData.read("selected", { values: ["gpt"] }))
    .toEqual({ status: "ready", value: { options: [{ ...choice, unavailable: { reason: "Retired" } }] } });
  expect(resolve).toHaveBeenCalledWith(["gpt"]);

  const form: DirectProjection = {
    ...record, id: "definition", name: "Agent", componentId: "@ontomato/sdk:ObjectForm",
    inputs: { values: { kind: "json" }, changedField: { kind: "scalar", type: "string" } }, outputs: {}, config: {},
    data: { createForm: { source: { type: { kind: "PlatformObjectType", id: AGENT_DEFINITION } }, read: "createForm", params: { values: { input: "values" }, changedField: { input: "changedField" } } } },
  };
  const formData = frameMemberData(form, "definition", instance, () => ({}), noPlatformRead);
  // The member's form source reads the type's create form for a new object, with the values the form holds.
  const source = memberFormSource({ key: "definition", projection: form, inputs: { value: {} } as never, data: formData }, instance);
  expect(await source.describe({ target: { kind: "draft" }, values: { name: "Analyst" }, changedField: "/name" })).toEqual(description);
  expect(describe).toHaveBeenCalledWith({ target: { kind: "draft" }, values: { name: "Analyst" }, changedField: "/name" });
});
