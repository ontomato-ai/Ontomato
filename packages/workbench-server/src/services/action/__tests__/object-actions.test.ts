import { describe, expect, it, vi } from "vitest";
import {
  describePanelOperationFromDeclaration, panelOperationDeclarationSchema, panelOwnerOperationDescriptorSchema,
} from "@ontomato/contracts/panel-operations";
import { HttpError } from "../../../utils/errors";
import { createCustomerOntologyReadAdapter } from "../../ontology-model/customer-reads";
import type { PanelOperationHost } from "../../product-panels/server-operations";
import {
  ACTIONS_EXECUTE, OBJECT_ACTION_TARGET, describeObjectAction, objectActionDeclaration, objectActionOperation,
  resolveObjectAction, type ResolvedObjectAction,
} from "../object-actions";

/*
 * A published Action executed on one customer object: declared from its stored parameters, resolved through the data
 * engine's form as the authority, described from that same declaration, and executed through the owner's form and execute
 * with the owner's own refusals.
 */

vi.mock("../../ontology-model/customer-reads", () => ({ createCustomerOntologyReadAdapter: vi.fn() }));

type Init = NonNullable<Parameters<typeof fetch>[1]>;
function hostWith(answers: Record<string, (init: Init) => Response>) {
  const sent: { path: string; init: Init }[] = [];
  const actor = { owner: { domainId: "d", userId: "U" }, credentials: { token: "U-token", locale: "en" } };
  const host: PanelOperationHost = {
    initiator: actor,
    executor: actor,
    async request(path, init) {
      sent.push({ path, init });
      const answer = answers[path];
      if (!answer) throw new Error(`Unexpected owner request: ${path}`);
      return answer(init);
    },
    async requestWorkbench() {
      throw new Error("The action owner does not use the workbench request");
    },
  };
  return { host, sent };
}

const order = { objectType: "Order", primaryKey: "00123" };
const stored = {
  id: "approve-order", name: "Approve order", status: "PUBLISHED", codeHash: "hash-1",
  target: { className: "Order", keyParameter: "order_id" },
  function: {
    name: "approve_order", code: "# ontomato-python:2",
    parameters: [
      { name: "order_id", type: "TYPE_STRING", description: "Order key" },
      { name: "note", type: "TYPE_STRING", description: "Why" },
      { name: "amount", type: "TYPE_NUMBER", description: null },
    ],
  },
};
const declaration = objectActionDeclaration(stored);
const field = (key: string, label: string, required: boolean) => ({
  key, label, required, defaultValue: null, help: null, type: "text" as const, multiline: false, placeholder: null,
  maxLength: 200,
});
const openedForm = {
  fields: [field("order_id", "Order", true), field("note", "Note", false), field("amount", "Amount", true)],
  values: { order_id: "00123", note: "", amount: "" },
  errors: [],
  parameters: null,
};
const ok = (data: unknown) => () => Response.json({ success: true, data });
const refused = (code: string, message: string) => () => Response.json({ success: false, code, message });

const resolved: ResolvedObjectAction = {
  actionId: "approve-order", codeHash: "hash-1", name: "Approve order", keyParameter: "order_id", object: order,
  declaration,
};

async function rejection(promise: Promise<unknown>): Promise<HttpError> {
  const error = await promise.then(() => undefined, (caught: unknown) => caught);
  expect(error).toBeInstanceOf(HttpError);
  return error as HttpError;
}

describe("resolving an action on a customer object", () => {
  it("reads the action, then opens its form with the object's key bound and read-only", async () => {
    const { host, sent } = hostWith({
      "/api/data-query/action/queryById": ok(stored),
      "/api/data-query/action/form": ok(openedForm),
    });

    expect(await resolveObjectAction(host, { actionId: "approve-order", object: order })).toEqual(resolved);
    expect(sent.map(request => request.path)).toEqual(["/api/data-query/action/queryById", "/api/data-query/action/form"]);
    expect(JSON.parse(String(sent[1]?.init.body))).toEqual({
      id: "approve-order", parameters: { order_id: "00123" }, readOnlyParameters: ["order_id"],
    });
  });

  it("refuses an action for another object type without opening its form", async () => {
    const { host, sent } = hostWith({ "/api/data-query/action/queryById": ok(stored) });

    const error = await rejection(resolveObjectAction(host, { actionId: "approve-order", object: { ...order, objectType: "Invoice" } }));
    expect([error.status, error.code]).toEqual([409, "ACTION_TARGET_MISMATCH"]);
    expect(sent).toHaveLength(1);
  });

  it("refuses an action without a target and a missing action", async () => {
    const untargeted = hostWith({ "/api/data-query/action/queryById": ok({ ...stored, target: null }) });
    const noTarget = await rejection(resolveObjectAction(untargeted.host, { actionId: "approve-order", object: order }));
    expect([noTarget.status, noTarget.code]).toEqual([409, "ACTION_NOT_OBJECT_ACTION"]);

    const absent = hostWith({ "/api/data-query/action/queryById": ok(null) });
    const missing = await rejection(resolveObjectAction(absent.host, { actionId: "approve-order", object: order }));
    expect([missing.status, missing.code]).toEqual([404, "ACTION_NOT_FOUND"]);
  });

  it("answers the form's refusals in the owner's words: ungranted is forbidden, missing is not found, the rest conflict", async () => {
    const cases = [
      ["ACTION_NOT_GRANTED", "No role grants this action", 403],
      ["ACTION_NOT_FOUND", "Action is outside the current domain", 404],
      ["ACTION_NOT_EXECUTABLE", "Action not published", 409],
    ] as const;
    for (const [code, message, status] of cases) {
      const { host } = hostWith({
        "/api/data-query/action/queryById": ok(stored),
        "/api/data-query/action/form": refused(code, message),
      });
      const error = await rejection(resolveObjectAction(host, { actionId: "approve-order", object: order }));
      expect([error.status, error.code, error.message]).toEqual([status, code, message]);
    }

    const { host } = hostWith({
      "/api/data-query/action/queryById": ok(stored),
      "/api/data-query/action/form": () => Response.json({ success: false, message: "Data engine failed" }),
    });
    const failure = await rejection(resolveObjectAction(host, { actionId: "approve-order", object: order }));
    expect([failure.status, failure.code]).toEqual([500, "ACTION_FORM_FAILED"]);
  });
});

describe("declaring and describing an action on a customer object", () => {
  it("declares one text value per stored parameter except the bound key, JSON text for a non-text type, none required", () => {
    expect(panelOperationDeclarationSchema.parse(declaration)).toEqual(declaration);
    expect(declaration).toEqual({
      id: "approve-order", effect: "write", batch: false, target: { source: "input", input: OBJECT_ACTION_TARGET },
      inputSchema: {
        type: "object",
        properties: {
          values: {
            type: "object",
            properties: {
              note: { type: "string", title: "note", description: "Why" },
              amount: { type: "string", title: "amount", contentMediaType: "application/json" },
            },
            additionalProperties: false,
          },
        },
        required: ["values"],
        additionalProperties: false,
      },
    });
  });

  it("describes the shared handler from the same declaration an author reads", () => {
    const descriptor = describeObjectAction(resolved);

    expect(panelOwnerOperationDescriptorSchema.parse(descriptor)).toEqual(descriptor);
    expect(descriptor).toEqual(describePanelOperationFromDeclaration(declaration, {
      handlerRef: ACTIONS_EXECUTE, label: "Approve order", resultSchema: descriptor.resultSchema,
    }));
    expect(descriptor).toMatchObject({
      handlerRef: ACTIONS_EXECUTE, label: "Approve order", effect: "write", batch: false,
      target: { source: "input", input: "target" }, inputSchema: declaration.inputSchema,
    });
    expect(descriptor.inspectImpact).toBeUndefined();
  });
});

describe("executing an action on a customer object", () => {
  const operation = objectActionOperation(resolved);
  const target = { kind: "object" as const, ...order };

  it("binds the action and accepts only its own object", () => {
    expect(operation).toMatchObject({
      handlerRef: ACTIONS_EXECUTE, binding: { kind: "Action", id: "approve-order" }, kind: "action", batch: false,
      targetType: "Order", targetInput: "target",
    });
    expect(operation.targetSchema.safeParse(target).success).toBe(true);
    expect(operation.targetSchema.safeParse({ ...target, primaryKey: "00124" }).success).toBe(false);
    expect(operation.targetSchema.safeParse({ ...target, objectType: "Invoice" }).success).toBe(false);
  });

  it("names the object as the confirming person reads it from the customer ontology owner", async () => {
    const record = vi.fn(async () => ({ primaryKey: "00123", label: "Order 00123 · ACME", fields: {} }));
    vi.mocked(createCustomerOntologyReadAdapter).mockReturnValue({ record } as never);
    const { host } = hostWith({});

    expect(await operation.targetLabel(host)).toBe("Order 00123 · ACME");
    expect(createCustomerOntologyReadAdapter).toHaveBeenCalledWith(host.initiator.owner, host.initiator.credentials);
    expect(record).toHaveBeenCalledWith("Order", "00123");

    const refusal = new HttpError(403, "No permission to read this object", "CUSTOMER_DATA_PERMISSION");
    record.mockRejectedValueOnce(refusal);
    await expect(operation.targetLabel(host)).rejects.toBe(refusal);
  });

  it("checks the values through the owner's form, then executes its typed parameters", async () => {
    const { host, sent } = hostWith({
      "/api/data-query/action/form": ok({
        ...openedForm, values: { order_id: "00123", note: "", amount: "12.5" },
        parameters: { order_id: "00123", amount: 12.5 },
      }),
      "/api/data-query/action/execute": ok({
        result: "{\"answer\":true}", error: null, spendTime: 3, affects: ["Order", "Payment"], partialQuery: null,
      }),
    });

    const outcome = await operation.execute(host, target, { values: { amount: "12.5" } });

    expect(outcome).toEqual({
      kind: "success", data: { result: "{\"answer\":true}", affects: ["Order", "Payment"] },
      affected: { objects: [order], objectTypes: ["Order", "Payment"] },
    });
    expect(JSON.parse(String(sent[0]?.init.body))).toEqual({
      id: "approve-order", parameters: { order_id: "00123" }, readOnlyParameters: ["order_id"],
      values: { amount: "12.5" },
    });
    const body = sent[1]?.init.body as FormData;
    expect(body.get("id")).toBe("approve-order");
    expect(JSON.parse(String(body.get("param")))).toEqual({ order_id: "00123", amount: 12.5 });
  });

  it("refuses invalid values with the owner's field errors and does not execute", async () => {
    const errors = [{ field: "/values/amount", code: "required", message: "Amount is required" }];
    const { host, sent } = hostWith({ "/api/data-query/action/form": ok({ ...openedForm, errors }) });

    expect(await operation.execute(host, target, { values: {} }))
      .toEqual({ kind: "refusal", code: "ACTION_INPUT_INVALID", message: "Amount is required", errors });
    expect(sent).toHaveLength(1);
  });

  it("keeps the owner's coded execution refusal and reports an uncoded one as a failure", async () => {
    const answers = (execute: () => Response) => hostWith({
      "/api/data-query/action/form": ok({ ...openedForm, parameters: { order_id: "00123" } }),
      "/api/data-query/action/execute": execute,
    });

    const precondition = answers(refused("ACTION_PRECONDITION_FAILED", "Preconditions are not met: still open"));
    expect(await operation.execute(precondition.host, target, { values: {} })).toEqual({
      kind: "refusal", code: "ACTION_PRECONDITION_FAILED", message: "Preconditions are not met: still open",
    });

    const crashed = answers(() => Response.json({ success: false, message: "Traceback: ZeroDivisionError" }));
    expect(await operation.execute(crashed.host, target, { values: {} })).toEqual({
      kind: "failure", code: "ACTION_EXECUTE_FAILED", message: "Traceback: ZeroDivisionError",
    });
  });

  it("leaves an execution without an owner answer to the coordinator", async () => {
    const { host } = hostWith({
      "/api/data-query/action/form": ok({ ...openedForm, parameters: { order_id: "00123" } }),
      "/api/data-query/action/execute": () => new Response("Bad gateway", { status: 502 }),
    });

    const error = await rejection(operation.execute(host, target, { values: {} }));
    expect([error.status, error.code]).toEqual([502, "OWNER_UNAVAILABLE"]);
  });
});
