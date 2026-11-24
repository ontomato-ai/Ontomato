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
  save: { method: "POST", path: "/ontology/objects/CustomerOrder", bodySchema: {} },
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

  it("live fillForm create follows the exact same clean settlement when targetless Action omits primaryKey", async () => {
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

      const filled = await harness.instance.fillForm({
        member: "orderForm",
        values: { "/customer": "Agent Corp", "/amount": 88 },
      });
      expect(filled).toMatchObject({ ok: true, member: "orderForm", filledFields: ["/customer", "/amount"] });
      await vi.waitFor(() => expect(customerInput().value).toBe("Agent Corp"));

      await harness.instance.forms.submit("orderForm");

      expect(harness.savedEvents).toEqual([{ className: ORDER, primaryKey: null }]);
      expect(harness.element.querySelector('[role="alert"]')).toBeNull();
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
            save: { method: "PUT", path: "/ontology/objects/CustomerOrder", bodySchema: {} },
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
        created: { objectType: ORDER, primaryKey: "ord-99" },
        affected: { objects: [{ objectType: ORDER, primaryKey: "ord-99" }], objectTypes: [ORDER] },
      });

      await harness.instance.forms.submit("orderForm");

      expect(harness.savedEvents).toEqual([{ className: ORDER, primaryKey: "ord-99" }]);
      expect(harness.instance.state.values.value.selected).toEqual({ className: ORDER, primaryKey: "ord-99" });
    } finally {
      harness.unmount();
    }
  });

  it("switches to the newly created object when live executeAction saves a filled create form", async () => {
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
            save: { method: "PUT", path: "/ontology/objects/CustomerOrder", bodySchema: {} },
          });
        }
        const values = (request.runtimeParams?.values as Record<string, unknown> | undefined) ?? { customer: "", amount: null };
        return ready({ ...createFormDescription, values });
      },
    });
    try {
      const customerInput = () => harness.element.querySelector<HTMLInputElement>('[data-field="/customer"] input')!;
      await vi.waitFor(() => expect(customerInput()).not.toBeNull());

      const filled = await harness.instance.fillForm({
        member: "orderForm",
        values: { "/customer": "New Co", "/amount": 55 },
      });
      expect(filled).toMatchObject({ ok: true, member: "orderForm", filledFields: ["/customer", "/amount"] });
      await vi.waitFor(() => expect(customerInput().value).toBe("New Co"));

      harness.setOutcome({
        kind: "success",
        data: { result: "{\"id\":\"ord-99\"}", affects: [ORDER] },
        created: { objectType: ORDER, primaryKey: "ord-99" },
        affected: { objects: [{ objectType: ORDER, primaryKey: "ord-99" }], objectTypes: [ORDER] },
      });

      const executed = await harness.instance.executeAction({
        operation: "orderForm.save",
        agentRun: { sessionId: "11111111-1111-4111-8111-111111111111", runId: "22222222-2222-4222-8222-222222222222", toolCallId: "call-create-1" },
      });
      expect(executed).toMatchObject({ ok: true, kind: "executed", operation: "orderForm.save" });
      await vi.waitFor(() => expect(harness.savedEvents).toEqual([{ className: ORDER, primaryKey: "ord-99" }]));
      expect(harness.prepared).toHaveLength(1);
      expect(harness.instance.state.values.value.selected).toEqual({ className: ORDER, primaryKey: "ord-99" });
      expect(harness.instance.forms.dirty("orderForm")).toBe(false);
    } finally {
      harness.unmount();
    }
  });

  it("discards edit-mode live fill cleanly and settles edit ObjectForm when executeAction saves", async () => {
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
          save: { method: "PUT", path: "/ontology/objects/CustomerOrder", bodySchema: {} },
        });
      },
    });
    try {
      const customerInput = () => harness.element.querySelector<HTMLInputElement>('[data-field="/customer"] input')!;
      await vi.waitFor(() => expect(customerInput()?.value).toBe("Old Co"));
      await vi.waitFor(() => expect(listReadCount).toBe(1));

      await harness.instance.fillForm({
        member: "orderForm",
        values: { "/customer": "Live Edit" },
      });
      await vi.waitFor(() => expect(customerInput().value).toBe("Live Edit"));

      harness.instance.forms.discard("orderForm");
      await nextTick();
      expect(customerInput().value).toBe("Old Co");
      expect(harness.instance.forms.dirty("orderForm")).toBe(false);

      await harness.instance.fillForm({
        member: "orderForm",
        values: { "/customer": "Persisted Co" },
      });
      await vi.waitFor(() => expect(customerInput().value).toBe("Persisted Co"));

      serverCustomer = "Persisted Co";
      harness.setOutcome({
        kind: "success",
        data: { result: "{\"ok\":true}", affects: [ORDER] },
        affected: { objects: [{ objectType: ORDER, primaryKey: "ord-1" }], objectTypes: [ORDER] },
      });
      const executed = await harness.instance.executeAction({
        operation: "orderForm.save",
        agentRun: { sessionId: "11111111-1111-4111-8111-111111111111", runId: "22222222-2222-4222-8222-222222222223", toolCallId: "call-edit-1" },
      });
      expect(executed).toMatchObject({ ok: true, kind: "executed", operation: "orderForm.save" });

      await vi.waitFor(() => expect(harness.savedEvents).toEqual([{ className: ORDER, primaryKey: "ord-1" }]));
      expect(harness.prepared).toHaveLength(1);
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

  it("serializes literal and input bound params alongside same-name, formField, and formFields in ObjectForm create mode and OperationButton", async () => {
    const richActionDescriptor: PanelOwnerOperationDescriptor = {
      kind: "action",
      handlerRef: "actions.execute",
      label: "Create order with campus",
      effect: "write",
      batch: false,
      target: { source: "none" },
      inputSchema: {
        type: "object",
        properties: {
          values: {
            type: "object",
            properties: {
              campus: { type: "string", title: "Campus" },
              term: { type: "string", title: "Term" },
              limit: { type: "string", title: "Limit", contentMediaType: "application/json" },
              cleared: { type: "string", title: "Cleared", contentMediaType: "application/json" },
              customer: { type: "string", title: "Customer" },
              studentPhone: { type: "string", title: "Phone" },
              profile: { type: "string", title: "Profile", contentMediaType: "application/json" },
            },
            additionalProperties: false,
          },
        },
        required: ["values"],
        additionalProperties: false,
      },
      resultSchema: {},
    };

    const richCreateForm = {
      fields: [
        { path: "/campus", label: "Campus", valueSchema: { type: "string" }, required: false, readOnly: false, control: { kind: "text" } },
        { path: "/term", label: "Term", valueSchema: { type: "string" }, required: false, readOnly: false, control: { kind: "text" } },
        { path: "/customer", label: "Customer", valueSchema: { type: "string" }, required: true, readOnly: false, control: { kind: "text" } },
        { path: "/phone", label: "Phone", valueSchema: { type: "string" }, required: false, readOnly: false, control: { kind: "text" } },
        { path: "/grade", label: "Grade", valueSchema: { type: "string" }, required: false, readOnly: false, control: { kind: "text" } },
        { path: "/note", label: "Note", valueSchema: { type: "string" }, required: false, readOnly: false, control: { kind: "text" } },
      ],
      values: { campus: "", term: "", customer: "", phone: "", grade: "", note: "" },
      errors: [],
      save: { method: "POST", path: "/ontology/objects/CustomerOrder", bodySchema: {} },
    };

    const actionParams = {
      campus: { literal: "north" as const },
      term: { input: "activeTerm" },
      limit: { literal: 10 },
      cleared: { literal: null },
      studentPhone: { formField: "/phone" },
      profile: { formFields: { grade: "/grade", note: "/note" } },
    };

    const projections: Record<string, DirectProjection> = {
      "rich-form": {
        ...baseRecord,
        id: "rich-form",
        name: "Create order",
        componentId: "@ontomato/sdk:ObjectForm",
        inputs: { activeTerm: { kind: "scalar", type: "string" } },
        outputs: {},
        config: {},
        data: {
          createForm: { source: { type: { kind: "ObjectType", id: ORDER } }, read: "createForm", params: {} },
        },
        operations: {
          save: { operation: { kind: "Action", id: "create-order" }, params: actionParams },
        },
      },
      "draft-btn": {
        ...baseRecord,
        id: "draft-btn",
        name: "Submit via button",
        componentId: "@ontomato/sdk:OperationButton",
        inputs: { activeTerm: { kind: "scalar", type: "string" } },
        outputs: {},
        config: { operation: "submit" },
        data: {},
        operations: {
          submit: { operation: { kind: "Action", id: "create-order" }, params: actionParams },
        },
      },
    };
    const manifest: DirectPanelManifest = {
      state: {
        activeTerm: { type: { kind: "scalar", type: "string" }, personal: false, deepLink: false, external: false },
      },
      members: {
        richForm: {
          target: { projectionId: "rich-form" },
          inputs: { activeTerm: { state: "activeTerm" } },
        },
        draftBtn: {
          target: { projectionId: "draft-btn" },
          inputs: { activeTerm: { state: "activeTerm" } },
          operationDrafts: { submit: { slot: "richForm" } },
        },
      },
    };

    const harness = mountCreatePanel({
      manifest,
      projections,
      initial: { activeTerm: "2026-fall" },
      answer: (request) => {
        if (request.operations) {
          const member = request.memberPath.at(-1)?.member;
          if (member === "richForm") return ready({ save: richActionDescriptor });
          if (member === "draftBtn") return ready({ submit: richActionDescriptor });
        }
        return ready(richCreateForm);
      },
    });
    try {
      // Fixed literal/input fields `/campus` and `/term` stay read-only; wired fields stay editable.
      await vi.waitFor(() => {
        expect(harness.element.querySelector<HTMLInputElement>('[data-field="/campus"] input')?.disabled).toBe(true);
        expect(harness.element.querySelector<HTMLInputElement>('[data-field="/term"] input')?.disabled).toBe(true);
        expect(harness.element.querySelector<HTMLInputElement>('[data-field="/customer"] input')?.disabled).toBe(false);
        expect(harness.element.querySelector<HTMLInputElement>('[data-field="/phone"] input')?.disabled).toBe(false);
        expect(harness.element.querySelector<HTMLInputElement>('[data-field="/grade"] input')?.disabled).toBe(false);
        expect(harness.element.querySelector<HTMLInputElement>('[data-field="/note"] input')?.disabled).toBe(false);
      });

      const form = harness.instance.forms.handle("richForm")!;
      form.set("/customer", "Alice");
      form.set("/phone", "13800001111");
      form.set("/grade", "G3");
      form.set("/note", "honor");
      await nextTick();

      // 1. Direct ObjectForm submit outputs clean { values } matching server serialization.
      await harness.instance.forms.submit("richForm");
      expect(harness.prepared).toHaveLength(1);
      expect(harness.prepared[0]).toEqual([
        "richForm.save",
        {
          call: {
            target: null,
            input: {
              values: {
                campus: "north",
                term: "2026-fall",
                limit: "10",
                cleared: "null",
                customer: "Alice",
                studentPhone: "13800001111",
                profile: JSON.stringify({ grade: "G3", note: "honor" }),
              },
            },
          },
        },
      ]);

      // 2. OperationButton routed via operationDrafts does not double-encode JSON-typed literals (`limit`, `cleared`).
      form.set("/customer", "Bob");
      form.set("/phone", "13900002222");
      form.set("/grade", "G4");
      form.set("/note", "transfer");
      await nextTick();

      const btn = harness.element.querySelector<HTMLButtonElement>(".sdk-operation-button button")!;
      btn.click();
      await vi.waitFor(() => expect(harness.prepared).toHaveLength(2));
      expect(harness.prepared[1]).toEqual([
        "draftBtn.submit",
        {
          call: {
            target: null,
            input: {
              values: {
                campus: "north",
                term: "2026-fall",
                limit: "10",
                cleared: "null",
                customer: "Bob",
                studentPhone: "13900002222",
                profile: JSON.stringify({ grade: "G4", note: "transfer" }),
              },
            },
          },
        },
      ]);
    } finally {
      harness.unmount();
    }
  });
});
