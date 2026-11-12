import { createApp, h, nextTick, ref } from "vue";
import { expect, it } from "vitest";
import type { RetrievalTask } from "@ontomato/contracts/agent-tasks";
import ShellResponse from "../components/ShellResponse.vue";
import { shellContextKey, type ShellContext } from "../context";
import type { ResponseItem } from "../view";

const task: RetrievalTask = {
  kind: "retrieval", id: "77777777-7777-4777-8777-777777777777", question: "Sales?", parentTaskId: null,
  root: { sessionId: "22222222-2222-4222-8222-222222222222", runId: "run" }, status: "completed", error: null,
  createdAt: null, process: { mode: "none" }, branches: [],
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
