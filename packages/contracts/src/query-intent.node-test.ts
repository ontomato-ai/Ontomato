import { test } from "node:test";
import assert from "node:assert/strict";
import { retrievalInputSchema } from "./data-retrieval";
import { queryIntentSchema, queryCoverageSchema } from "./query-intent";

test("retrieval preserves unknown mappings and rejects duplicate condition identities", () => {
  const intent = {
    schema: "ontomato.query-intent.v1", conditions: [
      { id: "joined", quote: "since 2020", mapping: null },
      { id: "age", quote: "under 45", mapping: { className: "/person", field: "age", operator: "<", value: 45 } },
    ], outputs: ["Paper count", "Paper details"],
  };
  const input = retrievalInputSchema.parse({ question: "People under 45 who joined since 2020", queryIntent: intent });
  assert.deepEqual(input.queryIntent, intent);
  assert.equal(queryIntentSchema.safeParse({ ...intent, conditions: [intent.conditions[0], intent.conditions[0]] }).success, false);
  assert.equal(queryIntentSchema.safeParse({ ...intent, conditions: [] }).success, true);
});

test("coverage preserves partial and unverified diagnostics without upgrading them", () => {
  const report = { status: "partial", conditions: [{ id: "joined", status: "unmapped" }], checks: ["truncated_result"] };
  assert.deepEqual(queryCoverageSchema.parse(report), report);
  assert.equal(queryCoverageSchema.safeParse({ ...report, status: "passed" }).success, false);
});
