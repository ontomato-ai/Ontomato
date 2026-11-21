import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";
import {
  actionAuthoringPageDraftSchema,
  actionExplanationEvidenceSchema,
  authoringAdoptionResponseSchema,
  authoringHostRunSchema,
  authoringKindSchema,
  authoringOperations,
  authoringWireSchemas,
  platformAuthoringEvidenceOperations,
} from "./authoring";
import { pageDraftSchema } from "./page-draft";

const sessionId = "bda3d9bd-afc1-4dfa-92c2-41efda234bad";
const runId = "959c449b-afd0-4af9-9f2d-663fecfce14a";
const executionId = "12a207b7-e868-45e5-a52d-e15f85447447";
const host = {
  hostId: "workbench", sessionId, runId, ownerId: "initiator", executionUserId: "delegate",
  domainId: "domain", classNames: ["/Employee"], expiresAt: 1_900_000_000_000,
};

test("authoring operation input cannot carry Workbench authority", () => {
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

  const draft = { pageKey: "actions", operation: "action.create", target: { objectType: "platform:Action" }, form: definition };
  assert.deepEqual(actionAuthoringPageDraftSchema.parse(draft), pageDraftSchema.parse(draft));
  assert.equal(actionAuthoringPageDraftSchema.safeParse({ ...draft, ...evidence }).success, false);
});

test("historical evidence requests carry only the original host facts and their declared input", () => {
  const definition = { name: "Adjust employee", function: { code: "print('checked')" } };
  const run = { ...host, expiresAt: 1 };
  const readTest = platformAuthoringEvidenceOperations["read-test"];
  const adopt = platformAuthoringEvidenceOperations.adopt;
  assert.deepEqual(readTest.body.parse({ run, input: { executionId } }), { run, input: { executionId } });
  assert.deepEqual(adopt.body.parse({ run, input: { definition } }), { run, input: { definition } });

  const live = { ...run, target: { kind: "live" } };
  assert.equal(readTest.body.safeParse({ run: live, input: { executionId } }).success, false);
  assert.equal(adopt.body.safeParse({ run: live, input: { definition } }).success, false);
  assert.equal(adopt.body.safeParse({ run, input: { definition, artifactId: executionId } }).success, false);

  const adopted = { definition, executionId: null, digest: "a".repeat(64) };
  assert.deepEqual(adopt.response.parse(adopted), adopted);
  assert.equal(readTest.response.safeParse({
    executionId: null, digest: adopted.digest, result: { result: "checked" },
  }).success, false);
});

test("Action test and explanation accept the same multi-class asset parameters", () => {
  const body = {
    code: "print('checked')",
    parameterDefs: [
      { name: "subject", type: "TYPE_ONTOOBJ", classNames: ["/Employee", "/Contractor"] },
      { name: "weights", type: "TYPE_NUMBER_ARRAY", value: [1, 2] },
    ],
  };
  const explain = authoringOperations.action["explain-draft"];
  assert.deepEqual(authoringOperations.action.test.body.parse(body), body);
  assert.deepEqual(explain.body.parse(body), body);
  assert.equal(explain.body.safeParse({ code: body.code }).success, false);
  assert.equal(authoringOperations.action.test.body.safeParse({
    ...body, parameterDefs: [{ name: "subject", type: "TYPE_ONTOOBJ", className: "/Employee" }],
  }).success, false);
});

test("Action explanation evidence points to its business run and stores the accepted JSON", () => {
  const acceptedResult = {
    codeSegments: [{ id: "read", kind: "QUERY", title: "Read", codeRange: { start: 1, end: 1 } }],
    businessMeaning: null,
  };
  const output = { ...acceptedResult, explanationRef: runId };
  assert.deepEqual(authoringOperations.action["explain-draft"].response.parse(output), output);

  const evidence = {
    sourceDigest: "b".repeat(64), explanationVersion: 2, acceptedResultRef: runId, acceptedResult,
  };
  assert.deepEqual(actionExplanationEvidenceSchema.parse(evidence), evidence);
  assert.equal(actionExplanationEvidenceSchema.safeParse({
    ...evidence, acceptedResultRef: { sessionId, runId, artifactId: executionId },
  }).success, false);
});

test("the Java schema is generated from the same definitions and its references resolve", () => {
  const javaSchema = JSON.parse(
    readFileSync(new URL("./authoring.java.schema.json", import.meta.url), "utf8"),
  );
  const { $schema, definitions: javaDefinitions } = zodToJsonSchema(z.never(), {
    definitions: authoringWireSchemas,
    $refStrategy: "none",
  });
  assert.deepEqual(javaSchema, { $schema, definitions: javaDefinitions });

  const { definitions } = zodToJsonSchema(z.never(), { definitions: authoringWireSchemas });
  const schema: Record<string, unknown> = { $schema, $ref: "#/definitions/hostRun", definitions };

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
