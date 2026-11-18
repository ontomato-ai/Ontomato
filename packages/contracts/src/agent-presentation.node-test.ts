import assert from "node:assert/strict";
import test from "node:test";
import {
  agentHostSendRequestSchema,
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
  PANEL_FRAME_LOAD_ERROR_CODES,
} from "./agent-presentation";

const id = "a40cfd44-e82c-40f1-8f07-2c1591622381";
const address = "/applications/scheduling/tasks";
const state = { selectedTask: { className: "platform:ScheduledTask", primaryKey: "task-1" } };
const presentationBinding = { connectionId: id };

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

test("display binding is issued on stream ready and only its connection ID is sent on the run request", () => {
  assert.deepEqual(agentHostSessionRunEventsQuerySchema.parse({ presentation: "true" }), { presentation: "true" });
  assert.deepEqual(agentHostSessionRunFrameSchema.parse({ type: "ready" }), { type: "ready" });
  assert.deepEqual(agentHostSessionRunFrameSchema.parse({ type: "ready", presentationBinding }), {
    type: "ready", presentationBinding,
  });
  assert.deepEqual(agentHostSendRequestSchema.parse({ message: "Show the page", presentationBinding }), {
    message: "Show the page", presentationBinding,
  });
  assert.equal(agentHostSendRequestSchema.safeParse({ message: "Show the page", presentationBinding: id }).success, false);
  assert.equal(agentHostSendRequestSchema.safeParse({
    message: "Show the page", presentationBinding: { connectionId: id, actor: id },
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

  for (const code of Object.values(PANEL_FRAME_LOAD_ERROR_CODES)) {
    const load = { status: "error", error: { code, message: "Frame failed" } };
    const result = { ...opened, reason: "load_error", current: { ...selected, load } };
    assert.deepEqual(presentationReceiptSchema.parse({ ...binding, result }).result, result);
  }
});
