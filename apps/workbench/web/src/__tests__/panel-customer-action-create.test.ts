import { afterEach, describe, expect, it, vi } from "vitest";
import { createApp, h, nextTick, ref } from "vue";
import { createI18n } from "vue-i18n";
import ElementPlus, { ElMessage } from "element-plus";
import publicEn from "@ontomato/workbench-ui/locales/en";
import type { DirectPanelManifest } from "@ontomato/contracts/panel-manifest";
import type { DirectProjection } from "@ontomato/contracts/product-panels";
import type { ProductPanelReadResponse } from "@ontomato/contracts/panel-host";
import type { PanelHumanOperationPreparation } from "@ontomato/contracts/panel-agent";
import type { PanelOwnerOperationDescriptor } from "@ontomato/contracts/panel-operations";
import { createDirectPanelInstance, type PanelMemberReadRequest } from "../../../../../packages/apps-sdk/src/panel/direct";
import PanelMember from "../../../../../packages/apps-sdk/src/panel/PanelMember.vue";
import { createPanelText } from "../../../../../packages/apps-sdk/src/panel/text";
import { noOperations } from "./panel-frame";

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

const ORDER = "CustomerOrder";

const createOrderDescriptor: PanelOwnerOperationDescriptor = {
  kind: "action",
  handlerRef: "actions.execute",
  label: "Create order",
  effect: "write",
  batch: false,
  target: { source: "none" },
  inputSchema: {
    type: "object",
    properties: {
      values: {
        type: "object",
        properties: {
          customer: { type: "string", title: "Customer", description: "Customer name" },
          amount: { type: "string", title: "Amount", contentMediaType: "application/json" },
        },
        additionalProperties: false,
      },
    },
    required: ["values"],
    additionalProperties: false,
  },
  resultSchema: {},
};

const createFormDescription = {
  fields: [
    { path: "/customer", label: "Customer", valueSchema: { type: "string" }, required: true, readOnly: false, control: { kind: "text" } },
    { path: "/amount", label: "Amount", valueSchema: { type: ["number", "null"] }, required: false, readOnly: false, control: { kind: "number" } },
  ],
  values: { customer: "", amount: null },
  errors: [],
  save: { method: "POST", path: "/ontology/objects/CustomerOrder", bodySchema: {}, draftOperation: "CustomerOrder.create" },
};

function mountCreatePanel(options: {
  manifest: DirectPanelManifest;
  projections: Record<string, DirectProjection>;
  answer: (request: PanelMemberReadRequest) => ProductPanelReadResponse | Promise<ProductPanelReadResponse>;
  initial?: Record<string, unknown>;
}) {
  const reads: PanelMemberReadRequest[] = [];
  const prepared: [string, unknown][] = [];
  const savedEvents: unknown[] = [];
  const recordedDrafts: { link: unknown; created: string }[] = [];
  let outcome: unknown = {
    kind: "success",
    data: { result: "{\"ok\":true}", affects: [ORDER] },
    affected: { objects: [], objectTypes: [ORDER] },
  };

  const prepare = vi.fn(async (operationId: string, invocation: unknown): Promise<PanelHumanOperationPreparation> => {
    prepared.push([operationId, invocation]);
    return {
      intentId: "5f0c1a2e-6a0b-4f8e-9a51-0c6f3e2b1d99",
      operationId,
      label: operationId,
      confirmation: { kind: "none" },
    };
  });

  const instance = createDirectPanelInstance(options.manifest, {
    readComponentPackage: noOperations.readComponentPackage,
    pageKey: "customer-orders",
    url: () => "/customer-orders",
    label: () => "Customer Orders",
    initial: (options.initial ?? {}) as never,
    text: createPanelText({}, ref("en"), "en"),
    operations: { ...noOperations.operations, prepare },
    expandPageComposer: noOperations.expandPageComposer,
    navigate: noOperations.navigate,
    nested: noOperations.nested,
    confirmOperation: async ({ intentId }) => {
      const result = {
        decision: "confirm" as const,
        response: { kind: "dispatched" as const, intentId, outcome: outcome as never },
      };
      const maybeAffected = (outcome as { kind?: string; affected?: unknown })?.kind === "success"
        ? (outcome as { affected?: unknown }).affected
        : undefined;
      if (maybeAffected) instance.refresh(maybeAffected as never);
      return result;
    },
    recordDraftCreated: async (link, created) => {
      recordedDrafts.push({ link, created });
    },
    reportDraftError: () => {},
    readProjection: async (id) => options.projections[id]!,
    read: async (request) => {
      reads.push(request);
      return options.answer(request);
    },
  });

  const element = document.createElement("div");
  document.body.append(element);
  const memberKeys = Object.keys(options.manifest.members);
  const app = createApp({
    render: () => h(
      "div",
      memberKeys.map((member) =>
        h(PanelMember, {
          instance,
          member,
          onSaved: (payload: unknown) => {
            savedEvents.push(payload);
          },
        })),
    ),
  });
  app.use(createI18n({ legacy: false, locale: "en", messages: { en: publicEn } })).use(ElementPlus).mount(element);

  return {
    instance,
    element,
    reads,
    prepared,
    savedEvents,
    recordedDrafts,
    setOutcome: (next: unknown) => { outcome = next; },
    unmount: () => app.unmount(),
  };
}

afterEach(() => {
  ElMessage.closeAll();
  document.querySelectorAll(".el-message, .el-message-box__wrapper, .el-overlay").forEach((node) => node.remove());
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

describe("ObjectForm create mode with targetless customer Action", () => {
  const projections: Record<string, DirectProjection> = {
    "order-list": {
      ...baseRecord,
      id: "order-list",
      name: "Orders",
      componentId: "@ontomato/sdk:ObjectList",
      inputs: {},
      outputs: { selected: { kind: "object", objectType: ORDER } },
      config: {},
      data: {
        rows: { source: { type: { kind: "ObjectType", id: ORDER } }, read: "query", params: {} },
      },
    },
    "order-form": {
      ...baseRecord,
      id: "order-form",
      name: "Order form",
      componentId: "@ontomato/sdk:ObjectForm",
      inputs: {
        target: { kind: "object", objectType: ORDER },
      },
      outputs: {},
      config: {},
      data: {
        form: { source: { object: { input: "target" } }, read: "form", params: {} },
        createForm: { source: { type: { kind: "ObjectType", id: ORDER } }, read: "createForm", params: {} },
      },
      operations: {
        save: { operation: { kind: "Action", id: "create-order" } },
      },
    },
  };

  const manifest: DirectPanelManifest = {
    state: {
      selected: { type: { kind: "object", objectType: ORDER }, personal: false, deepLink: true, external: false },
    },
    members: {
      orderList: { target: { projectionId: "order-list" }, outputs: { selected: { state: "selected" } } },
      orderForm: { target: { projectionId: "order-form" }, inputs: { target: { state: "selected" } } },
    },
  };

  it("human create succeeds without primaryKey: resets form cleanly, notifies success, emits saved(null), and refreshes sibling ObjectList", async () => {
    let listReadCount = 0;
    const harness = mountCreatePanel({
      manifest,
      projections,
      answer: (request) => {
        if (request.operations) return ready({ save: createOrderDescriptor });
        if (request.dataName === "rows") {
          listReadCount += 1;
          return ready({
            rows: listReadCount === 1
              ? [{ primaryKey: "ord-1", label: "Existing order", fields: { customer: "Old Co" } }]
              : [
                  { primaryKey: "ord-1", label: "Existing order", fields: { customer: "Old Co" } },
                  { primaryKey: "ord-2", label: "ACME order", fields: { customer: "ACME" } },
                ],
            total: listReadCount,
          });
        }
        return ready(createFormDescription);
      },
    });
    try {
      const customerInput = () => harness.element.querySelector<HTMLInputElement>('[data-field="/customer"] input')!;
      await vi.waitFor(() => expect(customerInput()).not.toBeNull());
      await vi.waitFor(() => expect(listReadCount).toBe(1));

      customerInput().value = "ACME";
      customerInput().dispatchEvent(new Event("input"));
      await nextTick();
      expect(harness.instance.forms.dirty("orderForm")).toBe(true);

      const createBtn = [...harness.element.querySelectorAll<HTMLButtonElement>(".sdk-owner-form-actions button")]
        .find((button) => button.textContent?.trim() === "Create")!;
      createBtn.click();

      await vi.waitFor(() => expect(harness.prepared).toHaveLength(1));
      expect(harness.prepared[0]).toEqual([
        "orderForm.save",
        { call: { target: null, input: { values: { customer: "ACME", amount: "null" } } } },
      ]);

      // Cleanly reset without error, success notification shown, saved emitted with primaryKey: null, and list refreshed.
      await vi.waitFor(() => expect(harness.savedEvents).toEqual([{ className: ORDER, primaryKey: null }]));
      expect(harness.element.querySelector('[role="alert"]')).toBeNull();
      expect(harness.instance.forms.dirty("orderForm")).toBe(false);
      expect(customerInput().value).toBe("");
      expect(harness.instance.state.values.value.selected).toBeNull();
      await vi.waitFor(() => expect(document.querySelector(".el-message--success")?.textContent).toContain(publicEn.platform.operationDone));
      await vi.waitFor(() => expect(listReadCount).toBe(2));
    } finally {
      harness.unmount();
    }
  });

  it("agent create draft follows the exact same clean settlement when targetless Action omits primaryKey", async () => {
    const harness = mountCreatePanel({
      manifest,
      projections,
      answer: (request) => {
        if (request.operations) return ready({ save: createOrderDescriptor });
        if (request.dataName === "rows") return ready({ rows: [], total: 0 });
        const values = (request.runtimeParams?.values as Record<string, unknown> | undefined) ?? { customer: "", amount: null };
        return ready({ ...createFormDescription, values });
      },
    });
    try {
      const customerInput = () => harness.element.querySelector<HTMLInputElement>('[data-field="/customer"] input')!;
      await vi.waitFor(() => expect(customerInput()).not.toBeNull());

      // Receive an agent create draft on the form.
      const link = { sessionId: "s-1", runId: "r-1", path: "outputs/drafts/new-order.page-draft.json" };
      const draft = {
        pageKey: "customer-orders",
        operation: "CustomerOrder.create",
        target: { objectType: ORDER },
        form: { customer: "Agent Corp", amount: 88 },
      };
      harness.instance.forms.hold(
        draft,
        link,
        harness.instance.receiveDraft,
        () => true,
        () => {},
        harness.instance.rollbackDraft,
      );
      await vi.waitFor(() => expect(customerInput().value).toBe("Agent Corp"));
      expect(harness.instance.draft.value?.slot).toBe("orderForm");

      await harness.instance.forms.submit("orderForm");

      expect(harness.savedEvents).toEqual([{ className: ORDER, primaryKey: null }]);
      expect(harness.element.querySelector('[role="alert"]')).toBeNull();
      expect(harness.instance.draft.value).toBeNull();
      expect(harness.recordedDrafts).toEqual([]);
      expect(harness.instance.forms.dirty("orderForm")).toBe(false);
      expect(customerInput().value).toBe("");
      await vi.waitFor(() => expect(document.querySelector(".el-message--success")?.textContent).toContain(publicEn.platform.operationDone));
    } finally {
      harness.unmount();
    }
  });

  it("switches to the newly created object when the Action reports a unique created object in affected.objects", async () => {
    const harness = mountCreatePanel({
      manifest,
      projections,
      answer: (request) => {
        if (request.operations) return ready({ save: createOrderDescriptor });
        if (request.dataName === "rows") return ready({ rows: [], total: 0 });
        if (request.dataName === "form") {
          return ready({
            ...createFormDescription,
            values: { customer: "New Co", amount: 55 },
            save: { method: "PUT", path: "/ontology/objects/CustomerOrder", bodySchema: {}, draftOperation: "CustomerOrder.update" },
          });
        }
        return ready(createFormDescription);
      },
    });
    try {
      const customerInput = () => harness.element.querySelector<HTMLInputElement>('[data-field="/customer"] input')!;
      await vi.waitFor(() => expect(customerInput()).not.toBeNull());

      customerInput().value = "New Co";
      customerInput().dispatchEvent(new Event("input"));
      await nextTick();

      harness.setOutcome({
        kind: "success",
        data: { result: "{\"id\":\"ord-99\"}", affects: [ORDER] },
        affected: { objects: [{ objectType: ORDER, primaryKey: "ord-99" }], objectTypes: [ORDER] },
      });

      await harness.instance.forms.submit("orderForm");

      expect(harness.savedEvents).toEqual([{ className: ORDER, primaryKey: "ord-99" }]);
      expect(harness.instance.state.values.value.selected).toEqual({ className: ORDER, primaryKey: "ord-99" });
    } finally {
      harness.unmount();
    }
  });
});

describe("OperationButton with targetless customer Action", () => {
  it("opens the parameter dialog with unwrapped Action parameters and submits { target: null, input: { values } }", async () => {
    const projections: Record<string, DirectProjection> = {
      "create-btn": {
        ...baseRecord,
        id: "create-btn",
        name: "Create order",
        componentId: "@ontomato/sdk:OperationButton",
        inputs: {},
        outputs: {},
        config: { operation: "create" },
        data: {},
        operations: {
          create: { operation: { kind: "Action", id: "create-order" } },
        },
      },
    };
    const manifest: DirectPanelManifest = {
      state: {},
      members: {
        createBtn: { target: { projectionId: "create-btn" } },
      },
    };
    const harness = mountCreatePanel({
      manifest,
      projections,
      answer: (request) => (request.operations ? ready({ create: createOrderDescriptor }) : ready({})),
    });
    try {
      const btn = await vi.waitFor(() => {
        const found = harness.element.querySelector<HTMLButtonElement>(".sdk-operation-button button");
        if (!found || found.disabled) throw new Error("Button not ready");
        return found;
      });
      btn.click();

      const dialog = await vi.waitFor(() => {
        const found = document.querySelector<HTMLElement>(".sdk-operation-input-dialog");
        if (!found) throw new Error("Dialog not open");
        return found;
      });
      expect(dialog.querySelector('[data-input-field="customer"] input')).not.toBeNull();
      expect(dialog.querySelector('[data-input-field="amount"] input')).not.toBeNull();
      expect(dialog.querySelector('[data-input-field="values"]')).toBeNull();

      const customerInput = dialog.querySelector<HTMLInputElement>('[data-input-field="customer"] input')!;
      customerInput.value = "Globex";
      customerInput.dispatchEvent(new Event("input"));
      const amountInput = dialog.querySelector<HTMLInputElement>('[data-input-field="amount"] input')!;
      amountInput.value = "120";
      amountInput.dispatchEvent(new Event("input"));
      await nextTick();

      const confirmBtn = [...dialog.querySelectorAll<HTMLButtonElement>(".sdk-operation-input-footer button")]
        .find((button) => button.textContent?.trim() === "Confirm")!;
      confirmBtn.click();

      await vi.waitFor(() => expect(harness.prepared).toHaveLength(1));
      expect(harness.prepared[0]).toEqual([
        "createBtn.create",
        { call: { target: null, input: { values: { customer: "Globex", amount: "120" } } } },
      ]);
    } finally {
      harness.unmount();
    }
  });

  it("dispatches immediately with { values: {} } when a targetless Action declares zero parameters", async () => {
    const noParamDescriptor: PanelOwnerOperationDescriptor = {
      ...createOrderDescriptor,
      label: "Rebuild index",
      inputSchema: {
        type: "object",
        properties: {
          values: { type: "object", properties: {}, additionalProperties: false },
        },
        required: ["values"],
        additionalProperties: false,
      },
    };
    const projections: Record<string, DirectProjection> = {
      "rebuild-btn": {
        ...baseRecord,
        id: "rebuild-btn",
        name: "Rebuild index",
        componentId: "@ontomato/sdk:OperationButton",
        inputs: {},
        outputs: {},
        config: { operation: "rebuild" },
        data: {},
        operations: {
          rebuild: { operation: { kind: "Action", id: "rebuild-index" } },
        },
      },
    };
    const manifest: DirectPanelManifest = {
      state: {},
      members: {
        rebuildBtn: { target: { projectionId: "rebuild-btn" } },
      },
    };
    const harness = mountCreatePanel({
      manifest,
      projections,
      answer: (request) => (request.operations ? ready({ rebuild: noParamDescriptor }) : ready({})),
    });
    try {
      const btn = await vi.waitFor(() => {
        const found = harness.element.querySelector<HTMLButtonElement>(".sdk-operation-button button");
        if (!found || found.disabled) throw new Error("Button not ready");
        return found;
      });
      btn.click();

      await vi.waitFor(() => expect(harness.prepared).toHaveLength(1));
      expect(document.querySelector(".sdk-operation-input-dialog")).toBeNull();
      expect(harness.prepared[0]).toEqual([
        "rebuildBtn.rebuild",
        { call: { target: null, input: { values: {} } } },
      ]);
    } finally {
      harness.unmount();
    }
  });
});
