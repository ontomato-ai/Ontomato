import { describe, expect, it, vi } from "vitest";
import { EXECUTE_OBJECT_ACTION } from "@ontomato/contracts/platform-object-types";
import {
  approveOrderAction, codeHash, createOrderAction, credentials, customerActionDispatchFixture, customerActionRequest,
  mocks, orderFormProjection, orderPanel, owner, use, uuid,
} from "./customer-action-dispatch-fixture";
import { panelOperationTargetCheck, readPanelTypeTable } from "../type-table";
import { declaredDirectOperation, readAdmittedProjectionOperations } from "../direct-operations";
import {
  dispatchHumanPanelOperation,
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

describe("targetless page Action preparation, dispatch, and cancellation", () => {
  const fixture = customerActionDispatchFixture();

  it("prompts with action and field names, freezes without action.object, and dispatches with affected.objectTypes", async () => {
    const { intentId } = await prepareHumanPanelOperation(owner, credentials, {
      agentRun: { runId: uuid(2), sessionId: uuid(3), toolCallId: "create-order" },
      applicationId: "app-1",
      useId: "orders-use",
      operationId: "orderForm.save",
      call: { target: null, input: { values: { customer: "ACME", amount: "42" } } },
    }, "Alice");

    const questionBody = mocks.request.mock.calls[0]?.[2] as { message: string };
    expect(questionBody.message).toContain("Create order");
    expect(questionBody.message).toContain("customer");
    expect(questionBody.message).toContain("amount");
    expect(questionBody.message).not.toContain("ACME");
    expect(questionBody.message).not.toContain("42");
    expect(fixture.intent(intentId)?.operation.action).toEqual({
      actionId: "create-order",
      codeHash,
      affects: ["Order", "AuditLog"],
    });


    const dispatched = await dispatchHumanPanelOperation(owner, credentials, intentId);
    expect(dispatched).toEqual({
      kind: "dispatched",
      intentId,
      outcome: {
        kind: "success",
        data: { result: "{\"created\":true}", affects: ["Order", "AuditLog"] },
        affected: { objects: [], objectTypes: ["Order", "AuditLog"] },
      },
    });
  });

  it("rejects a changed dispatch body and preserves a cancelled page intent", async () => {
    const { intentId } = await prepareHumanPanelOperation(owner, credentials, {
      agentRun: { runId: uuid(2), sessionId: uuid(3), toolCallId: "discard-order" },
      applicationId: "app-1",
      useId: "orders-use",
      operationId: "orderForm.save",
      call: { target: null, input: { values: { customer: "ACME", amount: "42" } } },
    });
    const path = `/panel-operations/intents/${intentId}`;
    await expect(customerActionRequest(`${path}/dispatch`, { call: { target: null, input: {} } })).rejects.toThrow();
    expect(fixture.intent(intentId)).toMatchObject({ dispatched: false, outcome: null });

    const reason = { code: "FORM_CONFIRMATION_STALE", message: "The form changed after preparation." };
    await customerActionRequest(`${path}/cancel`, reason);
    await expect(customerActionRequest(`${path}/dispatch`, {})).resolves.toMatchObject({
      kind: "not-dispatched", intentId, ...reason,
    });
    expect(vi.mocked(fetch).mock.calls.filter(([url]) => String(url).endsWith("/action/execute"))).toHaveLength(0);
  });

  it("refuses a concurrently invalidated intent in atomic claim() without executing the Action", async () => {
    const { intentId } = await prepareHumanPanelOperation(owner, credentials, {
      agentRun: { runId: uuid(2), sessionId: uuid(3), toolCallId: "stale-order" },
      applicationId: "app-1",
      useId: "orders-use",
      operationId: "orderForm.save",
      call: { target: null, input: { values: { customer: "Race Corp", amount: "50" } } },
    }, "Alice");


    fixture.invalidateAtClaim(intentId);

    const dispatched = await dispatchHumanPanelOperation(owner, credentials, intentId);
    expect(dispatched).toMatchObject({
      kind: "not-dispatched",
      intentId,
      code: "FORM_CONFIRMATION_STALE",
    });
    const executedCalls = vi.mocked(fetch).mock.calls.filter(([url]) => String(url).endsWith("/action/execute"));
    expect(executedCalls).toHaveLength(0);
  });

  it("validates unknown Action parameters, pinned literal params, and formFields keys on the panel prepare route", async () => {
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
    await expect(prepareHumanPanelOperation(owner, credentials, {
      applicationId: "app-1",
      useId: "orders-use",
      operationId: "orderForm.save",
      call: { target: null, input: { values: { payload: "{\"customer\":\"ACME\"}", rogue: "bad" } } },
    }, "Alice")).rejects.toThrow();

    // Conflicting pinned literal value in call.input.values is rejected with OPERATION_PARAM_MISMATCH.
    await expect(prepareHumanPanelOperation(owner, credentials, {
      applicationId: "app-1",
      useId: "orders-use",
      operationId: "orderForm.save",
      call: { target: null, input: { values: { payload: "{\"customer\":\"ACME\"}", source: "forged" } } },
    }, "Alice")).rejects.toMatchObject({ status: 403, code: "OPERATION_PARAM_MISMATCH" });

    // Undeclared key inside a formFields JSON parameter is rejected with ACTION_INPUT_INVALID.
    await expect(prepareHumanPanelOperation(owner, credentials, {
      applicationId: "app-1",
      useId: "orders-use",
      operationId: "orderForm.save",
      call: { target: null, input: { values: { payload: "{\"customer\":\"ACME\",\"secret\":\"nope\"}" } } },
    }, "Alice")).rejects.toMatchObject({ status: 400, code: "ACTION_INPUT_INVALID" });

    // Valid formFields JSON object automatically injects the pinned literal param inside values.
    const { intentId } = await prepareHumanPanelOperation(owner, credentials, {
      applicationId: "app-1",
      useId: "orders-use",
      operationId: "orderForm.save",
      call: { target: null, input: { values: { payload: "{\"customer\":\"ACME\",\"amount\":42}" } } },
    }, "Alice");
    const stored = fixture.intent(intentId);
    expect("call" in stored && stored.call.input).toEqual({
      values: { payload: "{\"customer\":\"ACME\",\"amount\":42}", source: "workbench" },
    });
  });


});
