import assert from "node:assert/strict";
import test from "node:test";
import { actionDefinitionSchema, actionExplanationSchema, type ActionCodeSegment } from "./action-panel";
import { panelReadResultSchemas } from "./panel-operations";
import { ACTION, platformObjectTypes } from "./platform-object-types";

const segment = (kind: string, extra: object = {}) => ({
  id: `s-${kind}`, kind, kindLabel: kind.toLowerCase(), title: kind, codeRange: { start: 1, end: 2 }, ...extra,
});

test("an action explanation names every nested segment's kind and allows an unexplained saved action", () => {
  const explanation = {
    code: "# ontomato-python:2", codeHash: "a".repeat(64), explanationVersion: 3,
    codeSegments: [
      segment("TRY_CATCH", {
        trySegs: [segment("UPDATE_OBJECT", { class: "Order", assignments: [{ field: "status", valueFrom: "approved" }] })],
        catchs: [{ error: "any", segs: [segment("ERROR_HANDLING")] }],
      }),
      segment("BRANCH", { branchArms: [{ condition: "open", segs: [segment("LOOP", { segs: [segment("QUERY")] })] }] }),
    ],
    businessMeaning: { operations: ["Approve the order"], negativeEffect: "" },
  };
  assert.deepEqual(actionExplanationSchema.parse(explanation), explanation);
  assert.deepEqual(actionExplanationSchema.parse({ codeSegments: [] }), { codeSegments: [] });

  const unlabelled = structuredClone(explanation) as unknown as { codeSegments: ActionCodeSegment[] };
  delete (unlabelled.codeSegments[1].branchArms![0].segs[0].segs![0] as Partial<ActionCodeSegment>).kindLabel;
  assert.equal(actionExplanationSchema.safeParse(unlabelled).success, false);
  assert.equal(actionExplanationSchema.safeParse({ codeSegments: [segment("GUESS")] }).success, false);
});

test("an action definition is the owner's derived description, header only without a function", () => {
  const header = {
    version: 1, source: "DERIVED", verified: false, name: "Approve order", description: null, codeHash: null,
    explanationVersion: null,
  };
  assert.deepEqual(actionDefinitionSchema.parse(header), header);
  const derived = {
    ...header,
    declaredTarget: { className: "Order", keyParameter: "order_id" },
    execution: { kind: "FUNCTION", operation: "OPERATION_WRITE" },
    parameters: [{ name: "order_id", type: "STRING", description: "Order key", sample: "00123", objectTypes: ["Order"], required: null, constraints: null }],
    returnDef: { isVoid: true, classNames: null, outKeyRefs: null },
    submissionCriteria: {
      conditions: [{ objectParameter: "order_id", className: "Order", field: "status", operator: "=", value: "open", message: "Still open" }],
      source: "GENERATED", verified: false,
    },
    effects: [{ kind: "UPDATE_OBJECT", kindLabel: "Update object", className: "Order", objectIdFrom: "order_id" }],
    affects: ["Order"], reads: [{ className: "Order" }], objects: ["Order"],
    target: { objectType: "Order", operation: "UPDATE_OBJECT" },
    businessMeaning: { operations: ["Approve the order"], negativeEffect: "" },
  };
  assert.deepEqual(actionDefinitionSchema.parse(derived), derived);
  assert.equal(actionDefinitionSchema.safeParse({ ...derived, effects: [{ kind: "UPDATE_OBJECT", className: "Order" }] }).success, false);
  assert.equal(actionDefinitionSchema.safeParse({ ...header, verified: true }).success, false);
});

test("the action type declares its new-action form, definition and explanation reads", () => {
  const reads = platformObjectTypes[ACTION].reads!;
  assert.deepEqual(reads.createForm, {
    source: "type", parameterMode: "fixed", params: { values: "panelFormValues", changedField: "changedField" }, result: "panelFormDescription",
  });
  assert.deepEqual(reads.definition, { source: "object", parameterMode: "fixed", params: {}, result: "actionDefinition" });
  assert.deepEqual(reads.explanation, { source: "object", parameterMode: "fixed", params: {}, result: "actionExplanation" });
  assert.equal(panelReadResultSchemas.actionDefinition, actionDefinitionSchema);
  assert.equal(panelReadResultSchemas.actionExplanation, actionExplanationSchema);
});
