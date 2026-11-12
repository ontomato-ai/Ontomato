import { expect, it } from "vitest";
import { emptyConversation, applyNotifications } from "../conversation";
import { conversationItems } from "../view";
import type { AgentHostSessionHistory } from "@ontomato/contracts/agent-host";
const sessionId = "11111111-1111-4111-8111-111111111111", runId = "22222222-2222-4222-8222-222222222222", inputId = "33333333-3333-4333-8333-333333333333";
const input: AgentHostSessionHistory["messages"][number] = { id: inputId, runId: null, messageSeq: 1, message: { role: "notification", kind: "agent-result", source: { session: { providerId: "ontology", sessionId },runId },outcome: "completed",content: "Governance report saved",timestamp: 1 } };
it("shows a failed automatic wake next to its notification without inventing a user or model message", () => {
  const state = emptyConversation(sessionId);
  applyNotifications(state,[input]);
  const items = conversationItems(state,{ sessionId,tasks: [],qualityResults: [],preparationFailures: [{ runId,inputId,error: "Agent caller has expired",createdAt: new Date(1).toISOString() }] });
  expect(items).toEqual([
    { kind: "notification",key: inputId,text: "Governance report saved" },
    { kind: "notification",key: `preparation:${runId}`,text: "Agent caller has expired",error: true },
  ]);
});
it("keeps the original receipt identity and never unconsumes an input on a late snapshot", () => {
  const state = emptyConversation(sessionId);
  applyNotifications(state,[input]);
  applyNotifications(state,[{ ...input,runId }]);
  applyNotifications(state,[input]);
  expect(Object.keys(state.messages)).toEqual([inputId]);
  expect(state.messages[inputId].runId).toBe(runId);
  expect(state.messages[inputId].message.role).toBe("notification");
});
