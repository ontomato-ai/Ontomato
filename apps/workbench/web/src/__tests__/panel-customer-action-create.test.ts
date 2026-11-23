import { afterEach, describe, expect, it, vi } from "vitest";
import { nextTick } from "vue";
import { ElMessage } from "element-plus";
import publicEn from "@ontomato/workbench-ui/locales/en";
import type { DirectPanelManifest } from "@ontomato/contracts/panel-manifest";
import type { DirectProjection } from "@ontomato/contracts/product-panels";
import type { PanelOwnerOperationDescriptor } from "@ontomato/contracts/panel-operations";
import { baseRecord, mountCreatePanel, ORDER, ready } from "./customer-action-form-fixture";

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

  it("switches to the newly created object on a save receipt with a unique primary key", async () => {
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
        const values = (request.runtimeParams?.values as Record<string, unknown> | undefined) ?? { customer: "", amount: null };
        return ready({ ...createFormDescription, values });
      },
    });
    try {
      const customerInput = () => harness.element.querySelector<HTMLInputElement>('[data-field="/customer"] input')!;
      await vi.waitFor(() => expect(customerInput()).not.toBeNull());

      const link = { sessionId: "s-1", runId: "r-3", path: "outputs/drafts/order-3.page-draft.json" };
      const draft = {
        pageKey: "customer-orders",
        operation: "CustomerOrder.create",
        target: { objectType: ORDER },
        form: { customer: "New Co", amount: 55 },
      };
      harness.instance.forms.hold(draft, link, harness.instance.receiveDraft, () => true, () => {}, harness.instance.rollbackDraft);
      await vi.waitFor(() => expect(customerInput().value).toBe("New Co"));

      // Server `/operate` dispatch reports a unique created object in affected.objects.
      harness.instance.refresh(
        { objects: [{ objectType: ORDER, primaryKey: "ord-99" }], objectTypes: [ORDER] },
        { operationId: "orderForm.save", panelId: "panel-orders", target: null },
      );

      await vi.waitFor(() => expect(harness.savedEvents).toEqual([{ className: ORDER, primaryKey: "ord-99" }]));
      expect(harness.prepared).toHaveLength(0);
      expect(harness.instance.state.values.value.selected).toEqual({ className: ORDER, primaryKey: "ord-99" });
      await vi.waitFor(() => expect(harness.recordedDrafts).toEqual([{ link, created: "ord-99" }]));
      expect(harness.instance.draft.value).toBeNull();
    } finally {
      harness.unmount();
    }
  });

  it("emits form-edited on edit-mode Discard and settles edit ObjectForm on a save receipt", async () => {
    const editOrderDescriptor: PanelOwnerOperationDescriptor = {
      ...createOrderDescriptor,
      label: "Update order",
      target: { source: "input", input: "target" },
    };
    const editProjections: Record<string, DirectProjection> = {
      ...projections,
      "order-form": {
        ...projections["order-form"]!,
        operations: {
          save: { operation: { kind: "Action", id: "update-order" }, target: { input: "target" } },
        },
      },
    };
    let serverCustomer = "Old Co";
    let listReadCount = 0;
    const formEditedEvents: unknown[] = [];
    const harness = mountCreatePanel({
      manifest,
      projections: editProjections,
      initial: { selected: { className: ORDER, primaryKey: "ord-1" } },
      answer: (request) => {
        if (request.operations) return ready({ save: editOrderDescriptor });
        if (request.dataName === "rows") {
          listReadCount += 1;
          return ready({
            rows: [{ primaryKey: "ord-1", label: serverCustomer, fields: { customer: serverCustomer } }],
            total: 1,
          });
        }
        const values = (request.runtimeParams?.values as Record<string, unknown> | undefined) ?? { customer: serverCustomer, amount: 10 };
        return ready({
          ...createFormDescription,
          values,
          save: { method: "PUT", path: "/ontology/objects/CustomerOrder", bodySchema: {}, draftOperation: "CustomerOrder.update" },
        });
      },
    });
    harness.instance.onFormEdited((target) => formEditedEvents.push(target));
    try {
      const customerInput = () => harness.element.querySelector<HTMLInputElement>('[data-field="/customer"] input')!;
      await vi.waitFor(() => expect(customerInput()?.value).toBe("Old Co"));
      await vi.waitFor(() => expect(listReadCount).toBe(1));

      // Agent delivers an edit draft into the open form.
      const link1 = { sessionId: "s-2", runId: "r-1", path: "outputs/drafts/edit-1.page-draft.json" };
      harness.instance.forms.hold(
        {
          pageKey: "customer-orders",
          operation: "CustomerOrder.update",
          target: { objectType: ORDER, id: "ord-1" },
          form: { customer: "Draft Edit", amount: 10 },
        },
        link1,
        harness.instance.receiveDraft,
        () => true,
        () => {},
        harness.instance.rollbackDraft,
      );
      await vi.waitFor(() => expect(customerInput().value).toBe("Draft Edit"));

      // User discards -> emits form-edited for that specific object target + slot.
      harness.instance.forms.discard("orderForm");
      await nextTick();
      expect(formEditedEvents).toEqual([{ kind: "object", objectType: ORDER, primaryKey: "ord-1", slot: "orderForm" }]);
      expect(customerInput().value).toBe("Old Co");

      // Agent delivers a fresh edit draft and server `/operate` executes & broadcasts completion.
      const link2 = { sessionId: "s-2", runId: "r-2", path: "outputs/drafts/edit-2.page-draft.json" };
      harness.instance.forms.hold(
        {
          pageKey: "customer-orders",
          operation: "CustomerOrder.update",
          target: { objectType: ORDER, id: "ord-1" },
          form: { customer: "Persisted Co", amount: 10 },
        },
        link2,
        harness.instance.receiveDraft,
        () => true,
        () => {},
        harness.instance.rollbackDraft,
      );
      await vi.waitFor(() => expect(customerInput().value).toBe("Persisted Co"));

      serverCustomer = "Persisted Co";
      harness.instance.refresh(
        { objects: [{ objectType: ORDER, primaryKey: "ord-1" }], objectTypes: [ORDER] },
        { operationId: "orderForm.save", panelId: "panel-orders", target: { objectType: ORDER, primaryKey: "ord-1" } },
      );

      await vi.waitFor(() => expect(harness.savedEvents).toEqual([{ className: ORDER, primaryKey: "ord-1" }]));
      expect(harness.prepared).toHaveLength(0);
      await vi.waitFor(() => expect(harness.instance.draft.value).toBeNull());
      expect(harness.instance.forms.dirty("orderForm")).toBe(false);
      expect(customerInput().value).toBe("Persisted Co");
      await vi.waitFor(() => expect(listReadCount).toBe(2));
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
