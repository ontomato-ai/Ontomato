import { describe, expect, it } from "vitest";
import type { DataPlan } from "@ontomato/contracts/dashboard";
import { applyDataPlan } from "../utils/dataPlan";

const sumBy = (field: string): DataPlan => ({
  mode: "derived",
  transform: { kind: "groupBy", groupBy: ["dept"], metrics: [{ op: "sum", field, as: "total" }] },
});

describe("applyDataPlan groupBy sum", () => {
  it("keeps a real zero sum instead of showing the row count", () => {
    const rows = [
      { dept: "a", amount: 0 },
      { dept: "a", amount: "0" },
      { dept: "a", amount: 0 },
    ];
    expect(applyDataPlan(rows, sumBy("amount"))).toEqual([{ dept: "a", total: 0 }]);
  });

  it("shows the row count only when the field holds no numeric value", () => {
    const rows = [
      { dept: "a", code: "X-1" },
      { dept: "a", code: "X-2" },
    ];
    expect(applyDataPlan(rows, sumBy("code"))).toEqual([{ dept: "a", total: 2 }]);
  });
});
