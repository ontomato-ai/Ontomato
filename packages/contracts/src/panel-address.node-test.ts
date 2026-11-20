import assert from "node:assert/strict";
import test from "node:test";
import {
  PanelAddressError, deepLinkedStateOf, entryPathOf, readPanelAddress, resolveEntryPath, writePanelAddress,
} from "./panel-address";
import { panelStateSchema, type PanelState } from "./panel-manifest";

/** What the trial's two panels declare: the frame shares a term, the content panel shows a selected task. */
const frameState: PanelState = panelStateSchema.parse({
  term: { type: { kind: "scalar", type: "string" }, deepLink: true, external: true },
});
const contentState: PanelState = panelStateSchema.parse({
  selectedTask: { type: { kind: "object", objectType: "platform:ScheduledTask" }, deepLink: true },
  mode: { type: { kind: "scalar", type: "string" }, deepLink: true },
  tab: { type: { kind: "scalar", type: "string" } },
  marked: { type: { kind: "list", items: { kind: "object", objectType: "platform:ScheduledTask" } } },
});
const task = { className: "platform:ScheduledTask", primaryKey: "10000000-0000-4000-8000-000000000004" };

/** The address the design writes as its example, built by the port rather than by hand. */
test("an address carries the entry path, the frame's state, the content's state and the page's own parameters", () => {
  const address = writePanelAddress({
    path: "/applications/app-school/orders",
    frame: { term: "A" },
    state: { mode: "list" },
    search: new URLSearchParams({ draftSessionId: "session-1" }),
  });
  assert.equal(
    address,
    "/applications/app-school/orders?draftSessionId=session-1&frame=%7B%22term%22%3A%22A%22%7D&state=%7B%22mode%22%3A%22list%22%7D",
  );
  assert.deepEqual(readPanelAddress(address), {
    path: "/applications/app-school/orders",
    frame: { term: "A" },
    state: { mode: "list" },
    search: new URLSearchParams({ draftSessionId: "session-1" }),
  });
});

test("an empty segment is left out and an address without state keeps the page's own parameters", () => {
  assert.equal(writePanelAddress({ path: "/a/schedules", frame: {}, state: {}, search: new URLSearchParams() }), "/a/schedules");
  assert.equal(
    writePanelAddress({ path: "/a/schedules", frame: {}, state: {}, search: new URLSearchParams({ tab: "runs" }) }),
    "/a/schedules?tab=runs",
  );
  // Writing replaces a state the address arrived with, so two writes of the same values are one string.
  const once = writePanelAddress({ path: "/a/schedules", frame: {}, state: { mode: "list" }, search: new URLSearchParams({ state: "%7B%7D" }) });
  assert.equal(once, "/a/schedules?state=%7B%22mode%22%3A%22list%22%7D");
  assert.deepEqual(readPanelAddress(once).state, { mode: "list" });
});

test("a task selected in one page of an application reads back as the same object after the address is written and read", () => {
  const address = writePanelAddress({ path: "/applications/app-a/tasks", frame: { term: "2026-autumn" }, state: { selectedTask: task }, search: new URLSearchParams() });
  const reopened = readPanelAddress(address);
  assert.deepEqual(reopened.frame, { term: "2026-autumn" });
  assert.deepEqual(deepLinkedStateOf(contentState, reopened.state, "state"), { selectedTask: task });
  assert.deepEqual(deepLinkedStateOf(frameState, reopened.frame, "frame"), { term: "2026-autumn" });
});

test("an explicit null is a value the address carries, not a missing field", () => {
  const address = writePanelAddress({ path: "/applications/app-a/tasks", frame: {}, state: { selectedTask: null }, search: new URLSearchParams() });
  assert.equal(address, "/applications/app-a/tasks?state=%7B%22selectedTask%22%3Anull%7D");
  assert.deepEqual(readPanelAddress(address).state, { selectedTask: null });
});

test("a segment that is not JSON, or not an object, is refused by the name of its field", () => {
  assert.throws(() => readPanelAddress("/a?state=%7Bnot-json"), (error: unknown) =>
    error instanceof PanelAddressError && error.field === "state" && /not JSON/.test(error.message));
  assert.throws(() => readPanelAddress("/a?frame=%5B%5D"), (error: unknown) =>
    error instanceof PanelAddressError && error.field === "frame");
  assert.throws(() => readPanelAddress("/a?state=%7B%22mode%22%3A%7B%22x%22%3A1%7D%7D"), (error: unknown) =>
    error instanceof PanelAddressError && error.field === "state.mode");
});

test("a field the panel does not offer in an address is refused by name, not dropped", () => {
  assert.throws(() => deepLinkedStateOf(contentState, { tab: "runs" }, "state"), (error: unknown) =>
    error instanceof PanelAddressError && error.field === "state.tab" && /does not accept/.test(error.message));
  assert.throws(() => deepLinkedStateOf(contentState, { missing: "x" }, "state"), (error: unknown) =>
    error instanceof PanelAddressError && error.field === "state.missing");
  assert.throws(() => deepLinkedStateOf(contentState, { marked: null }, "state"), (error: unknown) =>
    error instanceof PanelAddressError && error.field === "state.marked");
});

test("a value of the wrong type is refused, and the type the panel declared allows its own reference", () => {
  assert.throws(() => deepLinkedStateOf(contentState, { mode: 5 }, "state"), (error: unknown) =>
    error instanceof PanelAddressError && error.field === "state.mode");
  assert.throws(() => deepLinkedStateOf(contentState, { selectedTask: { className: "platform:Agent", primaryKey: "a" } }, "state"), (error: unknown) =>
    error instanceof PanelAddressError && error.field === "state.selectedTask");
  assert.throws(() => readPanelAddress("/a?state=%7B%22selectedTask%22%3A%7B%22className%22%3A%22platform%3AScheduledTask%22%7D%7D"), (error: unknown) =>
    error instanceof PanelAddressError && error.field === "state.selectedTask");
  assert.deepEqual(deepLinkedStateOf(contentState, {}, "state"), {});
});

test("the entry path is the entry's own rule, and a path that is not one is refused as an address field", () => {
  assert.equal(entryPathOf("/applications/app-a/tasks"), "/applications/app-a/tasks");
  for (const path of ["applications/app-a", "/applications//app-a", "/applications/app-a/tasks?tab=runs", "/applications/app-a/tasks#x", "/a/b\\c", "/a/%2f"])
    assert.throws(() => entryPathOf(path), (error: unknown) => error instanceof PanelAddressError && error.field === "path", path);
});

test("the entry request sends only the path, encoded once, to Java's resolve-entry", () => {
  assert.equal(
    resolveEntryPath("/applications/app-browser/orders"),
    "/api/data-query/platform/applications/resolve-entry?path=%2Fapplications%2Fapp-browser%2Forders",
  );
  assert.throws(() => resolveEntryPath("not-a-path"), (error: unknown) => error instanceof PanelAddressError && error.field === "path");
});
