import { describe, expect, it, vi } from "vitest";
import { EXECUTE_OBJECT_ACTION } from "@ontomato/contracts/platform-object-types";
import {
  approveOrderAction, codeHash, createOrderAction, credentials, customerActionDispatchFixture,
  mocks, orderFormProjection, orderPanel, owner, root, use, uuid,
} from "./customer-action-dispatch-fixture";
import { panelOperationTargetCheck, readPanelTypeTable } from "../type-table";
import { declaredDirectOperation, readAdmittedProjectionOperations } from "../direct-operations";
import { panelOperationStore } from "../operation-store";
import {
  dispatchHumanPanelOperation,
  dispatchPanel,
  invalidateFormConfirmations,
  operatePanel,
  prepareHumanPanelOperation,
} from "../operations";

describe("type table and registration check for targetless customer Actions", () => {
  it("exposes targetless Actions once in top-level operations with affects without duplicating across objectTypes", async () => {
    mocks.backendGet.mockImplementation(async (_name, url) => {
      if (String(url).includes("/ontology/model/object-types")) {
        return {
          text: JSON.stringify([
            {
              className: "Order", showName: "Order", classDesc: "",
              attributeCount: 2, businessKeyCount: 1, relationshipCount: 0,
              primaryKey: { status: "present", name: "order_id" },
            },
            {
              className: "AuditLog", showName: "Audit Log", classDesc: "",
              attributeCount: 1, businessKeyCount: 0, relationshipCount: 0,
              primaryKey: { status: "present", name: "log_id" },
            },
          ]),
        };
      }
      throw new Error(`Unexpected GET ${url}`);
    });
    mocks.backendPost.mockImplementation(async (_name, url) => {
      if (String(url).endsWith("/action/queryList")) {
        return {
          text: JSON.stringify({ success: true, data: [createOrderAction, approveOrderAction] }),
        };
      }
      throw new Error(`Unexpected POST ${url}`);
    });

    const table = await readPanelTypeTable(owner, credentials);

    // Targetless Action lives once in top-level `operations` with `affects`, not duplicated in `objectTypes`.
    expect(table.operations).toEqual([
      expect.objectContaining({
        id: "create-order",
        kind: "action",
        effect: "write",
        target: { source: "none" },
        affects: ["Order", "AuditLog"],
      }),
    ]);
    expect(table.objectTypes.Order?.operations?.map(op => op.id)).toEqual(["approve-order"]);
    expect(table.objectTypes.AuditLog?.operations).toBeUndefined();

    // Target check admits targetless Action without target on both ObjectForm and OperationButton.
    const check = panelOperationTargetCheck(owner, credentials);
    expect(await check({
      inputs: {},
      data: orderFormProjection.data,
      operations: { save: { operation: { kind: "Action", id: "create-order" } } },
    }, {})).toBeUndefined();

    // Binding a targetless Action WITH a target is rejected.
    expect(await check({
      inputs: { target: { kind: "object", objectType: "Order" } },
      data: {},
      operations: { save: { operation: { kind: "Action", id: "create-order" }, target: { input: "target" } } },
    }, { inputs: { target: { state: "selected" } } })).toBe("operation 'save' takes no target");

    // Binding a targeted Action WITHOUT a target is still rejected.
    expect(await check({
      inputs: {},
      data: {},
      operations: { approve: { operation: { kind: "Action", id: "approve-order" } } },
    }, {})).toBe("operation 'approve' takes a target of type 'Order'");
  });
});

describe("admitting targetless customer Actions in direct-operations", () => {
  it("admits targetless Actions with empty /action/form parameters and snapshot omitting action.object", async () => {
    const sent: { url: string; body: unknown }[] = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string, init: NonNullable<Parameters<typeof fetch>[1]>) => {
      const body = JSON.parse(String(init.body));
      sent.push({ url, body });
      if (url.endsWith("/action/queryById")) return Response.json({ success: true, data: createOrderAction });
      if (url.endsWith("/action/form")) {
        return Response.json({
          success: true,
          data: {
            fields: [
              { key: "customer", label: "Customer", required: true, defaultValue: null, help: null, type: "text", multiline: false, placeholder: null, maxLength: 200 },
              { key: "amount", label: "Amount", required: true, defaultValue: null, help: null, type: "text", multiline: false, placeholder: null, maxLength: 200 },
            ],
            values: { customer: "", amount: "" },
            errors: [],
            parameters: null,
          },
        });
      }
      throw new Error(`Unexpected fetch ${url}`);
    }));

    const admittedMap = await readAdmittedProjectionOperations(
      { owner, credentials },
      { panel: orderPanel as never, projection: orderFormProjection as never, member: orderPanel.manifest.members.orderForm, slot: "orderForm" },
      {},
    );
    expect(admittedMap.save).toMatchObject({
      kind: "action",
      handlerRef: EXECUTE_OBJECT_ACTION,
      label: "Create order",
      target: { source: "none" },
    });
    expect(sent.at(-1)?.body).toEqual({
      id: "create-order",
      parameters: {},
      readOnlyParameters: [],
    });

    mocks.projection.mockResolvedValue(orderFormProjection);
    const direct = await declaredDirectOperation(
      owner,
      credentials,
      use as never,
      orderPanel as never,
      "orderForm.save",
      null,
    );
    expect(direct.effect).toBe("write");
    if (direct.effect === "write") {
      expect(direct.fixedTarget).toBeNull();
      expect(direct.operation.action).toEqual({
        actionId: "create-order",
        codeHash,
        affects: ["Order", "AuditLog"],
      });
      expect(direct.operation.action?.object).toBeUndefined();
    }
  });
});

describe("operation-store invalidation SQL for form-bound customer Actions", () => {
  it("matches both form.save and actions.execute for object edits and targetless/draft creates", async () => {
    mocks.query.mockResolvedValue({ rowCount: 1 });
    const reason = { code: "FORM_CONFIRMATION_STALE", message: "Stale" };

    await panelOperationStore.invalidatePendingFormSaves(
      owner,
      { rootSession: root, targetType: "Order", primaryKey: "ord-1", slot: "orderForm" },
      reason,
    );
    const [editSql, editParams] = mocks.query.mock.calls[0]!;
    expect(editSql).toContain("intent->'operation'->>'kind'='form.save' OR intent->'operation'->>'handlerRef'='actions.execute'");
    expect(editSql).toContain("intent->'call'->'target'->>'kind'='object'");
    expect(editParams).toContain("Order");
    expect(editParams).toContain("ord-1");

    mocks.query.mockClear();
    await panelOperationStore.invalidatePendingFormSaves(
      owner,
      { rootSession: root, targetType: "Order", primaryKey: null, slot: "orderForm" },
      reason,
    );
    const [draftSql, draftParams] = mocks.query.mock.calls[0]!;
    expect(draftSql).toContain("intent->'operation'->>'kind'='form.save'");
    expect(draftSql).toContain("intent->'operation'->>'handlerRef'='actions.execute'");
    expect(draftSql).toContain("jsonb_typeof(intent->'call'->'target')='null'");
    expect(draftSql).toContain("intent->'operation'->>'slot'=");
    expect(draftSql).toContain("intent->'operation'->'action'->'affects' ?");
    expect(draftParams).toContain("orderForm");
    expect(draftParams).toContain("Order");
  });
});

describe("end-to-end targetless Action confirmation, dispatch, and stale invalidation", () => {
  const fixture = customerActionDispatchFixture();

  it("prompts with action name and input parameters, freezes without action.object, and dispatches with affected.objectTypes", async () => {
    const intentId = uuid(20);
    const response = await operatePanel(owner, credentials, uuid(2), {
      intentId,
      applicationId: "app-1",
      useId: "orders-use",
      operationId: "orderForm.save",
      call: { target: null, input: { values: { customer: "ACME", amount: "42" } } },
    }, "Alice");

    expect(response.kind).toBe("confirmation-required");
    const questionBody = mocks.request.mock.calls[0]?.[2] as { message: string };
    expect(questionBody.message).toContain("Create order");
    expect(questionBody.message).toContain("customer: ACME, amount: 42");
    expect(fixture.intent(intentId)?.operation.action).toEqual({
      actionId: "create-order",
      codeHash,
      affects: ["Order", "AuditLog"],
    });

    fixture.approve(intentId);

    const dispatched = await dispatchPanel(owner, credentials, uuid(2), intentId);
    expect(dispatched).toEqual({
      kind: "dispatched",
      intentId,
      outcome: {
        kind: "success",
        data: { result: "{\"created\":true}", affects: ["Order", "AuditLog"] },
        affected: { objects: [], objectTypes: ["Order", "AuditLog"] },
      },
    });
    expect(mocks.notify).toHaveBeenCalledWith({
      domainId: "d",
      initiator: "U",
      rootSession: root,
      target: null,
      affected: { objects: [], objectTypes: ["Order", "AuditLog"] },
      operation: {
        operationId: "orderForm.save",
        panelId: "panel-orders",
        target: null,
      },
    });
  });

  it("refuses a concurrently invalidated intent in atomic claim() without executing the Action", async () => {
    const intentId = uuid(23);
    const response = await operatePanel(owner, credentials, uuid(2), {
      intentId,
      applicationId: "app-1",
      useId: "orders-use",
      operationId: "orderForm.save",
      call: { target: null, input: { values: { customer: "Race Corp", amount: "50" } } },
    }, "Alice");
    expect(response.kind).toBe("confirmation-required");

    fixture.approve(intentId);

    fixture.invalidateAtClaim(intentId);

    const dispatched = await dispatchPanel(owner, credentials, uuid(2), intentId);
    expect(dispatched).toMatchObject({
      kind: "not-dispatched",
      intentId,
      code: "FORM_CONFIRMATION_STALE",
    });
    const executedCalls = vi.mocked(fetch).mock.calls.filter(([url]) => String(url).endsWith("/action/execute"));
    expect(executedCalls).toHaveLength(0);
    expect(mocks.notify).not.toHaveBeenCalled();
  });

  it("validates unknown Action parameters, pinned literal params, and formFields keys on /operate", async () => {
    const boundAction = {
      ...createOrderAction,
      id: "create-order-bound",
      function: {
        name: "create_order_bound",
        parameters: [
          { name: "payload", type: "TYPE_OBJECT", description: "Packed form fields" },
          { name: "source", type: "TYPE_STRING", description: "Entry source" },
        ],
      },
    };
    mocks.projection.mockResolvedValue({
      ...orderFormProjection,
      operations: {
        save: {
          operation: { kind: "Action" as const, id: "create-order-bound" },
          params: {
            payload: { formFields: { customer: "/customer", amount: "/amount" } },
            source: { literal: "workbench" },
          },
        },
      },
    });
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      if (url.endsWith("/action/queryById")) return Response.json({ success: true, data: boundAction });
      if (url.endsWith("/action/form")) {
        return Response.json({ success: true, data: { fields: [], values: {}, errors: [], parameters: {} } });
      }
      throw new Error(`Unexpected fetch ${url}`);
    }));

    // Unknown parameter in call.input.values is rejected by strict action inputSchema.
    await expect(operatePanel(owner, credentials, uuid(2), {
      intentId: uuid(24),
      applicationId: "app-1",
      useId: "orders-use",
      operationId: "orderForm.save",
      call: { target: null, input: { values: { payload: "{\"customer\":\"ACME\"}", rogue: "bad" } } },
    }, "Alice")).rejects.toThrow();

    // Conflicting pinned literal value in call.input.values is rejected with OPERATION_PARAM_MISMATCH.
    await expect(operatePanel(owner, credentials, uuid(2), {
      intentId: uuid(25),
      applicationId: "app-1",
      useId: "orders-use",
      operationId: "orderForm.save",
      call: { target: null, input: { values: { payload: "{\"customer\":\"ACME\"}", source: "forged" } } },
    }, "Alice")).rejects.toMatchObject({ status: 403, code: "OPERATION_PARAM_MISMATCH" });

    // Undeclared key inside a formFields JSON parameter is rejected with ACTION_INPUT_INVALID.
    await expect(operatePanel(owner, credentials, uuid(2), {
      intentId: uuid(26),
      applicationId: "app-1",
      useId: "orders-use",
      operationId: "orderForm.save",
      call: { target: null, input: { values: { payload: "{\"customer\":\"ACME\",\"secret\":\"nope\"}" } } },
    }, "Alice")).rejects.toMatchObject({ status: 400, code: "ACTION_INPUT_INVALID" });

    // Valid formFields JSON object automatically injects the pinned literal param inside values.
    const validId = uuid(27);
    const ok = await operatePanel(owner, credentials, uuid(2), {
      intentId: validId,
      applicationId: "app-1",
      useId: "orders-use",
      operationId: "orderForm.save",
      call: { target: null, input: { values: { payload: "{\"customer\":\"ACME\",\"amount\":42}" } } },
    }, "Alice");
    expect(ok.kind).toBe("confirmation-required");
    const stored = fixture.intent(validId)!;
    expect("call" in stored && stored.call.input).toEqual({
      values: { payload: "{\"customer\":\"ACME\",\"amount\":42}", source: "workbench" },
    });
  });

  it("handles targeted customer edit Action through /operate -> invalidate on discard -> re-confirm -> dispatch with operation completion", async () => {
    mocks.panel.mockResolvedValue({
      id: "panel-orders",
      name: "Orders",
      description: "",
      visibility: "domain" as const,
      manifest: {
        state: {
          selected: { type: { kind: "object" as const, objectType: "Order" }, personal: false, deepLink: true, external: false },
        },
        members: {
          orderForm: {
            target: { projectionId: "proj-order-edit-form" },
            inputs: { target: { state: "selected" } },
          },
        },
      },
    });
    mocks.projection.mockResolvedValue({
      id: "proj-order-edit-form",
      name: "Order edit form",
      description: "",
      visibility: "domain" as const,
      componentId: "@ontomato/sdk:ObjectForm",
      inputs: { target: { kind: "object" as const, objectType: "Order" } },
      outputs: {},
      config: {},
      data: {
        form: { source: { object: { input: "target" } }, read: "form", params: {} },
      },
      operations: {
        save: {
          operation: { kind: "Action" as const, id: "approve-order" },
          target: { input: "target" },
        },
      },
    });
    mocks.backendGet.mockResolvedValue({
      text: JSON.stringify([{
        className: "Order",
        name: "order_id",
        showName: "Order ID",
        attrDesc: "",
        type: "string",
        enable: true,
        primaryKey: true,
        businessKey: true,
      }]),
    });
    mocks.backendPost.mockResolvedValue({
      text: JSON.stringify({ success: true, data: { data: { order_id: "ord-7" } } }),
    });
    vi.stubGlobal("fetch", vi.fn(async (url: string, init: NonNullable<Parameters<typeof fetch>[1]>) => {
      if (url.endsWith("/action/queryById")) return Response.json({ success: true, data: approveOrderAction });
      if (url.endsWith("/action/form")) {
        const body = JSON.parse(String(init.body));
        const values = body.values ?? { note: "" };
        return Response.json({
          success: true,
          data: {
            fields: [{ key: "note", label: "Note", required: false, defaultValue: null, help: null, type: "text", multiline: false, placeholder: null, maxLength: 200 }],
            values: { note: values.note ?? "" },
            errors: [],
            parameters: body.values ? { order_id: "ord-7", note: values.note } : null,
          },
        });
      }
      if (url.endsWith("/action/execute")) {
        return Response.json({
          success: true,
          data: { result: "{\"updated\":true}", error: null, spendTime: 3, affects: ["Order"], partialQuery: null },
        });
      }
      throw new Error(`Unexpected fetch ${url}`);
    }));

    const orderTarget = { kind: "object" as const, objectType: "Order", primaryKey: "ord-7" };
    const staleIntentId = uuid(28);
    const req1 = await operatePanel(owner, credentials, uuid(2), {
      intentId: staleIntentId,
      applicationId: "app-1",
      useId: "orders-use",
      operationId: "orderForm.save",
      call: { target: orderTarget, input: { values: { note: "Initial" } } },
    }, "Alice");
    expect(req1.kind).toBe("confirmation-required");

    // User clicks Discard on the edit form -> form-edited notification invalidates the pending confirmation.
    expect(await invalidateFormConfirmations(owner, {
      rootSession: root,
      target: { kind: "object", objectType: "Order", primaryKey: "ord-7", slot: "orderForm" },
    })).toEqual({ invalidated: 1 });

    fixture.approve(staleIntentId);
    expect(await dispatchPanel(owner, credentials, uuid(2), staleIntentId)).toMatchObject({
      kind: "not-dispatched",
      code: "FORM_CONFIRMATION_STALE",
    });

    // Fresh confirmation approved -> dispatches and broadcasts object-changed with completed operation metadata.
    const freshIntentId = uuid(29);
    const req2 = await operatePanel(owner, credentials, uuid(2), {
      intentId: freshIntentId,
      applicationId: "app-1",
      useId: "orders-use",
      operationId: "orderForm.save",
      call: { target: orderTarget, input: { values: { note: "Approved" } } },
    }, "Alice");
    expect(req2.kind).toBe("confirmation-required");

    fixture.approve(freshIntentId);
    const done = await dispatchPanel(owner, credentials, uuid(2), freshIntentId);
    expect(done, JSON.stringify(done)).toMatchObject({ kind: "dispatched", outcome: { kind: "success" } });
    expect(mocks.notify).toHaveBeenCalledWith({
      domainId: "d",
      initiator: "U",
      rootSession: root,
      target: { objectType: "Order", primaryKey: "ord-7" },
      affected: { objects: [{ objectType: "Order", primaryKey: "ord-7" }], objectTypes: ["Order"] },
      operation: {
        operationId: "orderForm.save",
        panelId: "panel-orders",
        target: { objectType: "Order", primaryKey: "ord-7" },
      },
    });
  });

  it("invalidates a pending targetless Action confirmation when the user edits or directly saves the create form", async () => {
    const intentId = uuid(21);
    const response = await operatePanel(owner, credentials, uuid(2), {
      intentId,
      applicationId: "app-1",
      useId: "orders-use",
      operationId: "orderForm.save",
      call: { target: null, input: { values: { customer: "ACME", amount: "42" } } },
    }, "Alice");
    expect(response.kind).toBe("confirmation-required");

    expect(await invalidateFormConfirmations(owner, {
      rootSession: root,
      target: { kind: "draft", objectType: "Order", slot: "orderForm" },
    })).toEqual({ invalidated: 1 });

    fixture.approve(intentId);
    expect(await dispatchPanel(owner, credentials, uuid(2), intentId)).toMatchObject({
      kind: "not-dispatched",
      code: "FORM_CONFIRMATION_STALE",
    });

    // Also verify direct human save invalidates a fresh pending confirmation on the same form.
    const intentId2 = uuid(22);
    const response2 = await operatePanel(owner, credentials, uuid(2), {
      intentId: intentId2,
      applicationId: "app-1",
      useId: "orders-use",
      operationId: "orderForm.save",
      call: { target: null, input: { values: { customer: "Beta", amount: "10" } } },
    }, "Alice");
    expect(response2.kind).toBe("confirmation-required");

    const humanPrep = await prepareHumanPanelOperation(owner, credentials, {
      applicationId: "app-1",
      useId: "orders-use",
      operationId: "orderForm.save",
      call: { target: null, input: { values: { customer: "Human", amount: "99" } } },
    });
    const humanDone = await dispatchHumanPanelOperation(owner, credentials, humanPrep.intentId);
    expect(humanDone).toMatchObject({ kind: "dispatched", outcome: { kind: "success" } });

    fixture.approve(intentId2);
    expect(await dispatchPanel(owner, credentials, uuid(2), intentId2)).toMatchObject({
      kind: "not-dispatched",
      code: "FORM_CONFIRMATION_STALE",
    });
  });
});
