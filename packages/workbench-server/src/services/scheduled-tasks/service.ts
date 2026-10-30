import { z } from "zod";
import {
  SCHEDULED_TASKS_PER_OWNER_MAX,
  scheduledTaskListSchema,
  scheduledTaskRunPageSchema,
  scheduledTaskRunSchema,
  scheduledTaskSchema,
  type ScheduledTask,
  type ScheduledTaskInput,
  type ScheduledTaskRun,
} from "@ontomato/contracts/scheduled-tasks";
import { environment } from "../../config/environment";
import { HttpError } from "../../utils/errors";
import { assistantStore } from "../assistant/store";
import { ensureScheduledCredential, renewDeadScheduledCredential } from "./credentials";
import { startScheduledRun } from "./runner";
import { nextRunAt } from "./schedule";
import { scheduledTaskStore, type RunRecord, type ScheduledTaskOwner, type TaskRecord } from "./store";

/** The caller's online credentials, from which the owner's background credential is issued when needed. */
export interface ScheduledTaskCaller {
  token?: string;
  apiKey?: string;
  locale?: string;
}

const iso = (date: Date) => date.toISOString();

function runView(run: RunRecord): ScheduledTaskRun {
  return scheduledTaskRunSchema.parse({
    id: run.id,
    taskId: run.taskId,
    sessionId: run.sessionId,
    trigger: run.trigger,
    status: run.status,
    error: run.error,
    startedAt: iso(run.startedAt),
    finishedAt: run.finishedAt ? iso(run.finishedAt) : null,
  });
}

function taskView(task: TaskRecord, lastRun: RunRecord | null): ScheduledTask {
  return scheduledTaskSchema.parse({
    id: task.id,
    agentId: task.agentId,
    prompt: task.prompt,
    frequency: task.frequency,
    notifyEmail: task.notifyEmail,
    enabled: task.enabled,
    pausedReason: task.pausedReason,
    nextRunAt: task.enabled && !task.pausedReason && task.nextRunAt ? iso(task.nextRunAt) : null,
    lastRun: lastRun ? runView(lastRun) : null,
    createdAt: iso(task.createdAt),
    updatedAt: iso(task.updatedAt),
  });
}

const firstRun = (input: Pick<ScheduledTaskInput, "frequency">) =>
  new Date(nextRunAt(input.frequency, Date.now(), environment.scheduleTimeZone()));

/** A task runs its agent's current definition; it can only be set up for an agent that may start conversations. */
async function requireRunnableAgent(agentId: string, owner: ScheduledTaskOwner) {
  const agent = await assistantStore.agent(agentId, owner);
  if (!agent.enabled) throw new HttpError(409, "Agent disabled", "AGENT_DISABLED");
}

/** Ensures the owner's credential; when a dead one was renewed, the tasks it paused resume. */
async function prepareCredential(owner: ScheduledTaskOwner, caller: ScheduledTaskCaller) {
  const { renewed } = await ensureScheduledCredential(owner, caller);
  if (renewed) await resumeCredentialPaused(owner);
}

async function resumeCredentialPaused(owner: ScheduledTaskOwner) {
  for (const task of await scheduledTaskStore.credentialPaused(owner))
    await scheduledTaskStore.resume(task.id, "credential_invalid", firstRun(task));
}

async function view(id: string, owner: ScheduledTaskOwner): Promise<ScheduledTask> {
  const found = await scheduledTaskStore.withLastRun(id, owner);
  if (!found) throw new HttpError(404, "Scheduled task not found", "NOT_FOUND");
  return taskView(found.task, found.lastRun);
}

const sameDefinition = (task: TaskRecord, input: ScheduledTaskInput) =>
  task.agentId === input.agentId &&
  task.prompt === input.prompt &&
  task.notifyEmail === input.notifyEmail &&
  JSON.stringify(task.frequency) === JSON.stringify(input.frequency);

const runCursorSchema = z.object({ startedAt: z.string().datetime({ offset: true }), id: z.string().uuid() });

/** Every operation acts on the caller's own tasks in the caller's domain only. */
export const scheduledTaskService = {
  /**
   * The owner's tasks. Opening the list with a valid login is also when a credential that runs found dead is
   * renewed, resuming the tasks it paused.
   */
  async list(owner: ScheduledTaskOwner, caller: ScheduledTaskCaller) {
    if (await renewDeadScheduledCredential(owner, caller)) await resumeCredentialPaused(owner);
    return scheduledTaskListSchema.parse({
      tasks: (await scheduledTaskStore.list(owner)).map(({ task, lastRun }) => taskView(task, lastRun)),
      timeZone: environment.scheduleTimeZone(),
    });
  },

  async create(id: string, owner: ScheduledTaskOwner, input: ScheduledTaskInput, caller: ScheduledTaskCaller) {
    await requireRunnableAgent(input.agentId, owner);
    await prepareCredential(owner, caller);
    const result = await scheduledTaskStore.create(
      id,
      owner,
      input,
      caller.locale ?? "en",
      firstRun(input),
      SCHEDULED_TASKS_PER_OWNER_MAX,
    );
    if (result.overLimit)
      throw new HttpError(409, `At most ${SCHEDULED_TASKS_PER_OWNER_MAX} scheduled tasks`, "SCHEDULED_TASK_LIMIT");
    if (!result.task || (!result.created && !sameDefinition(result.task, input)))
      throw new HttpError(409, "Idempotency key reused", "IDEMPOTENCY_CONFLICT");
    return { task: await view(result.task.id, owner), created: result.created };
  },

  async update(id: string, owner: ScheduledTaskOwner, input: ScheduledTaskInput, caller: ScheduledTaskCaller) {
    if (!(await scheduledTaskStore.get(id, owner))) throw new HttpError(404, "Scheduled task not found", "NOT_FOUND");
    await requireRunnableAgent(input.agentId, owner);
    await prepareCredential(owner, caller);
    await scheduledTaskStore.update(id, owner, input, caller.locale ?? "en", firstRun(input));
    return view(id, owner);
  },

  async setEnabled(id: string, owner: ScheduledTaskOwner, enabled: boolean, caller: ScheduledTaskCaller) {
    const task = await scheduledTaskStore.get(id, owner);
    if (!task) throw new HttpError(404, "Scheduled task not found", "NOT_FOUND");
    if (enabled) {
      await requireRunnableAgent(task.agentId, owner);
      await prepareCredential(owner, caller);
    }
    await scheduledTaskStore.setEnabled(id, owner, enabled, enabled ? firstRun(task) : null);
    return view(id, owner);
  },

  async delete(id: string, owner: ScheduledTaskOwner) {
    if (!(await scheduledTaskStore.delete(id, owner))) throw new HttpError(404, "Scheduled task not found", "NOT_FOUND");
  },

  /** Runs the task once now, outside its schedule; refused while a run of it is still running. */
  async runNow(id: string, runId: string, owner: ScheduledTaskOwner, caller: ScheduledTaskCaller) {
    const task = await scheduledTaskStore.get(id, owner);
    if (!task) throw new HttpError(404, "Scheduled task not found", "NOT_FOUND");
    await prepareCredential(owner, caller);
    const run = await startScheduledRun(task, "manual", runId);
    if (!run) throw new HttpError(409, "The previous run is still running", "SCHEDULED_TASK_BUSY");
    return runView(run);
  },

  async runs(id: string, owner: ScheduledTaskOwner, input: { cursor?: string; limit: number }) {
    if (!(await scheduledTaskStore.get(id, owner))) throw new HttpError(404, "Scheduled task not found", "NOT_FOUND");
    let cursor = null;
    if (input.cursor) {
      try {
        cursor = runCursorSchema.parse(JSON.parse(Buffer.from(input.cursor, "base64url").toString()));
      } catch {
        throw new HttpError(400, "Invalid cursor", "INVALID_REQUEST");
      }
    }
    const rows = await scheduledTaskStore.runs(id, cursor, input.limit + 1);
    const page = rows.slice(0, input.limit);
    const last = page.at(-1);
    return scheduledTaskRunPageSchema.parse({
      runs: page.map(runView),
      nextCursor:
        rows.length > input.limit && last
          ? Buffer.from(JSON.stringify({ startedAt: iso(last.startedAt), id: last.id })).toString("base64url")
          : null,
    });
  },
};
