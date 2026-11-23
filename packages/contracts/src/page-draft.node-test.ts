import assert from "node:assert/strict";
import test from "node:test";
import { draftTarget, pageDraftReadSchema, pageDraftSchema, pageDraftTargetSchema } from "./page-draft";
import { panelMemberItemKeySchema, panelObjectRefSchema } from "./panel-manifest";

const objectType = "platform:AgentDefinition";
const file = { pageKey: "agent-settings", operation: "agent.create", target: { objectType }, form: { name: "New analyst" } };

test("a draft addresses its target, or the object its first save created", () => {
  assert.deepEqual(draftTarget({ target: { objectType, id: "agent-1" } }), { kind: "update", objectType, id: "agent-1" });
  // A create draft has no real object until its first save; from then on it addresses what that save created.
  assert.deepEqual(draftTarget(file), { kind: "create", objectType });
  assert.deepEqual(draftTarget({ ...file, created: { id: "agent-2" } }), { kind: "update", objectType, id: "agent-2" });
  // Editing an embedded row under a parent object preserves itemKey (scalar or typed object ref).
  assert.deepEqual(
    draftTarget({ target: { objectType, id: "parent-1", itemKey: "row-1" } }),
    { kind: "update", objectType, id: "parent-1", itemKey: "row-1" },
  );
  const objectItemKey = { className: "platform:ScheduledTask", primaryKey: "row-2" };
  assert.deepEqual(
    draftTarget({ target: { objectType, id: "parent-1", itemKey: objectItemKey } }),
    { kind: "update", objectType, id: "parent-1", itemKey: objectItemKey },
  );
  // Adding an embedded row under a parent object omits itemKey.
  const addRow = draftTarget({ target: { objectType, id: "parent-1" } });
  assert.deepEqual(addRow, { kind: "update", objectType, id: "parent-1" });
  assert.equal("itemKey" in addRow, false);
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

test("draft target accepts optional panelMemberItemKey and rejects invalid itemKey or unknown parent field", () => {
  // Reuse the same schema exported by panel-manifest without circular imports.
  assert.equal(panelMemberItemKeySchema.parse("row-1"), "row-1");
  assert.deepEqual(
    panelObjectRefSchema.parse({ className: objectType, primaryKey: "row-1" }),
    { className: objectType, primaryKey: "row-1" },
  );

  const scalarRowEdit = {
    ...file,
    operation: "row.update",
    target: { objectType, id: "parent-1", itemKey: "row-1" },
  };
  assert.deepEqual(pageDraftSchema.parse(scalarRowEdit), scalarRowEdit);
  assert.deepEqual(pageDraftReadSchema.parse(scalarRowEdit), scalarRowEdit);

  const typedRowEdit = {
    ...file,
    operation: "row.update",
    target: { objectType, id: "parent-1", itemKey: { className: "platform:ScheduledTask", primaryKey: "row-2" } },
  };
  assert.deepEqual(pageDraftSchema.parse(typedRowEdit), typedRowEdit);
  assert.deepEqual(pageDraftReadSchema.parse(typedRowEdit), typedRowEdit);

  // Invalid itemKey values are rejected.
  for (const itemKey of [
    "",
    0,
    42,
    null,
    true,
    {},
    { className: objectType },
    { primaryKey: "row-1" },
    { className: "", primaryKey: "row-1" },
    { className: objectType, primaryKey: "" },
    { className: objectType, primaryKey: "row-1", extra: true },
  ]) {
    const target = { objectType, id: "parent-1", itemKey };
    assert.equal(pageDraftTargetSchema.safeParse(target).success, false);
    assert.equal(pageDraftSchema.safeParse({ ...file, target }).success, false);
    assert.equal(pageDraftReadSchema.safeParse({ ...file, target }).success, false);
  }

  // Unknown extra fields such as `parent` are strictly rejected.
  for (const target of [
    { objectType, id: "child-1", parent: { objectType: "platform:ObjectType", id: "parent-1" } },
    { objectType, id: "parent-1", itemKey: "row-1", parent: "parent-0" },
  ]) {
    assert.equal(pageDraftTargetSchema.safeParse(target).success, false);
    assert.equal(pageDraftSchema.safeParse({ ...file, target }).success, false);
    assert.equal(pageDraftReadSchema.safeParse({ ...file, target }).success, false);
  }
});
