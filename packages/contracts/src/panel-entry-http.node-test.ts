import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { applicationEntryResolutionSchema } from "./product-panels";
import { entryPathOf, readPanelAddress, writePanelAddress } from "./panel-address";

/*
 * The answers Java actually gave, recorded from the data engine's own controller against PostgreSQL for a synthetic
 * reader (`worktrees/base-application-catalog-java/notes/entry-http/`, commit 385a49a2). The contract parses them, and
 * the address the port writes for the entry they name reads back into the same path and state — so an address this
 * platform builds is the one those answers describe, not a fixture shaped like it.
 */
const answer = (name: string) => JSON.parse(readFileSync(fileURLToPath(new URL(`./entry-http/${name}.json`, import.meta.url)), "utf8"));
const resolution = (name: string) => applicationEntryResolutionSchema.parse(answer(name).data);

test("a declared entry's answer carries its group, its inputs, its frame and its theme, and its path is an address path", () => {
  const resolved = resolution("200-grouped");
  assert.equal(resolved.applicationId, "app-school");
  assert.equal(resolved.use.id, "school");
  assert.equal(resolved.use.groupKey, "school");
  assert.deepEqual(resolved.use.inputs, { term: { literal: null } });
  assert.equal(resolved.framePanelId, "panel-frame");
  assert.deepEqual(resolved.theme, { light: { "--el-color-primary": "#123456" } });
  assert.equal(resolved.menu.groups[0]?.key, "school");
  assert.deepEqual(resolved.menu.panelUses.map(entry => entry.id), ["school"]);
  assert.equal(entryPathOf(resolved.use.path), "/applications/app-school/main");
});

test("a derived object-detail entry has no name and no group, keeps its encoded segment, and its identity fits the contract", () => {
  const resolved = resolution("200-unnamed");
  assert.equal(resolved.applicationId, "browser");
  assert.equal(resolved.use.names, undefined);
  assert.equal(resolved.use.inputs, undefined);
  assert.equal(resolved.use.groupKey, undefined);
  assert.equal(resolved.use.id, "browser-detail:客户");
  assert.equal(resolved.use.pageKey, resolved.use.id);
  // The id carries the class name: the entry contract caps an id at 200, and the boundary fix caps the name at 185.
  assert.ok(resolved.use.id.length <= 200, `entry id is ${resolved.use.id.length} characters`);
  assert.equal(entryPathOf(resolved.use.path), "/browser/detail/%E5%AE%A2%E6%88%B7");
  assert.deepEqual(resolved.menu, { groups: [], panelUses: [] });
});

test("an address written for a resolved entry reads back the same path, frame and state", () => {
  for (const [name, state] of [
    ["200-grouped", { term: "2026-autumn" }],
    ["200-unnamed", { selection: { className: "客户", primaryKey: "10000000-0000-4000-8000-000000000004" } }],
  ] as const) {
    const resolved = resolution(name);
    const address = writePanelAddress({ path: resolved.use.path, frame: { term: "2026-autumn" }, state, search: new URLSearchParams() });
    const reopened = readPanelAddress(address);
    assert.equal(reopened.path, entryPathOf(resolved.use.path), name);
    assert.deepEqual(reopened.frame, { term: "2026-autumn" }, name);
    assert.deepEqual(reopened.state, state, name);
  }
});

test("a refused entry is Java's own message and no entry at all, so nothing downstream can address one", () => {
  assert.deepEqual(answer("403"), { message: "Application access denied" });
  assert.deepEqual(answer("404"), { message: "Panel entry not found" });
  for (const name of ["403", "404"])
    assert.equal(applicationEntryResolutionSchema.safeParse(answer(name)).success, false, name);
});

test("an entry the contract refuses is not made addressable: the answer's own keys are the whole record", () => {
  const body = answer("200-grouped");
  const withUnknown = { ...body, data: { ...body.data, use: { ...body.data.use, extra: "not-in-the-contract" } } };
  assert.throws(() => applicationEntryResolutionSchema.parse(withUnknown.data));
});
