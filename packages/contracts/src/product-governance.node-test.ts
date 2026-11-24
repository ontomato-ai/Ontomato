import assert from "node:assert/strict";
import { test } from "node:test";
import {
  domainProductGrantsRequestSchema,
  domainProductGrantsResponseSchema,
  setProductGrantsRequestSchema,
} from "./product-governance";

test("grant sets accept explicit verbs and use an empty set for revocation", () => {
  const input = { id: "retriever", principalKind: "role", principalId: "reviewers" };
  for (const verbs of [["use", "view", "edit"], []]) {
    assert.deepEqual(setProductGrantsRequestSchema.parse({ ...input, verbs }), { ...input, verbs });
  }
  assert.equal(setProductGrantsRequestSchema.safeParse({ ...input, verbs: ["execute"] }).success, false);
  assert.equal(setProductGrantsRequestSchema.safeParse({ ...input, principalKind: "domain", verbs: [] }).success, false);
});

test("domain grant lookup accepts partial filters and rows with omitted names", () => {
  assert.deepEqual(domainProductGrantsRequestSchema.parse({}), {});
  assert.deepEqual(domainProductGrantsRequestSchema.parse({ principalId: "reviewers" }), { principalId: "reviewers" });
  const response = { grants: [
    { resourceId: "retriever", principalKind: "role", principalId: "reviewers", principalName: "Reviewers", verb: "view" },
    { resourceId: "retriever", principalKind: "domain", principalId: "*", verb: "use" },
  ] };
  assert.deepEqual(domainProductGrantsResponseSchema.parse(response), response);
});
