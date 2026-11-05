import { expect, it } from "vitest";

it("infers Unicode field names from the data without treating an identifier as a measure", async () => {
  const { execute } = await import(new URL("../../../../skills/executable/analysis/growth-rate-calc/scripts/index.mjs", import.meta.url).href);
  const result = await execute({
    data: [
      { 标识: 1, 说明: "第一期", 统计月份: "2024-01", 销售额: 100 },
      { 标识: 2, 说明: "第二期", 统计月份: "2024-02", 销售额: 125 },
    ]
  });
  expect(result.json).toMatchObject({
    success: true, timeField: "统计月份", valueField: "销售额",
    results: [{ value: 100 }, { value: 125, momGrowth: 25 }],
  });
});
