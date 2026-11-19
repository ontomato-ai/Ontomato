import assert from "node:assert/strict";
import test from "node:test";
import {
  agentHostSendRequestSchema,
  agentHostSessionLiveFrameSchema,
  agentHostSessionRunEventsQuerySchema,
  agentHostSessionRunFrameSchema,
} from "./agent-host";
import {
  displayPageAddressInputSchema,
  displaySnapshotSchema,
  presentationFrameSchema,
  presentationReceiptSchema,
  presentationResultSchema,
  presentRequestSchema,
  PANEL_LOAD_ERROR_CODES,
} from "./agent-presentation";

const id = "a40cfd44-e82c-40f1-8f07-2c1591622381";
const address = "/applications/scheduling/tasks";
const state = { selectedTask: { className: "platform:ScheduledTask", primaryKey: "task-1" } };
const presentationBinding = { viewId: id };

test("present accepts only workspace outputs or a site-relative page and rejects conflicting state", () => {
  assert.deepEqual(presentRequestSchema.parse({ target: "outputs/result.dataset.json" }), {
    target: "outputs/result.dataset.json",
  });
  assert.deepEqual(presentRequestSchema.parse({ target: address, state }), { target: address, state });
  for (const invalid of [
    { target: "result.dataset.json" },
    { target: "outputs/../result.dataset.json" },
    { target: "outputs/", state },
    { target: "outputs/result.dataset.json", state },
    { target: "https://example.com/page" },
    { target: "//[", state },
    { target: "/\\example.com/page" },
    { target: address, state: [] },
    { target: `${address}?%73tate=%7B%7D`, state },
    { target: address, useId: "tasks" },
  ]) assert.equal(presentRequestSchema.safeParse(invalid).success, false, JSON.stringify(invalid));
});

test("run requests carry the view identity and ready identifies a particular connection", () => {
  assert.deepEqual(agentHostSessionRunEventsQuerySchema.parse(presentationBinding), presentationBinding);
  assert.equal(agentHostSessionRunEventsQuerySchema.safeParse({ presentation: "true" }).success, false);
  assert.deepEqual(agentHostSessionRunFrameSchema.parse({ type: "ready" }), { type: "ready" });
  assert.deepEqual(agentHostSessionRunFrameSchema.parse({ type: "ready", connectionId: id }), {
    type: "ready", connectionId: id,
  });
  assert.deepEqual(agentHostSendRequestSchema.parse({ message: "Show the page", presentationBinding }), {
    message: "Show the page", presentationBinding,
  });
  assert.equal(agentHostSendRequestSchema.safeParse({ message: "Show the page", presentationBinding: id }).success, false);
  assert.equal(agentHostSendRequestSchema.safeParse({
    message: "Show the page", presentationBinding: { connectionId: id },
  }).success, false);
});

test("a live display request is distinct from a lifecycle notice, and navigation is distinct from state feedback", () => {
  const frame = {
    type: "presentation", sessionId: id, runId: id, toolCallId: "call-1",
    target: { kind: "page", address, state },
  };
  assert.deepEqual(presentationFrameSchema.parse(frame), frame);
  assert.equal(agentHostSessionRunFrameSchema.safeParse(frame).success, false);
  assert.equal(presentationFrameSchema.safeParse({ ...frame, target: { kind: "artifact", path: "outputs/a" } }).success, false);
  for (const kind of ["navigate", "state"]) {
    const input = { kind, address };
    assert.deepEqual(displayPageAddressInputSchema.parse(input), input);
  }
  assert.equal(displayPageAddressInputSchema.safeParse({ kind: "address", address }).success, false);
});

test("object invalidations are live frames with a root session and object identity", () => {
  const change = {
    type: "object-changed", session: { providerId: "workbench", sessionId: id },
    target: { objectType: "platform:ScheduledTask", primaryKey: "task-1" },
  };
  assert.deepEqual(agentHostSessionLiveFrameSchema.parse(change), change);
  assert.equal(agentHostSessionRunFrameSchema.safeParse(change).success, false);
  assert.equal(agentHostSessionLiveFrameSchema.safeParse({ ...change, target: { ...change.target, data: {} } }).success, false);
});

test("one live invalidation carries the batch's owner-reported objects and types", () => {
  const session = { providerId: "workbench", sessionId: id };
  const objects = [{ objectType: "platform:MetricView", primaryKey: "metric-1" }, { objectType: "platform:Function", primaryKey: "function-1" }];
  const affected = { objects, objectTypes: ["platform:MetricView", "platform:Function"] };
  const batch = { type: "object-changed", session, target: null, affected };
  assert.deepEqual(agentHostSessionLiveFrameSchema.parse(batch), batch);
  const single = { ...batch, target: objects[0] };
  assert.deepEqual(agentHostSessionLiveFrameSchema.parse(single), single);
  const typesOnly = { ...batch, affected: { ...affected, objects: [] } };
  assert.deepEqual(agentHostSessionLiveFrameSchema.parse(typesOnly), typesOnly);
  assert.equal(agentHostSessionLiveFrameSchema.safeParse({ ...batch, affected: undefined }).success, false);
});

test("a receipt reports an observed outcome, keeping an empty view distinct from a missing observation", () => {
  const observedAt = "2026-11-18T10:00:00Z";
  const current = { known: true, observedAt, target: null };
  const selected = {
    known: true, observedAt, placement: "overlay",
    target: { kind: "page", url: address, label: "", selection: [] },
    load: { status: "ready" },
  };
  const binding = { connectionId: id, toolCallId: "call-1" };
  const notFound = { status: "not_opened", reason: "not_found", current };
  assert.deepEqual(presentationReceiptSchema.parse({ ...binding, result: notFound }), {
    ...binding, result: notFound,
  });
  const opened = { status: "opened", reason: "target_selected", current: selected };
  assert.equal(presentationReceiptSchema.safeParse({ ...binding, result: opened }).success, true);
  assert.equal(presentationReceiptSchema.safeParse({ ...binding, result: { ...opened, current } }).success, false);
  assert.equal(presentationReceiptSchema.safeParse({ ...binding, result: { ...opened, reason: "blocked_unsaved" } }).success, false);
  assert.equal(presentationReceiptSchema.safeParse({ toolCallId: binding.toolCallId, result: opened }).success, false);
  assert.equal(displaySnapshotSchema.safeParse({ known: true, target: null }).success, false);

  const missing = { status: "unknown", reason: "receipt_missing", current: { known: false, reason: "receipt_missing" } };
  assert.deepEqual(presentationResultSchema.parse(missing), missing);
  assert.equal(presentationReceiptSchema.safeParse({ ...binding, result: missing }).success, false);

  for (const code of Object.values(PANEL_LOAD_ERROR_CODES)) {
    const message = code === PANEL_LOAD_ERROR_CODES.panelUnavailable ? "403 Forbidden" : "Frame failed";
    const load = { status: "error", error: { code, message } };
    const result = { ...opened, reason: "load_error", current: { ...selected, load } };
    assert.deepEqual(presentationReceiptSchema.parse({ ...binding, result }).result, result);
  }
});
