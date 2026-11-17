import { expect, it } from "vitest";
import { emptyConversation, applyNotifications } from "../conversation";
import { conversationItems } from "../view";
import type { AgentHostSessionHistory } from "@ontomato/contracts/agent-host";
const sessionId = "11111111-1111-4111-8111-111111111111", runId = "22222222-2222-4222-8222-222222222222", inputId = "33333333-3333-4333-8333-333333333333";
const input: AgentHostSessionHistory["messages"][number] = { contextSeq: null, id: inputId, runId: null, messageSeq: 1, message: { role: "notification", kind: "agent-result", source: { session: { providerId: "ontology", sessionId },runId },outcome: "completed",content: "Governance report saved",timestamp: 1 } };
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
