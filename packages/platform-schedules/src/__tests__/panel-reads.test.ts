import { expect, it } from "vitest";
import { platformTaskRunSchema, platformTaskSchema, type PlatformTask } from "@ontomato/contracts/platform-schedules";
import examples from "../../../contracts/examples/platform-schedules.json";
import { createScheduledTaskReads } from "../panel-reads";
import { scheduledTaskPanelMessages, scheduledTaskPanelTextEn } from "../panel-text";

const messages = scheduledTaskPanelMessages(scheduledTaskPanelTextEn);
const translate = (key: string, values?: Record<string, string | number>) => {
  let text = messages[key] ?? key;
  for (const [name, value] of Object.entries(values ?? {})) {
    text = text.replace(`{${name}}`, String(value));
  }
  return text;
};

it("builds task records with owner outputs, application counts, and run records", async () => {
  const task = platformTaskSchema.parse(examples.creates[0]!.response);
  const run = platformTaskRunSchema.parse(examples.runs.find(item => item.response.status === "completed")!.response);
  const reads = createScheduledTaskReads({
    async list() {
      return { tasks: [task], timeZone: task.timeZone };
    },
    async task() {
      return task;
    },
    async form() {
      throw new Error("unused");
    },
    async runs() {
      return { runs: [run], nextCursor: "older" };
    },
    async run() {
      return run;
    },
    async applications() {
      return [{ id: task.appId, name: "Ontology", description: null, available: true, unavailableReason: null, taskCount: 1 }];
    },
  }, "en", translate);

  const list = await reads.list();
  expect(list).toHaveLength(1);
  expect(list[0]).toMatchObject({
    primaryKey: task.id,
    label: task.title,
    fields: {
      application: task.appId,
      applicationName: "Ontology",
      stateLabel: "On",
      enabled: true,
      revision: task.revision,
    },
    tones: { stateLabel: "success" },
    outputs: {
      revision: task.revision,
      enabled: true,
      paused: false,
      pauseCode: "",
      isRunning: false,
    },
  });

  const counts = await reads.counts();
  expect(counts).toEqual([
    { key: "", label: "All", count: 1 },
    { key: task.appId, label: "Ontology", count: 1 },
  ]);

  const page = await reads.runRecords(task.id);
  expect(page.nextCursor).toBe("older");
  expect(page.rows).toHaveLength(1);
  expect(page.rows[0]).toMatchObject({
    primaryKey: run.id,
    fields: { status: "Completed" },
    tones: { status: "success" },
    outputs: {
      resultPath: run.resultLink?.path ?? "",
      isRunning: false,
    },
  });

  const focused = await reads.runRecord(task.id, run.id);
  expect(focused.primaryKey).toBe(run.id);
  expect(focused.outputs?.isRunning).toBe(false);
});

it("classifies task attention groups and supports counts(by='attention')", async () => {
  const baseTask = platformTaskSchema.parse(examples.creates[0]!.response);
  const completedRun = platformTaskRunSchema.parse(examples.runs.find(item => item.response.status === "completed")!.response);
  const failedRun = { ...completedRun, id: "run-failed", status: "failed" as const, error: { code: "run_failed" as const, message: "boom" } };
  const runningTask = { ...baseTask, id: "task-running", title: "Running", activeRunId: "run-live", lastRun: null, pause: null };
  const issueTask = { ...baseTask, id: "task-failed", title: "Failed", activeRunId: null, lastRun: failedRun, pause: null };
  const pausedTask = {
    ...baseTask,
    id: "task-paused",
    title: "Paused",
    activeRunId: null,
    lastRun: completedRun,
    pause: { code: "target_unavailable" as const, message: "Paused after failures", at: completedRun.startedAt },
  };
  const resultsTask = { ...baseTask, id: "task-done", title: "Done", activeRunId: null, lastRun: completedRun, pause: null };
  const idleTask = { ...baseTask, id: "task-idle", title: "Idle", activeRunId: null, lastRun: null, pause: null };

  const reads = createScheduledTaskReads({
    async list() {
      return { tasks: [runningTask, issueTask, pausedTask, resultsTask, idleTask], timeZone: baseTask.timeZone };
    },
    async task() {
      return baseTask;
    },
    async form() {
      throw new Error("unused");
    },
    async runs() {
      return { runs: [], nextCursor: null };
    },
    async run() {
      return completedRun;
    },
    async applications() {
      return [{ id: baseTask.appId, name: "Ontology", description: null, available: true, unavailableReason: null, taskCount: 5 }];
    },
  }, "en", translate);

  const list = await reads.list();
  expect(list.map(row => ({
    id: row.primaryKey,
    attentionGroup: row.outputs?.attentionGroup,
    needsIntervention: row.outputs?.needsIntervention,
    latestRunId: row.outputs?.latestRunId,
    openPath: row.outputs?.openPath,
    activeRunId: row.fields.activeRunId,
    lastRunStatus: row.fields.lastRunStatus,
    pauseMessage: row.fields.pauseMessage,
    lastRunError: row.fields.lastRunError,
  }))).toEqual([
    { id: "task-running", attentionGroup: "running", needsIntervention: false, latestRunId: "run-live", openPath: "/schedules?taskId=task-running&runId=run-live", activeRunId: "run-live", lastRunStatus: undefined, pauseMessage: undefined, lastRunError: undefined },
    { id: "task-failed", attentionGroup: "issues", needsIntervention: true, latestRunId: "run-failed", openPath: "/schedules?taskId=task-failed&runId=run-failed", activeRunId: undefined, lastRunStatus: "failed", pauseMessage: undefined, lastRunError: "boom" },
    { id: "task-paused", attentionGroup: "issues", needsIntervention: true, latestRunId: completedRun.id, openPath: `/schedules?taskId=task-paused&runId=${encodeURIComponent(completedRun.id)}`, activeRunId: undefined, lastRunStatus: "completed", pauseMessage: "Paused after failures", lastRunError: undefined },
    { id: "task-done", attentionGroup: "results", needsIntervention: false, latestRunId: completedRun.id, openPath: `/schedules?taskId=task-done&runId=${encodeURIComponent(completedRun.id)}`, activeRunId: undefined, lastRunStatus: "completed", pauseMessage: undefined, lastRunError: undefined },
    { id: "task-idle", attentionGroup: "idle", needsIntervention: false, latestRunId: "", openPath: "/schedules?taskId=task-idle", activeRunId: undefined, lastRunStatus: undefined, pauseMessage: undefined, lastRunError: undefined },
  ]);

  const counts = await reads.counts("attention");
  expect(counts).toEqual([
    { key: "issues", label: "Needs attention", count: 2 },
    { key: "results", label: "Recent results", count: 1 },
    { key: "running", label: "Running", count: 1 },
  ]);
});

it("loads latestRunRecord with full run output, pause notice without run, and summary fallback", async () => {
  const baseTask = platformTaskSchema.parse(examples.creates[0]!.response);
  const completedRun = platformTaskRunSchema.parse(examples.runs.find(item => item.response.status === "completed")!.response);
  const taskWithCompletedRun = {
    ...baseTask,
    activeRunId: null,
    lastRun: {
      id: completedRun.id,
      taskId: baseTask.id,
      trigger: completedRun.trigger,
      status: completedRun.status,
      scheduledAt: completedRun.scheduledAt,
      startedAt: completedRun.startedAt,
      finishedAt: completedRun.finishedAt,
      error: completedRun.error,
      resultSummary: completedRun.resultSummary,
      resultLink: completedRun.resultLink,
      spendTime: completedRun.spendTime,
    },
  };
  const fullRun = {
    ...completedRun,
    result: "First paragraph\n\nSecond paragraph",
    resultSummary: "Short summary",
  };
  const pausedNoRunTask = {
    ...baseTask,
    id: "task-paused-empty",
    activeRunId: null,
    lastRun: null,
    pause: { code: "credential_invalid" as const, message: "Credential expired" },
  };
  const fallbackTask = {
    ...baseTask,
    id: "task-fallback",
    activeRunId: null,
    lastRun: {
      id: "run-missing",
      taskId: "task-fallback",
      trigger: "manual" as const,
      status: "failed" as const,
      scheduledAt: null,
      startedAt: "2026-11-25T08:00:00Z",
      finishedAt: "2026-11-25T08:00:10Z",
      error: { code: "run_failed" as const, message: "Timeout" },
      resultSummary: null,
      resultLink: null,
      spendTime: 10_000,
    },
  };

  const byId = new Map<string, PlatformTask>([
    [taskWithCompletedRun.id, taskWithCompletedRun],
    [pausedNoRunTask.id, pausedNoRunTask],
    [fallbackTask.id, fallbackTask],
  ]);

  const reads = createScheduledTaskReads({
    async list() {
      return { tasks: [], timeZone: baseTask.timeZone };
    },
    async task(id) {
      return byId.get(id)!;
    },
    async form() {
      throw new Error("unused");
    },
    async runs() {
      return { runs: [], nextCursor: null };
    },
    async run(taskId) {
      if (taskId === fallbackTask.id) throw new Error("not found");
      return fullRun;
    },
    async applications() {
      return [];
    },
  }, "en", translate);

  const completed = await reads.latestRunRecord(taskWithCompletedRun.id);
  expect(completed.primaryKey).toBe(fullRun.id);
  expect(completed.fields).toMatchObject({
    status: "completed",
    trigger: fullRun.trigger,
    startedAt: fullRun.startedAt,
    finishedAt: fullRun.finishedAt,
    timeZone: fullRun.snapshot.timeZone,
    result: "First paragraph\n\nSecond paragraph",
    resultSummary: "Short summary",
  });

  const pausedEmpty = await reads.latestRunRecord(pausedNoRunTask.id);
  expect(pausedEmpty.fields).toMatchObject({
    pauseMessage: "Credential expired",
    timeZone: pausedNoRunTask.timeZone,
  });
  expect(pausedEmpty.fields.status).toBeUndefined();
  expect(pausedEmpty.fields.startedAt).toBeUndefined();

  const fallback = await reads.latestRunRecord(fallbackTask.id);
  expect(fallback.fields).toMatchObject({
    status: "failed",
    trigger: "manual",
    startedAt: "2026-11-25T08:00:00Z",
    finishedAt: "2026-11-25T08:00:10Z",
  });
  expect(String(fallback.fields.errorMessage)).toContain("Timeout");
});
