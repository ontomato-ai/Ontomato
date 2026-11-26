import { afterEach, expect, it, vi } from "vitest";
import { computed, effectScope, nextTick, type ComputedRef } from "vue";
import type { DirectPanelManifest } from "@ontomato/contracts/panel-manifest";
import type { DirectProjection } from "@ontomato/contracts/product-panels";
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
import type { PanelMemberReadRequest } from "../../../../../packages/apps-sdk/src/panel/direct";

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
  { rows: { source: { type: { kind: "PlatformObjectType", id: ONTOLOGY_TYPE } }, read: "instances", params: { className: { input: "type" } } } },
  { type: { kind: "scalar", type: "string" } },
);
const graph = ontology(
  {
    counts: { source: { type: { kind: "PlatformObjectType", id: ONTOLOGY_TYPE } }, read: "counts", params: {} },
    start: { source: { type: { kind: "PlatformObjectType", id: ONTOLOGY_TYPE } }, read: "start", params: {} },
    neighbors: { source: { type: { kind: "PlatformObjectType", id: ONTOLOGY_TYPE } }, read: "neighbors", params: { node: { input: "node" } } },
  },
  { node: { kind: "json" } },
);
const rowsAnswer = () => ({ rows: [], total: 0 });
const user = { className: USER, primaryKey: "u-1", label: "Alice", layer: "governance" };

afterEach(() => {
  vi.resetModules();
});

it("reads nothing for a datum whose required parameter has no value, in the platform's document", async () => {
  const manifest: DirectPanelManifest = {
    state: { selectedType: { type: { kind: "scalar", type: "string" }, personal: false, deepLink: true, external: false } },
    members: { objects: { target: { projectionId: typeObjects.id }, inputs: { type: { state: "selectedType" } } } },
  };
  const reads: PanelMemberReadRequest[] = [];
  const instance = createDirectPanelInstance(manifest, {
    pageKey: "map", url: () => "/map", label: () => "Map", initial: {},
    text: createPanelText({}, { value: "en" } as never, "en"), ...noOperations,
    readProjection: async () => typeObjects,
    read: async (request) => {
      reads.push(request);
      return { status: "ready", value: rowsAnswer() as never };
    },
  });
  const scope = effectScope();
  let objects!: ComputedRef<MemberDataState>;
  scope.run(() => {
    objects = instance.memberData("objects", typeObjects, () => ({ type: instance.state.values.value.selectedType ?? null }) as MemberInputs).use("rows");
  });
  await nextTick();
  expect(objects.value).toEqual({ status: "awaiting" });
  expect(reads).toEqual([]);

  instance.state.set("selectedType", ACTION);
  await vi.waitFor(() => expect(objects.value.status).toBe("ready"));
  expect(reads).toEqual([{ memberPath: [{ member: "objects" }], dataName: "rows", inputs: { type: ACTION } }]);
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
    }), {
      pageKey: "knowledge", url: () => "/knowledge", label: () => "Knowledge", initial: {},
      text: createPanelText({}, { value: "en" } as never, "en"), ...noOperations,
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
      throw new Error(`Nothing at ${path}`);
    },
  };
  platformOntologyAdapters(requests).forEach(registerPlatformObjectAdapter);
  const instance = createPanelInstance(definePanel({ state: {}, members: {} }), {
    text: (key) => key, pageKey: "map", url: () => "/map", label: () => "Map", initial: {}, ...noOperations, readProjection: async () => { throw new Error("unused"); },
  });

  const graphData = frameMemberData(graph, "graph", instance, () => ({ node: null }), noPlatformRead);
  expect(await graphData.read("neighbors", {})).toEqual({ status: "awaiting" });
  expect(sent).toEqual([]);
  expect(await graphData.read("counts", {})).toEqual({ status: "ready", value: { counts: [{ type: USER, layer: "governance", status: "ok", count: 4 }] } });
  expect(await graphData.read("start", {})).toEqual({ status: "ready", value: { node: user } });
  expect(await graphData.read("neighbors", { node: { className: USER, primaryKey: "u-1" } }))
    .toEqual({ status: "ready", value: { node: user, neighbors: [], edges: [], relations: [] } });

  expect(sent.map(({ path, body }) => [path, body])).toEqual([
    ["/platform-ontology/counts", undefined],
    ["/platform-ontology/start", undefined],
    ["/platform-ontology/neighbors", { node: { className: USER, primaryKey: "u-1" } }],
  ]);
});

it("reads a reference's choices and held values, and a type's create form, as a member's data in a frame", async () => {
  const choice = { primaryKey: "gpt", value: "gpt", label: "GPT" };
  const list = vi.fn(async () => ({ options: [choice] }));
  const resolve = vi.fn(async () => [{ ...choice, unavailable: { reason: "Retired" } }]);
  registerPlatformObjectAdapter({ objectType: MODEL_OPTION, options: { list, resolve } });
  const description = {
    fields: [], values: { name: "" }, errors: [], revision: 1,
    save: { method: "POST" as const, path: "/agents", bodySchema: {} },
  };
  const describe = vi.fn(async () => description);
  registerPlatformObjectAdapter({ objectType: AGENT_DEFINITION, forms: { describe, save: vi.fn() } });
  const instance = createPanelInstance(definePanel({ state: {}, members: {} }), {
    text: (key) => key, pageKey: "agents", url: () => "/agents", label: () => "Agents", initial: {}, ...noOperations, readProjection: async () => { throw new Error("unused"); },
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
  const source = memberFormSource({
    key: "definition", projection: form, inputs: { value: {} } as never, operations: computed(() => ({ status: "ready" as const, value: {} })), data: formData,
  }, instance);
  expect(await source.describe({ target: { kind: "draft" }, values: { name: "Analyst" }, changedField: "/name" })).toEqual(description);
  expect(describe).toHaveBeenCalledWith({ target: { kind: "draft" }, values: { name: "Analyst" }, changedField: "/name" });
});

it("clears stale ready data and declared read outputs immediately on target switch while keeping same-target refreshes ready", async () => {
  const headerProjection: DirectProjection = {
    ...record,
    id: "type-header",
    name: "Type header",
    componentId: "@ontomato/sdk:ObjectHeader",
    inputs: { target: { kind: "object", objectType: ONTOLOGY_TYPE } },
    outputs: {},
    config: {},
    data: {
      record: { source: { object: { input: "target" } }, read: "record", params: {} },
    },
    operations: {
      remove: {
        operation: { kind: "PlatformOperation", id: "agents.delete" },
        target: { input: "target" },
      },
    },
  };
  const objectsProjection: DirectProjection = {
    ...record,
    id: "type-objects",
    name: "Type objects",
    componentId: "@ontomato/sdk:ObjectList",
    inputs: { type: { kind: "scalar", type: "string" } },
    outputs: {},
    config: {},
    data: {
      rows: {
        source: { type: { kind: "PlatformObjectType", id: ONTOLOGY_TYPE } },
        read: "instances",
        params: { className: { input: "type" } },
      },
    },
  };
  const manifest: DirectPanelManifest = {
    state: {
      selectedTypeRef: { type: { kind: "object", objectType: ONTOLOGY_TYPE }, personal: false, deepLink: false, external: false },
      selectedType: { type: { kind: "scalar", type: "string" }, personal: false, deepLink: false, external: false },
    },
    members: {
      header: { target: { projectionId: headerProjection.id }, inputs: { target: { state: "selectedTypeRef" } } },
      objects: { target: { projectionId: objectsProjection.id }, inputs: { type: { state: "selectedType" } } },
    },
  };

  type Resolver = (response: import("@ontomato/contracts/panel-host").ProductPanelReadResponse) => void;
  const pendingRecords = new Map<string, Resolver[]>();
  const pendingOps = new Map<string, Resolver[]>();
  const pendingObjects = new Map<string, Resolver[]>();
  const enqueue = (map: Map<string, Resolver[]>, key: string) =>
    new Promise<import("@ontomato/contracts/panel-host").ProductPanelReadResponse>((resolve) => {
      const list = map.get(key) ?? [];
      list.push(resolve);
      map.set(key, list);
    });

  const instance = createDirectPanelInstance(manifest, {
    pageKey: "target-switch",
    url: () => "/target-switch",
    label: () => "Target switch",
    initial: {
      selectedTypeRef: { className: ONTOLOGY_TYPE, primaryKey: ACTION },
      selectedType: ACTION,
    },
    text: createPanelText({}, { value: "en" } as never, "en"),
    ...noOperations,
    readProjection: async (id) => (id === headerProjection.id ? headerProjection : objectsProjection),
    read: (request) => {
      if ("operations" in request) {
        const key = (request.inputs.target as { primaryKey?: string } | null)?.primaryKey ?? "none";
        return enqueue(pendingOps, key);
      }
      if (request.dataName === "record") {
        const key = (request.inputs.target as { primaryKey: string }).primaryKey;
        return enqueue(pendingRecords, key);
      }
      const type = String(request.inputs.type ?? "");
      const search = String((request.runtimeParams as Record<string, unknown> | undefined)?.search ?? "");
      return enqueue(pendingObjects, `${type}:${search}`);
    },
  });

  const scope = effectScope();
  let headerRecord!: ComputedRef<MemberDataState>;
  let headerOps!: ComputedRef<import("../../../../../packages/apps-sdk/src/panel/member-operations").MemberOperationsState>;
  let objectsData!: ComputedRef<MemberDataState>;
  scope.run(() => {
    const headerInputs = () => ({ target: instance.state.values.value.selectedTypeRef ?? null }) as MemberInputs;
    headerRecord = instance.memberData("header", headerProjection, headerInputs).use("record");
    headerOps = instance.memberOperations("header", headerProjection, headerInputs);
    objectsData = instance.memberData("objects", objectsProjection, () => ({ type: instance.state.values.value.selectedType ?? null }) as MemberInputs).use("rows");
  });

  // Resolve target A (`ACTION`) for record, operations, and objects.
  await vi.waitFor(() => {
    expect(pendingRecords.get(ACTION)?.length).toBe(1);
    expect(pendingOps.get(ACTION)?.length).toBe(1);
    expect(pendingObjects.get(`${ACTION}:`)?.length).toBe(1);
  });
  pendingRecords.get(ACTION)!.shift()!({
    status: "ready",
    value: {
      primaryKey: ACTION,
      label: "Action",
      fields: {},
      outputs: { directoryPath: "/ontology/assets/actions", directoryName: "Actions" },
    } as never,
  });
  pendingOps.get(ACTION)!.shift()!({
    status: "ready",
    value: {
      remove: {
        kind: "action",
        handlerRef: "agents.delete",
        label: "Delete",
        effect: "write",
        target: { source: "input", input: "target" },
        inputSchema: {},
        resultSchema: {},
        batch: false,
      },
    } as never,
  });
  pendingObjects.get(`${ACTION}:`)!.shift()!({
    status: "ready",
    value: rowsAnswer() as never,
  });

  await vi.waitFor(() => {
    expect(headerRecord.value.status).toBe("ready");
    expect(headerOps.value.status).toBe("ready");
    expect(objectsData.value.status).toBe("ready");
    expect(instance.outputs.header?.directoryPath).toBe("/ontology/assets/actions");
    expect(instance.outputs.header?.directoryName).toBe("Actions");
  });

  // Same-target refresh and non-target parameter change (search) keep ready state until the new answer arrives.
  instance.refresh({
    objects: [{ objectType: ONTOLOGY_TYPE, primaryKey: ACTION }],
    objectTypes: [ONTOLOGY_TYPE],
  });
  instance.memberParam("objects", "search").set("ref");
  await nextTick();
  expect(headerRecord.value.status).toBe("ready");
  expect(headerOps.value.status).toBe("ready");
  expect(objectsData.value.status).toBe("ready");
  expect(instance.outputs.header?.directoryPath).toBe("/ontology/assets/actions");

  // Resolve the same-target refresh before switching targets.
  pendingRecords.get(ACTION)!.shift()!({
    status: "ready",
    value: {
      primaryKey: ACTION,
      label: "Action v2",
      fields: {},
      outputs: { directoryPath: "/ontology/assets/actions", directoryName: "Actions" },
    } as never,
  });
  pendingOps.get(ACTION)!.shift()!({ status: "ready", value: {} as never });
  pendingObjects.get(`${ACTION}:ref`)!.shift()!({ status: "ready", value: rowsAnswer() as never });
  await nextTick();

  // Switch target from A (`ACTION`) to B (`USER`) while panel is active: stale ready state and outputs clear immediately.
  instance.state.set("selectedTypeRef", { className: ONTOLOGY_TYPE, primaryKey: USER });
  instance.state.set("selectedType", USER);

  expect(headerRecord.value.status).toBe("loading");
  expect(objectsData.value.status).toBe("loading");

  await vi.waitFor(() => {
    expect(instance.outputs.header?.directoryPath ?? null).toBeNull();
    expect(instance.outputs.header?.directoryName ?? null).toBeNull();
    expect(pendingRecords.get(USER)?.length).toBe(1);
    expect(pendingOps.get(USER)?.length).toBe(1);
    expect(pendingObjects.get(`${USER}:ref`)?.length).toBe(1);
  });

  // Resolving target B restores ready state and publishes B's outputs.
  pendingRecords.get(USER)!.shift()!({
    status: "ready",
    value: {
      primaryKey: USER,
      label: "User",
      fields: {},
      outputs: { directoryPath: "/settings/users", directoryName: "Users" },
    } as never,
  });
  pendingOps.get(USER)!.shift()!({ status: "ready", value: {} as never });
  pendingObjects.get(`${USER}:ref`)!.shift()!({ status: "ready", value: rowsAnswer() as never });

  await vi.waitFor(() => {
    expect(headerRecord.value.status).toBe("ready");
    expect(instance.outputs.header?.directoryPath).toBe("/settings/users");
    expect(instance.outputs.header?.directoryName).toBe("Users");
  });

  // Clearing target transitions immediately to awaiting and clears outputs.
  instance.state.set("selectedTypeRef", null);
  expect(headerRecord.value.status).toBe("awaiting");
  await vi.waitFor(() => {
    expect(instance.outputs.header?.directoryPath ?? null).toBeNull();
    expect(instance.outputs.header?.directoryName ?? null).toBeNull();
  });

  scope.stop();
});
