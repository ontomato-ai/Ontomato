import assert from "node:assert/strict";
import test from "node:test";
import { draftTarget, pageDraftReadSchema, pageDraftSchema } from "./page-draft";

const objectType = "platform:AgentDefinition";
const file = { pageKey: "agent-settings", operation: "agent.create", target: { objectType }, form: { name: "New analyst" } };

test("a draft addresses its target, or the object its first save created", () => {
  assert.deepEqual(draftTarget({ target: { objectType, id: "agent-1" } }), { kind: "update", objectType, id: "agent-1" });
  // A create draft has no real object until its first save; from then on it addresses what that save created.
  assert.deepEqual(draftTarget(file), { kind: "create", objectType });
  assert.deepEqual(draftTarget({ ...file, created: { id: "agent-2" } }), { kind: "update", objectType, id: "agent-2" });
});

test("only the read carries what a create draft created; the file an agent writes cannot", () => {
  assert.equal(pageDraftReadSchema.safeParse({ ...file, created: { id: "agent-2" } }).success, true);
  assert.equal(pageDraftSchema.safeParse({ ...file, created: { id: "agent-2" } }).success, false);
  assert.equal(pageDraftReadSchema.safeParse({ ...file, created: { id: "" } }).success, false);
});

test("both create and edit drafts require the object's type", () => {
  assert.deepEqual(pageDraftSchema.parse(file), file);
  const edit = { ...file, operation: "agent.update", target: { objectType, id: "agent-1" } };
  assert.deepEqual(pageDraftSchema.parse(edit), edit);
  for (const target of [{}, { id: "agent-1" }, { objectType: "" }, { objectType, id: null }]) {
    assert.equal(pageDraftSchema.safeParse({ ...file, target }).success, false);
    assert.equal(pageDraftReadSchema.safeParse({ ...file, target }).success, false);
  }
});
