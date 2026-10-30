import { describe, expect, it } from "vitest";
import {
  compileStructuredSpec,
  emptyIntent,
  intentFromAction,
  suggestedParameters,
  validateStep,
} from "../intent";

describe("action creation intent", () => {
  it("compiles an object update intent in the thinking order", () => {
    const intent = emptyIntent();
    intent.primaryClass = "orders";
    intent.parameters.push({ name: "order_id", type: "STRING", className: "orders", description: "订单ID" });
    intent.objectRules.locator = "order_id";
    intent.objectRules.assignments.push({ field: "status", source: "CONSTANT", value: "已发货" });
    intent.conditions.push({ className: "orders", field: "status", operator: "IS", value: "已下单", message: "仅已下单" });
    intent.unrepresentable.push("依赖外部库存服务");

    expect(compileStructuredSpec(intent)).toEqual({
      family: "OBJECT",
      operation: "UPDATE_OBJECT",
      primaryObject: "orders",
      parameters: [{ name: "order_id", type: "STRING", class: "orders", description: "订单ID" }],
      executionConditions: {
        operator: "AND",
        conditions: [{ object: "orders", field: "status", operator: "IS", value: "已下单", message: "仅已下单" }],
        unrepresentable: ["依赖外部库存服务"],
      },
      objectRules: {
        locator: "order_id",
        assignments: [{ field: "status", source: "CONSTANT", value: "已发货" }],
      },
    });
  });

  it("sends no structured spec for an empty intent", () => {
    expect(compileStructuredSpec(emptyIntent())).toBeNull();
  });

  it("seeds the wizard from a derived definition", () => {
    const intent = intentFromAction({
      name: "订单发货",
      description: "将订单状态更新为已发货",
      function: { parameters: [] },
      definition: {
        parameters: [
          { name: "order_id", type: "STRING", description: "订单ID", objectTypes: ["orders"] },
        ],
        effects: [
          {
            kind: "UPDATE_OBJECT",
            className: "orders",
            objectIdFrom: "order_id",
            assignments: [{ field: "status", valueFrom: "固定值「已发货」" }],
            guards: {},
          },
        ],
        submissionCriteria: {
          operator: "AND",
          conditions: [
            { className: "orders", field: "status", operator: "IS", value: "已下单", message: "仅已下单" },
          ],
          unrepresentable: [],
        },
      },
    });

    expect(intent.family).toBe("OBJECT");
    expect(intent.operation).toBe("UPDATE_OBJECT");
    expect(intent.primaryClass).toBe("orders");
    expect(intent.parameters).toEqual([
      { name: "order_id", type: "STRING", className: "orders", description: "订单ID" },
    ]);
    expect(intent.objectRules.locator).toBe("order_id");
    expect(intent.objectRules.assignments).toEqual([
      { field: "status", source: "CONSTANT", value: "「已发货」" },
    ]);
    expect(intent.conditions).toHaveLength(1);
  });

  it("validates the object and relation steps", () => {
    const intent = emptyIntent();
    expect(validateStep(0, intent)).toBe(false);
    intent.primaryClass = "orders";
    expect(validateStep(0, intent)).toBe(true);
    expect(validateStep(4, intent)).toBe(false);
    intent.objectRules.locator = "order_id";
    intent.objectRules.assignments.push({ field: "status", source: "CONSTANT", value: "已发货" });
    expect(validateStep(4, intent)).toBe(true);

    intent.family = "RELATION";
    intent.operation = "CREATE_EDGE";
    expect(validateStep(4, intent)).toBe(false);
    intent.relationRules = {
      relation: "order_customer",
      sourceClass: "orders",
      sourceId: "order_id",
      targetClass: "customers",
      targetId: "customer_id",
    };
    expect(validateStep(4, intent)).toBe(true);
  });

  it("suggests interface parameters for the operation", () => {
    const intent = emptyIntent();
    intent.family = "RELATION";
    intent.operation = "CREATE_EDGE";
    intent.primaryClass = "orders";
    expect(suggestedParameters(intent).map((item) => item.name)).toEqual(["source_id", "target_id"]);

    intent.family = "VECTOR";
    intent.operation = "APPEND_VECTOR";
    intent.vectorRules.source = "FILE";
    expect(suggestedParameters(intent).map((item) => item.name)).toEqual(["object_id", "file"]);
  });
});
