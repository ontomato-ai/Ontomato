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
    ["", "/panel-operations/intents/i-1/dispatch"],
    ["", "/assistant/sessions"],
    ["", "/assistant/sessions/s-1/runs"],
  ];
  for (const [service, path] of running) assert.ok(carriesPreviewIdentity(service, "POST", path), `${service}${path}`);
  const building: [string, string, string][] = [
    ["/data-query", "POST", "/writeFunctionOperation/query"],
    ["/data-query", "POST", "/action/trial"],
    ["/data-query", "POST", "/action/setStatus"],
    ["/data-query", "POST", "/function/save"],
    ["/data-query", "POST", "/platform/triggers"],
    ["/data-query", "GET", "/platform/triggers/t-1/runs"],
    ["/data-query", "GET", "/action/execute"],
    ["", "POST", "/praxis/runs/r-1/tick"],
    ["", "GET", "/praxis/runs"],
    ["", "POST", "/assistant/agent-definitions"],
    ["", "POST", "/panel-operations/intents"],
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
