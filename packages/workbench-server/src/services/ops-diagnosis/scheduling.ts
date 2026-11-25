import { createHash } from "node:crypto";
import type { PlatformScheduleExecutionState, PlatformScheduleExecutionRequest, PlatformScheduleExecutionStatusRequest } from "@ontomato/contracts/platform-schedules";
import { workbenchManagement } from "@ontomato/contracts/workbench-management";
import { assistantService } from "../assistant/service";
import { assistantStore } from "../assistant/store";
import { diagnosisService } from "./service";
import { withScheduledUserActivity } from "../assistant/scheduled-activity";
import { checkedForm, completeForm, emptyExecution, instruction, option, scheduledSessionId, select, type ScheduleApplication, type ScheduleContext } from "../scheduling/application";
import { scheduledConversationStatus } from "../scheduling/conversation";
import { listCaseSets } from "../../platform/diagnosis/autotest/cases/repository";
import { getActiveRun, isRunActive, startRun } from "../../platform/diagnosis/autotest/runner/run-controller";
import { loadRunMeta, scheduledRunSource } from "../../platform/diagnosis/autotest/results/store";
import { workbenchIdentity } from "../../identity/installed";
import { assertManagement } from "../../identity/management";
import { agentAllowed } from "../assistant/authorization";
import { HttpError } from "../../utils/errors";

function fingerprint(input: PlatformScheduleExecutionRequest): string {
  return createHash("sha256").update(JSON.stringify({ taskId: input.taskId, formRevision: input.formRevision, content: Object.entries(input.content).sort(([a], [b]) => a.localeCompare(b)) })).digest("hex");
}
function batchState(input: PlatformScheduleExecutionStatusRequest): PlatformScheduleExecutionState {
  const batchId = `run-${input.runId}`;
  if (input.handle?.batchId !== undefined && input.handle.batchId !== batchId)
    throw new HttpError(404, "Test run not found", "TASK_NOT_FOUND");
  const meta = loadRunMeta(batchId);
  const source = scheduledRunSource(batchId);
  if (!meta || meta.domainId !== input.owner.domainId || source?.creatorId !== input.owner.userId || source.platformRunId !== input.runId)
    throw new HttpError(404, "Test run not found", "TASK_NOT_FOUND");
  const active = getActiveRun()?.runId === batchId;
  const state = emptyExecution(active ? "running" : meta.status === "completed" ? "completed" : "failed");
  state.handle = { batchId };
  state.resultLink = { appId: "operations", path: `/ops/results?runId=${batchId}` };
  state.resultSummary = `${meta.summary.correct}/${meta.summary.total} passed; ${meta.summary.wrong} wrong; ${meta.summary.abnormal} abnormal`;
  if (state.status === "failed") state.error = {
    code: meta.status === "running" || meta.status === "stopping" ? "interrupted" : meta.status === "cancelled" ? "cancelled" : "run_failed",
    message: "The test batch did not finish successfully",
  };
  return state;
}
async function startBatch(input: PlatformScheduleExecutionRequest, context: ScheduleContext): Promise<PlatformScheduleExecutionState> {
  const batchId = `run-${input.runId}`;
  const old = loadRunMeta(batchId);
  if (old) {
    const source = scheduledRunSource(batchId);
    if (old.domainId !== context.owner.domainId || source?.creatorId !== context.owner.userId || source.fingerprint !== fingerprint(input))
      throw new HttpError(409, "Idempotency key reused", "IDEMPOTENCY_CONFLICT");
    return batchState({ taskId: input.taskId, runId: input.runId, owner: context.owner, handle: { batchId } });
  }
  if (isRunActive()) return {
    ...emptyExecution("skipped"),
    error: { code: "autotest_busy", message: "The previous test batch is still running" },
    resultSummary: "Skipped because the test runner is busy",
  };
  const actor = await workbenchIdentity().resolveAutotestActor({
    token: context.credentials.token, apiKey: context.credentials.apiKey, domainId: context.owner.domainId,
  });
  if (actor.userId !== context.owner.userId || actor.domainId !== context.owner.domainId)
    throw new HttpError(403, "Test credential does not match the task creator", "PERMISSION_DENIED");
  // Recheck after credential I/O: another caller may have acquired the one process-wide test slot.
  if (isRunActive()) return { ...emptyExecution("skipped"), error: { code: "autotest_busy", message: "The previous test batch is still running" } };
  await startRun({
    domainId: actor.domainId, userId: actor.userId, caseSetId: input.content.caseSetId, rounds: 1,
    tk: context.credentials.token, apiKey: context.credentials.apiKey,
    schedule: { platformRunId: input.runId, creatorId: actor.userId, fingerprint: fingerprint(input) },
  });
  return batchState({ taskId: input.taskId, runId: input.runId, owner: context.owner, handle: { batchId } });
}

function requireInspectionAccess({ owner, credentials }: ScheduleContext) {
  return workbenchIdentity().assertObserveAccess({ domainId: owner.domainId, token: credentials.token, apiKey: credentials.apiKey });
}

function requireAutotestFormAccess({ owner, credentials }: ScheduleContext) {
  return assertManagement(workbenchManagement.opsCaseSetsRead, owner, credentials);
}

async function refused(check: Promise<void>): Promise<HttpError | undefined> {
  try {
    await check;
  } catch (error) {
    if (!(error instanceof HttpError) || error.status !== 403) throw error;
    return error;
  }
}

export const operationsScheduleApplication: ScheduleApplication = {
  id: "operations",
  description(locale) { return locale?.startsWith("zh") ? "跑自动测试，或按指令巡检" : "Run automated tests or inspect as instructed"; },
  async authorize(context) {
    if (await refused(requireInspectionAccess(context))) await requireAutotestFormAccess(context);
  },
  async form(input, context) {
    const { owner, credentials } = context;
    const zh = credentials.locale?.startsWith("zh");
    const selected = input.values.operation;
    if (selected !== undefined && selected !== "inspection" && selected !== "autotest")
      throw new HttpError(400, "Unknown operations schedule type", "INVALID_REQUEST");
    const autotestRefusal = selected === "inspection" ? undefined : await refused(requireAutotestFormAccess(context));
    const defaultOperation = autotestRefusal ? "inspection" : "autotest";
    const operation = selected ?? defaultOperation;
    if (operation === "autotest" && autotestRefusal) throw autotestRefusal;
    if (operation === "inspection") await requireInspectionAccess(context);
    const diagnosis = await assistantStore.opsDiagnosis(owner.domainId);
    const canInspect = Boolean(diagnosis?.enabled && await agentAllowed(diagnosis, "USE", credentials));
    const fields = [select("operation", zh ? "做什么" : "Operation", [
      option("autotest", zh ? "跑自动测试" : "Run automated tests", autotestRefusal?.message ?? null),
      option("inspection", zh ? "巡检" : "Inspection", canInspect ? null : zh ? "无权使用运维诊断智能体" : "Operations diagnosis use permission required"),
    ], true, defaultOperation)];
    if (operation === "inspection") fields.push(instruction(zh ? "指令" : "Instruction"));
    else {
      const cases = listCaseSets(owner.domainId);
      const options = cases.map((set) => option(set.id, `${set.name} (${set.caseCount})`, set.caseCount ? null : zh ? "用例集没有题目" : "Case set has no cases"));
      const current = input.values.caseSetId;
      if (current && !cases.some((set) => set.id === current)) options.push(option(current, current, zh ? "用例集已不存在" : "Case set no longer exists"));
      fields.push(select("caseSetId", zh ? "用例集" : "Case set", options));
    }
    const values = input.changedField === "operation" ? { operation } : { ...input.values, operation };
    return completeForm("operations", operation === "inspection" ? "inspection-v1" : "autotest-v1", fields, values);
  },
  async validate(input, context) {
    if (input.content.operation === "autotest")
      await assertManagement(workbenchManagement.opsRunsStart, context.owner, context.credentials);
    return checkedForm(input, await this.form({ values: input.content, changedField: null, taskId: null, timeZone: input.timeZone }, context));
  },
  async start(input, context) {
    await this.validate(input, context);
    return withScheduledUserActivity(context.owner.userId, async () => {
      if (input.content.operation === "autotest") return startBatch(input, context);
      const diagnosis = await assistantStore.opsDiagnosis(context.owner.domainId);
      if (!diagnosis?.enabled) throw new HttpError(404, "Operations diagnosis unavailable", "NOT_FOUND");
      const sessionId = scheduledSessionId(input.runId);
      await assistantService.create(sessionId, context.owner, { agentId: diagnosis.id }, context.credentials, "scheduled");
      await assistantService.send(sessionId, input.runId, { message: input.content.instruction }, context.owner, context.credentials, "background");
      return {
        ...emptyExecution(),
        handle: { sessionId, agentId: diagnosis.id },
        resultLink: { appId: "operations", path: `/ops/diagnosis?frame.sessionId=${sessionId}` },
      };
    });
  },
  async status(input) {
    if (input.handle?.batchId !== undefined || !input.handle) {
      const batchId = `run-${input.runId}`;
      if (input.handle?.batchId !== undefined || loadRunMeta(batchId)) return batchState(input);
    }
    const sessionId = typeof input.handle?.sessionId === "string" ? input.handle.sessionId : scheduledSessionId(input.runId);
    const diagnosisPath = `/ops/diagnosis?frame.sessionId=${sessionId}`;
    try {
      return await scheduledConversationStatus(assistantService, input.owner, sessionId, input.runId, "operations", diagnosisPath);
    } catch (error) {
      // Read-only fallback for historical scheduled inspections persisted in legacy `ops_sessions`.
      if (!(error instanceof HttpError && error.status === 404)) throw error;
      return scheduledConversationStatus(diagnosisService, input.owner, sessionId, input.runId, "operations", diagnosisPath);
    }
  },
};
