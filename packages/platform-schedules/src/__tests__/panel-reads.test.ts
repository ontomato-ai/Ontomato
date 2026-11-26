import { expect, it, vi } from "vitest";
import { panelFormDescriptionSchema, panelOptionListSchema } from "@ontomato/contracts/panel-projection";
import { platformTaskRunSchema, platformTaskSchema, type PlatformTask, type PlatformTaskList } from "@ontomato/contracts/platform-schedules";
import examples from "../../../contracts/examples/platform-schedules.json";
import { createScheduledTaskReads } from "../panel-reads";

const action = platformTaskSchema.parse(examples.creates[0].response);
const app = platformTaskSchema.parse(examples.creates.find(item => item.name === "agents-instruction")!.response);
const actionRun = platformTaskRunSchema.parse(examples.runs[0].response);
const namedApp = { id: "agents", name: "Agents", icon: "bot", description: null, available: true, unavailableReason: null, taskCount: 1 };

function setup(tasks: PlatformTask[] = [app, action]) {
  const directory = { applications: [namedApp], missingIds: [] };
  const api = {
    list: vi.fn(async (includeCredentials?: boolean): Promise<PlatformTaskList> => ({
      tasks, timeZone: action.timeZone, ...(includeCredentials && { credentialStatus: "renewal-required" as const }),
    })),
    task: vi.fn(async (id: string) => tasks.find(task => task.id === id)!),
    form: vi.fn(async () => { throw new Error("Unexpected application form"); }),
    runs: vi.fn(async (_id: string, _cursor?: string | null) => ({ runs: [actionRun], nextCursor: "older" })),
    run: vi.fn(async (_id: string, _runId: string) => actionRun),
    applicationsStatus: vi.fn(async () => directory),
    targets: vi.fn(async () => ({
      actions: [{ id: "correct-status", name: "Update status", description: null }],
      workflows: [{ id: "daily-report", name: "Daily report", description: null }],
      applications: [namedApp],
    })),
    describeTargets: vi.fn(async (rows: readonly PlatformTask[], _directory: typeof directory) => rows.map(row => row.targetKind !== "application" ? row : ({
      ...row, targetName: "Warehouse assistant", summary: [{ key: "instruction", label: "Instructions", value: "Check stock levels" }],
    }))),
    findMembers: vi.fn(async (_keyword: string | undefined, _limit: number): Promise<{ id: string; name: string }[]> => []),
  };
  return { api, reads: createScheduledTaskReads(api, "en", key => key) };
}

it("uses the viewer's resolved application data for target searches and does not look it up for native-only lists", async () => {
  const { api, reads } = setup();
  expect((await reads.list({ scope: "action" })).map(row => row.primaryKey)).toEqual([action.id]);
  expect(api.applicationsStatus).not.toHaveBeenCalled();
  const [row] = await reads.list({ scope: "application", search: "stock levels" });
  expect(row.fields).toMatchObject({ targetName: "Warehouse assistant", targetIcon: "bot", targetId: "agents" });
  expect(row.outputs).toMatchObject({ definitionStatus: "PUBLISHED", targetKind: "application" });
  expect(api.describeTargets).toHaveBeenCalledOnce();
  expect(api.describeTargets.mock.calls[0][0].map(task => task.id)).toEqual([app.id]);
  expect((await reads.record(app.id)).fields.targetName).toBe("Warehouse assistant");
  expect(await reads.list({ status: "PENDING_REVIEW" })).toEqual([]);
});

it("reads credentials and counts without loading target or member names", async () => {
  const issue = { ...action, enabled: true, pause: { code: "credential_invalid" as const, message: "Credential expired" }, nextRunAt: null };
  const { api, reads } = setup([issue, app]);
  expect((await reads.status()).outputs).toMatchObject({ credentialStatus: "renewal-required", hasCredentialPaused: true });
  expect(api.list).toHaveBeenCalledWith(true);
  expect((await reads.counts()).find(group => group.key === "action")?.count).toBe(1);
  expect((await reads.counts("attention")).find(group => group.key === "issues")?.count).toBe(1);
  expect(api.applicationsStatus).not.toHaveBeenCalled();
  expect(api.describeTargets).not.toHaveBeenCalled();
  expect(api.targets).not.toHaveBeenCalled();
  expect(api.findMembers).not.toHaveBeenCalled();
});

it("projects typed native inputs, clears them when changing the target, and lets an author choose a pending draft", async () => {
  const { api, reads } = setup();
  const edit = panelFormDescriptionSchema.parse(await reads.form(action.id, {}));
  expect(edit.fields.find(field => field.path === "/task/capabilityContent/runStartParameters")?.control.kind).toBe("string-array");
  expect(edit.values.task).toMatchObject({ capabilityContent: action.content });
  const changed = panelFormDescriptionSchema.parse(await reads.form(action.id, {
    changedField: "/task/targetKind", values: { task: { targetKind: "workflow", capabilityContent: action.content } },
  }));
  expect(changed.values.task).toMatchObject({ targetId: "", capabilityContent: { inputs: {} } });
  expect(changed.fields.some(field => field.path.endsWith("runStartParameters"))).toBe(false);
  const create = panelFormDescriptionSchema.parse(await reads.createForm({
    values: { task: { title: "Nightly report", targetKind: "workflow", targetId: "daily-report", enabled: false } },
  }));
  expect(create.errors).toEqual([]);
  expect(create.save.path).toContain("enabled=false");
  expect(create.fields.find(field => field.path === "/task/coauthorIds")?.control).toMatchObject({ kind: "reference", multiple: true });
  expect(api.form).not.toHaveBeenCalled();
  expect(api.describeTargets).not.toHaveBeenCalled();
  expect(api.findMembers).not.toHaveBeenCalled();
});

it("searches the authorized member directory and resolves held IDs independently of the current options", async () => {
  const { api, reads } = setup();
  api.findMembers.mockImplementation(async keyword => keyword === "Kai" || keyword === "member-k"
    ? [{ id: "member-k", name: "Kai" }] : []);
  const result = panelOptionListSchema.parse(await reads.memberOptions({ keyword: "Kai", page: { number: 1, size: 50 } }));
  expect(api.findMembers).toHaveBeenCalledWith("Kai", 50);
  expect(result.options[0]).toMatchObject({ value: "member-k", label: "Kai" });
  const held = panelOptionListSchema.parse(await reads.memberResolve(["member-missing", "member-k"]));
  expect(held.options[0]).toMatchObject({ value: "member-missing", unavailable: expect.anything() });
  expect(held.options[1]).toMatchObject({ value: "member-k", label: "Kai" });
});

it("uses the viewer's history for the default drawer and never substitutes another run for an explicit id", async () => {
  const { api, reads } = setup([{ ...action, activeRunId: "another-member-run" }]);
  const workflowRun = {
    ...actionRun, snapshot: { ...actionRun.snapshot, targetKind: "workflow" as const, executorId: "member-k" },
    executionDetails: { workflowRunId: "praxis-run" }, result: "First paragraph\n\nSecond paragraph",
  };
  api.runs.mockResolvedValue({ runs: [workflowRun], nextCursor: "older" });
  const latest = await reads.runRecord(action.id);
  expect(api.run).not.toHaveBeenCalled();
  expect(latest.fields).toMatchObject({ status: "platformSchedules.runStatus.workflowStarted", executorId: "member-k", workflowRunId: "praxis-run" });
  expect(latest.primaryKey).toBe(actionRun.id);
  expect((await reads.runRecords(action.id)).nextCursor).toBe("older");
  api.run.mockRejectedValueOnce(new Error("read refused"));
  await expect(reads.runRecord(action.id, "another-member-run")).rejects.toThrow("read refused");
  expect(api.run).toHaveBeenCalledWith(action.id, "another-member-run");
  expect(api.applicationsStatus).not.toHaveBeenCalled();
  expect(api.describeTargets).not.toHaveBeenCalled();
});
