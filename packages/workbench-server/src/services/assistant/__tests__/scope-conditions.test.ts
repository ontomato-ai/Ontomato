import { expect, it } from "vitest";
import { scopeConditions } from "../scope-conditions";

const missing = { or: [
  { field: "最高学历", operator: "is", value: null },
  { field: "最高学历", operator: "=", value: "" },
  { field: "最高学位", operator: "is", value: null },
  { field: "最高学位", operator: "=", value: "" },
] };
const active = { field: "在职状态", operator: "=", value: "在职" };
const graph = { filters: [{ id: "source", label: "Legacy condition", expression: JSON.stringify({ properties: { and: [active, missing] } }) }] };

it("splits the staff example into two conditions and preserves the full OR expression", () => {
  const filters = scopeConditions(graph, "zh-CN");
  expect(filters).toHaveLength(2);
  expect(filters[0]!.label).toContain("在职状态");
  expect(JSON.parse(filters[0]!.expression)).toEqual(active);
  expect(JSON.parse(filters[1]!.expression)).toEqual(missing);
  expect(filters[1]!.label).toContain("最高学历");
  expect(filters[1]!.label).toContain("最高学位");
  expect(scopeConditions(graph, "en").map(filter => filter.id)).toEqual(filters.map(filter => filter.id));
});

it("keeps NOT and nested OR groups intact", () => {
  const expression = { not: [{ and: [active, missing] }] };
  const filters = scopeConditions({ filters: [{ id: "not", label: "Original", expression: JSON.stringify(expression) }] }, "zh-CN");
  expect(filters).toHaveLength(1);
  expect(filters[0]!.expression).toBe(JSON.stringify(expression));
  // The negation must show in the label, or the condition reads as its opposite.
  const [plain] = scopeConditions({ filters: [{ id: "and", label: "Original", expression: JSON.stringify({ and: [active, missing] }) }] }, "zh-CN");
  expect(filters[0]!.label).not.toBe(plain!.label);
});

it("preserves unfamiliar expressions instead of offering misleading editable parts", () => {
  const source = { id: "unknown", label: "Original", expression: "salary > 10" };
  expect(scopeConditions({ filters: [source] }, "zh-CN")).toEqual([source]);
  const structured = { ...source, expression: JSON.stringify({ and: [active, { custom: true }] }) };
  expect(scopeConditions({ filters: [structured] }, "zh-CN")).toEqual([structured]);
});

it("does not confuse a literal NULL string or whitespace with missing values", () => {
  const expression = { or: [
    { field: "education", operator: "=", value: "NULL" },
    { field: "education", operator: "=", value: " " },
  ] };
  const [filter] = scopeConditions({ filters: [{ id: "literal", label: "Original", expression: JSON.stringify(expression) }] }, "zh-CN");
  expect(filter!.label).toContain("NULL");
  expect(filter!.label).not.toContain("未填写");
});

it("uses field names rather than legacy explanatory descriptions", () => {
  const [filter] = scopeConditions({ filters: [{ id: "status", label: "Original", targetIds: ["field"], expression: JSON.stringify(active) }],
    nodes: [{ id: "field", kind: "field", attrName: "在职状态", label: "在职状态，例如在职、离职、退休。" }] }, "zh-CN");
  expect(filter!.label).toContain("在职状态");
  expect(filter!.label).not.toContain("例如在职");
});

it("handles persisted DSL logic operators and shortens the staff field descriptions", () => {
  const status = { field: "status", operator: "=", value: "在职" };
  const age = { field: "age", operator: ">=", value: 60 };
  const filters = scopeConditions({ filters: [{ id: "staff", label: "Old", targetIds: ["status", "age"],
    expression: JSON.stringify({ properties: { operator: "logic", and: [status, age] } }) }], nodes: [
    { id: "status", kind: "field", attrName: "status", label: "在职状态，例如在职、离职、退休。" },
    { id: "age", kind: "field", attrName: "age", label: "年龄，单位为岁。" },
  ] }, "zh-CN");
  const labels = filters.map(filter => filter.label);
  expect(labels[0]).toContain("在职状态");
  expect(labels[1]).toContain("年龄");
  expect(labels.join(" ")).not.toContain("例如在职");
  expect(labels.join(" ")).not.toContain("单位为岁");
  expect(filters.map(filter => JSON.parse(filter.expression))).toEqual([status, age]);
});
