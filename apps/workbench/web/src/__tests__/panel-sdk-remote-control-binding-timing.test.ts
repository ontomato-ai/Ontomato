import { afterEach, describe, expect, it, vi } from "vitest";
import { createApp, computed, h, nextTick, ref } from "vue";
import { createI18n } from "vue-i18n";
import ElementPlus from "element-plus";
import publicEn from "@ontomato/workbench-ui/locales/en";
import type { DirectPanelManifest } from "@ontomato/contracts/panel-manifest";
import type { DirectProjection } from "@ontomato/contracts/product-panels";
import type { ProductPanelReadResponse } from "@ontomato/contracts/panel-host";
import type { PanelFormDescription } from "@ontomato/contracts/panel-projection";
import type { PanelHumanOperationPreparation } from "@ontomato/contracts/panel-agent";
import type { PanelOwnerOperationDescriptor } from "@ontomato/contracts/panel-operations";
import { SCHEDULED_TASK } from "@ontomato/contracts/panel-client-requests";
import { APPLICATION } from "@ontomato/contracts/platform-object-types";
import { createDirectPanelInstance, type PanelReadPort } from "../../../../../packages/apps-sdk/src/panel/direct";
import PanelMember from "../../../../../packages/apps-sdk/src/panel/PanelMember.vue";
import { createPanelText } from "../../../../../packages/apps-sdk/src/panel/text";
import { noOperations } from "./panel-frame";

/*
 * Regression suite for remote-control binding, universal 4-tuple verification, full-auto pre-dispatch
 * verification, mixed-type list composite keys, and dirty form discard confirmation:
 * - Item 1.1: Expected member instance & target binding checks; nested member swap rejection.
 * - Item 1.2: Batch expectedCheckedKeys verification before preparing.
 * - Item 1.3: Mixed-type ObjectList composite `<className>:<primaryKey>` row keys and ambiguity rejection.
 * - Item 1.4: Single universal 4-tuple check across Form fixedFields, Row target/params, Button/Batch, Nested dispose.
 * - Item 1.6: Full-auto mode runs the same 4-tuple check after prepare and before dispatch, cancelling on mismatch.
 * - Item 2.4: `<form>.discard` on a dirty form requires conversation confirmation and preserves edits until confirmed.
 */

const AGENT_RUN = {
  sessionId: "11111111-1111-4111-8111-111111111111",
  runId: "22222222-2222-4222-8222-222222222222",
  toolCallId: "call-bind-1",
};

const baseRecord = {
  domainId: "d",
  ownerId: "o",
  revision: 1,
  createdAt: "",
  updatedAt: "",
  editable: false,
  visibility: "domain" as const,
  description: "",
};

const ready = (value: unknown): ProductPanelReadResponse => ({ status: "ready", value: value as never });

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function mountPanel(options: {
  manifest: DirectPanelManifest;
  projections: Record<string, DirectProjection>;
  initial?: Record<string, unknown>;
  read: PanelReadPort;
  prepare?: (
    operationId: string,
    invocation: unknown,
    memberPath?: unknown,
    agentRun?: unknown,
  ) => Promise<PanelHumanOperationPreparation>;
  requestLocalConfirmation?: (input: {
    readonly agentRun: typeof AGENT_RUN;
    readonly operationLabel: string;
    readonly targetLabel: string;
    readonly impactSummary?: string;
  }) => Promise<{ readonly intentId: string; readonly questionId: string; readonly label: string }>;
  autoMode?: boolean;
}) {
  let intentSeq = 0;
  const prepared: { intentId: string; operationId: string; invocation: unknown; agentRun: unknown }[] = [];
  const dispatched: { intentId: string; skipDialog?: boolean }[] = [];
  const cancelled: { intentId: string; reason: { code: string; message: string } }[] = [];

  const defaultPrepare = async (
    operationId: string,
    invocation: unknown,
    _memberPath?: unknown,
    agentRun?: unknown,
  ): Promise<PanelHumanOperationPreparation> => {
    intentSeq += 1;
    const intentId = `6f0c1a2e-6a0b-4f8e-9a51-0c6f3e2b1d0${intentSeq}`;
    prepared.push({ intentId, operationId, invocation, agentRun });
    const autoMode = options.autoMode ?? false;
    return {
      intentId,
      operationId,
      label: operationId,
      confirmation: { kind: "none" },
      autoMode,
      ...(autoMode ? {} : { questionId: `7f0c1a2e-6a0b-4f8e-9a51-0c6f3e2b1d0${intentSeq}` }),
    };
  };

  const prepare = vi.fn(options.prepare ?? defaultPrepare);
  const cancel = vi.fn(async (intentId: string, reason: { code: string; message: string }) => {
    cancelled.push({ intentId, reason });
  });
  const confirmOperation = vi.fn(async (
    preparation: PanelHumanOperationPreparation,
    hooks?: { onConfirmed?: () => void; skipDialog?: boolean },
  ) => {
    hooks?.onConfirmed?.();
    dispatched.push({ intentId: preparation.intentId, skipDialog: hooks?.skipDialog });
    return {
      decision: "confirm" as const,
      response: {
        kind: "dispatched" as const,
        intentId: preparation.intentId,
        outcome: { kind: "success" as const, data: {}, message: "Done" },
      },
    };
  });

  const instance = createDirectPanelInstance(options.manifest, {
    readComponentPackage: noOperations.readComponentPackage,
    pageKey: "sdk-binding-test",
    url: () => "/sdk-binding-test",
    label: () => "SDK binding test",
    initial: options.initial as never,
    text: createPanelText({}, ref("en"), "en"),
    operations: {
      ...noOperations.operations,
      prepare,
      cancel,
      ...(options.requestLocalConfirmation ? { requestLocalConfirmation: options.requestLocalConfirmation } : {}),
    },
    confirmOperation,
    readProjection: (id) => {
      const found = options.projections[id];
      return found ? Promise.resolve(found) : Promise.reject(new Error(`Unknown projection ${id}`));
    },
    read: options.read,
    expandPageComposer: () => {},
    navigate: async () => {},
    nested: () => Promise.reject(new Error("Unexpected nested mount")),
  });

  const element = document.createElement("div");
  document.body.appendChild(element);
  const i18n = createI18n({ legacy: false, locale: "en", messages: { en: publicEn } });
  const app = createApp({
    setup() {
      return () =>
        h("div", Object.keys(options.manifest.members).map((member) => h(PanelMember, { key: member, instance, member })));
    },
  });
  app.use(i18n).use(ElementPlus).mount(element);
  return {
    instance,
    element,
    prepared,
    dispatched,
    cancelled,
    prepare,
    cancel,
    confirmOperation,
    unmount() {
      instance.markDisposed();
      app.unmount();
      element.remove();
    },
  };
}

afterEach(() => {
  document.body.innerHTML = "";
});

describe("Item 1.2 & 1.6: Batch expectedCheckedKeys verification and full-auto pre-dispatch check", () => {
  const manifest: DirectPanelManifest = {
    state: {
      checked: {
        type: { kind: "list", items: { kind: "object", objectType: SCHEDULED_TASK } },
        personal: false,
        deepLink: false,
        external: false,
        default: [
          { className: SCHEDULED_TASK, primaryKey: "t-1" },
          { className: SCHEDULED_TASK, primaryKey: "t-2" },
        ],
      },
    },
    members: {
      toolbar: {
        target: { projectionId: "p-batch-btn" },
        inputs: { targets: { state: "checked" } },
      },
    },
  };

  const batchBtnProjection: DirectProjection = {
    ...baseRecord,
    id: "p-batch-btn",
    name: "Batch Delete",
    componentId: "@ontomato/sdk:OperationButton",
    inputs: { targets: { kind: "list", items: { kind: "object", objectType: SCHEDULED_TASK } } },
    outputs: {},
    data: {},
    operations: {
      batchDelete: { operation: { kind: "PlatformOperation", id: "tasks.delete" } },
    },
    config: { operation: "batchDelete" },
  };

  const batchDeleteDescriptor: PanelOwnerOperationDescriptor = {
    kind: "action",
    handlerRef: "tasks.delete",
    label: "Delete selected",
    effect: "write",
    batch: true,
    target: { source: "input", input: "targets" },
    inputSchema: {},
    resultSchema: {},
  };

  it("reports checkedKeys on PanelInstance and rejects batch action as stale before prepare when checked rows changed or cleared", async () => {
    const harness = mountPanel({
      manifest,
      projections: { "p-batch-btn": batchBtnProjection },
      read: async (req) =>
        req.operations
          ? ready({ batchDelete: batchDeleteDescriptor })
          : ready([]),
    });
    try {
      await vi.waitFor(() => expect(harness.element.querySelector("button")).not.toBeNull());
      expect(harness.instance.checkedKeys()).toEqual({
        checked: [`${SCHEDULED_TASK}:t-1`, `${SCHEDULED_TASK}:t-2`],
      });

      // User changes checked rows from t-1/t-2 to t-3/t-4 before agent's request arrives.
      harness.instance.state.set("checked", [
        { className: SCHEDULED_TASK, primaryKey: "t-3" },
        { className: SCHEDULED_TASK, primaryKey: "t-4" },
      ]);
      await nextTick();

      const staleChanged = await harness.instance.executeAction({
        operation: "toolbar.batchDelete",
        expectedCheckedKeys: [`${SCHEDULED_TASK}:t-1`, `${SCHEDULED_TASK}:t-2`],
        agentRun: AGENT_RUN,
      });
      expect(staleChanged).toMatchObject({ ok: false, reason: "stale", operation: "toolbar.batchDelete" });
      expect(harness.prepare).not.toHaveBeenCalled();

      // User unchecks everything -> still reports stale (not action_unavailable) because expectedCheckedKeys changed.
      harness.instance.state.set("checked", []);
      await nextTick();
      const staleCleared = await harness.instance.executeAction({
        operation: "toolbar.batchDelete",
        expectedCheckedKeys: [`${SCHEDULED_TASK}:t-3`, `${SCHEDULED_TASK}:t-4`],
        agentRun: AGENT_RUN,
      });
      expect(staleCleared).toMatchObject({ ok: false, reason: "stale", operation: "toolbar.batchDelete" });
      expect(harness.prepare).not.toHaveBeenCalled();
    } finally {
      harness.unmount();
    }
  });

  it("verifies checked selection again in full-auto mode after prepare returns and cancels instead of dispatching if selection changed", async () => {
    const pendingPrepare = deferred<PanelHumanOperationPreparation>();
    const harness = mountPanel({
      manifest,
      projections: { "p-batch-btn": batchBtnProjection },
      autoMode: true,
      read: async (req) =>
        req.operations
          ? ready({ batchDelete: batchDeleteDescriptor })
          : ready([]),
      prepare: async () => pendingPrepare.promise,
    });
    try {
      await vi.waitFor(() => expect(harness.element.querySelector("button")).not.toBeNull());

      const inFlight = harness.instance.executeAction({
        operation: "toolbar.batchDelete",
        expectedCheckedKeys: [`${SCHEDULED_TASK}:t-1`, `${SCHEDULED_TASK}:t-2`],
        agentRun: AGENT_RUN,
      });
      await vi.waitFor(() => expect(harness.prepare).toHaveBeenCalledTimes(1));

      // While prepare() is in flight in full-auto mode, user changes checked rows to t-9.
      harness.instance.state.set("checked", [{ className: SCHEDULED_TASK, primaryKey: "t-9" }]);
      await nextTick();

      pendingPrepare.resolve({
        intentId: "6f0c1a2e-6a0b-4f8e-9a51-0c6f3e2b1d90",
        operationId: "toolbar.batchDelete",
        label: "Delete selected",
        confirmation: { kind: "none" },
        autoMode: true,
      });

      const outcome = await inFlight;
      expect(outcome).toMatchObject({
        ok: false,
        reason: "stale",
        operation: "toolbar.batchDelete",
        intentId: "6f0c1a2e-6a0b-4f8e-9a51-0c6f3e2b1d90",
      });
      expect(harness.dispatched).toHaveLength(0);
      expect(harness.cancelled).toHaveLength(1);
      expect(harness.cancelled[0]!.intentId).toBe("6f0c1a2e-6a0b-4f8e-9a51-0c6f3e2b1d90");
    } finally {
      harness.unmount();
    }
  });
});

describe("Item 1.3, 1.4 & 1.6: Mixed-type list composite rowKey and row confirmation / full-auto target verification", () => {
  it("disambiguates mixed-type list rows by composite <className>:<primaryKey> and rejects ambiguous plain primaryKey", async () => {
    const manifest: DirectPanelManifest = {
      state: {},
      members: {
        items: { target: { projectionId: "p-mixed-list" } },
      },
    };
    const projection: DirectProjection = {
      ...baseRecord,
      id: "p-mixed-list",
      name: "Mixed Objects",
      componentId: "@ontomato/sdk:ObjectList",
      inputs: {},
      outputs: {},
      data: {
        rows: { source: { type: { kind: "PlatformObjectType", id: SCHEDULED_TASK } }, read: "list", params: {} },
      },
      operations: {
        remove: { operation: { kind: "PlatformOperation", id: "demo.remove" }, target: { row: true } },
      },
      config: {
        columns: [{ key: "label", label: "Item" }],
        rowActions: {
          items: [{ kind: "operation", operation: "remove", label: "Remove" }],
        },
      },
    };
    const removeDescriptor: PanelOwnerOperationDescriptor = {
      kind: "action",
      handlerRef: "demo.remove",
      label: "Remove",
      effect: "write",
      batch: false,
      target: { source: "input", input: "row" },
      inputSchema: {},
      resultSchema: {},
    };
    const harness = mountPanel({
      manifest,
      projections: { "p-mixed-list": projection },
      autoMode: true,
      read: async (req) => {
        if (req.operations) return ready({ remove: removeDescriptor });
        return ready([
          { primaryKey: "42", className: "demo:Alpha", label: "Alpha 42", fields: {} },
          { primaryKey: "42", className: "demo:Beta", label: "Beta 42", fields: {} },
        ]);
      },
    });
    try {
      await vi.waitFor(() => expect(harness.element.textContent).toContain("Beta 42"));

      // Plain "42" matches both demo:Alpha and demo:Beta -> rejected as ambiguous, never silently picks Alpha.
      const ambiguous = await harness.instance.executeAction({
        operation: "items.remove",
        rowKey: "42",
        agentRun: AGENT_RUN,
      });
      expect(ambiguous).toMatchObject({ ok: false, reason: "input_required" });
      expect(harness.prepared).toHaveLength(0);

      // Composite "demo:Beta:42" targets demo:Beta precisely.
      const targeted = await harness.instance.executeAction({
        operation: "items.remove",
        rowKey: "demo:Beta:42",
        agentRun: AGENT_RUN,
      });
      expect(targeted).toMatchObject({ ok: true, kind: "executed", operation: "items.remove" });
      expect(harness.prepared).toHaveLength(1);
      expect(harness.prepared[0]!.invocation).toEqual({
        call: {
          target: { kind: "object", objectType: "demo:Beta", primaryKey: "42" },
          input: {},
        },
      });
    } finally {
      harness.unmount();
    }
  });

  it("invalidates row confirmation AND full-auto dispatch when outer parent target switches even if the same rowKey exists", async () => {
    const manifest: DirectPanelManifest = {
      state: {
        app: {
          type: { kind: "object", objectType: APPLICATION },
          personal: false,
          deepLink: false,
          external: false,
          default: { className: APPLICATION, primaryKey: "app-A" },
        },
      },
      members: {
        entries: {
          target: { projectionId: "p-app-entries" },
          inputs: { app: { state: "app" } },
        },
      },
    };
    const projection: DirectProjection = {
      ...baseRecord,
      id: "p-app-entries",
      name: "App Entries",
      componentId: "@ontomato/sdk:ObjectList",
      inputs: { app: { kind: "object", objectType: APPLICATION } },
      outputs: {},
      data: {
        rows: { source: { type: { kind: "PlatformObjectType", id: SCHEDULED_TASK } }, read: "list", params: {} },
      },
      operations: {
        remove: {
          operation: { kind: "PlatformOperation", id: "apps.removeEntry" },
          target: { input: "app" },
          params: { entryId: { rowField: "primaryKey" } },
        },
      },
      config: {
        columns: [{ key: "label", label: "Entry" }],
        rowActions: {
          items: [{ kind: "operation", operation: "remove", label: "Remove" }],
        },
      },
    };
    const removeDescriptor: PanelOwnerOperationDescriptor = {
      kind: "action",
      handlerRef: "apps.removeEntry",
      label: "Remove entry",
      effect: "write",
      batch: false,
      target: { source: "input", input: "app" },
      inputSchema: { type: "object", properties: { entryId: { type: "string" } } },
      resultSchema: {},
    };

    // Default confirmation path (Item 1.4): switch outer app from app-A to app-B while both have row "entry-1".
    const confirmHarness = mountPanel({
      manifest,
      projections: { "p-app-entries": projection },
      autoMode: false,
      read: async (req) => {
        if (req.operations) return ready({ remove: removeDescriptor });
        return ready([{ primaryKey: "entry-1", className: "platform:Entry", label: "Home Entry", fields: {} }]);
      },
    });
    try {
      await vi.waitFor(() => expect(confirmHarness.element.textContent).toContain("Home Entry"));
      const awaiting = await confirmHarness.instance.executeAction({
        operation: "entries.remove",
        rowKey: "platform:Entry:entry-1",
        agentRun: AGENT_RUN,
      });
      expect(awaiting).toMatchObject({ ok: true, kind: "awaiting_confirmation" });
      if (!awaiting.ok || awaiting.kind !== "awaiting_confirmation") throw new Error("Expected confirmation");

      // Outer panel switches from app-A to app-B; row "entry-1" is still displayed!
      confirmHarness.instance.state.set("app", { className: APPLICATION, primaryKey: "app-B" });
      await nextTick();

      const stale = await awaiting.confirmation.dispatch();
      expect(stale).toMatchObject({ ok: false, reason: "stale" });
      expect(confirmHarness.dispatched).toHaveLength(0);
      expect(confirmHarness.cancelled).toHaveLength(1);
    } finally {
      confirmHarness.unmount();
    }

    // Full-auto path (Item 1.6): switch outer app while prepare() is in flight -> cancels instead of dispatching.
    const pendingPrepare = deferred<PanelHumanOperationPreparation>();
    const autoHarness = mountPanel({
      manifest,
      projections: { "p-app-entries": projection },
      autoMode: true,
      read: async (req) => {
        if (req.operations) return ready({ remove: removeDescriptor });
        return ready([{ primaryKey: "entry-1", className: "platform:Entry", label: "Home Entry", fields: {} }]);
      },
      prepare: async () => pendingPrepare.promise,
    });
    try {
      await vi.waitFor(() => expect(autoHarness.element.textContent).toContain("Home Entry"));
      const inFlight = autoHarness.instance.executeAction({
        operation: "entries.remove",
        rowKey: "platform:Entry:entry-1",
        agentRun: AGENT_RUN,
      });
      await vi.waitFor(() => expect(autoHarness.prepare).toHaveBeenCalledTimes(1));

      autoHarness.instance.state.set("app", { className: APPLICATION, primaryKey: "app-B" });
      await nextTick();
      pendingPrepare.resolve({
        intentId: "6f0c1a2e-6a0b-4f8e-9a51-0c6f3e2b1d91",
        operationId: "entries.remove",
        label: "Remove entry",
        confirmation: { kind: "none" },
        autoMode: true,
      });

      const outcome = await inFlight;
      expect(outcome).toMatchObject({ ok: false, reason: "stale", intentId: "6f0c1a2e-6a0b-4f8e-9a51-0c6f3e2b1d91" });
      expect(autoHarness.dispatched).toHaveLength(0);
      expect(autoHarness.cancelled).toHaveLength(1);
    } finally {
      autoHarness.unmount();
    }
  });
});

describe("Item 1.1, 1.4, 1.6 & 2.4: ObjectForm fixedFields staleness, expectedTarget, full-auto check, and dirty discard confirmation", () => {
  const formManifest: DirectPanelManifest = {
    state: {
      task: {
        type: { kind: "object", objectType: SCHEDULED_TASK },
        personal: false,
        deepLink: false,
        external: false,
        default: { className: SCHEDULED_TASK, primaryKey: "t-1" },
      },
      parentScope: {
        type: { kind: "scalar", type: "string" },
        personal: false,
        deepLink: false,
        external: false,
        default: "Scope-A",
      },
    },
    members: {
      form: {
        target: { projectionId: "p-task-form" },
        inputs: {
          task: { state: "task" },
        },
      },
    },
  };

  const formProjection: DirectProjection = {
    ...baseRecord,
    id: "p-task-form",
    name: "Task Form",
    componentId: "@ontomato/sdk:ObjectForm",
    inputs: {
      task: { kind: "object", objectType: SCHEDULED_TASK },
      values: { kind: "json" },
      changedField: { kind: "scalar", type: "string" },
    },
    outputs: {},
    data: {
      form: {
        source: { object: { input: "task" } },
        read: "form",
        params: { values: { input: "values" }, changedField: { input: "changedField" } },
      },
    },
    operations: {
      save: { operation: { kind: "PlatformOperation", id: "tasks.save" }, target: { input: "task" } },
    },
    config: {
      fixedFields: {
        "/scope": { state: "parentScope" },
      },
    },
  };

  const formDescription: PanelFormDescription = {
    revision: 3,
    fields: [
      { path: "/scope", label: "Scope", control: { kind: "text" }, valueSchema: { type: "string" }, required: false, readOnly: false },
      { path: "/name", label: "Name", control: { kind: "text" }, valueSchema: { type: "string" }, required: true, readOnly: false },
    ],
    values: { scope: "Scope-A", name: "Original" },
    errors: [],
    save: { method: "PUT", path: "/tasks/t-1", bodySchema: {} },
  };

  const saveDescriptor: PanelOwnerOperationDescriptor = {
    kind: "form.save",
    handlerRef: "tasks.save",
    label: "Save",
    effect: "write",
    batch: false,
    target: { source: "input", input: "task" },
    inputSchema: {},
    resultSchema: {},
  };

  it("rejects fillForm and save with stale when expectedTarget does not match, and detects fixedFields changes in confirmation and full-auto", async () => {
    const harness = mountPanel({
      manifest: formManifest,
      projections: { "p-task-form": formProjection },
      autoMode: false,
      read: async (req) =>
        req.operations
          ? ready({ save: saveDescriptor })
          : ready(formDescription),
    });
    try {
      await vi.waitFor(() => expect(harness.element.querySelector('[data-field="/name"] input')).not.toBeNull());

      // Stale expectedTarget rejects fillForm and save immediately.
      const staleFill = await harness.instance.fillForm({
        member: "form",
        values: { "/name": "Wrong target" },
        expectedTarget: { kind: "object", objectType: SCHEDULED_TASK, primaryKey: "t-other" },
      });
      expect(staleFill).toMatchObject({ ok: false, reason: "stale" });

      // Matching expectedTarget fills cleanly.
      const okFill = await harness.instance.fillForm({
        member: "form",
        values: { "/name": "Updated" },
        expectedTarget: { kind: "object", objectType: SCHEDULED_TASK, primaryKey: "t-1" },
      });
      expect(okFill).toMatchObject({ ok: true, filledFields: ["/name"] });

      // Prepare confirmation under Scope-A, then outer state switches fixedFields to Scope-B.
      const awaiting = await harness.instance.executeAction({
        operation: "form.save",
        expectedTarget: { kind: "object", objectType: SCHEDULED_TASK, primaryKey: "t-1" },
        agentRun: AGENT_RUN,
      });
      expect(awaiting).toMatchObject({ ok: true, kind: "awaiting_confirmation" });
      if (!awaiting.ok || awaiting.kind !== "awaiting_confirmation") throw new Error("Expected confirmation");

      harness.instance.state.set("parentScope", "Scope-B");
      await nextTick();
      const staleFixed = await awaiting.confirmation.dispatch();
      expect(staleFixed).toMatchObject({ ok: false, reason: "stale" });
      expect(harness.dispatched).toHaveLength(0);
      expect(harness.cancelled).toHaveLength(1);
    } finally {
      harness.unmount();
    }

    // Full-auto path (Item 1.6): fixedFields change while prepare() is in flight cancels before dispatch!
    const pendingPrepare = deferred<PanelHumanOperationPreparation>();
    const autoHarness = mountPanel({
      manifest: formManifest,
      projections: { "p-task-form": formProjection },
      autoMode: true,
      read: async (req) =>
        req.operations
          ? ready({ save: saveDescriptor })
          : ready(formDescription),
      prepare: async () => pendingPrepare.promise,
    });
    try {
      await vi.waitFor(() => expect(autoHarness.element.querySelector('[data-field="/name"] input')).not.toBeNull());
      await autoHarness.instance.fillForm({ member: "form", values: { "/name": "Auto edit" } });
      const inFlight = autoHarness.instance.executeAction({ operation: "form.save", agentRun: AGENT_RUN });
      await vi.waitFor(() => expect(autoHarness.prepare).toHaveBeenCalledTimes(1));

      autoHarness.instance.state.set("parentScope", "Scope-B");
      await nextTick();
      pendingPrepare.resolve({
        intentId: "6f0c1a2e-6a0b-4f8e-9a51-0c6f3e2b1d92",
        operationId: "form.save",
        label: "Save",
        confirmation: { kind: "none" },
        autoMode: true,
      });

      const outcome = await inFlight;
      expect(outcome).toMatchObject({ ok: false, reason: "stale", intentId: "6f0c1a2e-6a0b-4f8e-9a51-0c6f3e2b1d92" });
      expect(autoHarness.dispatched).toHaveLength(0);
      expect(autoHarness.cancelled).toHaveLength(1);
    } finally {
      autoHarness.unmount();
    }
  });

  it("requires conversation confirmation for <form>.discard when dirty, preserves edits until confirmed, and rejects stale edits (Item 2.4)", async () => {
    let localSeq = 0;
    const requestLocalConfirmation = vi.fn(async () => {
      localSeq += 1;
      return {
        intentId: `8f0c1a2e-6a0b-4f8e-9a51-0c6f3e2b1d0${localSeq}`,
        questionId: `9f0c1a2e-6a0b-4f8e-9a51-0c6f3e2b1d0${localSeq}`,
        label: "Discard",
      };
    });
    const harness = mountPanel({
      manifest: formManifest,
      projections: { "p-task-form": formProjection },
      requestLocalConfirmation,
      read: async (req) =>
        req.operations
          ? ready({ save: saveDescriptor })
          : ready(formDescription),
    });
    try {
      await vi.waitFor(() => expect(harness.element.querySelector('[data-field="/name"] input')).not.toBeNull());

      // Clean form: discard is unavailable and does not request confirmation.
      const cleanDiscard = await harness.instance.executeAction({ operation: "form.discard", agentRun: AGENT_RUN });
      expect(cleanDiscard).toMatchObject({ ok: false, reason: "action_unavailable" });
      expect(requestLocalConfirmation).not.toHaveBeenCalled();

      // Make the form dirty.
      await harness.instance.fillForm({ member: "form", values: { "/name": "User unsaved draft" } });
      expect(harness.instance.dirty()).toBe(true);

      // Agent requests discard -> asks conversation confirmation, does NOT immediately clear unsaved edits!
      const awaiting = await harness.instance.executeAction({ operation: "form.discard", agentRun: AGENT_RUN });
      expect(awaiting).toMatchObject({
        ok: true,
        kind: "awaiting_confirmation",
        operation: "form.discard",
        questionId: "9f0c1a2e-6a0b-4f8e-9a51-0c6f3e2b1d01",
      });
      expect(requestLocalConfirmation).toHaveBeenCalledTimes(1);
      expect(harness.instance.forms.handle("form")!.values.value.name).toBe("User unsaved draft");
      expect(harness.instance.dirty()).toBe(true);
      if (!awaiting.ok || awaiting.kind !== "awaiting_confirmation") throw new Error("Expected confirmation");

      // If user edits further before confirming, old discard confirmation becomes stale and preserves the newer edit.
      harness.instance.forms.handle("form")!.set("/name", "Newer unsaved edit");
      await nextTick();
      const stale = await awaiting.confirmation.dispatch();
      expect(stale).toMatchObject({ ok: false, reason: "stale" });
      expect(harness.instance.forms.handle("form")!.values.value.name).toBe("Newer unsaved edit");

      // Re-request discard and confirm while unchanged -> discards edits cleanly.
      const awaiting2 = await harness.instance.executeAction({ operation: "form.discard", agentRun: AGENT_RUN });
      if (!awaiting2.ok || awaiting2.kind !== "awaiting_confirmation") throw new Error("Expected confirmation");
      const confirmed = await awaiting2.confirmation.dispatch();
      expect(confirmed).toMatchObject({ ok: true, outcome: { discarded: true } });
      expect(harness.instance.dirty()).toBe(false);
      expect(harness.instance.forms.handle("form")!.values.value.name).toBe("Original");
    } finally {
      harness.unmount();
    }
  });
});

describe("Item 1.1 & 1.4: Nested panel expectedMemberInstanceId and disposal invalidation", () => {
  it("exposes nested memberInstances, rejects stale expectedMemberInstanceId after swap, and invalidates pending confirmation when nested panel disposes", async () => {
    const parentManifest: DirectPanelManifest = { state: {}, members: {} };
    const childManifest: DirectPanelManifest = {
      state: {
        task: {
          type: { kind: "object", objectType: SCHEDULED_TASK },
          personal: false,
          deepLink: false,
          external: false,
          default: { className: SCHEDULED_TASK, primaryKey: "t-1" },
        },
      },
      members: {
        action: {
          target: { projectionId: "p-child-btn" },
          inputs: { task: { state: "task" } },
        },
      },
    };
    const childBtnProjection: DirectProjection = {
      ...baseRecord,
      id: "p-child-btn",
      name: "Run Child",
      componentId: "@ontomato/sdk:OperationButton",
      inputs: { task: { kind: "object", objectType: SCHEDULED_TASK } },
      outputs: {},
      data: {},
      operations: {
        run: { operation: { kind: "PlatformOperation", id: "tasks.run" } },
      },
      config: { operation: "run" },
    };
    const runDescriptor: PanelOwnerOperationDescriptor = {
      kind: "action",
      handlerRef: "tasks.run",
      label: "Run",
      effect: "write",
      batch: false,
      target: { source: "input", input: "task" },
      inputSchema: {},
      resultSchema: {},
    };

    const parent = mountPanel({
      manifest: parentManifest,
      projections: {},
      read: async () => ready([]),
    });
    const childA = mountPanel({
      manifest: childManifest,
      projections: { "p-child-btn": childBtnProjection },
      autoMode: false,
      read: async (req) =>
        req.operations ? ready({ run: runDescriptor }) : ready([]),
    });
    const childB = mountPanel({
      manifest: childManifest,
      projections: { "p-child-btn": childBtnProjection },
      autoMode: false,
      read: async (req) =>
        req.operations ? ready({ run: runDescriptor }) : ready([]),
    });

    try {
      await vi.waitFor(() => expect(childA.element.querySelector("button")).not.toBeNull());
      await vi.waitFor(() => expect(childB.element.querySelector("button")).not.toBeNull());

      const unpublishA = parent.instance.publish("detail", computed(() => ({
        instanceId: childA.instance.instanceId,
        formRegistries: childA.instance.formRegistries,
        operations: childA.instance.operations.value,
        dirty: () => childA.instance.dirty(),
        context: childA.instance.pageContext.value,
        memberInstances: () => childA.instance.memberInstances(),
        checkedKeys: () => childA.instance.checkedKeys(),
        fillForm: (req) => childA.instance.fillForm(req),
        executeAction: (req) => childA.instance.executeAction(req),
      })));

      expect(parent.instance.memberInstances()).toEqual({ detail: childA.instance.instanceId });

      // Prepare confirmation on nested childA with its expectedMemberInstanceId.
      const awaiting = await parent.instance.executeAction({
        operation: "detail.action.run",
        expectedMemberInstanceId: childA.instance.instanceId,
        agentRun: AGENT_RUN,
      });
      expect(awaiting).toMatchObject({ ok: true, kind: "awaiting_confirmation" });
      if (!awaiting.ok || awaiting.kind !== "awaiting_confirmation") throw new Error("Expected confirmation");

      // Swap nested member "detail" from childA to childB and dispose childA.
      unpublishA();
      childA.instance.markDisposed();
      const unpublishB = parent.instance.publish("detail", computed(() => ({
        instanceId: childB.instance.instanceId,
        formRegistries: childB.instance.formRegistries,
        operations: childB.instance.operations.value,
        dirty: () => childB.instance.dirty(),
        context: childB.instance.pageContext.value,
        memberInstances: () => childB.instance.memberInstances(),
        checkedKeys: () => childB.instance.checkedKeys(),
        fillForm: (req) => childB.instance.fillForm(req),
        executeAction: (req) => childB.instance.executeAction(req),
      })));

      expect(parent.instance.memberInstances()).toEqual({ detail: childB.instance.instanceId });

      // 1. Late request carrying childA's expectedMemberInstanceId is rejected as stale without touching childB.
      const staleLate = await parent.instance.executeAction({
        operation: "detail.action.run",
        expectedMemberInstanceId: childA.instance.instanceId,
        agentRun: AGENT_RUN,
      });
      expect(staleLate).toMatchObject({ ok: false, reason: "stale" });
      expect(childB.prepare).not.toHaveBeenCalled();

      // 2. Confirming the earlier childA confirmation after childA was disposed is rejected as stale and cancelled!
      const staleConfirm = await awaiting.confirmation.dispatch();
      expect(staleConfirm).toMatchObject({ ok: false, reason: "stale" });
      expect(childA.dispatched).toHaveLength(0);
      expect(childA.cancelled).toHaveLength(1);
      unpublishB();
    } finally {
      childA.unmount();
      childB.unmount();
      parent.unmount();
    }
  });
});
