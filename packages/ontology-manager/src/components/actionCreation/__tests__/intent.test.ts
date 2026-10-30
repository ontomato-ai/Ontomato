import { describe, expect, it } from "vitest";
import {
  compileStructuredSpec,
  emptyIntent,
  intentFromAction,
  validateStep,
} from "../intent";

describe("action creation intent", () => {
  it("compiles only declared intent fields", () => {
    const intent = emptyIntent();
    intent.actionType = "UPDATE";
    intent.targetObject = "orders";
    intent.parameters.push({ name: "order_id", type: "STRING", className: "orders", description: "订单ID" });
    intent.rules.push({ kind: "UPDATE_OBJECT", object: "orders", field: "status", value: "已发货" });
    intent.criteria = {
      operator: "AND",
      conditions: [{ object: "orders", field: "status", operator: "IS", value: "已下单", message: "仅已下单" }],
      unrepresentable: ["依赖外部库存服务"],
    };

    expect(compileStructuredSpec(intent)).toEqual({
      actionType: "UPDATE",
      targetObject: "orders",
      parameters: [{ name: "order_id", type: "STRING", class: "orders", description: "订单ID" }],
      writeRules: [{ kind: "UPDATE_OBJECT", object: "orders", field: "status", value: "已发货" }],
      submissionCriteria: {
        operator: "AND",
        conditions: [{ object: "orders", field: "status", operator: "IS", value: "已下单", message: "仅已下单" }],
        unrepresentable: ["依赖外部库存服务"],
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
            assignments: [{ field: "status", valueFrom: "固定值“已发货”" }],
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

    expect(intent.actionType).toBe("UPDATE");
    expect(intent.targetObject).toBe("orders");
    expect(intent.parameters).toEqual([
      { name: "order_id", type: "STRING", className: "orders", description: "订单ID" },
    ]);
    expect(intent.rules).toEqual([
      { kind: "UPDATE_OBJECT", object: "orders", field: "status", value: "固定值“已发货”" },
    ]);
    expect(intent.criteria?.conditions).toHaveLength(1);
  });

  it("requires a target for schema actions and a name for external calls", () => {
    const intent = emptyIntent();
    expect(validateStep(0, intent)).toBe(false);
    intent.targetObject = "orders";
    expect(validateStep(0, intent)).toBe(true);
    intent.actionType = "EXTERNAL";
    intent.targetObject = "";
    expect(validateStep(0, intent)).toBe(false);
    intent.name = "通知库存服务";
    expect(validateStep(0, intent)).toBe(true);
  });
});
