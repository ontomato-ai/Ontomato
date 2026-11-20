import { expect, it } from "vitest";
import { emptyConversation, applyNotifications, applyHistoryPage, applyRunSnapshot } from "../conversation";
import { conversationItems } from "../view";
import type { AgentHostRunSnapshot, AgentHostSessionHistory } from "@ontomato/contracts/agent-host";
const sessionId = "11111111-1111-4111-8111-111111111111", runId = "22222222-2222-4222-8222-222222222222", inputId = "33333333-3333-4333-8333-333333333333";
const childSessionId = "44444444-4444-4444-8444-444444444444", childRunId = "55555555-5555-4555-8555-555555555555";
const input: AgentHostSessionHistory["messages"][number] = { contextSeq: null, id: inputId, runId: null, messageSeq: 1, message: { role: "notification", kind: "agent-result", source: { session: { providerId: "ontology", sessionId },runId },outcome: "completed",content: "Governance report saved",timestamp: 1 } };
it("hides a delegated agent's result from the reader but still shows a failed automatic wake", () => {
  const state = emptyConversation(sessionId);
  applyNotifications(state,[input]);
  const items = conversationItems(state,{ sessionId,tasks: [],qualityResults: [],preparationFailures: [{ runId,inputId,error: "Agent caller has expired",createdAt: new Date(1).toISOString() }] });
  expect(items).toEqual([
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

it("places a consumed user insertion inside one response using consumption order",()=>{
  const state=emptyConversation(sessionId);
  const assistant=(text:string,timestamp:number)=>({role:"assistant" as const,content:[{type:"text" as const,text}],timestamp,api:null,provider:null,model:null,usage:null,origin:"runtime" as const,stopReason:"stop" as const});
  applyNotifications(state,[
    {id:"first",runId,messageSeq:1,contextSeq:1,message:{role:"user",content:"Question",timestamp:1}},
    {id:"insert",runId,messageSeq:2,contextSeq:3,message:{role:"user",content:"Use current year",timestamp:2}},
    {id:"before",runId,messageSeq:3,contextSeq:2,message:assistant("Before insertion",3)},
    {id:"after",runId,messageSeq:4,contextSeq:4,message:assistant("After insertion",4)},
  ]);
  const items=conversationItems(state),responses=items.filter(item=>item.kind==="response");
  expect(responses).toHaveLength(1);
  expect(responses[0].process.map(block=>[block.kind,"text" in block?block.text:""])).toEqual([["note","Before insertion"],["input","Use current year"],["note","After insertion"]]);
});

it("hides a delegated agent's model-directed question across live, history, and reconnect while keeping preparation failures", () => {
  const internalQuestion: AgentHostSessionHistory["messages"][number] = {
    id: inputId,
    runId: null,
    messageSeq: 1,
    contextSeq: null,
    message: {
      role: "notification",
      kind: "agent-question",
      source: { session: { providerId: "ontology", sessionId: childSessionId }, runId: childRunId },
      content: "Should I exclude retired teachers?",
      defaultAssumption: "Exclude retired teachers",
      timestamp: 1,
    },
  };
  const live = emptyConversation(sessionId);
  applyNotifications(live, [internalQuestion]);
  expect(conversationItems(live)).toEqual([]);
  expect(conversationItems(live, {
    sessionId,
    tasks: [],
    qualityResults: [],
    preparationFailures: [{ runId, inputId, error: "Caller credential expired", createdAt: new Date(1).toISOString() }],
  })).toEqual([{ kind: "notification", key: `preparation:${runId}`, text: "Caller credential expired", error: true }]);

  const history = emptyConversation();
  applyHistoryPage(history, {
    session: { id: sessionId, agentId: "regular", title: "Session", createdAt: new Date(0).toISOString(), updatedAt: new Date(1).toISOString(), latestRun: null },
    messages: [{ ...internalQuestion, runId, contextSeq: 1 }],
    runs: [],
    latestRun: null,
    pendingQuestions: [],
    page: { olderCursor: null, nextCursor: null, throughCursor: `${sessionId}:1`, messageSeq: 1 },
  }, false);
  expect(conversationItems(history)).toEqual([]);

  const reconnect = emptyConversation(sessionId);
  const snapshot: AgentHostRunSnapshot = {
    run: { id: runId, sessionId, status: "running", stopReason: null, errorMessage: null, answerMessageId: null, workspaceCommit: null, createdAt: new Date(0).toISOString(), finishedAt: null, resolvedSkills: [] },
    cursor: { seq: 1, streamId: "stream-1", runId },
    messages: [{ ...internalQuestion, runId, contextSeq: 1 }],
    pendingMessages: [],
    toolExecutions: [],
    artifacts: [],
    pendingQuestions: [],
  };
  applyRunSnapshot(reconnect, snapshot);
  expect(conversationItems(reconnect)).toEqual([]);
});

it("keeps explicit user questions, current-session questions, user answers, and readable task processes", () => {
  const explicitUserQuestionId = "66666666-6666-4666-8666-666666666666";
  const ownQuestionId = "77777777-7777-4777-8777-777777777777";
  const answerId = "88888888-8888-4888-8888-888888888888";
  const state = emptyConversation(sessionId);
  applyNotifications(state, [
    {
      id: explicitUserQuestionId,
      runId: null,
      messageSeq: 1,
      contextSeq: null,
      message: {
        role: "notification",
        kind: "agent-question",
        recipient: "user",
        source: { session: { providerId: "ontology", sessionId: childSessionId }, runId: childRunId },
        content: "Approve execution?",
        defaultAssumption: "No",
        timestamp: 1,
      },
    },
    {
      id: ownQuestionId,
      runId,
      messageSeq: 2,
      contextSeq: null,
      message: {
        role: "notification",
        kind: "agent-question",
        source: { session: { providerId: "workbench", sessionId }, runId },
        content: "Which fiscal year?",
        defaultAssumption: "2025",
        timestamp: 2,
      },
    },
    {
      id: answerId,
      runId: null,
      messageSeq: 3,
      contextSeq: null,
      message: {
        role: "notification",
        kind: "agent-answer",
        source: { kind: "user" },
        replyTo: ownQuestionId,
        content: "2024",
        timestamp: 3,
      },
    },
  ]);

  expect(conversationItems(state)).toEqual([
    { kind: "notification", key: explicitUserQuestionId, text: "Approve execution?", markdownRunId: childRunId },
    { kind: "notification", key: ownQuestionId, text: "Which fiscal year?", markdownRunId: runId },
    { kind: "user", key: answerId, text: "2024", answer: true },
  ]);

  const taskProcess = emptyConversation();
  applyRunSnapshot(taskProcess, {
    run: { id: childRunId, sessionId: childSessionId, status: "running", stopReason: null, errorMessage: null, answerMessageId: null, workspaceCommit: null, createdAt: new Date(0).toISOString(), finishedAt: null, resolvedSkills: [] },
    cursor: { seq: 1, streamId: "child-stream", runId: childRunId },
    messages: [{
      id: "99999999-9999-4999-8999-999999999999",
      runId: childRunId,
      messageSeq: 1,
      contextSeq: 1,
      message: {
        role: "assistant",
        content: [
          { type: "text", text: "Checking definition with parent" },
          { type: "toolCall", id: "call-1", name: "agent", arguments: { op: "send", session: "parent", needsInput: true } },
        ],
        timestamp: 1,
        api: null,
        provider: null,
        model: null,
        usage: null,
        origin: "runtime",
        stopReason: "toolUse",
      },
    }],
    pendingMessages: [],
    toolExecutions: [{
      toolCallId: "call-1",
      toolName: "agent",
      args: { op: "send", session: "parent", needsInput: true },
      status: "completed",
      result: { content: [{ type: "text", text: "{\"questionId\":\"q1\"}" }], details: { artifactIds: [] } },
    }],
    artifacts: [],
    pendingQuestions: [],
  });
  const response = conversationItems(taskProcess).find((item) => item.kind === "response");
  expect(response?.process).toMatchObject([
    { kind: "note", text: "Checking definition with parent" },
    { kind: "steps", steps: [{ kind: "tool", toolName: "agent", status: "completed" }] },
  ]);
});
