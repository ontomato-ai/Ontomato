import { withScheduledUserActivity } from "./user-activity";
import { randomUUID } from "node:crypto";
import type { ScheduledTaskPauseReason } from "@ontomato/contracts/scheduled-tasks";
import { RuntimeClient } from "../../infrastructure/agent-runtime/client";
import { runWithLogContext } from "../../logging/log-context";
import { createLogger } from "../../logging/logger";
import { finalText } from "../../platform/agent-runtime/runtime";
import { runOutcome } from "../../platform/agent-runtime/projection";
import { AuthFailedError } from "../../utils/backend-client";
import { HttpError, toErrorMessage } from "../../utils/errors";
import { assistantService } from "../assistant/service";
import { assistantStore } from "../assistant/store";
import { markScheduledCredentialDead, resolveScheduledCredential } from "./credentials";
import { sendRunMail } from "./notify";
import { scheduledTaskStore, type RunFailure, type RunRecord, type TaskRecord } from "./store";

const logger = createLogger("scheduled-task-runner");

/** A run without a conversation, or whose runtime run is unknown, for this long was lost (e.g. by a restart). */
const LOST_AFTER_MS = 10 * 60_000;

class StartFailure extends Error {
  constructor(readonly failure: RunFailure) {
    super(failure.message);
  }
}

const PAUSING: Partial<Record<RunFailure["code"], ScheduledTaskPauseReason>> = {
  credential_invalid: "credential_invalid",
  agent_unavailable: "agent_unavailable",
};

const ownerOf = (task: TaskRecord) => ({ domainId: task.domainId, userId: task.ownerId });

async function agentName(task: TaskRecord) {
  try {
    return (await assistantStore.agent(task.agentId, ownerOf(task))).name;
  } catch {
    return "—";
  }
}

/**
 * Starts one run of a task in a new conversation of its agent, under the owner's background credential. Returns the
 * recorded run, or null while another run of the task is still running (that trigger is skipped). Failures to start
 * are recorded on the run; a dead credential or an unavailable agent also pauses the task.
 */
export async function startScheduledRun(
  task: TaskRecord,
  trigger: RunRecord["trigger"],
  runId: string = randomUUID(),
): Promise<RunRecord | null> {
  return withScheduledUserActivity(task.ownerId, async () => {
    // A due task may have been claimed before account cleanup deleted it.
    if (!await scheduledTaskStore.get(task.id, ownerOf(task))) return null;
    return startAdmittedRun(task, trigger, runId);
  });
}

async function startAdmittedRun(task: TaskRecord, trigger: RunRecord["trigger"], runId: string): Promise<RunRecord | null> {
  const started = await scheduledTaskStore.startRun(runId, task.id, trigger);
  if (!started) {
    logger.info("Scheduled run skipped: the previous run is still running", { taskId: task.id, trigger });
    return null;
  }
  if (started.replayed) return started.run;
  const owner = ownerOf(task);
  // Set once the conversation exists, so a failure afterwards can remove it.
  const created: { sessionId: string | null } = { sessionId: null };
  try {
    const agent = await assistantStore.agent(task.agentId, owner).catch((error) => {
      if (error instanceof HttpError && error.status === 404) return null;
      throw error;
    });
    if (!agent || !agent.enabled)
      throw new StartFailure({ code: "agent_unavailable", message: agent ? "Agent disabled" : "Agent not found" });
    let resolved;
    try {
      resolved = await resolveScheduledCredential(owner);
    } catch (error) {
      throw new StartFailure({ code: "dependency_unavailable", message: toErrorMessage(error) });
    }
    if (!resolved.ok) throw new StartFailure({ code: "credential_invalid", message: "" });
    const credentials = { ...resolved.credentials, locale: task.locale };
    const session = randomUUID();
    await runWithLogContext({ domainId: owner.domainId, userId: owner.userId, token: credentials.token, apiKey: credentials.apiKey }, async () => {
      try {
        await assistantService.create(session, owner, { agentId: task.agentId }, "scheduled");
      } catch (error) {
        throw startFailure(error);
      }
      created.sessionId = session;
      await scheduledTaskStore.attachSession(runId, session);
      try {
        await assistantService.start(session, runId, task.prompt, owner, credentials);
      } catch (error) {
        throw startFailure(error);
      }
    });
    return { ...started.run, sessionId: session };
  } catch (error) {
    const failure = error instanceof StartFailure ? error.failure : { code: "start_failed" as const, message: toErrorMessage(error) };
    if (created.sessionId) await discardSession(created.sessionId, task, runId);
    const finished = await scheduledTaskStore.finishRun(runId, failure);
    if (failure.code === "credential_invalid") await markScheduledCredentialDead(owner);
    const reason = PAUSING[failure.code];
    if (reason) await scheduledTaskStore.pause(task.id, reason);
    logger.warn("Scheduled run could not start", { taskId: task.id, runId, code: failure.code, paused: Boolean(reason) });
    if (finished && task.notifyEmail)
      await sendRunMail({ to: task.notifyEmail, locale: task.locale, agentName: await agentName(task), prompt: task.prompt, failure });
    return finished ?? started.run;
  }
}

function startFailure(error: unknown): StartFailure {
  if (error instanceof HttpError && error.code === "AGENT_DISABLED")
    return new StartFailure({ code: "agent_unavailable", message: error.message });
  if ((error instanceof AuthFailedError || error instanceof HttpError) && error.status === 401)
    return new StartFailure({ code: "credential_invalid", message: error.message });
  return new StartFailure({ code: "start_failed", message: toErrorMessage(error) });
}

/** A conversation whose run never started holds nothing; it is removed so the list does not fill with empty ones. */
async function discardSession(sessionId: string, task: TaskRecord, runId: string) {
  try {
    await assistantService.delete(sessionId, ownerOf(task));
    await scheduledTaskStore.attachSession(runId, null);
  } catch (error) {
    logger.warn("Could not remove the conversation of a scheduled run that did not start", {
      taskId: task.id,
      runId,
      errorName: error instanceof Error ? error.name : typeof error,
    });
  }
}

/**
 * Ends recorded runs whose runtime run has stopped, and runs that were lost; sends their mail. Each run is ended
 * once, by whichever instance gets there first.
 */
export async function settleScheduledRuns(now = Date.now()) {
  for (const run of await scheduledTaskStore.running(100)) {
    try {
      await settle(run, now);
    } catch (error) {
      logger.warn("Could not settle a scheduled run", { runId: run.id, errorName: error instanceof Error ? error.name : typeof error });
    }
  }
}

async function settle(run: RunRecord & { task: TaskRecord }, now: number) {
  const lost = now - run.startedAt.getTime() > LOST_AFTER_MS;
  if (!run.sessionId) {
    if (lost) await finish(run, { code: "interrupted", message: "" });
    return;
  }
  const client = new RuntimeClient(run.task.domainId);
  try {
    // The lifecycle view decides; the full snapshot is read once, for the answer, after the stop.
    if ((await client.status(run.id)).status !== "stopped") return;
  } catch (error) {
    if (error instanceof HttpError && error.status === 404 && lost) await finish(run, { code: "interrupted", message: "" });
    return;
  }
  const snapshot = await client.run(run.id);
  const ok = runOutcome(snapshot.run) === "completed";
  await finish(
    run,
    ok ? null : { code: "run_failed", message: snapshot.run.errorMessage ?? snapshot.run.stopReason ?? "" },
    ok ? finalText(snapshot) : undefined,
  );
}

async function finish(run: RunRecord & { task: TaskRecord }, failure: RunFailure | null, answer?: string) {
  const finished = await scheduledTaskStore.finishRun(run.id, failure);
  if (!finished || !run.task.notifyEmail) return;
  await sendRunMail({
    to: run.task.notifyEmail,
    locale: run.task.locale,
    agentName: await agentName(run.task),
    prompt: run.task.prompt,
    answer,
    ...(failure ? { failure } : {}),
  });
}
