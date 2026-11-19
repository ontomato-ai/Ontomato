import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";
import {
  actionAuthoringPageDraftSchema,
  authoringAdoptionResponseSchema,
  authoringHostRunSchema,
  authoringKindSchema,
  authoringOperations,
  authoringWireSchemas,
} from "./authoring";
import { pageDraftSchema } from "./page-draft";

const sessionId = "bda3d9bd-afc1-4dfa-92c2-41efda234bad";
const runId = "959c449b-afd0-4af9-9f2d-663fecfce14a";
const executionId = "12a207b7-e868-45e5-a52d-e15f85447447";

test("authoring operation input cannot carry Workbench authority", () => {
  const host = {
    hostId: "workbench", sessionId, runId, ownerId: "initiator", executionUserId: "delegate",
    domainId: "domain", classNames: ["/Employee"], expiresAt: 1_900_000_000_000,
  };
  assert.equal(authoringHostRunSchema.safeParse({ ...host, target: { kind: "live" } }).success, true);
  assert.equal(authoringHostRunSchema.safeParse({
    ...host, target: { kind: "build-test", contextId: executionId },
  }).success, true);
  assert.equal(authoringHostRunSchema.safeParse({ ...host, target: { kind: "build-test" } }).success, false);

  const action = { code: "print('checked')", parameterDefs: [] };
  assert.deepEqual(authoringOperations.action.test.body.parse(action), action);
  assert.equal(authoringOperations.action.test.body.safeParse({
    ...action, runId, executionUserId: host.executionUserId, target: { kind: "live" },
  }).success, false);
  assert.equal(authoringOperations.action.reset.body.safeParse({ sandboxId: "outside" }).success, false);
  assert.equal(authoringKindSchema.safeParse("function").success, false);
});

test("Action sandbox input uses inline samples and one structured DSL object", () => {
  const vector = { className: "/Employee", objectId: "one", attrName: "notes", text: "A sample" };
  const sample = { objDatas: [{ className: "/Employee", rows: [{ id: "one" }] }], relDatas: [], vectorDatas: [vector] };
  assert.deepEqual(authoringOperations.action.prepare.body.parse(sample), sample);
  assert.equal(authoringOperations.action.prepare.body.safeParse({
    ...sample, vectorDatas: [{ ...vector, fileId: "outside" }],
  }).success, false);
  assert.equal(authoringOperations.action["query-sandbox"].body.safeParse({ dsl: ["query"] }).success, false);
});

test("MetricView tests take the complete existing QueryPackage", () => {
  const { pythonAggregate: queryPackage } = JSON.parse(
    readFileSync(new URL("../examples/query-packages.json", import.meta.url), "utf8"),
  );
  const body = { queryPackage, columnLabels: { total: "Total" } };
  assert.deepEqual(authoringOperations["metric-view"].test.body.parse(body), body);
  assert.equal(authoringOperations["metric-view"].test.body.safeParse({
    ...body, queryPackage: { ...queryPackage, files: queryPackage.files.slice(1) },
  }).success, false);
  assert.equal("prepare" in authoringOperations["metric-view"], false);
});

test("test rereads preserve the same evidence and Action drafts retain the existing envelope", () => {
  const evidence = { executionId, digest: "a".repeat(64) };
  const record = {
    ...evidence,
    result: {
      result: '{"answer":[{"count":1}]}',
      error: null,
      spendTime: 12,
      partialQuery: { truncated: true, rowLimit: 100, truncationHint: "Limited input" },
    },
  };
  assert.deepEqual(authoringOperations.action.test.response.parse(record), record);
  assert.deepEqual(authoringOperations["metric-view"]["read-test"].response.parse(record), record);
  const definition = { name: "Action", explanationRef: runId };
  assert.deepEqual(authoringAdoptionResponseSchema.parse({ definition, ...evidence }), { definition, ...evidence });

  const draft = { pageKey: "actions", operation: "action.create", target: {}, form: definition };
  assert.deepEqual(actionAuthoringPageDraftSchema.parse(draft), pageDraftSchema.parse(draft));
  assert.equal(actionAuthoringPageDraftSchema.safeParse({ ...draft, ...evidence }).success, false);
});

test("the Java schema is generated from the same definitions and its references resolve", () => {
  const schema: Record<string, unknown> = JSON.parse(
    readFileSync(new URL("./authoring.schema.json", import.meta.url), "utf8"),
  );
  const { $schema, definitions } = zodToJsonSchema(z.never(), { definitions: authoringWireSchemas });
  assert.deepEqual(schema, { $schema, $ref: "#/definitions/hostRun", definitions });

  function checkReferences(node: unknown, path: string) {
    if (typeof node !== "object" || node === null) return;
    for (const [key, value] of Object.entries(node)) {
      if (key === "$ref" && typeof value === "string") {
        const target = value.slice(2).split("/").reduce<unknown>(
          (parent, segment) => (parent as Record<string, unknown> | undefined)?.[segment], schema,
        );
        assert.ok(target, value);
        assert.notEqual(value, path, "a definition cannot refer directly to itself");
      } else {
        checkReferences(value, `${path}/${key}`);
      }
    }
  }
  checkReferences(schema, "#");
});
