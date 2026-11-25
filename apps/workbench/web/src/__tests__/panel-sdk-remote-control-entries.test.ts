import { afterEach, describe, expect, it, vi } from "vitest";
import { createApp, h, nextTick, ref } from "vue";
import { createI18n } from "vue-i18n";
import ElementPlus from "element-plus";
import publicEn from "@ontomato/workbench-ui/locales/en";
import type { RuntimeJsonValue } from "@ontomato/contracts/agent-runtime-values";
import type { DirectPanelManifest } from "@ontomato/contracts/panel-manifest";
import type { DirectProjection } from "@ontomato/contracts/product-panels";
import type { ProductPanelOperationsReadResponse, ProductPanelReadResponse } from "@ontomato/contracts/panel-host";
import type { PanelFormDescription, PanelFormField } from "@ontomato/contracts/panel-projection";
import type { PanelHumanOperationPreparation } from "@ontomato/contracts/panel-agent";
import type { PanelOwnerOperationDescriptor } from "@ontomato/contracts/panel-operations";
import { SCHEDULED_TASK } from "@ontomato/contracts/panel-client-requests";
import { APPLICATION } from "@ontomato/contracts/platform-object-types";
import { createDirectPanelInstance, type PanelMemberReadRequest } from "../../../../../packages/apps-sdk/src/panel/direct";
import PanelMember from "../../../../../packages/apps-sdk/src/panel/PanelMember.vue";
import { createPanelText } from "../../../../../packages/apps-sdk/src/panel/text";
import { noOperations } from "./panel-frame";

/*
 * Regression suite for SDK remote-control entry faithfulness and honest reporting:
 * - Item 2.1: ObjectList row actions obey `when` / `disabledWhen`; ObjectForm rejects clean edit-mode saves and saves
 *   while already `saving`.
 * - Item 2.2: `executeAction` rejects unmounted / unregistered UI handlers instead of falling back to `binding.invoke`.
 * - Item 2.3: Agent `input` may only fill unbound interactive parameters and never overrides form/row/literal/input values.
 * - Item 2.5: `fillForm` enforces parent/child read-only & fixed rules on objects/arrays, closed select options (rejecting
 *   unlisted & disabled choices), and layout-omitted fields (`unassignedFields: "omit"`).
 * - Item 2.6: Agent run context is passed per invocation rather than shared mutable state on `PanelInstance`.
 * - Item 3.1: ObjectList rejects new row operations while busy instead of silently reporting success.
 * - Item 3.3: Early exit during async `fillForm` refresh records all remaining unprocessed fields in `rejectedFields`.
 * - Item 3.4: Missing operation descriptors distinguish `loading` (`action_not_ready`) from ready-without-permission /
 *   `forbidden` (`action_unavailable`).
 */

const AGENT_RUN = {
  sessionId: "11111111-1111-4111-8111-111111111111",
  runId: "22222222-2222-4222-8222-222222222222",
  toolCallId: "call-1",
};

const CUSTOMER = "Customer";

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

function actionDescriptor(
  label: string,
  properties: Record<string, Record<string, RuntimeJsonValue>>,
  options: {
    target?: PanelOwnerOperationDescriptor["target"];
    required?: string[];
  } = {},
): PanelOwnerOperationDescriptor {
  return {
    kind: "action",
    handlerRef: "actions.execute",
    label,
    effect: "write",
    batch: false,
    target: options.target ?? { source: "none" },
    inputSchema: {
      type: "object",
      properties: {
        values: {
          type: "object",
          properties,
          ...(options.required ? { required: options.required } : {}),
        },
      },
      required: ["values"],
    },
    resultSchema: {},
  };
}

function platformSaveDescriptor(objectType: string, label = "Save"): PanelOwnerOperationDescriptor {
  return {
    kind: "form.save",
    handlerRef: `${objectType}.save`,
    label,
    effect: "write",
    batch: false,
    target: { source: "input", input: "task" },
    inputSchema: {},
    resultSchema: {},
  };
}

function mountDirectPanel(options: {
  manifest: DirectPanelManifest;
  projections: Record<string, DirectProjection>;
  initial?: Record<string, unknown>;
  read: (request: PanelMemberReadRequest) => Promise<ProductPanelReadResponse | ProductPanelOperationsReadResponse>;
  prepare?: (
    operationId: string,
    invocation: unknown,
    memberPath?: unknown,
    agentRun?: unknown,
  ) => Promise<PanelHumanOperationPreparation>;
  autoMode?: boolean;
  mountedMembers?: () => string[];
}) {
  let intentSeq = 0;
  const prepared: { intentId: string; operationId: string; invocation: unknown; agentRun: unknown }[] = [];
  const dispatched: { intentId: string; skipDialog?: boolean }[] = [];

  const defaultPrepare = async (
    operationId: string,
    invocation: unknown,
    _memberPath?: unknown,
    agentRun?: unknown,
  ): Promise<PanelHumanOperationPreparation> => {
    intentSeq += 1;
    const intentId = `5f0c1a2e-6a0b-4f8e-9a51-0c6f3e2b1d0${intentSeq}`;
    prepared.push({ intentId, operationId, invocation, agentRun });
    const autoMode = options.autoMode ?? true;
    return {
      intentId,
      operationId,
      label: operationId,
      confirmation: { kind: "none" },
      autoMode,
      ...(autoMode ? {} : { questionId: `question-${intentSeq}` }),
    };
  };

  const prepare = vi.fn(options.prepare ?? defaultPrepare);
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
    pageKey: "sdk-entries-test",
    url: () => "/sdk-entries-test",
    label: () => "SDK entries test",
    initial: options.initial as never,
    text: createPanelText({}, ref("en"), "en"),
    operations: { ...noOperations.operations, prepare },
    confirmOperation,
    expandPageComposer: noOperations.expandPageComposer,
    navigate: noOperations.navigate,
    nested: noOperations.nested,
    readProjection: async (id) => options.projections[id]!,
    read: options.read as never,
  });

  const element = document.createElement("div");
  document.body.append(element);
  const allMembers = Object.keys(options.manifest.members);
  const visibleMembers = ref(options.mountedMembers ? options.mountedMembers() : allMembers);
  const app = createApp({
    render: () => h(
      "div",
      visibleMembers.value.map((member) => h(PanelMember, { key: member, instance, member })),
    ),
  });
  app.use(createI18n({ legacy: false, locale: "en", messages: { en: publicEn } })).use(ElementPlus).mount(element);

  return {
    instance,
    element,
    visibleMembers,
    prepared,
    dispatched,
    prepare,
    confirmOperation,
    unmount: () => app.unmount(),
  };
}

afterEach(() => {
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

describe("Item 2.1 & 3.1: ObjectList row action conditions and busy rejection", () => {
  const listProjection: DirectProjection = {
    ...baseRecord,
    id: "entries-list",
    name: "Entries",
    componentId: "@ontomato/sdk:ObjectList",
    inputs: {},
    outputs: {},
    config: {
      columns: [{ key: "label", label: "Entry" }],
      rowActions: {
        items: [
          {
            kind: "operation",
            operation: "remove",
            label: "Remove",
            when: { field: "canEdit", equals: true },
            disabledWhen: { field: "locked", equals: true },
          },
        ],
      },
    },
    data: {
      rows: { source: { type: { kind: "PlatformObjectType", id: SCHEDULED_TASK } }, read: "list", params: {} },
    },
    operations: {
      remove: {
        operation: { kind: "PlatformOperation", id: "schedules.deleteTask" },
        target: { row: true },
      },
    },
  };

  const removeDescriptor: PanelOwnerOperationDescriptor = {
    kind: "action",
    handlerRef: "schedules.deleteTask",
    label: "Remove entry",
    effect: "write",
    batch: false,
    target: { source: "input", input: "task" },
    inputSchema: {},
    resultSchema: {},
  };

  const manifest: DirectPanelManifest = {
    state: {},
    members: {
      entries: { target: { projectionId: "entries-list" } },
    },
  };

  const rowsPayload = [
    { primaryKey: "row-hidden", label: "Read-only row", fields: { canEdit: false, locked: false } },
    { primaryKey: "row-disabled", label: "Locked row", fields: { canEdit: true, locked: true } },
    { primaryKey: "row-active", label: "Active row", fields: { canEdit: true, locked: false } },
    { primaryKey: "row-second", label: "Second active row", fields: { canEdit: true, locked: false } },
  ];

  it("enforces rowActions when and disabledWhen conditions before executing a row action", async () => {
    const harness = mountDirectPanel({
      manifest,
      projections: { "entries-list": listProjection },
      read: async (req) => (req.operations ? ready({ remove: removeDescriptor }) : ready(rowsPayload)),
    });
    try {
      await vi.waitFor(() => {
        expect(harness.element.textContent).toContain("Active row");
        expect(harness.element.textContent).toContain("Remove");
      });

      const hiddenResult = await harness.instance.executeAction({
        operation: "entries.remove",
        rowKey: "row-hidden",
        agentRun: AGENT_RUN,
      });
      expect(hiddenResult).toMatchObject({ ok: false, reason: "action_unavailable" });
      expect(hiddenResult.ok ? "" : hiddenResult.message).toContain("not shown");

      const disabledResult = await harness.instance.executeAction({
        operation: "entries.remove",
        rowKey: "row-disabled",
        agentRun: AGENT_RUN,
      });
      expect(disabledResult).toMatchObject({ ok: false, reason: "action_unavailable" });
      expect(disabledResult.ok ? "" : disabledResult.message).toContain("disabled");

      expect(harness.prepared).toHaveLength(0);

      const allowedResult = await harness.instance.executeAction({
        operation: "entries.remove",
        rowKey: "row-active",
        agentRun: AGENT_RUN,
      });
      expect(allowedResult).toMatchObject({ ok: true, kind: "executed", operation: "entries.remove" });
      expect(harness.prepared).toHaveLength(1);
    } finally {
      harness.unmount();
    }
  });

  it("rejects a concurrent row action while the list is busy instead of reporting success", async () => {
    const firstPrepare = deferred<PanelHumanOperationPreparation>();
    const preparedCalls: { operationId: string; invocation: unknown }[] = [];
    const harness = mountDirectPanel({
      manifest,
      projections: { "entries-list": listProjection },
      read: async (req) => (req.operations ? ready({ remove: removeDescriptor }) : ready(rowsPayload)),
      prepare: async (operationId, invocation) => {
        preparedCalls.push({ operationId, invocation });
        return firstPrepare.promise;
      },
    });
    try {
      await vi.waitFor(() => {
        expect(harness.element.textContent).toContain("Second active row");
        expect(harness.element.textContent).toContain("Remove");
      });

      const inFlight = harness.instance.executeAction({
        operation: "entries.remove",
        rowKey: "row-active",
        agentRun: AGENT_RUN,
      });
      await vi.waitFor(() => expect(preparedCalls).toHaveLength(1));

      const busyResult = await harness.instance.executeAction({
        operation: "entries.remove",
        rowKey: "row-second",
        agentRun: { ...AGENT_RUN, toolCallId: "call-2" },
      });
      expect(busyResult).toMatchObject({ ok: false, reason: "action_unavailable" });
      expect(busyResult.ok ? "" : busyResult.message?.toLowerCase()).toContain("busy");
      expect(preparedCalls).toHaveLength(1);

      firstPrepare.resolve({
        intentId: "5f0c1a2e-6a0b-4f8e-9a51-0c6f3e2b1d99",
        operationId: "entries.remove",
        label: "Remove entry",
        confirmation: { kind: "none" },
        autoMode: true,
      });
      expect(await inFlight).toMatchObject({ ok: true, kind: "executed", operation: "entries.remove" });
    } finally {
      harness.unmount();
    }
  });
});

describe("Item 2.1, 2.2 & 2.6: ObjectForm save gates, no binding.invoke fallback, and per-call agent context", () => {
  const taskFormProjection = (id: string): DirectProjection => ({
    ...baseRecord,
    id,
    name: id,
    componentId: "@ontomato/sdk:ObjectForm",
    inputs: { task: { kind: "object", objectType: SCHEDULED_TASK } },
    outputs: {},
    config: {},
    data: {
      form: { source: { object: { input: "task" } }, read: "form", params: {} },
    },
    operations: {
      save: { operation: { kind: "PlatformOperation", id: `${SCHEDULED_TASK}.save` }, target: { input: "task" } },
    },
  });

  const customerFormProjection: DirectProjection = {
    ...baseRecord,
    id: "customer-form",
    name: "Customer form",
    componentId: "@ontomato/sdk:ObjectForm",
    inputs: { target: { kind: "object", objectType: CUSTOMER } },
    outputs: {},
    config: {},
    data: {
      form: { source: { object: { input: "target" } }, read: "form", params: {} },
    },
    operations: {
      save: { operation: { kind: "Action", id: "update-customer" }, target: { input: "target" } },
    },
  };

  it("rejects edit-mode form.save when clean or already saving", async () => {
    const firstPrepare = deferred<PanelHumanOperationPreparation>();
    let prepareCount = 0;
    const harness = mountDirectPanel({
      manifest: {
        state: {
          selectedTask: { type: { kind: "object", objectType: SCHEDULED_TASK }, personal: false, deepLink: false, external: false },
        },
        members: {
          form: { target: { projectionId: "task-form" }, inputs: { task: { state: "selectedTask" } } },
        },
      },
      projections: { "task-form": taskFormProjection("task-form") },
      initial: { selectedTask: { className: SCHEDULED_TASK, primaryKey: "t-1" } },
      read: async (req) => {
        if (req.operations) return ready({ save: platformSaveDescriptor(SCHEDULED_TASK) });
        return ready({
          fields: [
            { path: "/name", label: "Name", control: { kind: "text" }, valueSchema: { type: "string" }, required: true, readOnly: false },
          ],
          values: { name: "Task 1" },
          errors: [],
          revision: 1,
          save: { method: "PUT", path: "/tasks/t-1", bodySchema: {} },
        });
      },
      prepare: async () => {
        prepareCount += 1;
        return firstPrepare.promise;
      },
    });
    try {
      await vi.waitFor(() => expect(harness.element.querySelector<HTMLInputElement>('[data-field="/name"] input')?.value).toBe("Task 1"));

      // Clean edit form has no clickable save button -> agent save is rejected.
      const cleanSave = await harness.instance.executeAction({ operation: "form.save", agentRun: AGENT_RUN });
      expect(cleanSave).toMatchObject({ ok: false, reason: "action_unavailable" });
      expect(prepareCount).toBe(0);

      // Edit the form, then start saving and issue a second save while in flight.
      expect(await harness.instance.fillForm({ values: { "/name": "Task 1 updated" } })).toMatchObject({ ok: true });
      const inFlight = harness.instance.executeAction({ operation: "form.save", agentRun: AGENT_RUN });
      await vi.waitFor(() => expect(prepareCount).toBe(1));

      const whileSaving = await harness.instance.executeAction({
        operation: "form.save",
        agentRun: { ...AGENT_RUN, toolCallId: "call-2" },
      });
      expect(whileSaving).toMatchObject({ ok: false, reason: "action_unavailable" });
      expect(prepareCount).toBe(1);

      firstPrepare.resolve({
        intentId: "5f0c1a2e-6a0b-4f8e-9a51-0c6f3e2b1d11",
        operationId: "form.save",
        label: "Save",
        confirmation: { kind: "none" },
        autoMode: true,
      });
      expect(await inFlight).toMatchObject({ ok: true, kind: "executed", operation: "form.save" });
    } finally {
      harness.unmount();
    }
  });

  it("refuses executeAction when no UI handler is mounted (unmounted customer form or unbound projection operation)", async () => {
    const saveAction = actionDescriptor("Update customer", { name: {} }, { target: { source: "input", input: "target" } });
    const harness = mountDirectPanel({
      manifest: {
        state: {
          selectedCustomer: { type: { kind: "object", objectType: CUSTOMER }, personal: false, deepLink: false, external: false },
        },
        members: {
          customerForm: { target: { projectionId: "customer-form" }, inputs: { target: { state: "selectedCustomer" } } },
        },
      },
      projections: { "customer-form": customerFormProjection },
      initial: { selectedCustomer: { className: CUSTOMER, primaryKey: "c-1" } },
      read: async (req) => {
        if (req.operations) return ready({ save: saveAction });
        return ready({
          fields: [
            { path: "/name", label: "Name", control: { kind: "text" }, valueSchema: { type: "string" }, required: true, readOnly: false },
          ],
          values: { name: "Alice" },
          errors: [],
          save: { method: "PUT", path: "/customers/c-1", bodySchema: {} },
        });
      },
    });
    try {
      await vi.waitFor(() => expect(harness.element.querySelector<HTMLInputElement>('[data-field="/name"] input')?.value).toBe("Alice"));

      // Register a projection operation on the panel instance without any mounted button component.
      const unregisterOrphan = harness.instance.register({
        slot: "customerForm",
        projectionId: "customer-form",
        ports: { binding: CUSTOMER, inputs: { target: { kind: "object", objectType: CUSTOMER } } },
        operations: {
          orphanArchive: actionDescriptor("Archive", {}, { target: { source: "input", input: "target" } }),
        },
      });
      const orphanResult = await harness.instance.executeAction({
        operation: "customerForm.orphanArchive",
        agentRun: AGENT_RUN,
      });
      expect(orphanResult).toMatchObject({ ok: false, reason: "action_not_found" });
      unregisterOrphan();

      // Close/unmount the customer form modal while keeping an operation registration present on the instance.
      harness.visibleMembers.value = [];
      await nextTick();
      const staleRegistration = harness.instance.register({
        slot: "customerForm",
        projectionId: "customer-form",
        ports: { binding: CUSTOMER, inputs: { target: { kind: "object", objectType: CUSTOMER } } },
        operations: { save: saveAction },
      });

      const unmountedSave = await harness.instance.executeAction({
        operation: "customerForm.save",
        agentRun: AGENT_RUN,
      });
      expect(unmountedSave).toMatchObject({ ok: false, reason: "action_not_found" });
      expect(harness.prepared).toHaveLength(0);
      staleRegistration();
    } finally {
      harness.unmount();
    }
  });

  it("isolates per-call agent context so a concurrent manual save on Form B never inherits Form A's agentRun", async () => {
    const formAPrepare = deferred<PanelHumanOperationPreparation>();
    const prepareCalls: { operationId: string; agentRun: unknown }[] = [];
    const harness = mountDirectPanel({
      manifest: {
        state: {
          selectedTaskA: { type: { kind: "object", objectType: SCHEDULED_TASK }, personal: false, deepLink: false, external: false },
          selectedTaskB: { type: { kind: "object", objectType: SCHEDULED_TASK }, personal: false, deepLink: false, external: false },
        },
        members: {
          formA: { target: { projectionId: "form-a" }, inputs: { task: { state: "selectedTaskA" } } },
          formB: { target: { projectionId: "form-b" }, inputs: { task: { state: "selectedTaskB" } } },
        },
      },
      projections: {
        "form-a": taskFormProjection("form-a"),
        "form-b": taskFormProjection("form-b"),
      },
      initial: {
        selectedTaskA: { className: SCHEDULED_TASK, primaryKey: "t-1" },
        selectedTaskB: { className: SCHEDULED_TASK, primaryKey: "t-2" },
      },
      read: async (req) => {
        if (req.operations) return ready({ save: platformSaveDescriptor(SCHEDULED_TASK) });
        return ready({
          fields: [
            { path: "/name", label: "Name", control: { kind: "text" }, valueSchema: { type: "string" }, required: true, readOnly: false },
          ],
          values: { name: "Task 1" },
          errors: [],
          revision: 1,
          save: { method: "PUT", path: "/tasks/t-1", bodySchema: {} },
        });
      },
      prepare: async (operationId, _invocation, _memberPath, agentRun) => {
        prepareCalls.push({ operationId, agentRun });
        if (operationId === "formA.save") return formAPrepare.promise;
        return {
          intentId: "5f0c1a2e-6a0b-4f8e-9a51-0c6f3e2b1d22",
          operationId,
          label: "Save B",
          confirmation: { kind: "none" },
          autoMode: false,
        };
      },
    });
    try {
      await vi.waitFor(() => expect(harness.element.querySelectorAll('[data-field="/name"] input')).toHaveLength(2));

      await harness.instance.fillForm({ member: "formA", values: { "/name": "Agent edit A" } });
      harness.instance.forms.handle("formB")!.set("/name", "Manual edit B");
      await nextTick();

      const agentSaveA = harness.instance.executeAction({ operation: "formA.save", agentRun: AGENT_RUN });
      await vi.waitFor(() => expect(prepareCalls).toHaveLength(1));
      expect(prepareCalls[0]).toEqual({ operationId: "formA.save", agentRun: AGENT_RUN });

      // While Form A's agent save is suspended in prepare(), user manually submits Form B.
      await harness.instance.forms.submit("formB");
      expect(prepareCalls).toHaveLength(2);
      expect(prepareCalls[1]).toEqual({ operationId: "formB.save", agentRun: undefined });

      formAPrepare.resolve({
        intentId: "5f0c1a2e-6a0b-4f8e-9a51-0c6f3e2b1d21",
        operationId: "formA.save",
        label: "Save A",
        confirmation: { kind: "none" },
        autoMode: true,
      });
      const outcomeA = await agentSaveA;
      expect(outcomeA).toMatchObject({
        ok: true,
        kind: "executed",
        operation: "formA.save",
        intentId: "5f0c1a2e-6a0b-4f8e-9a51-0c6f3e2b1d21",
      });
    } finally {
      harness.unmount();
    }
  });
});

describe("Item 2.3: Agent input cannot override form, fixed literal, or state-wired parameters", () => {
  it("submits strictly screen/fixed/wired values for cross-member operationDrafts and strips bound/undeclared keys on OperationButton", async () => {
    const updateAction = actionDescriptor(
      "Submit customer",
      { name: {}, campus: {}, term: {} },
      { target: { source: "input", input: "target" } },
    );
    const approveAction = actionDescriptor(
      "Approve",
      { campus: {}, term: {}, reason: {} },
      { target: { source: "input", input: "target" }, required: ["reason"] },
    );

    const projections: Record<string, DirectProjection> = {
      "customer-form": {
        ...baseRecord,
        id: "customer-form",
        name: "Customer form",
        componentId: "@ontomato/sdk:ObjectForm",
        inputs: { target: { kind: "object", objectType: CUSTOMER } },
        outputs: {},
        config: { actions: "none" },
        data: {
          form: { source: { object: { input: "target" } }, read: "form", params: {} },
        },
        operations: {
          save: {
            operation: { kind: "Action", id: "update-customer" },
            target: { input: "target" },
            params: { campus: { literal: "north" }, term: { input: "activeTerm" } },
          },
        },
      },
      "header-save": {
        ...baseRecord,
        id: "header-save",
        name: "Header save",
        componentId: "@ontomato/sdk:OperationButton",
        inputs: {
          target: { kind: "object", objectType: CUSTOMER },
          activeTerm: { kind: "scalar", type: "string" },
        },
        outputs: {},
        config: { operation: "submit" },
        data: {},
        operations: {
          submit: {
            operation: { kind: "Action", id: "update-customer" },
            target: { input: "target" },
            params: {
              campus: { literal: "north" },
              term: { input: "activeTerm" },
            },
          },
        },
      },
      "approve-btn": {
        ...baseRecord,
        id: "approve-btn",
        name: "Approve button",
        componentId: "@ontomato/sdk:OperationButton",
        inputs: {
          target: { kind: "object", objectType: CUSTOMER },
          activeTerm: { kind: "scalar", type: "string" },
        },
        outputs: {},
        config: { operation: "approve" },
        data: {},
        operations: {
          approve: {
            operation: { kind: "Action", id: "approve-customer" },
            target: { input: "target" },
            params: {
              campus: { literal: "north" },
              term: { input: "activeTerm" },
            },
          },
        },
      },
    };

    const manifest: DirectPanelManifest = {
      state: {
        selectedCustomer: { type: { kind: "object", objectType: CUSTOMER }, personal: false, deepLink: false, external: false },
        activeTerm: { type: { kind: "scalar", type: "string" }, personal: false, deepLink: false, external: false },
      },
      members: {
        customerForm: { target: { projectionId: "customer-form" }, inputs: { target: { state: "selectedCustomer" } } },
        headerSave: {
          target: { projectionId: "header-save" },
          inputs: { target: { state: "selectedCustomer" }, activeTerm: { state: "activeTerm" } },
          operationDrafts: { submit: { slot: "customerForm" } },
        },
        approveBtn: {
          target: { projectionId: "approve-btn" },
          inputs: { target: { state: "selectedCustomer" }, activeTerm: { state: "activeTerm" } },
        },
      },
    };

    const harness = mountDirectPanel({
      manifest,
      projections,
      initial: {
        selectedCustomer: { className: CUSTOMER, primaryKey: "c-1" },
        activeTerm: "2026-fall",
      },
      read: async (req) => {
        if (req.operations) {
          const member = req.memberPath.at(-1)?.member;
          if (member === "customerForm") return ready({ save: updateAction });
          if (member === "headerSave") return ready({ submit: updateAction });
          return ready({ approve: approveAction });
        }
        return ready({
          fields: [
            { path: "/name", label: "Name", control: { kind: "text" }, valueSchema: { type: "string" }, required: true, readOnly: false },
          ],
          values: { name: "Alice" },
          errors: [],
          save: { method: "PUT", path: "/customers/c-1", bodySchema: {} },
        });
      },
    });
    try {
      await vi.waitFor(() => {
        expect(harness.element.querySelector<HTMLInputElement>('[data-field="/name"] input')?.value).toBe("Alice");
        expect(harness.element.textContent).toContain("Submit customer");
        expect(harness.element.textContent).toContain("Approve");
      });

      await harness.instance.fillForm({ member: "customerForm", values: { "/name": "Alice Screen" } });

      // 1. Cross-member header button: agent attempts to override form field `name` and bound `campus`/`term`.
      const headerOutcome = await harness.instance.executeAction({
        operation: "headerSave.submit",
        input: {
          name: "Spoofed Bob",
          campus: "south",
          term: "1999",
          values: { name: "Spoofed Nested", campus: "west" },
        },
        agentRun: AGENT_RUN,
      });
      expect(headerOutcome).toMatchObject({ ok: true, kind: "executed", operation: "headerSave.submit" });
      expect(harness.prepared[0]?.invocation).toEqual({
        call: {
          target: { kind: "object", objectType: CUSTOMER, primaryKey: "c-1" },
          input: { values: { name: "Alice Screen", campus: "north", term: "2026-fall" } },
        },
      });

      // 2. Standalone button with interactive `reason` + bound `campus`/`term`: only `reason` comes from agent input.
      const approveOutcome = await harness.instance.executeAction({
        operation: "approveBtn.approve",
        input: {
          campus: "south",
          term: "1999",
          reason: "Verified records",
          undeclared: "drop-me",
        },
        agentRun: { ...AGENT_RUN, toolCallId: "call-2" },
      });
      expect(approveOutcome).toMatchObject({ ok: true, kind: "executed", operation: "approveBtn.approve" });
      expect(harness.prepared[1]?.invocation).toEqual({
        call: {
          target: { kind: "object", objectType: CUSTOMER, primaryKey: "c-1" },
          input: { values: { reason: "Verified records", campus: "north", term: "2026-fall" } },
        },
      });
    } finally {
      harness.unmount();
    }
  });
});

describe("Item 2.5 & 3.3: fillForm control restrictions and early-exit rejectedFields accounting", () => {
  it("enforces parent/child read-only & fixed constraints, closed select options, and unassignedFields: omit", async () => {
    const fields: PanelFormField[] = [
      { path: "/name", label: "Name", control: { kind: "text" }, valueSchema: { type: "string" }, required: true, readOnly: false },
      {
        path: "/status",
        label: "Status",
        control: {
          kind: "select",
          options: [
            { value: "active", label: "Active", description: null, disabled: false, disabledReason: null },
            { value: "archived", label: "Archived", description: null, disabled: true, disabledReason: "Archived cannot be chosen" },
          ],
        },
        valueSchema: { type: "string" },
        required: true,
        readOnly: false,
      },
      {
        path: "/lockedGroup",
        label: "Locked group",
        control: {
          kind: "object",
          fields: [
            { path: "/email", label: "Email", control: { kind: "text" }, valueSchema: { type: "string" }, required: false, readOnly: false },
          ],
        },
        valueSchema: { type: "object" },
        required: false,
        readOnly: true,
        readOnlyReason: "Group is read-only",
      },
      {
        path: "/lockedRows",
        label: "Locked rows",
        control: {
          kind: "object-array",
          itemFields: [
            { path: "/title", label: "Title", control: { kind: "text" }, valueSchema: { type: "string" }, required: false, readOnly: false },
          ],
        },
        valueSchema: { type: "array" },
        required: false,
        readOnly: true,
        readOnlyReason: "Rows are read-only",
      },
      {
        path: "/profile",
        label: "Profile",
        control: {
          kind: "object",
          fields: [
            { path: "/nickname", label: "Nickname", control: { kind: "text" }, valueSchema: { type: "string" }, required: false, readOnly: false },
            { path: "/role", label: "Role", control: { kind: "text" }, valueSchema: { type: "string" }, required: false, readOnly: true, readOnlyReason: "Role is managed by owner" },
            { path: "/org", label: "Org", control: { kind: "text" }, valueSchema: { type: "string" }, required: false, readOnly: false },
          ],
        },
        valueSchema: { type: "object" },
        required: false,
        readOnly: false,
      },
      {
        path: "/omittedSecret",
        label: "Omitted secret",
        control: { kind: "text" },
        valueSchema: { type: "string" },
        required: false,
        readOnly: false,
      },
    ];

    const formProjection: DirectProjection = {
      ...baseRecord,
      id: "restricted-form",
      name: "Restricted form",
      componentId: "@ontomato/sdk:ObjectForm",
      inputs: { task: { kind: "object", objectType: SCHEDULED_TASK } },
      outputs: {},
      config: {
        fixedFields: { "/profile/org": { literal: "HQ" } },
        groups: [
          {
            key: "main",
            title: "Main",
            fields: ["/name", "/status", "/lockedGroup", "/lockedRows", "/profile"],
          },
        ],
        unassignedFields: "omit",
      },
      data: {
        form: { source: { object: { input: "task" } }, read: "form", params: {} },
      },
      operations: {
        save: { operation: { kind: "PlatformOperation", id: `${SCHEDULED_TASK}.save` }, target: { input: "task" } },
      },
    };

    const harness = mountDirectPanel({
      manifest: {
        state: {
          selectedTask: { type: { kind: "object", objectType: SCHEDULED_TASK }, personal: false, deepLink: false, external: false },
        },
        members: {
          form: { target: { projectionId: "restricted-form" }, inputs: { task: { state: "selectedTask" } } },
        },
      },
      projections: { "restricted-form": formProjection },
      initial: { selectedTask: { className: SCHEDULED_TASK, primaryKey: "t-1" } },
      read: async (req) => {
        if (req.operations) return ready({ save: platformSaveDescriptor(SCHEDULED_TASK) });
        return ready({
          fields,
          values: {
            name: "Initial",
            status: "active",
            lockedGroup: { email: "a@example.com" },
            lockedRows: [{ title: "Row 0" }],
            profile: { nickname: "Init", role: "viewer", org: "HQ" },
            omittedSecret: "untouched",
          },
          errors: [],
          revision: 1,
          save: { method: "PUT", path: "/tasks/t-1", bodySchema: {} },
        });
      },
    });
    try {
      await vi.waitFor(() => expect(harness.element.querySelector<HTMLInputElement>('[data-field="/name"] input')?.value).toBe("Initial"));

      const outcome = await harness.instance.fillForm({
        values: {
          "/lockedGroup/email": "hack@example.com",
          "/lockedRows/0/title": "Hacked Row",
          "/profile": { nickname: "Updated", role: "admin", org: "HQ" },
          "/status": "archived",
          "/omittedSecret": "should-not-enter",
          "/name": "Valid Name",
        },
      });
      expect(outcome).toMatchObject({
        ok: true,
        member: "form",
        filledFields: ["/name"],
      });
      if (!outcome.ok) throw new Error("Expected partial fill");
      expect(outcome.rejectedFields).toEqual(expect.arrayContaining([
        expect.objectContaining({ path: "/lockedGroup/email", reason: "read_only" }),
        expect.objectContaining({ path: "/lockedRows/0/title", reason: "read_only" }),
        expect.objectContaining({ path: "/profile", reason: "read_only" }),
        expect.objectContaining({ path: "/status", reason: "invalid_value" }),
        expect.objectContaining({ path: "/omittedSecret", reason: "unknown_field" }),
      ]));
      const formValues = harness.instance.forms.handle("form")!.values.value;
      expect(formValues.name).toBe("Valid Name");
      expect((formValues.lockedGroup as Record<string, unknown>).email).toBe("a@example.com");
      expect((formValues.lockedRows as Record<string, unknown>[])[0]?.title).toBe("Row 0");
      expect((formValues.profile as Record<string, unknown>).role).toBe("viewer");
      expect(formValues.status).toBe("active");
      expect(formValues.omittedSecret).toBe("untouched");

      // Unlisted select option and fixed nested child on whole-object assignment are also rejected.
      const secondOutcome = await harness.instance.fillForm({
        overwriteUnsaved: true,
        values: {
          "/status": "not-an-option",
          "/profile": { nickname: "Updated", role: "viewer", org: "Branch" },
        },
      });
      expect(secondOutcome).toMatchObject({ ok: false, reason: "all_fields_rejected" });
      if (secondOutcome.ok) throw new Error("Expected rejection");
      expect(secondOutcome.rejectedFields).toEqual(expect.arrayContaining([
        expect.objectContaining({ path: "/status", reason: "invalid_value" }),
        expect.objectContaining({ path: "/profile", reason: "fixed" }),
      ]));

      // Preserving read-only/fixed children while updating editable sibling succeeds.
      const validComposite = await harness.instance.fillForm({
        overwriteUnsaved: true,
        values: {
          "/status": "active",
          "/profile": { nickname: "Updated", role: "viewer", org: "HQ" },
        },
      });
      expect(validComposite).toMatchObject({ ok: true, filledFields: ["/status", "/profile"] });
    } finally {
      harness.unmount();
    }
  });

  it("records all remaining trailing fields in rejectedFields when fillForm exits early during refreshOnChange", async () => {
    const refreshDeferred = deferred<PanelFormDescription>();
    const baseDescription = (category = "general"): PanelFormDescription => ({
      fields: [
        {
          path: "/category",
          label: "Category",
          control: {
            kind: "select",
            options: [
              { value: "general", label: "General", description: null, disabled: false, disabledReason: null },
              { value: "tech", label: "Tech", description: null, disabled: false, disabledReason: null },
            ],
          },
          valueSchema: { type: "string" },
          required: true,
          readOnly: false,
          refreshOnChange: true,
        },
        { path: "/detail", label: "Detail", control: { kind: "text" }, valueSchema: { type: "string" }, required: false, readOnly: false },
        { path: "/note", label: "Note", control: { kind: "text" }, valueSchema: { type: "string" }, required: false, readOnly: false },
      ],
      values: { category, detail: "", note: "" },
      errors: [],
      revision: 1,
      save: { method: "PUT", path: "/tasks/t-1", bodySchema: {} },
    });

    const formProjection: DirectProjection = {
      ...baseRecord,
      id: "refresh-form",
      name: "Refresh form",
      componentId: "@ontomato/sdk:ObjectForm",
      inputs: { task: { kind: "object", objectType: SCHEDULED_TASK } },
      outputs: {},
      config: {},
      data: {
        form: { source: { object: { input: "task" } }, read: "form", params: {} },
      },
      operations: {
        save: { operation: { kind: "PlatformOperation", id: `${SCHEDULED_TASK}.save` }, target: { input: "task" } },
      },
    };

    const harness = mountDirectPanel({
      manifest: {
        state: {
          selectedTask: { type: { kind: "object", objectType: SCHEDULED_TASK }, personal: false, deepLink: false, external: false },
        },
        members: {
          form: { target: { projectionId: "refresh-form" }, inputs: { task: { state: "selectedTask" } } },
        },
      },
      projections: { "refresh-form": formProjection },
      initial: { selectedTask: { className: SCHEDULED_TASK, primaryKey: "t-1" } },
      read: async (req) => {
        if (req.operations) return ready({ save: platformSaveDescriptor(SCHEDULED_TASK) });
        if (req.runtimeParams?.changedField === "/category") {
          return ready(await refreshDeferred.promise);
        }
        return ready(baseDescription());
      },
    });
    try {
      await vi.waitFor(() => expect(harness.element.querySelector('[data-field="/detail"] input')).not.toBeNull());

      const fillPromise = harness.instance.fillForm({
        values: { "/category": "tech", "/detail": "GPU", "/note": "urgent" },
      });
      await nextTick();

      // User edits `/note` while the owner refresh for `/category` is still pending.
      harness.instance.forms.handle("form")!.set("/note", "user-typed");
      refreshDeferred.resolve(baseDescription("tech"));

      const outcome = await fillPromise;
      expect(outcome).toMatchObject({
        ok: true,
        member: "form",
        filledFields: ["/category"],
      });
      if (!outcome.ok) throw new Error("Expected partial fill");
      expect(outcome.rejectedFields).toHaveLength(2);
      expect(outcome.rejectedFields).toEqual(expect.arrayContaining([
        expect.objectContaining({ path: "/detail", reason: "read_only" }),
        expect.objectContaining({ path: "/note", reason: "read_only" }),
      ]));
      expect(harness.instance.forms.handle("form")!.values.value.detail).toBe("");
      expect(harness.instance.forms.handle("form")!.values.value.note).toBe("user-typed");
    } finally {
      harness.unmount();
    }
  });

  it("enforces whole-form read-only overlay on platform ObjectForm when no save operation is admitted", async () => {
    const formProjection: DirectProjection = {
      ...baseRecord,
      id: "nosave-platform-form",
      name: "No-save platform form",
      componentId: "@ontomato/sdk:ObjectForm",
      inputs: { task: { kind: "object", objectType: SCHEDULED_TASK } },
      outputs: {},
      config: {},
      data: {
        form: { source: { object: { input: "task" } }, read: "form", params: {} },
      },
      operations: {
        save: { operation: { kind: "PlatformOperation", id: `${SCHEDULED_TASK}.save` }, target: { input: "task" } },
      },
    };

    const harness = mountDirectPanel({
      manifest: {
        state: {
          selectedTask: { type: { kind: "object", objectType: SCHEDULED_TASK }, personal: false, deepLink: false, external: false },
        },
        members: {
          form: { target: { projectionId: "nosave-platform-form" }, inputs: { task: { state: "selectedTask" } } },
        },
      },
      projections: { "nosave-platform-form": formProjection },
      initial: { selectedTask: { className: SCHEDULED_TASK, primaryKey: "t-1" } },
      read: async (req) => {
        if (req.operations) return ready({});
        return ready({
          fields: [
            { path: "/name", label: "Name", control: { kind: "text" }, valueSchema: { type: "string" }, required: true, readOnly: false },
            {
              path: "/settings",
              label: "Settings",
              control: {
                kind: "object",
                fields: [
                  {
                    path: "/mode",
                    label: "Mode",
                    control: {
                      kind: "select",
                      options: [
                        { value: "cron", label: "Cron", description: null, disabled: false, disabledReason: null },
                        { value: "manual", label: "Manual", description: null, disabled: false, disabledReason: null },
                      ],
                    },
                    valueSchema: { type: "string" },
                    required: true,
                    readOnly: false,
                  },
                ],
                variantBy: "/mode",
                variants: {
                  cron: [
                    { path: "/expr", label: "Expression", control: { kind: "text" }, valueSchema: { type: "string" }, required: false, readOnly: false },
                  ],
                },
              },
              valueSchema: { type: "object" },
              required: false,
              readOnly: false,
            },
            {
              path: "/items",
              label: "Items",
              control: {
                kind: "object-array",
                itemFields: [
                  { path: "/label", label: "Label", control: { kind: "text" }, valueSchema: { type: "string" }, required: true, readOnly: false },
                ],
              },
              valueSchema: { type: "array" },
              required: false,
              readOnly: false,
            },
          ],
          values: {
            name: "Readonly Task",
            settings: { mode: "cron", expr: "0 * * * *" },
            items: [{ label: "Step 1" }],
          },
          errors: [],
          revision: 1,
          save: { method: "PUT", path: "/tasks/t-1", bodySchema: {} },
        });
      },
    });
    try {
      await vi.waitFor(() => expect(harness.element.querySelector('[data-field="/name"]')).not.toBeNull());
      // Wait for operations read to settle with no admitted save, applying the whole-form read-only overlay.
      await vi.waitFor(() => {
        const handle = harness.instance.forms.handle("form");
        expect(handle?.fields.value.every((field) => field.readOnly)).toBe(true);
      });

      const outcome = await harness.instance.fillForm({
        values: {
          "/name": "Mutated",
          "/settings/mode": "manual",
          "/settings/expr": "*/5 * * * *",
          "/items/0/label": "Mutated Step",
          "/items": [{ label: "Replaced" }],
        },
      });
      expect(outcome).toMatchObject({
        ok: false,
        reason: "all_fields_rejected",
      });
      if (outcome.ok) throw new Error("Expected fillForm to reject all fields when save is not admitted");
      expect(outcome.rejectedFields).toHaveLength(5);
      for (const rejected of outcome.rejectedFields ?? []) {
        expect(rejected.reason).toBe("read_only");
      }
      expect(harness.instance.forms.handle("form")!.values.value).toEqual({
        name: "Readonly Task",
        settings: { mode: "cron", expr: "0 * * * *" },
        items: [{ label: "Step 1" }],
      });
    } finally {
      harness.unmount();
    }
  });

  it("records remaining fields in rejectedFields when target switches during async refreshOnChange", async () => {
    const refreshDeferred = deferred<PanelFormDescription>();
    const descriptionFor = (key: string, category = "general"): PanelFormDescription => ({
      fields: [
        {
          path: "/category",
          label: "Category",
          control: {
            kind: "select",
            options: [
              { value: "general", label: "General", description: null, disabled: false, disabledReason: null },
              { value: "tech", label: "Tech", description: null, disabled: false, disabledReason: null },
            ],
          },
          valueSchema: { type: "string" },
          required: true,
          readOnly: false,
          refreshOnChange: true,
        },
        { path: "/detail", label: "Detail", control: { kind: "text" }, valueSchema: { type: "string" }, required: false, readOnly: false },
      ],
      values: { category, detail: `Detail ${key}` },
      errors: [],
      revision: 1,
      save: { method: "PUT", path: `/tasks/${key}`, bodySchema: {} },
    });

    const formProjection: DirectProjection = {
      ...baseRecord,
      id: "switch-form",
      name: "Switch form",
      componentId: "@ontomato/sdk:ObjectForm",
      inputs: { task: { kind: "object", objectType: SCHEDULED_TASK } },
      outputs: {},
      config: {},
      data: {
        form: { source: { object: { input: "task" } }, read: "form", params: {} },
      },
      operations: {
        save: { operation: { kind: "PlatformOperation", id: `${SCHEDULED_TASK}.save` }, target: { input: "task" } },
      },
    };

    const harness = mountDirectPanel({
      manifest: {
        state: {
          selectedTask: { type: { kind: "object", objectType: SCHEDULED_TASK }, personal: false, deepLink: false, external: false },
        },
        members: {
          form: { target: { projectionId: "switch-form" }, inputs: { task: { state: "selectedTask" } } },
        },
      },
      projections: { "switch-form": formProjection },
      initial: { selectedTask: { className: SCHEDULED_TASK, primaryKey: "t-1" } },
      read: async (req) => {
        if (req.operations) return ready({ save: platformSaveDescriptor(SCHEDULED_TASK) });
        const pk = (req.inputs.task as { primaryKey: string }).primaryKey;
        if (req.runtimeParams?.changedField === "/category") {
          return ready(await refreshDeferred.promise);
        }
        return ready(descriptionFor(pk));
      },
    });
    try {
      await vi.waitFor(() => expect(harness.element.querySelector<HTMLInputElement>('[data-field="/detail"] input')?.value).toBe("Detail t-1"));

      const fillPromise = harness.instance.fillForm({
        values: { "/category": "tech", "/detail": "Should not leak to t-2" },
      });
      await nextTick();

      // Switch selected object to t-2 (discarding t-1 via confirmLeaveUnsaved or direct discard) while refresh is pending.
      harness.instance.forms.discard("form");
      harness.instance.state.set("selectedTask", { className: SCHEDULED_TASK, primaryKey: "t-2" });
      await nextTick();
      refreshDeferred.resolve(descriptionFor("t-1", "tech"));

      const outcome = await fillPromise;
      expect(outcome).toMatchObject({
        ok: true,
        member: "form",
        filledFields: ["/category"],
        rejectedFields: [expect.objectContaining({ path: "/detail", reason: "unknown_field" })],
      });
      await vi.waitFor(() => expect(harness.element.querySelector<HTMLInputElement>('[data-field="/detail"] input')?.value).toBe("Detail t-2"));
    } finally {
      harness.unmount();
    }
  });
});

describe("Item 3.4: Distinguish loading (action_not_ready) from unauthorized missing descriptor (action_unavailable)", () => {
  it("reports action_not_ready while loading and action_unavailable with permission reason once ready without descriptor", async () => {
    const opsLoading = deferred<ProductPanelOperationsReadResponse>();
    const listOpsLoading = deferred<ProductPanelOperationsReadResponse>();
    const formOpsLoading = deferred<ProductPanelOperationsReadResponse>();

    const projections: Record<string, DirectProjection> = {
      "delete-btn": {
        ...baseRecord,
        id: "delete-btn",
        name: "Delete button",
        componentId: "@ontomato/sdk:OperationButton",
        inputs: { app: { kind: "object", objectType: APPLICATION } },
        outputs: {},
        config: { operation: "delete" },
        data: {},
        operations: {
          delete: { operation: { kind: "PlatformOperation", id: `${APPLICATION}.delete` }, target: { input: "app" } },
        },
      },
      "entries-list": {
        ...baseRecord,
        id: "entries-list",
        name: "Entries",
        componentId: "@ontomato/sdk:ObjectList",
        inputs: {},
        outputs: {},
        config: {
          columns: [{ key: "label", label: "Entry" }],
          rowActions: { items: [{ kind: "operation", operation: "remove", label: "Remove" }] },
        },
        data: {
          rows: { source: { type: { kind: "PlatformObjectType", id: SCHEDULED_TASK } }, read: "list", params: {} },
        },
        operations: {
          remove: {
            operation: { kind: "PlatformOperation", id: "schedules.deleteTask" },
            target: { row: true },
          },
        },
      },
      "task-form": {
        ...baseRecord,
        id: "task-form",
        name: "Task form",
        componentId: "@ontomato/sdk:ObjectForm",
        inputs: { task: { kind: "object", objectType: SCHEDULED_TASK } },
        outputs: {},
        config: {},
        data: {
          form: { source: { object: { input: "task" } }, read: "form", params: {} },
        },
        operations: {
          save: { operation: { kind: "PlatformOperation", id: `${SCHEDULED_TASK}.save` }, target: { input: "task" } },
        },
      },
    };

    const harness = mountDirectPanel({
      manifest: {
        state: {
          selectedApp: { type: { kind: "object", objectType: APPLICATION }, personal: false, deepLink: false, external: false },
          selectedTask: { type: { kind: "object", objectType: SCHEDULED_TASK }, personal: false, deepLink: false, external: false },
        },
        members: {
          deleteBtn: { target: { projectionId: "delete-btn" }, inputs: { app: { state: "selectedApp" } } },
          entries: { target: { projectionId: "entries-list" } },
          taskForm: { target: { projectionId: "task-form" }, inputs: { task: { state: "selectedTask" } } },
        },
      },
      projections,
      initial: {
        selectedApp: { className: APPLICATION, primaryKey: "app-1" },
        selectedTask: { className: SCHEDULED_TASK, primaryKey: "t-1" },
      },
      read: async (req) => {
        const member = req.memberPath.at(-1)?.member;
        if (req.operations) {
          if (member === "deleteBtn") return opsLoading.promise;
          if (member === "entries") return listOpsLoading.promise;
          return formOpsLoading.promise;
        }
        if (member === "entries") {
          return ready([{ primaryKey: "row-1", label: "Entry 1", fields: {} }]);
        }
        return ready({
          fields: [
            { path: "/name", label: "Name", control: { kind: "text" }, valueSchema: { type: "string" }, required: true, readOnly: false },
          ],
          values: { name: "Task 1" },
          errors: [],
          revision: 1,
          save: { method: "PUT", path: "/tasks/t-1", bodySchema: {} },
        });
      },
    });
    try {
      await vi.waitFor(() => expect(harness.element.textContent).toContain("Entry 1"));
      await vi.waitFor(() => expect(harness.element.querySelector<HTMLInputElement>('[data-field="/name"] input')?.value).toBe("Task 1"));

      // 1. While operations are still loading -> action_not_ready ("not ready yet").
      const btnLoading = await harness.instance.executeAction({ operation: "deleteBtn.delete", agentRun: AGENT_RUN });
      expect(btnLoading).toMatchObject({ ok: false, reason: "action_not_ready" });
      expect(btnLoading.ok ? "" : btnLoading.message).toContain("not ready yet");

      const rowLoading = await harness.instance.executeAction({
        operation: "entries.remove",
        rowKey: "row-1",
        agentRun: AGENT_RUN,
      });
      expect(rowLoading).toMatchObject({ ok: false, reason: "action_not_ready" });
      expect(rowLoading.ok ? "" : rowLoading.message).toContain("not ready yet");

      const formLoading = await harness.instance.executeAction({ operation: "taskForm.save", agentRun: AGENT_RUN });
      expect(formLoading).toMatchObject({ ok: false, reason: "action_not_ready" });
      expect(formLoading.ok ? "" : formLoading.message).toContain("not ready yet");

      // 2. Once operations finish loading without admitting the operation (no permission) -> action_unavailable, NOT "not ready yet".
      opsLoading.resolve({ status: "ready", value: {} });
      listOpsLoading.resolve({ status: "ready", value: {} });
      formOpsLoading.resolve({ status: "forbidden", reason: "No permission to save tasks" });

      await vi.waitFor(async () => {
        const btnDenied = await harness.instance.executeAction({ operation: "deleteBtn.delete", agentRun: AGENT_RUN });
        expect(btnDenied).toMatchObject({ ok: false, reason: "action_unavailable" });
        expect(btnDenied.ok ? "" : btnDenied.message).not.toContain("not ready yet");
        expect(btnDenied.ok ? "" : btnDenied.message).toContain("not permitted");
      });

      const rowDenied = await harness.instance.executeAction({
        operation: "entries.remove",
        rowKey: "row-1",
        agentRun: AGENT_RUN,
      });
      expect(rowDenied).toMatchObject({ ok: false, reason: "action_unavailable" });
      expect(rowDenied.ok ? "" : rowDenied.message).not.toContain("not ready yet");
      expect(rowDenied.ok ? "" : rowDenied.message).toContain("not permitted");

      const formDenied = await harness.instance.executeAction({ operation: "taskForm.save", agentRun: AGENT_RUN });
      expect(formDenied).toMatchObject({ ok: false, reason: "action_unavailable" });
      expect(formDenied.ok ? "" : formDenied.message).toContain("No permission to save tasks");
    } finally {
      harness.unmount();
    }
  });
});
