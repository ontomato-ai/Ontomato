import assert from "node:assert/strict";
import test from "node:test";
import {
  agentHostSendRequestSchema,
  agentHostSessionLiveFrameSchema,
  agentHostSessionRunEventsQuerySchema,
  agentHostSessionRunFrameSchema,
} from "./agent-host";
import {
  pageContextLine,
  pageContextSchema,
  writtenText,
} from "./page-context";
import {
  displayPageAddressInputSchema,
  displaySnapshotSchema,
  fillFormRequestSchema,
  observeDisplayRequestSchema,
  pageActionRequestSchema,
  presentationCallRequestSchema,
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

test("pageContext carries declared public state and live form contents on every message line and writtenText strips standalone lines", () => {
  const ctx = pageContextSchema.parse({
    url: address,
    label: "Tasks",
    selection: [],
    state: { tab: "history", filter: "active", checked: [{ className: "platform:ScheduledTask", primaryKey: "t-1" }] },
    forms: [{
      member: "taskForm",
      target: { kind: "object", objectType: "platform:ScheduledTask", primaryKey: "t-1" },
      dirty: true,
      dirtyFields: ["/name"],
      values: { name: "Edited task name" },
    }],
  });
  const prompts = {
    page: ({ label, url }: { label: string; url: string }) => `Current page: ${label} (${url})`,
    pageAddress: (url: string) => `Current page: ${url}`,
    selection: (label: string) => `Selected: ${label}`,
    state: (value: string) => `State: ${value}`,
    forms: (value: string) => `Form: ${value}`,
    file: ({ label, path }: { label: string; path: string }) => `Current file: ${label} (${path})`,
    closed: "Current page: closed",
  };
  const firstLine = pageContextLine(ctx, prompts, true);
  assert.match(firstLine, /^Current page: Tasks \(\/applications\/scheduling\/tasks\)；State: \{"tab":"history".*；Form: \[\{"member":"taskForm"/);
  const followUpLine = pageContextLine(ctx, prompts, false);
  assert.match(followUpLine, /^State: \{"tab":"history".*；Form: \[\{"member":"taskForm"/);
  assert.equal(writtenText(`Check this tab\n\n${followUpLine}`, prompts), "Check this tab");
  assert.equal(writtenText(`Check this tab\n\n${firstLine}`, prompts), "Check this tab");
  const formsOnly = pageContextLine({ url: address, label: "Tasks", selection: [], forms: ctx.forms }, prompts, false);
  assert.match(formsOnly, /^Form: \[\{"member":"taskForm"/);
  assert.equal(writtenText(`Check my edits\n\n${formsOnly}`, prompts), "Check my edits");
});

test("observe display request, live frame and observed result support mid-round re-reads with form contents", () => {
  assert.deepEqual(observeDisplayRequestSchema.parse({ mode: "observe" }), { mode: "observe" });
  assert.deepEqual(presentationCallRequestSchema.parse({ toolCallId: "obs-1", input: { mode: "observe" } }), {
    toolCallId: "obs-1", input: { mode: "observe" },
  });
  const frame = { type: "presentation", sessionId: id, runId: id, toolCallId: "obs-1", target: { kind: "observe" } };
  assert.deepEqual(presentationFrameSchema.parse(frame), frame);
  const observed = {
    status: "observed",
    reason: "current_display",
    current: {
      known: true,
      observedAt: "2026-11-23T10:00:00Z",
      placement: "side",
      target: {
        kind: "page",
        url: address,
        label: "Tasks",
        selection: [],
        state: { tab: "edit" },
        forms: [{ member: "taskForm", dirty: true, dirtyFields: ["/title"], values: { title: "Updated" } }],
      },
      load: { status: "ready" },
    },
  };
  assert.deepEqual(presentationReceiptSchema.parse({ connectionId: id, toolCallId: "obs-1", result: observed }).result, observed);
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
  assert.deepEqual(agentHostSendRequestSchema.parse({
    message: "Assign the next reviewer",
    variables: { runId: id, stepId: id },
  }), {
    message: "Assign the next reviewer",
    variables: { runId: id, stepId: id },
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

test("fill_form and page_action requests, frames, and receipts validate on the shared presentation channel", () => {
  const fillInput = { mode: "fill_form", member: "form", values: { "/name": "New Action" } };
  assert.deepEqual(fillFormRequestSchema.parse(fillInput), fillInput);
  assert.equal(fillFormRequestSchema.safeParse({ mode: "fill_form", values: {} }).success, false);
  assert.deepEqual(presentationCallRequestSchema.parse({ toolCallId: "fill-1", input: fillInput }), {
    toolCallId: "fill-1",
    input: fillInput,
  });
  const fillFrame = {
    type: "presentation",
    sessionId: id,
    runId: id,
    toolCallId: "fill-1",
    target: { kind: "fill_form", member: "form", values: { "/name": "New Action" }, overwriteUnsaved: true },
  };
  assert.deepEqual(presentationFrameSchema.parse(fillFrame), fillFrame);

  const actionInput = { mode: "page_action", operation: "list.delete", rowKey: "row-1", input: { reason: "cleanup" } };
  assert.deepEqual(pageActionRequestSchema.parse(actionInput), actionInput);
  assert.deepEqual(presentationCallRequestSchema.parse({ toolCallId: "act-1", input: actionInput }), {
    toolCallId: "act-1",
    input: actionInput,
  });
  const actionFrame = {
    type: "presentation",
    sessionId: id,
    runId: id,
    toolCallId: "act-1",
    target: { kind: "page_action", operation: "list.delete", rowKey: "row-1", input: { reason: "cleanup" } },
  };
  assert.deepEqual(presentationFrameSchema.parse(actionFrame), actionFrame);

  const selected = {
    known: true,
    observedAt: "2026-11-23T14:00:00Z",
    placement: "side",
    target: { kind: "page", url: address, label: "Tasks", selection: [] },
    load: { status: "ready" },
  };
  const filledReceipt = {
    connectionId: id,
    toolCallId: "fill-1",
    result: {
      status: "filled",
      reason: "form_updated",
      member: "form",
      filledFields: ["/name"],
      rejectedFields: [{ path: "/id", reason: "read_only", message: "Field /id is read-only." }],
      current: selected,
    },
  };
  assert.deepEqual(presentationReceiptSchema.parse(filledReceipt), filledReceipt);

  const awaitingReceipt = {
    connectionId: id,
    toolCallId: "act-1",
    result: {
      status: "awaiting_confirmation",
      reason: "confirmation_required",
      operation: "form.save",
      intentId: id,
      questionId: id,
      label: "Save",
      current: selected,
    },
  };
  assert.deepEqual(presentationReceiptSchema.parse(awaitingReceipt), awaitingReceipt);

  const missingWithIntent = {
    status: "unknown",
    reason: "receipt_missing",
    intentId: id,
    current: { known: false, reason: "receipt_missing" },
  };
  assert.deepEqual(presentationResultSchema.parse(missingWithIntent), missingWithIntent);

  const outcomeUnknownReceipt = {
    connectionId: id,
    toolCallId: "act-unknown",
    result: {
      status: "unknown",
      reason: "outcome_unknown",
      operation: "batch.updateStatus",
      intentId: id,
      outcome: { kind: "unknown", message: "Owner connection closed before answer." },
      current: selected,
      error: { code: "ACTION_OUTCOME_UNKNOWN", message: "Owner connection closed before answer." },
    },
  };
  assert.deepEqual(presentationReceiptSchema.parse(outcomeUnknownReceipt), outcomeUnknownReceipt);
  assert.deepEqual(presentationResultSchema.parse(outcomeUnknownReceipt.result), outcomeUnknownReceipt.result);

  const boundFillInput = {
    mode: "fill_form",
    member: "form",
    memberPath: ["detail"],
    values: { "/name": "Scoped" },
    expectedPageInstanceId: "page-1",
    expectedMemberInstanceId: "nested-1",
    expectedTarget: { kind: "object", objectType: "platform:ScheduledTask", primaryKey: "task-1" },
  };
  assert.deepEqual(fillFormRequestSchema.parse(boundFillInput), boundFillInput);
  const boundActionInput = {
    mode: "page_action",
    operation: "list.batchDelete",
    rowKey: "platform:ScheduledTask:task-1",
    expectedPageInstanceId: "page-1",
    expectedMemberInstanceId: "nested-1",
    expectedTarget: { kind: "draft", objectType: "platform:ScheduledTask" },
    expectedCheckedKeys: ["platform:ScheduledTask:task-1", "platform:ScheduledTask:task-2"],
  };
  assert.deepEqual(pageActionRequestSchema.parse(boundActionInput), boundActionInput);

  const selectedWithBinding = {
    known: true,
    observedAt: "2026-11-23T14:00:00Z",
    placement: "side",
    target: {
      kind: "page",
      url: address,
      label: "Tasks",
      selection: [],
      pageInstanceId: "page-1",
      memberInstances: { detail: "nested-1" },
      checkedKeys: { checked: ["platform:ScheduledTask:task-1"] },
    },
    load: { status: "ready" },
  };
  const staleFillReceipt = {
    connectionId: id,
    toolCallId: "fill-2",
    result: {
      status: "not_filled",
      reason: "stale",
      member: "form",
      current: selectedWithBinding,
    },
  };
  assert.deepEqual(presentationReceiptSchema.parse(staleFillReceipt), staleFillReceipt);
});
