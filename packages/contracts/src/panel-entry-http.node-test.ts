import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { applicationEntryResolutionSchema } from "./product-panels";
import { deepLinkedStateOf, readPanelAddress, writePanelAddress } from "./panel-address";
import { panelStateSchema } from "./panel-manifest";

/*
 * The answers Java actually gave, recorded from the data engine's own `ApplicationController` against PostgreSQL for a
 * synthetic reader (`worktrees/base-application-catalog-java/notes/entry-http/`). The contract parses them, and the
 * entry they name is an address the port writes and reads back into the same parts — so an address resolved here is the
 * one those answers describe, not a fixture shaped like it.
 */
const answer = (name: string) => JSON.parse(readFileSync(fileURLToPath(new URL(`./entry-http/${name}.json`, import.meta.url)), "utf8"));

/** The state the object browser's panel declares for the entry the unnamed answer resolves. */
const browserState = panelStateSchema.parse({
  selection: { type: { kind: "object", objectType: "platform:ObjectType" }, deepLink: true },
});

test("the grouped answer parses as the entry contract and its entry's address reads back whole", () => {
  const body = answer("200-grouped");
  assert.equal(body.success, true);
  const resolution = applicationEntryResolutionSchema.parse(body.data);
  assert.equal(resolution.applicationId, "browser");
  assert.equal(resolution.use.id, "browse");
  assert.equal(resolution.menu.groups[0]?.key, "browse");
  assert.equal(resolution.menu.panelUses.length, 1);

  const entry = readPanelAddress(writePanelAddress({ path: resolution.use.path, frame: {}, state: {}, search: new URLSearchParams() }));
  assert.equal(entry.path, "/browser/list");
  assert.deepEqual(entry.frame, {});
  assert.deepEqual(entry.state, {});
  assert.deepEqual(entry.search, new URLSearchParams());
});

test("the unnamed answer carries inputs whose literal is null, and its entry is addressable all the same", () => {
  const resolution = applicationEntryResolutionSchema.parse(answer("200-unnamed").data);
  assert.equal(resolution.use.names, undefined);
  assert.deepEqual(resolution.use.inputs, { selection: { literal: null } });
  const address = writePanelAddress({ path: resolution.use.path, frame: {}, state: { selection: null }, search: new URLSearchParams() });
  assert.equal(address, "/browser/data?state=%7B%22selection%22%3Anull%7D");
  assert.deepEqual(deepLinkedStateOf(browserState, readPanelAddress(address).state, "state"), { selection: null });
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
