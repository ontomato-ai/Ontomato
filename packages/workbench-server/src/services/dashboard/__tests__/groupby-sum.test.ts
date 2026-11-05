import { describe, expect, it } from "vitest";
import type { TransformSpec } from "@ontomato/contracts/dashboard";
import { applyTransformSpec } from "../planning/core/utils";

const sumBy = (field: string): TransformSpec => ({
  kind: "groupBy",
  groupBy: ["dept"],
  metrics: [{ op: "sum", field, as: "total" }],
});

describe("groupBy sum", () => {
  it("keeps a real zero sum instead of showing the row count", () => {
    const rows = [
      { dept: "a", amount: 0 },
      { dept: "a", amount: "0" },
      { dept: "a", amount: 0 },
    ];
    expect(applyTransformSpec(rows, sumBy("amount"))).toEqual([{ dept: "a", total: 0 }]);
  });

  it("shows the row count only when the field holds no numeric value", () => {
    const rows = [
      { dept: "a", code: "X-1" },
      { dept: "a", code: "X-2" },
    ];
    expect(applyTransformSpec(rows, sumBy("code"))).toEqual([{ dept: "a", total: 2 }]);
  });
});
