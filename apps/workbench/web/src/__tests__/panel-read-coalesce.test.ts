import { expect, it } from "vitest";
import { effectScope, nextTick, ref, type ComputedRef } from "vue";
import { definePanel, type DirectPanelManifest } from "@ontomato/contracts/panel-manifest";
import {
  BUSINESS_KNOWLEDGE,
  DASHBOARD_CARD,
  OBJECT_TYPE,
} from "@ontomato/contracts/platform-object-types";
import type { DirectProjection } from "@ontomato/contracts/product-panels";
import type { ProductPanelReadResponse } from "@ontomato/contracts/panel-host";
import {
  createDirectPanelInstance,
  type MemberDataState,
  type MemberInputs,
  type PanelMemberReadRequest,
} from "../../../../../packages/apps-sdk/src/panel/direct";
import { slotInputValues } from "../../../../../packages/apps-sdk/src/panel/ports";
import { createPanelText } from "../../../../../packages/apps-sdk/src/panel/text";
import { noOperations } from "./panel-frame";

const recordMeta = {
  domainId: "d",
  ownerId: "o",
  revision: 1,
  createdAt: "",
  updatedAt: "",
  editable: false,
  visibility: "domain" as const,
  description: "",
};

function flush(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const ready = (value: unknown): ProductPanelReadResponse => ({ status: "ready", value: value as never });

const objectTypeListProjection = (id: string, componentId: string): DirectProjection => ({
  ...recordMeta,
  id,
  name: id,
  componentId,
  inputs: {},
  outputs: {},
  config: {},
  data: {
    rows: { source: { type: { kind: "PlatformObjectType", id: OBJECT_TYPE } }, read: "list", params: {} },
  },
});

const objectTypeRecordProjection = (id: string, componentId: string): DirectProjection => ({
  ...recordMeta,
  id,
  name: id,
  componentId,
  inputs: { object: { kind: "object", objectType: OBJECT_TYPE } },
  outputs: {},
  config: {},
  data: {
    record: { source: { object: { input: "object" } }, read: "record", params: {} },
  },
});

const knowledgeQueryProjection = (id: string): DirectProjection => ({
  ...recordMeta,
  id,
  name: id,
  componentId: "@ontomato/sdk:ObjectList",
  inputs: { search: { kind: "scalar", type: "string" } },
  outputs: {},
  config: {},
  data: {
    rows: {
      source: { type: { kind: "PlatformObjectType", id: BUSINESS_KNOWLEDGE } },
      read: "query",
      params: { search: { input: "search" } },
    },
  },
});

const knowledgeRecordProjection = (id: string, withSearchParam = false): DirectProjection => ({
  ...recordMeta,
  id,
  name: id,
  componentId: "@ontomato/sdk:ObjectSummary",
  inputs: {
    object: { kind: "object", objectType: BUSINESS_KNOWLEDGE },
    ...(withSearchParam ? { search: { kind: "scalar", type: "string" } } : {}),
  },
  outputs: {},
  config: {},
  data: {
    record: {
      source: { object: { input: "object" } },
      read: "record",
      params: withSearchParam ? { search: { input: "search" } } : {},
    },
  },
});

const dashboardCardProjection = (id: string, revision = 1): DirectProjection => ({
  ...recordMeta,
  id,
  revision,
  name: id,
  componentId: "@ontomato/sdk:MetricChart",
  inputs: {},
  outputs: {},
  config: {},
  data: {
    chart: {
      source: { object: { literal: { className: DASHBOARD_CARD, primaryKey: "card-1" } } },
      read: "chartTemplate",
      params: {},
    },
  },
});

function createTestInstance(
  manifest: DirectPanelManifest,
  projections: Record<string, DirectProjection>,
  read: (request: PanelMemberReadRequest) => Promise<ProductPanelReadResponse>,
  initial: Record<string, unknown> = {},
) {
  return createDirectPanelInstance(manifest, {
    pageKey: "ontology-graph",
    url: () => "/ontology/graph",
    label: () => "Ontology graph",
    initial: initial as never,
    text: createPanelText({}, ref("en"), "en"),
    ...noOperations,
    recordDraftCreated: async () => {},
    readProjection: async (id) => {
      const found = projections[id];
      if (!found) throw new Error(`Unknown projection ${id}`);
      return found;
    },
    read,
  });
}

it("coalesces concurrent identical type list reads across members of one panel instance and isolates across instances", async () => {
  const graph = objectTypeListProjection("graph", "@ontomato/sdk:ObjectGraph");
  const list = objectTypeListProjection("list", "@ontomato/sdk:ObjectList");
  const count = objectTypeListProjection("count", "@ontomato/sdk:ObjectCount");
  const manifest = definePanel({
    state: {},
    members: {
      graph: { target: { projectionId: graph.id } },
      list: { target: { projectionId: list.id } },
      count: { target: { projectionId: count.id } },
    },
    commands: {},
  });

  const readsA: PanelMemberReadRequest[] = [];
  const gateA = deferred<ProductPanelReadResponse>();
  const instanceA = createTestInstance(manifest, { graph, list, count }, async (req) => {
    readsA.push(req);
    return gateA.promise;
  });

  const readsB: PanelMemberReadRequest[] = [];
  const instanceB = createTestInstance(manifest, { graph, list, count }, async (req) => {
    readsB.push(req);
    return ready([{ primaryKey: "Order", label: "Order", fields: {} }]);
  });

  const scope = effectScope();
  let graphRows!: ComputedRef<MemberDataState>;
  let listRows!: ComputedRef<MemberDataState>;
  let countRows!: ComputedRef<MemberDataState>;
  let otherRows!: ComputedRef<MemberDataState>;

  scope.run(() => {
    graphRows = instanceA.memberData("graph", graph, () => ({})).use("rows");
    listRows = instanceA.memberData("list", list, () => ({})).use("rows");
    countRows = instanceA.memberData("count", count, () => ({})).use("rows");
    otherRows = instanceB.memberData("list", list, () => ({})).use("rows");
  });

  expect(readsA).toHaveLength(1);
  expect(readsB).toHaveLength(1);
  expect(graphRows.value.status).toBe("loading");
  expect(listRows.value.status).toBe("loading");
  expect(countRows.value.status).toBe("loading");

  const payload = [{ primaryKey: "Customer", label: "Customer", fields: {} }];
  gateA.resolve(ready(payload));
  await flush();

  expect(graphRows.value).toEqual({ status: "ready", value: payload });
  expect(listRows.value).toEqual({ status: "ready", value: payload });
  expect(countRows.value).toEqual({ status: "ready", value: payload });
  expect(otherRows.value).toEqual({ status: "ready", value: [{ primaryKey: "Order", label: "Order", fields: {} }] });

  scope.stop();
});

it("coalesces concurrent record reads across ObjectHeader and ObjectSummary on selection change", async () => {
  const header = objectTypeRecordProjection("header", "@ontomato/sdk:ObjectHeader");
  const summary = objectTypeRecordProjection("summary", "@ontomato/sdk:ObjectSummary");
  const manifest = definePanel({
    state: { selected: { type: { kind: "object", objectType: OBJECT_TYPE } } },
    members: {
      header: { target: { projectionId: header.id }, inputs: { object: { state: "selected" } } },
      summary: { target: { projectionId: summary.id }, inputs: { object: { state: "selected" } } },
    },
    commands: {},
  });

  const reads: PanelMemberReadRequest[] = [];
  const gate = deferred<ProductPanelReadResponse>();
  const instance = createTestInstance(manifest, { header, summary }, async (req) => {
    reads.push(req);
    return gate.promise;
  });

  const inputsOf = (member: string) => () => slotInputValues(manifest, member, instance.state.values.value) as MemberInputs;
  const scope = effectScope();
  let headerRecord!: ComputedRef<MemberDataState>;
  let summaryRecord!: ComputedRef<MemberDataState>;

  scope.run(() => {
    headerRecord = instance.memberData("header", header, inputsOf("header")).use("record");
    summaryRecord = instance.memberData("summary", summary, inputsOf("summary")).use("record");
  });
  await flush();
  expect(reads).toHaveLength(0);
  expect(headerRecord.value.status).toBe("awaiting");
  expect(summaryRecord.value.status).toBe("awaiting");

  instance.state.set("selected", { className: OBJECT_TYPE, primaryKey: "Customer" });
  await nextTick();

  expect(reads).toHaveLength(1);
  gate.resolve(ready({ primaryKey: "Customer", label: "Customer", fields: { layer: "entity" } }));
  await flush();

  expect(headerRecord.value).toEqual({
    status: "ready",
    value: { primaryKey: "Customer", label: "Customer", fields: { layer: "entity" } },
  });
  expect(summaryRecord.value).toEqual(headerRecord.value);

  scope.stop();
});

it("reuses a fresh on-screen result for staggered mounts and stops reusing after unmount or panel deactivation", async () => {
  const list = objectTypeListProjection("list", "@ontomato/sdk:ObjectList");
  const graph = objectTypeListProjection("graph", "@ontomato/sdk:ObjectGraph");
  const manifest = definePanel({
    state: {},
    members: {
      list: { target: { projectionId: list.id } },
      graph: { target: { projectionId: graph.id } },
    },
    commands: {},
  });

  let version = 0;
  const reads: PanelMemberReadRequest[] = [];
  const instance = createTestInstance(manifest, { list, graph }, async (req) => {
    reads.push(req);
    version += 1;
    return ready([{ primaryKey: `c-${version}`, label: `Class ${version}`, fields: {} }]);
  });

  const scopeA = effectScope();
  let listRows!: ComputedRef<MemberDataState>;
  scopeA.run(() => {
    listRows = instance.memberData("list", list, () => ({})).use("rows");
  });
  await flush();
  expect(reads).toHaveLength(1);
  expect(listRows.value).toEqual({ status: "ready", value: [{ primaryKey: "c-1", label: "Class 1", fields: {} }] });

  // Staggered mount while member A is still on screen: reuses A's fresh result with no second read.
  const scopeB = effectScope();
  let graphRows!: ComputedRef<MemberDataState>;
  scopeB.run(() => {
    graphRows = instance.memberData("graph", graph, () => ({})).use("rows");
  });
  expect(reads).toHaveLength(1);
  expect(graphRows.value).toEqual(listRows.value);

  // Unmount both holders -> next mount must fetch fresh from the server.
  scopeA.stop();
  scopeB.stop();

  const scopeC = effectScope();
  let listRowsAgain!: ComputedRef<MemberDataState>;
  scopeC.run(() => {
    listRowsAgain = instance.memberData("list", list, () => ({})).use("rows");
  });
  await flush();
  expect(reads).toHaveLength(2);
  expect(listRowsAgain.value).toEqual({ status: "ready", value: [{ primaryKey: "c-2", label: "Class 2", fields: {} }] });

  // Deactivating the panel invalidates fresh on-screen snapshots so reactivating + mounting fetches anew.
  instance.setActive(false);
  instance.setActive(true);
  const scopeD = effectScope();
  let graphRowsAfterHide!: ComputedRef<MemberDataState>;
  scopeD.run(() => {
    graphRowsAfterHide = instance.memberData("graph", graph, () => ({})).use("rows");
  });
  await flush();
  expect(reads).toHaveLength(3);
  expect(graphRowsAfterHide.value).toEqual({ status: "ready", value: [{ primaryKey: "c-3", label: "Class 3", fields: {} }] });

  scopeC.stop();
  scopeD.stop();
});

it("evicts pre-write in-flight reads on refresh(affected) and refreshObjects(), coalescing affected members onto one post-write request", async () => {
  const list = objectTypeListProjection("list", "@ontomato/sdk:ObjectList");
  const count = objectTypeListProjection("count", "@ontomato/sdk:ObjectCount");
  const manifest = definePanel({
    state: {},
    members: {
      list: { target: { projectionId: list.id } },
      count: { target: { projectionId: count.id } },
    },
    commands: {},
  });

  const gates: ReturnType<typeof deferred<ProductPanelReadResponse>>[] = [];
  const instance = createTestInstance(manifest, { list, count }, async () => {
    const gate = deferred<ProductPanelReadResponse>();
    gates.push(gate);
    return gate.promise;
  });

  const scope = effectScope();
  let listRows!: ComputedRef<MemberDataState>;
  let countRows!: ComputedRef<MemberDataState>;
  scope.run(() => {
    listRows = instance.memberData("list", list, () => ({})).use("rows");
    countRows = instance.memberData("count", count, () => ({})).use("rows");
  });
  expect(gates).toHaveLength(1);

  // Trigger refresh(affected) while the pre-write read is still in flight.
  instance.refresh({ objects: [], objectTypes: [OBJECT_TYPE] });
  expect(gates).toHaveLength(2);

  // Resolve the post-write read first, then let the stale pre-write read resolve late.
  const postWrite = [{ primaryKey: "Order", label: "Order v2", fields: {} }];
  gates[1]!.resolve(ready(postWrite));
  await flush();
  gates[0]!.resolve(ready([{ primaryKey: "Order", label: "Order v1", fields: {} }]));
  await flush();

  expect(listRows.value).toEqual({ status: "ready", value: postWrite });
  expect(countRows.value).toEqual({ status: "ready", value: postWrite });

  // refreshObjects() also evicts in-flight/fresh state and coalesces all members onto 1 new read.
  instance.refreshObjects();
  expect(gates).toHaveLength(3);
  const afterGlobalRefresh = [{ primaryKey: "Order", label: "Order v3", fields: {} }];
  gates[2]!.resolve(ready(afterGlobalRefresh));
  await flush();

  expect(listRows.value).toEqual({ status: "ready", value: afterGlobalRefresh });
  expect(countRows.value).toEqual({ status: "ready", value: afterGlobalRefresh });

  scope.stop();
});

it("never caches error or forbidden results and forces a fresh request on retry()", async () => {
  const list = objectTypeListProjection("list", "@ontomato/sdk:ObjectList");
  const count = objectTypeListProjection("count", "@ontomato/sdk:ObjectCount");
  const manifest = definePanel({
    state: {},
    members: {
      list: { target: { projectionId: list.id } },
      count: { target: { projectionId: count.id } },
    },
    commands: {},
  });

  const responses: ProductPanelReadResponse[] = [
    { status: "error", message: "Backend timeout" },
    { status: "forbidden", reason: "Denied" },
    ready([{ primaryKey: "Customer", label: "Customer", fields: {} }]),
  ];
  let calls = 0;
  const instance = createTestInstance(manifest, { list, count }, async () => {
    const next = responses[calls] ?? ready([]);
    calls += 1;
    return next;
  });

  const scopeA = effectScope();
  let listRows!: ComputedRef<MemberDataState>;
  scopeA.run(() => {
    listRows = instance.memberData("list", list, () => ({})).use("rows");
  });
  await flush();
  expect(calls).toBe(1);
  expect(listRows.value.status).toBe("error");

  // Error must not be reused by a later mount.
  const scopeB = effectScope();
  let countRows!: ComputedRef<MemberDataState>;
  scopeB.run(() => {
    countRows = instance.memberData("count", count, () => ({})).use("rows");
  });
  await flush();
  expect(calls).toBe(2);
  expect(countRows.value).toEqual({ status: "forbidden", reason: "Denied" });

  // Clicking retry() on member A issues a fresh read instead of reusing forbidden/error.
  if (listRows.value.status !== "error" || !listRows.value.retry) throw new Error("Expected error state with retry");
  listRows.value.retry();
  await flush();
  expect(calls).toBe(3);
  expect(listRows.value).toEqual({ status: "ready", value: [{ primaryKey: "Customer", label: "Customer", fields: {} }] });

  scopeA.stop();
  scopeB.stop();
});

it("distinguishes different parameters and projection-scoped dashboard cards, and keeps imperative read() fresh", async () => {
  const listA = knowledgeQueryProjection("listA");
  const listB = knowledgeQueryProjection("listB");
  const cardA = dashboardCardProjection("cardA", 1);
  const cardB = dashboardCardProjection("cardB", 1);
  const manifest = definePanel({
    state: {
      qA: { type: { kind: "scalar", type: "string" } },
      qB: { type: { kind: "scalar", type: "string" } },
    },
    members: {
      listA: { target: { projectionId: listA.id }, inputs: { search: { state: "qA" } } },
      listB: { target: { projectionId: listB.id }, inputs: { search: { state: "qB" } } },
      cardA: { target: { projectionId: cardA.id } },
      cardB: { target: { projectionId: cardB.id } },
    },
    commands: {},
  });

  const reads: PanelMemberReadRequest[] = [];
  const instance = createTestInstance(
    manifest,
    { listA, listB, cardA, cardB },
    async (req) => {
      reads.push(req);
      const member = req.memberPath[0]!.member;
      if (member === "cardA" || member === "cardB") {
        return ready({
          cardId: "card-1",
          metricId: member,
          chartType: "bar",
          spec: { chartType: "bar", title: member },
        });
      }
      return ready({ rows: [] });
    },
    { qA: "alpha", qB: "beta" },
  );

  const inputsOf = (member: string) => () => slotInputValues(manifest, member, instance.state.values.value) as MemberInputs;
  const scope = effectScope();
  scope.run(() => {
    instance.memberData("listA", listA, inputsOf("listA")).use("rows");
    instance.memberData("listB", listB, inputsOf("listB")).use("rows");
    instance.memberData("cardA", cardA, inputsOf("cardA")).use("chart");
    instance.memberData("cardB", cardB, inputsOf("cardB")).use("chart");
  });
  await flush();

  // Different search params -> 2 reads; different DASHBOARD_CARD projections -> 2 reads.
  expect(reads).toHaveLength(4);

  // Imperative memberData.read() does not read from on-screen fresh cache when no request is in flight,
  // while two concurrent imperative reads with the same key still coalesce into 1 request.
  await Promise.all([
    instance.memberData("listA", listA, inputsOf("listA")).read("rows", {}),
    instance.memberData("listA", listA, inputsOf("listA")).read("rows", {}),
  ]);
  expect(reads).toHaveLength(5);

  // Null/undefined parameter values are stripped identically to the server's readParameters normalization.
  instance.state.set("qA", null);
  instance.state.set("qB", null);
  await flush();
  expect(reads).toHaveLength(6);

  scope.stop();
});

it("prefills parameterless panelRecord reads from panelRecordList and overwrites cleanly on error", async () => {
  const list = objectTypeListProjection("list", "@ontomato/sdk:ObjectList");
  const summary = objectTypeRecordProjection("summary", "@ontomato/sdk:ObjectSummary");
  const manifest = definePanel({
    state: { selected: { type: { kind: "object", objectType: OBJECT_TYPE } } },
    members: {
      list: { target: { projectionId: list.id } },
      summary: { target: { projectionId: summary.id }, inputs: { object: { state: "selected" } } },
    },
    commands: {},
  });

  const recordGate = deferred<ProductPanelReadResponse>();
  const instance = createTestInstance(manifest, { list, summary }, async (req) => {
    if (req.dataName === "rows") {
      return ready([
        { primaryKey: "Customer", label: "Customer", fields: { layer: "entity" } },
      ]);
    }
    return recordGate.promise;
  });

  const inputsOf = (member: string) => () => slotInputValues(manifest, member, instance.state.values.value) as MemberInputs;
  const scope = effectScope();
  let summaryRecord!: ComputedRef<MemberDataState>;
  scope.run(() => {
    instance.memberData("list", list, inputsOf("list")).use("rows");
    summaryRecord = instance.memberData("summary", summary, inputsOf("summary")).use("record");
  });
  await flush();

  instance.state.set("selected", { className: OBJECT_TYPE, primaryKey: "Customer" });
  await nextTick();
  expect(summaryRecord.value).toEqual({
    status: "ready",
    value: { primaryKey: "Customer", label: "Customer", fields: { layer: "entity" } },
  });

  recordGate.resolve({ status: "error", message: "Upstream unavailable" });
  await flush();
  expect(summaryRecord.value.status).toBe("error");
  if (summaryRecord.value.status === "error") {
    expect(summaryRecord.value.message).toBe("Upstream unavailable");
  }

  scope.stop();
});

it("prefills parameterless panelRecord reads synchronously from fresh on-screen list/query rows (stripping highlights), overwrites with authoritative answer, and never prefills stale rows after refresh", async () => {
  const list = knowledgeQueryProjection("list");
  const header = knowledgeRecordProjection("header", false);
  const summary = knowledgeRecordProjection("summary", false);
  const filteredRecord = knowledgeRecordProjection("filteredRecord", true);
  const manifest = definePanel({
    state: {
      selected: { type: { kind: "object", objectType: BUSINESS_KNOWLEDGE } },
      search: { type: { kind: "scalar", type: "string" } },
    },
    members: {
      list: { target: { projectionId: list.id }, inputs: { search: { state: "search" } } },
      header: { target: { projectionId: header.id }, inputs: { object: { state: "selected" } } },
      summary: { target: { projectionId: summary.id }, inputs: { object: { state: "selected" } } },
      filteredRecord: {
        target: { projectionId: filteredRecord.id },
        inputs: { object: { state: "selected" }, search: { state: "search" } },
      },
    },
    commands: {},
  });

  const recordGates: ReturnType<typeof deferred<ProductPanelReadResponse>>[] = [];
  const reads: PanelMemberReadRequest[] = [];
  let listVersion = 0;
  const instance = createTestInstance(
    manifest,
    { list, header, summary, filteredRecord },
    async (req) => {
      reads.push(req);
      if (req.dataName === "rows") {
        listVersion += 1;
        return ready({
          rows: [
            {
              primaryKey: "k-1",
              label: `Refund policy v${listVersion}`,
              subtitle: "Summary row",
              fields: { status: "active" },
              highlights: { label: [{ start: 0, end: 6 }] },
            },
            {
              primaryKey: "k-2",
              label: "Restricted item",
              fields: { status: "active" },
            },
          ],
        });
      }
      const gate = deferred<ProductPanelReadResponse>();
      recordGates.push(gate);
      return gate.promise;
    },
    { search: "Refund" },
  );

  const inputsOf = (member: string) => () => slotInputValues(manifest, member, instance.state.values.value) as MemberInputs;
  const scope = effectScope();
  let headerRecord!: ComputedRef<MemberDataState>;
  let summaryRecord!: ComputedRef<MemberDataState>;
  let filteredState!: ComputedRef<MemberDataState>;

  scope.run(() => {
    instance.memberData("list", list, inputsOf("list")).use("rows");
    headerRecord = instance.memberData("header", header, inputsOf("header")).use("record");
    summaryRecord = instance.memberData("summary", summary, inputsOf("summary")).use("record");
    filteredState = instance.memberData("filteredRecord", filteredRecord, inputsOf("filteredRecord")).use("record");
  });
  await flush();
  expect(reads.map((r) => r.dataName)).toEqual(["rows"]);

  // Select k-1: header and summary immediately prefill without highlights, and share 1 authoritative record read.
  // filteredRecord has a non-empty `search` parameter, so it does NOT prefill and issues its own parameterized read.
  instance.state.set("selected", { className: BUSINESS_KNOWLEDGE, primaryKey: "k-1" });
  await nextTick();

  expect(headerRecord.value).toEqual({
    status: "ready",
    value: {
      primaryKey: "k-1",
      label: "Refund policy v1",
      subtitle: "Summary row",
      fields: { status: "active" },
    },
  });
  expect(summaryRecord.value).toEqual(headerRecord.value);
  expect(filteredState.value.status).toBe("loading");
  expect(recordGates).toHaveLength(2);

  // Authoritative record resolves with additional fields and overwrites the prefill.
  const fullK1 = {
    primaryKey: "k-1",
    label: "Refund policy v1",
    subtitle: "Summary row",
    fields: { status: "active", body: "Full detail content" },
  };
  recordGates[0]!.resolve(ready(fullK1));
  recordGates[1]!.resolve(ready(fullK1));
  await flush();
  expect(headerRecord.value).toEqual({ status: "ready", value: fullK1 });
  expect(summaryRecord.value).toEqual({ status: "ready", value: fullK1 });

  // Select k-2: prefills from list, then server returns forbidden -> overwrites prefill cleanly.
  instance.state.set("selected", { className: BUSINESS_KNOWLEDGE, primaryKey: "k-2" });
  await nextTick();
  expect(headerRecord.value).toEqual({
    status: "ready",
    value: { primaryKey: "k-2", label: "Restricted item", fields: { status: "active" } },
  });
  recordGates[2]!.resolve({ status: "forbidden", reason: "No access to k-2" });
  recordGates[3]!.resolve({ status: "forbidden", reason: "No access to k-2" });
  await flush();
  expect(headerRecord.value).toEqual({ status: "forbidden", reason: "No access to k-2" });
  expect(summaryRecord.value).toEqual({ status: "forbidden", reason: "No access to k-2" });

  // After refresh invalidates the type list (while list has not refreshed yet), selecting k-1 must NOT prefill stale v1.
  instance.refresh({ objects: [{ objectType: BUSINESS_KNOWLEDGE, primaryKey: "k-1" }], objectTypes: [] });
  instance.state.set("selected", { className: BUSINESS_KNOWLEDGE, primaryKey: "k-1" });
  await nextTick();
  expect(headerRecord.value.status).toBe("loading");
  expect(summaryRecord.value.status).toBe("loading");

  scope.stop();
});
