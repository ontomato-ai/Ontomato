import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { operationsScheduleApplication as application } from "../scheduling";
import { platformScheduleExecutionStateSchema, platformScheduleFormSchema, type PlatformScheduleExecutionRequest } from "@ontomato/contracts/platform-schedules";
import { workbenchManagement } from "@ontomato/contracts/workbench-management";
import { HttpError } from "../../../utils/errors";

const mocks = vi.hoisted(() => ({
  active: vi.fn(), busy: vi.fn(), start: vi.fn(), meta: vi.fn(), source: vi.fn(), cases: vi.fn(),
  access: vi.fn(), management: vi.fn(), actor: vi.fn(), create: vi.fn(), run: vi.fn(), status: vi.fn(), grantAllowed: vi.fn(),
  opsDiagnosis: vi.fn(),
}));
const diagnosisId = "64348621-8f48-4734-b498-a265598c19f0";
vi.mock("../../assistant/service", () => ({ assistantService: { create: mocks.create, send: mocks.run } }));
vi.mock("../../assistant/store", () => ({ assistantStore: { opsDiagnosis: mocks.opsDiagnosis } }));
vi.mock("../service", () => ({ diagnosisService: { create: vi.fn(), send: vi.fn() } }));
vi.mock("../../assistant/authorization", () => ({ agentAllowed: mocks.grantAllowed }));
vi.mock("../../scheduling/conversation", () => ({ scheduledConversationStatus: mocks.status }));
vi.mock("../../../platform/diagnosis/autotest/runner/run-controller", () => ({ getActiveRun: mocks.active, isRunActive: mocks.busy, startRun: mocks.start }));
vi.mock("../../../platform/diagnosis/autotest/results/store", () => ({ loadRunMeta: mocks.meta, scheduledRunSource: mocks.source }));
vi.mock("../../../platform/diagnosis/autotest/cases/repository", () => ({ listCaseSets: mocks.cases }));
vi.mock("../../../identity/installed", () => ({ workbenchIdentity: () => ({ assertObserveAccess: mocks.access, resolveAutotestActor: mocks.actor }) }));
vi.mock("../../../identity/management", () => ({ assertManagement: mocks.management }));
const owner={ userId:"alice", domainId:"sales" }, context={owner,credentials:{apiKey:"internal",locale:"zh-CN"}};
function input():PlatformScheduleExecutionRequest {
  return {taskId:randomUUID(),runId:randomUUID(),appId:"operations",title:"Regression",content:{operation:"autotest",caseSetId:"set"},formRevision:"autotest-v1",timeZone:"Asia/Shanghai",locale:"zh-CN",trigger:"schedule",scheduledAt:"2026-11-06T02:00:00Z",admittedAt:"2026-11-06T02:00:01Z"};
}
beforeEach(() => {
  mocks.meta.mockReturnValue(null); mocks.source.mockReturnValue(null); mocks.busy.mockReturnValue(false); mocks.active.mockReturnValue(null);
  mocks.actor.mockResolvedValue(owner); mocks.access.mockResolvedValue(undefined); mocks.management.mockResolvedValue(undefined); mocks.grantAllowed.mockResolvedValue(true);
  mocks.opsDiagnosis.mockResolvedValue({ id: diagnosisId, kind: "ops-diagnosis", enabled: true });
  mocks.cases.mockReturnValue([{id:"set",name:"Regression",caseCount:2}]); mocks.create.mockResolvedValue({}); mocks.run.mockResolvedValue({});
});
afterEach(() => {vi.resetAllMocks();});
it("returns a replacement form when switching operations, keeping no hidden branch values", async () => {
  const form=await application.form({values:{operation:"inspection",caseSetId:"set"},changedField:"operation",taskId:null,timeZone:"Asia/Shanghai"},context);
  platformScheduleFormSchema.parse(form); expect(form.values).toEqual({operation:"inspection",instruction:""});
});
it("opens the inspection form for an inspector without access to case sets", async () => {
  mocks.management.mockRejectedValue(new HttpError(403, "Case sets are restricted"));
  const form = await application.form({ values: {}, changedField: null, taskId: null, timeZone: "Asia/Shanghai" }, context);
  expect(form.values).toEqual({ operation: "inspection", instruction: "" });
  expect(mocks.cases).not.toHaveBeenCalled();
});
it("requires the run-start operation before admitting a scheduled batch", async () => {
  mocks.management.mockImplementation(async (operation) => {
    if (operation.id === workbenchManagement.opsRunsStart.id) throw new HttpError(403, "Run start denied");
  });
  const request = input();
  await expect(application.validate(request, context)).rejects.toMatchObject({ status: 403 });
  await expect(application.start(request, context)).rejects.toMatchObject({ status: 403 });
  expect(mocks.start).not.toHaveBeenCalled();
});
it("records a busy test runner as skipped without queueing or pausing", async () => {
  mocks.busy.mockReturnValue(true); const result=await application.start(input(),context);
  platformScheduleExecutionStateSchema.parse(result); expect(result).toMatchObject({status:"skipped",error:{code:"autotest_busy"},pause:null}); expect(mocks.start).not.toHaveBeenCalled();
});
it("uses a stable file-backed batch identity and never restarts it while reading status", async () => {
  const request=input(); let saved:Record<string,unknown>|null=null;
  mocks.start.mockImplementation(async (config) => {
    saved=config.schedule;
    const meta={runId:`run-${request.runId}`,domainId:owner.domainId,status:"running",summary:{total:2,correct:0,wrong:0,abnormal:0}};
    mocks.meta.mockReturnValue(meta);mocks.source.mockImplementation(()=>saved);mocks.active.mockReturnValue(meta);return meta;
  });
  const result=await application.start(request,context);
  expect(result.handle).toEqual({batchId:`run-${request.runId}`});
  expect(mocks.start.mock.calls[0][0]).toMatchObject({apiKey:"internal",rounds:1,domainId:"sales",userId:"alice",schedule:{platformRunId:request.runId,creatorId:"alice"}});
  await application.start(request,context);
  await application.status({taskId:request.taskId,runId:request.runId,owner,handle:result.handle});
  expect(mocks.start).toHaveBeenCalledTimes(1);
});
it("returns missing status after a lost busy response without starting another batch", async () => {
  mocks.status.mockRejectedValue(new Error("Conversation not found"));const request=input();
  await expect(application.status({taskId:request.taskId,runId:request.runId,owner,handle:null})).rejects.toThrow();
  expect(mocks.start).not.toHaveBeenCalled();
});
it("starts an inspection in the unified assistant host and applies the same observer authorization", async () => {
  const request={...input(),content:{operation:"inspection",instruction:"Check failures"},formRevision:"inspection-v1"};
  const result=await application.start(request,context);
  expect(result.resultLink).toEqual({
    appId: "operations",
    path: expect.stringContaining("/ops/diagnosis?frame.sessionId="),
  });
  expect(mocks.create.mock.calls[0]).toEqual([expect.any(String), owner, { agentId: diagnosisId }, context.credentials, "scheduled"]);
  expect(mocks.run.mock.calls[0]).toEqual(expect.arrayContaining([request.runId,{message:"Check failures"},owner,context.credentials,"background"]));
  expect(mocks.access).toHaveBeenCalledWith({domainId:"sales",apiKey:"internal",token:undefined});
  expect(mocks.management).not.toHaveBeenCalled();
});
it("blocks scheduled inspection when diagnosis use grant is missing", async () => {
  mocks.grantAllowed.mockResolvedValue(false);
  const request={...input(),content:{operation:"inspection",instruction:"Check failures"},formRevision:"inspection-v1"};
  await expect(application.validate(request,context)).rejects.toMatchObject({status:422});
  await expect(application.start(request,context)).rejects.toMatchObject({status:422});
  expect(mocks.create).not.toHaveBeenCalled();
});
