import { createApp, h, nextTick, ref } from "vue";
import { expect, it, vi } from "vitest";
import type { ChannelAgentTask } from "@ontomato/contracts/agent-tasks";
import type { AgentHostRunSnapshot } from "@ontomato/contracts/agent-host";
import type { ShellTaskPort } from "../host";
import TaskCard from "../components/tasks/TaskCard.vue";
import ShellResponse from "../components/ShellResponse.vue";
import { shellContextKey, type ShellContext } from "../context";
import type { ResponseItem } from "../view";

const task: ChannelAgentTask = {
  kind: "agent",title:"Sales?",agentRef:{providerId:"ontology",agentId:"retrieval"},agentName:"Retriever",sessionRef:{providerId:"ontology",sessionId:"66666666-6666-4666-8666-666666666666"},runId:"88888888-8888-4888-8888-888888888888",requestedBy:{session:{providerId:"workbench",sessionId:"11111111-1111-4111-8111-111111111111"},runId:"22222222-2222-4222-8222-222222222222"},results:[], id: "77777777-7777-4777-8777-777777777777", parentTaskId: null,
  root: { sessionId: "22222222-2222-4222-8222-222222222222", runId: "run" }, status: "completed", error: null,
  createdAt: null, process: { mode: "none" },
};
const item: ResponseItem = {
  kind: "response", key: "run", runId: "run", workspaceCommit: null, running: false,
  end: { stopReason: "stop", errorMessage: null }, answerMessageId: null, answerText: "", reviews: [],
  process: [{ kind: "task", key: `task:${task.id}`, task }], startedAt: 0, finishedAt: 25_000,
};

it("retains a delegated task's loaded content and subscription across collapse and reopen", async () => {
  const running: ChannelAgentTask = { ...task, status: "running", process: {
    mode: "inline", runtimeSessionId: task.sessionRef.sessionId, runtimeRunId: task.runId,
  } };
  const snapshot: AgentHostRunSnapshot = { pendingQuestions: [],
    run: { id: task.runId, sessionId: task.sessionRef.sessionId, status: "running", stopReason: null,
      errorMessage: null, answerMessageId: null, workspaceCommit: null, createdAt: new Date(0).toISOString(), finishedAt: null, resolvedSkills: [] },
    cursor: { runId: task.runId, seq: 1, streamId: task.id }, messages: [], toolExecutions: [], artifacts: [],
    pendingMessages: [{ id: "note", message: { role: "assistant", content: [{ type: "text", text: "Inspecting records" }],
      api: null, provider: null, model: null, usage: null, stopReason: "pending", timestamp: 1 } }],
  };
  const detach = vi.fn();
  const port: ShellTaskPort = { subscribe: vi.fn(), readProcess: vi.fn().mockResolvedValue(snapshot), subscribeProcess: vi.fn().mockReturnValue(detach) };
  const root = document.createElement("div"); document.body.append(root);
  const current = ref<ChannelAgentTask>({ ...running, status: "starting" });
  const app = createApp({ render: () => h(TaskCard, { task: current.value, sessionId: task.root.sessionId }) });
  app.provide(shellContextKey, { labels: ref({ tasks: { status: { starting: "Starting", running: "Running", completed: "Done" } } }), tasks: port } as unknown as ShellContext);
  app.mount(root);
  try {
    const summary = root.querySelector<HTMLButtonElement>(".task-summary")!;
    current.value = running;
    await nextTick();
    expect(summary.getAttribute("aria-expanded")).toBe("true");
    await vi.waitFor(() => expect(root.textContent).toContain("Inspecting records"));
    current.value = { ...running, status: "completed" };
    await nextTick();
    expect(summary.getAttribute("aria-expanded")).toBe("false");
    summary.click(); await nextTick();
    expect(root.textContent).toContain("Inspecting records");
    summary.click(); await nextTick();
    expect((root.querySelector(".task-body") as HTMLElement).style.display).toBe("none");
    expect(detach).not.toHaveBeenCalled();
    summary.click(); await nextTick();
    expect(root.textContent).toContain("Inspecting records");
    expect(port.readProcess).toHaveBeenCalledTimes(1);
    expect(port.subscribeProcess).toHaveBeenCalledTimes(1);
  } finally { app.unmount(); root.remove(); }
  expect(detach).toHaveBeenCalledOnce();
});

it("labels delegated tasks with the provider display name without showing a collaboration counter", async () => {
  const genericTask: ChannelAgentTask = {
    ...task,
    id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    title: "Inspect deployment health",
  };
  const responseItem: ResponseItem = {
    ...item,
    process: [{ kind: "task", key: `task:${genericTask.id}`, task: genericTask }],
  };
  const root = document.createElement("div");
  document.body.append(root);
  const app = createApp({ render: () => h(ShellResponse, { item: responseItem, sessionId: task.root.sessionId }) });
  app.provide(shellContextKey, {
    labels: ref({
      thinking: "Thinking",
      worked: (time: string) => time,
      working: "Working",
      elapsed: (time: string) => time,
      tasks: {
        status: { starting: "Starting", running: "Running", completed: "Done", failed: "Failed", cancelled: "Cancelled" },
        errors: {},
      },
    }),
    slots: {},
  } as unknown as ShellContext);
  app.mount(root);
  try {
    expect(root.querySelector(".tasks-entry")).toBeNull();
    const toggle = root.querySelector<HTMLButtonElement>(".process-toggle")!;
    toggle.click();
    await nextTick();
    const card = root.querySelector(`#agent-task-${genericTask.id}`)!;
    expect(card.querySelector(".executor")?.textContent?.trim()).toBe("Retriever");
    expect(card.querySelector(".detail")?.textContent?.trim()).toBe("Inspect deployment health");
  } finally {
    app.unmount();
    root.remove();
  }
});
