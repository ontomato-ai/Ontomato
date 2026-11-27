import { test } from "node:test";
import assert from "node:assert/strict";
import { carriesPreviewIdentity } from "./execution-context";

test("a preview identity is carried to the entries that run something and to no building or read", () => {
  const running: [string, string][] = [
    ["/data-query", "/action/execute"],
    ["/data-query", "/writeFunctionOperation/insert"],
    ["/data-query", "/writeFunctionOperation/deleteVector"],
    ["/data-query", "/vectorResource/upload"],
    ["/data-query", "/platform/triggers/t-1/runs"],
    ["", "/praxis/runs"],
    ["", "/praxis/runs/r-1/tick"],
    ["", "/praxis/runs/r-1/acts-on"],
    ["", "/praxis/runs/r-1/case/submit"],
    ["", "/praxis/runs/r-1/case/fill"],
    ["", "/praxis/runs/r-1/case/close"],
    ["", "/praxis/steps/s-1/decide"],
    ["", "/praxis/steps/s-1/assign"],
    ["/data-query", "/platform/agent-channel/commands"],
    ["/data-query", "/ontology/ai/sessions/s-1/runs"],
    ["", "/panel-operations/intents/i-1/dispatch"],
    ["", "/assistant/sessions"],
    ["", "/assistant/sessions/s-1/runs"],
  ];
  running.push(
    ["", "/observe/agent/sessions"],
    ["", "/observe/agent/sessions/s-1/runs"],
    ["", "/observe/diagnoses"],
    ["", "/panel-operations/intents"],
  );
  for (const [service, path] of running) assert.ok(carriesPreviewIdentity(service, "POST", path), `${service}${path}`);
  // Stopping, cancelling and deleting runs, conversations and workspaces, the platform's records of pending page
  // operations, and ops test runs are not business writes.
  const platformState: [string, string, string][] = [
    ["", "POST", "/assistant/sessions/s-1/runs/r-1/cancel"],
    ["", "POST", "/observe/agent/sessions/s-1/runs/r-1/cancel"],
    ["/data-query", "POST", "/ontology/ai/sessions/s-1/runs/r-1/cancel"],
    ["", "DELETE", "/assistant/sessions/s-1"],
    ["", "DELETE", "/observe/agent/sessions/s-1"],
    ["/data-query", "DELETE", "/ontology/ai/sessions/s-1"],
    ["", "DELETE", "/workspaces/w-1"],
    ["", "POST", "/panel-operations/intents/i-1/cancel"],
    ["", "POST", "/panel-operations/questions/q-1/cancel-if-pending"],
    ["", "POST", "/panel-operations/local-confirmations"],
    ["", "POST", "/panel-operations/local-confirmations/q-1/claim"],
    ["", "POST", "/observe/autotest/runs"],
    ["", "POST", "/observe/autotest/runs/r-1/stop"],
    ["", "DELETE", "/observe/autotest/runs/r-1"],
  ];
  for (const [service, method, path] of platformState) assert.ok(!carriesPreviewIdentity(service, method, path), `${method} ${service}${path}`);
  const building: [string, string, string][] = [
    ["/data-query", "POST", "/writeFunctionOperation/query"],
    ["/data-query", "POST", "/action/trial"],
    ["/data-query", "POST", "/action/setStatus"],
    ["/data-query", "POST", "/function/save"],
    ["/data-query", "POST", "/platform/triggers"],
    ["/data-query", "GET", "/platform/triggers/t-1/runs"],
    ["/data-query", "GET", "/action/execute"],
    ["", "GET", "/praxis/runs"],
    ["", "GET", "/praxis/runs/r-1/case"],
    ["", "GET", "/praxis/inbox"],
    ["", "POST", "/assistant/agent-definitions"],
    ["", "PATCH", "/assistant/sessions/s-1"],
    ["", "PUT", "/workspaces/w-1/files"],
    ["", "POST", "/workspaces/w-1/import"],
    ["", "GET", "/assistant/sessions/s-1"],
    ["", "POST", "/observe/autotest/case-sets"],
    ["", "GET", "/observe/autotest/runs/r-1"],
    // The same path at the other service is another owner's.
    ["", "POST", "/action/execute"],
    ["/data-query", "POST", "/praxis/runs"],
  ];
  for (const [service, method, path] of building) assert.ok(!carriesPreviewIdentity(service, method, path), `${method} ${service}${path}`);
});

test("a running entry is recognised however its owner would still route the spelling", () => {
  for (const path of ["/action/execute?x=1", "/action/execute/", "/action//execute", "/Action/Execute", "/action/%65xecute"])
    assert.ok(carriesPreviewIdentity("/data-query", "post", path), path);
  for (const path of ["/PRAXIS/runs", "/praxis/runs/", "/assistant/sessions/a%2Fb/runs"])
    assert.ok(carriesPreviewIdentity("", "POST", path), path);
});

test("a malformed percent-encoding is read as it is spelled, without failing the caller", () => {
  assert.ok(!carriesPreviewIdentity("/data-query", "POST", "/action/%E0%A4%A"));
  assert.ok(carriesPreviewIdentity("", "POST", "/praxis/runs/%E0%A4%A/tick"));
});
