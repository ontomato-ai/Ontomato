import { effectScope, nextTick, ref } from "vue";
import { expect, it, vi } from "vitest";
import { definePanel, type DirectPanelManifest } from "@ontomato/contracts/panel-manifest";
import { BUSINESS_KNOWLEDGE, TRIGGER } from "@ontomato/contracts/platform-object-types";
import type { ProductPanelReadResponse } from "@ontomato/contracts/panel-host";
import type { DirectProjection, ProductProjection } from "@ontomato/contracts/product-panels";
import { createDirectPanelInstance, type PanelMemberReadRequest } from "../../../../../packages/apps-sdk/src/panel/direct";
import { frameMemberData } from "../../../../../packages/apps-sdk/src/panel/frame-member";
import { createPanelInstance } from "../../../../../packages/apps-sdk/src/panel/instance";
import { createPanelText } from "../../../../../packages/apps-sdk/src/panel/text";
import { noOperations } from "./panel-frame";

/*
 * Platform data-layer previous-result contract (`direct.ts` and `frame-member.ts`):
 * - Re-reading the same target when a subsequent read fails exposes `status: "error"` with `retry` and `previous`
 *   carrying the last `ready` answer (including `rowOperations`), so list components can preserve rows without caching.
 * - Retrying from `error` keeps `previous` on `status: "loading"` while in flight, and keeps it if retry fails again.
 * - Switching targets, receiving `forbidden`, or receiving `empty` clears `previous` immediately so unauthorized or
 *   cross-target stale data is never exposed.
 */

const meta = {
  domainId: "d",
  ownerId: "o",
  revision: 1,
  createdAt: "",
  updatedAt: "",
  editable: false,
  visibility: "domain" as const,
  description: "",
};

const task = (primaryKey: string) => ({ className: TRIGGER, primaryKey });

function createDeferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const field = (path: string, label: string) => ({
  path,
  label,
  control: { kind: "text" as const },
  valueSchema: {},
  required: false,
  readOnly: false,
});

const taskForm = (name: string) => ({
  fields: [field("/name", "Name")],
  values: { name },
  errors: [],
  revision: 1,
  save: { method: "PUT" as const, path: "/tasks/:id", bodySchema: {} },
});

it("preserves previous ready answer on same-target reread error & retry, and clears it on target switch, forbidden, or empty (direct.ts)", async () => {
  const projection: DirectProjection = {
    ...meta,
    id: "task-form",
    name: "Task form",
    componentId: "@ontomato/sdk:ObjectForm",
    inputs: { task: { kind: "object", objectType: TRIGGER } },
    outputs: {},
    config: {},
    data: {
      form: {
        source: { object: { input: "task" } },
        read: "form",
        params: {},
      },
    },
  };
  const manifest: DirectPanelManifest = {
    state: {
      selectedTask: { type: { kind: "object", objectType: TRIGGER }, personal: false, deepLink: false, external: false },
    },
    members: {
      detail: {
        target: { projectionId: projection.id },
        inputs: { task: { state: "selectedTask" } },
      },
    },
  };

  const firstFormValue = taskForm("Task 1");
  let nextAnswer: (request: PanelMemberReadRequest) => ProductPanelReadResponse | Promise<ProductPanelReadResponse> = () => ({
    status: "ready",
    value: firstFormValue,
    rowOperations: { "t-1": { run: { available: true } } },
  });

  const instance = createDirectPanelInstance(manifest, {
    readComponentPackage: noOperations.readComponentPackage,
    pageKey: "tasks",
    url: () => "/tasks",
    label: () => "Tasks",
    initial: { selectedTask: task("t-1") },
    text: createPanelText({}, ref("en"), "en"),
    operations: noOperations.operations,
    expandPageComposer: noOperations.expandPageComposer,
    navigate: noOperations.navigate,
    nested: noOperations.nested,
    confirmOperation: async () => ({ decision: "cancel" }),
    readProjection: async () => projection,
    read: async (request) => nextAnswer(request),
  });

  const placed = await instance.placing("detail");
  if (placed.kind !== "projection") throw new Error("expected projection placement");
  const member = placed.context;
  const scope = effectScope();
  const state = scope.run(() => member.data.use("form"))!;

  try {
    // 1. Initial load succeeds
    await vi.waitFor(() => expect(state.value.status).toBe("ready"));
    const firstReady = {
      status: "ready" as const,
      value: firstFormValue,
      rowOperations: { "t-1": { run: { available: true } } },
    };
    expect(state.value).toEqual(firstReady);

    // 2. Same-target reread fails: status is error with `previous` carrying the last ready snapshot + retry
    const failDeferred = createDeferred<ProductPanelReadResponse>();
    nextAnswer = () => failDeferred.promise;
    member.data.refresh?.("form");
    expect(state.value).toEqual({ ...firstReady, refreshing: true });

    failDeferred.resolve({ status: "error", message: "Backend timeout", code: "TIMEOUT" });
    await vi.waitFor(() => expect(state.value.status).toBe("error"));
    expect(state.value.status).toBe("error");
    if (state.value.status !== "error") throw new Error("expected error");
    expect(state.value.message).toBe("Backend timeout");
    expect(state.value.code).toBe("TIMEOUT");
    expect(state.value.previous).toEqual(firstReady);
    expect(typeof state.value.retry).toBe("function");

    // 3. Clicking retry keeps `previous` on `loading` while in flight; failing again still keeps `previous`
    const retryDeferred = createDeferred<ProductPanelReadResponse>();
    nextAnswer = () => retryDeferred.promise;
    state.value.retry!();
    expect(state.value).toEqual({ status: "loading", previous: firstReady });

    retryDeferred.resolve({ status: "error", message: "Still unreachable" });
    await vi.waitFor(() => expect(state.value.status === "error" && state.value.message === "Still unreachable").toBe(true));
    if (state.value.status !== "error") throw new Error("expected error");
    expect(state.value.previous).toEqual(firstReady);

    // 4. Retrying and receiving `forbidden` clears `previous` immediately; a subsequent error has no `previous`
    nextAnswer = () => ({ status: "forbidden", reason: "No access" });
    state.value.retry!();
    await vi.waitFor(() => expect(state.value.status).toBe("forbidden"));
    nextAnswer = () => ({ status: "error", message: "Network down" });
    member.data.refresh?.("form");
    await vi.waitFor(() => expect(state.value.status).toBe("error"));
    if (state.value.status !== "error") throw new Error("expected error");
    expect(state.value.previous).toBeUndefined();

    // 5. Recover to ready, then receive `empty`: clears `previous` so a later error has no `previous`
    const secondReady = { status: "ready" as const, value: taskForm("Task 1 v2") };
    nextAnswer = () => secondReady;
    member.data.refresh?.("form");
    await vi.waitFor(() => expect(state.value).toEqual(secondReady));

    nextAnswer = () => ({ status: "empty" });
    member.data.refresh?.("form");
    await vi.waitFor(() => expect(state.value.status).toBe("empty"));

    nextAnswer = () => ({ status: "error", message: "After empty failure" });
    member.data.refresh?.("form");
    await vi.waitFor(() => expect(state.value.status).toBe("error"));
    if (state.value.status !== "error") throw new Error("expected error");
    expect(state.value.previous).toBeUndefined();

    // 6. Recover to ready on t-1, then switch target to t-2 while in error: clears `previous` immediately and on new error
    nextAnswer = () => secondReady;
    member.data.refresh?.("form");
    await vi.waitFor(() => expect(state.value).toEqual(secondReady));

    nextAnswer = () => ({ status: "error", message: "t-1 temporary error" });
    member.data.refresh?.("form");
    await vi.waitFor(() => expect(state.value.status === "error" && state.value.previous !== undefined).toBe(true));

    const t2Deferred = createDeferred<ProductPanelReadResponse>();
    nextAnswer = () => t2Deferred.promise;
    instance.state.set("selectedTask", task("t-2"));
    // Immediately stripped before t-2 resolves
    expect(state.value).toEqual({ status: "loading" });
    await nextTick();
    expect(state.value).toEqual({ status: "loading" });

    t2Deferred.resolve({ status: "error", message: "t-2 failed" });
    await vi.waitFor(() => expect(state.value.status).toBe("error"));
    if (state.value.status !== "error") throw new Error("expected error");
    expect(state.value.message).toBe("t-2 failed");
    expect(state.value.previous).toBeUndefined();
  } finally {
    scope.stop();
  }
});

it("preserves previous ready answer on same-target reread failure & retry and clears on forbidden/empty (frame-member.ts)", async () => {
  const projection: ProductProjection = {
    ...meta,
    id: "knowledge-list",
    name: "Knowledge",
    componentId: "@ontomato/sdk:ObjectList",
    inputs: { status: { kind: "scalar", type: "string" } },
    outputs: {},
    config: {},
    data: {
      rows: {
        source: { type: { kind: "PlatformObjectType", id: BUSINESS_KNOWLEDGE } },
        read: "query",
        params: { status: { input: "status" } },
      },
    },
  };
  const panel = definePanel({
    state: { status: { type: { kind: "scalar", type: "string" } } },
    members: {
      list: {
        target: { projectionId: projection.id },
        inputs: { status: { state: "status" } },
      },
    },
  });
  const instance = createPanelInstance(panel, {
    text: (key) => key,
    pageKey: "knowledge",
    url: () => "/knowledge",
    label: () => "Knowledge",
    initial: { status: "pending" },
    ...noOperations,
    readProjection: async () => {
      throw new Error("unused");
    },
  });

  const statusInput = ref("pending");
  const initialRows = { rows: [{ primaryKey: "k-1", label: "Night cutoff", fields: {} }], total: 1 };
  let readImpl: () => Promise<ProductPanelReadResponse> = async () => ({ status: "ready", value: initialRows });

  const data = frameMemberData(projection, "list", instance, () => ({ status: statusInput.value }), () => readImpl());
  const scope = effectScope();
  const state = scope.run(() => data.use("rows"))!;

  try {
    await vi.waitFor(() => expect(state.value.status).toBe("ready"));
    expect(state.value).toEqual({ status: "ready", value: initialRows });

    // Rejected promise on same-target reread preserves `previous` and provides `retry`
    readImpl = async () => {
      throw Object.assign(new Error("Gateway timeout"), { code: "GATEWAY_TIMEOUT" });
    };
    statusInput.value = "approved";
    await vi.waitFor(() => expect(state.value.status).toBe("error"));
    if (state.value.status !== "error") throw new Error("expected error");
    expect(state.value.message).toBe("Gateway timeout");
    expect(state.value.code).toBe("GATEWAY_TIMEOUT");
    expect(state.value.previous).toEqual({ status: "ready", value: initialRows });
    expect(typeof state.value.retry).toBe("function");

    // Retry while loading keeps `previous`, and `forbidden` clears it
    const retryDeferred = createDeferred<ProductPanelReadResponse>();
    readImpl = () => retryDeferred.promise;
    state.value.retry!();
    expect(state.value).toEqual({ status: "loading", previous: { status: "ready", value: initialRows } });

    retryDeferred.resolve({ status: "forbidden", reason: "Denied" });
    await vi.waitFor(() => expect(state.value.status).toBe("forbidden"));

    readImpl = async () => ({ status: "error", message: "After forbidden" });
    statusInput.value = "rejected";
    await vi.waitFor(() => expect(state.value.status).toBe("error"));
    if (state.value.status !== "error") throw new Error("expected error");
    expect(state.value.previous).toBeUndefined();
  } finally {
    scope.stop();
  }
});
