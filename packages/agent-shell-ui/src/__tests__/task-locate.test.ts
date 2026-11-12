import { createApp, h, nextTick, ref } from "vue";
import { expect, it, vi } from "vitest";
import type { ChannelAgentTask } from "@ontomato/contracts/agent-tasks";
import type { AgentHostRunSnapshot } from "@ontomato/contracts/agent-host";
import type { ShellTaskPort } from "../host";
import TaskDrawer from "../components/tasks/TaskDrawer.vue";
import ShellResponse from "../components/ShellResponse.vue";
import { shellContextKey, type ShellContext } from "../context";
import type { ResponseItem } from "../view";

const task: ChannelAgentTask = {
  kind: "agent",title:"Sales?",agentRef:{providerId:"ontology",agentId:"retrieval"},sessionRef:{providerId:"ontology",sessionId:"66666666-6666-4666-8666-666666666666"},runId:"88888888-8888-4888-8888-888888888888",requestedBy:{session:{providerId:"workbench",sessionId:"11111111-1111-4111-8111-111111111111"},runId:"22222222-2222-4222-8222-222222222222"},results:[], id: "77777777-7777-4777-8777-777777777777", retrieval:{question:"Sales?",decisionRevision:0,branches:[]}, parentTaskId: null,
  root: { sessionId: "22222222-2222-4222-8222-222222222222", runId: "run" }, status: "completed", error: null,
  createdAt: null, process: { mode: "none" },
};
const item: ResponseItem = {
  kind: "response", key: "run", runId: "run", workspaceCommit: null, running: false,
  end: { stopReason: "stop", errorMessage: null }, answerMessageId: null, answerText: "", reviews: [],
  process: [{ kind: "task", key: `task:${task.id}`, task }], startedAt: 0, finishedAt: 25_000,
};

it("opens a finished reply's folded process when the reader picks one of its tasks from the list", async () => {
  const root = document.createElement("div");
  document.body.append(root);
  const taskFocus = ref<{ taskId: string; at: number } | null>(null);
  const opened: string[] = [];
  const app = createApp({ render: () => h(ShellResponse, { item, sessionId: task.root.sessionId }) });
  app.provide(shellContextKey, {
    labels: ref({
      worked: (time: string) => time, working: "Working", elapsed: (time: string) => time,
      tasks: { count: (n: number) => `${n} tasks`, retriever: "Retriever", status: { completed: "Done" } },
    }),
    slots: {}, taskFocus, openTasks: (runId: string) => opened.push(runId),
  } as unknown as ShellContext);
  app.mount(root);
  try {
    expect(root.querySelector(`#agent-task-${task.id}`)).toBeNull();
    root.querySelector<HTMLButtonElement>(".tasks-entry")!.click();
    expect(opened).toEqual(["run"]);
    taskFocus.value = { taskId: task.id, at: 1 };
    await nextTick();
    await nextTick();
    expect(root.querySelector(`#agent-task-${task.id}`)).not.toBeNull();
  } finally {
    app.unmount();
    root.remove();
  }
});

it("opens a deeper task's read-only process through the existing proxy and links page-backed work", async () => {
  const child: ChannelAgentTask = { ...task, id:"99999999-9999-4999-8999-999999999999", title:"Nested review", parentTaskId:task.id, status:"running",
    process:{mode:"inline",runtimeSessionId:task.sessionRef.sessionId,runtimeRunId:task.runId} };
  const page: ChannelAgentTask = { ...task,id:"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",title:"Governance",parentTaskId:child.id,process:{mode:"page",href:"/governance/chat/record"} };
  const snapshot: AgentHostRunSnapshot = {
    run:{id:child.runId,sessionId:child.sessionRef.sessionId,status:"running",stopReason:null,errorMessage:null,answerMessageId:null,workspaceCommit:null,createdAt:new Date(0).toISOString(),finishedAt:null,resolvedSkills:[]},
    cursor:{runId:child.runId,seq:1,streamId:child.id},messages:[],toolExecutions:[],artifacts:[],
    pendingMessages:[{id:page.id,message:{role:"assistant",content:[{type:"text",text:"Inspecting nested records"}],api:null,provider:null,model:null,usage:null,stopReason:"pending",timestamp:1}}],
  };
  const detach=vi.fn(),port:ShellTaskPort={subscribe:vi.fn(),readProcess:vi.fn().mockResolvedValue(snapshot),subscribeProcess:vi.fn().mockReturnValue(detach)};
  const locate=vi.fn(),root=document.createElement("div");document.body.append(root);
  const app=createApp({render:()=>h(TaskDrawer,{snapshot:{sessionId:task.root.sessionId,tasks:[task,child,page],qualityResults:[]},rounds:[task.root.runId],runId:task.root.runId,onLocate:locate})});
  app.provide(shellContextKey,{labels:ref({close:"Close",tasks:{listTitle:"Tasks",previousRound:"Previous",nextRound:"Next",round:()=>"1/1",retriever:"Retriever",status:{completed:"Done",running:"Running"}}}),tasks:port} as unknown as ShellContext);
  app.mount(root);
  try {
    expect(port.readProcess).not.toHaveBeenCalled();
    const row=Array.from(root.querySelectorAll<HTMLButtonElement>("button.task-row")).find(button=>button.textContent!.includes(child.title))!;
    row.click();await nextTick();await Promise.resolve();await nextTick();
    expect(port.readProcess).toHaveBeenCalledWith(task.root.sessionId,child.id);
    expect(port.subscribeProcess).toHaveBeenCalledWith(task.root.sessionId,child.id,expect.objectContaining({seq:1,streamId:child.id}),expect.any(Object));
    await vi.waitFor(() => expect(root.textContent).toContain("Inspecting nested records"));
    expect(root.querySelector("textarea")).toBeNull();expect(locate).not.toHaveBeenCalled();
    expect(root.querySelector("a.task-row")?.getAttribute("href")).toBe("/governance/chat/record");
    row.click();await nextTick();expect(detach).toHaveBeenCalledOnce();
  } finally {app.unmount();root.remove();}
});
