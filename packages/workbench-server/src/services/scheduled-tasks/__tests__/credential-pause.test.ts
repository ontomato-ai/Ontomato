import { beforeEach, describe, expect, it, vi } from "vitest";
import type { WorkbenchIdentity } from "../../../identity/types";
import type { RunFailure, RunRecord, TaskRecord } from "../store";

/**
 * A scheduled run whose background credential no longer authenticates fails and pauses its task; the owner's next
 * visit to the task list with a valid login renews the credential and resumes the task. The store is an in-memory
 * stand-in holding the same state the tables do; identity and the assistant are fakes at their seams.
 */
const state = vi.hoisted(() => ({
  tasks: new Map<string, any>(),
  runs: new Map<string, any>(),
  credential: null as null | { sealedKey: string | null; state: "valid" | "invalid" },
}));

vi.mock("../store", () => ({
  scheduledTaskStore: {
    async get(id: string) { return state.tasks.get(id) ?? null; },
    async startRun(id: string, taskId: string, trigger: string) {
      if ([...state.runs.values()].some((r) => r.taskId === taskId && r.status === "running")) return null;
      const run = { id, taskId, sessionId: null, trigger, status: "running", error: null, startedAt: new Date(), finishedAt: null };
      state.runs.set(id, run);
      return { run: { ...run }, replayed: false };
    },
    async attachSession(id: string, sessionId: string | null) {
      state.runs.get(id).sessionId = sessionId;
    },
    async finishRun(id: string, failure: RunFailure | null) {
      const run = state.runs.get(id);
      if (run.status !== "running") return null;
      Object.assign(run, { status: failure ? "failed" : "completed", error: failure, finishedAt: new Date() });
      return { ...run };
    },
    async pause(id: string, reason: string) {
      const task = state.tasks.get(id);
      if (task.enabled) Object.assign(task, { pausedReason: reason, nextRunAt: null });
    },
    async credentialPaused() {
      return [...state.tasks.values()].filter((t) => t.enabled && t.pausedReason === "credential_invalid");
    },
    async resume(id: string, reason: string, nextRunAt: Date) {
      const task = state.tasks.get(id);
      if (task.pausedReason === reason) Object.assign(task, { pausedReason: null, nextRunAt });
    },
    async list() {
      return [...state.tasks.values()].map((task) => ({ task, lastRun: null }));
    },
    async credential() {
      return state.credential && { ...state.credential };
    },
    async saveCredential(_owner: unknown, sealedKey: string | null) {
      state.credential = { sealedKey, state: "valid" };
    },
    async invalidateCredential(_owner: unknown, sealedKey: string | null) {
      if (state.credential?.sealedKey === sealedKey) state.credential.state = "invalid";
    },
  },
}));

const assistant = vi.hoisted(() => ({ create: vi.fn(), start: vi.fn(), delete: vi.fn() }));
vi.mock("../../assistant/service", () => ({ assistantService: assistant }));
vi.mock("../../assistant/store", () => ({
  assistantStore: { agent: async () => ({ id: "agent", name: "Analyst", enabled: true }) },
}));
vi.mock("../notify", () => ({ sendRunMail: vi.fn() }));

const { installWorkbenchIdentity } = await import("../../../identity/installed");
const { ensureScheduledCredential } = await import("../credentials");
const { startScheduledRun } = await import("../runner");
const { scheduledTaskService } = await import("../service");

const owner = { domainId: "d1", userId: "u1" };
let live: string | null = null;
let issued = 0;

installWorkbenchIdentity({
  async issueScheduledCredential(caller) {
    if (!caller.token) throw new Error("login required");
    live = `internal-${++issued}`;
    return live;
  },
  async resolveScheduledCredential(_owner, key) {
    return key !== null && key === live ? { apiKey: key } : null;
  },
} as Partial<WorkbenchIdentity> as WorkbenchIdentity);

function task(): TaskRecord {
  const now = new Date();
  return {
    id: "00000000-0000-4000-8000-000000000001",
    domainId: owner.domainId,
    ownerId: owner.userId,
    agentId: "00000000-0000-4000-8000-000000000002",
    prompt: "Summarize yesterday's orders",
    frequency: { kind: "daily", time: "08:00" },
    notifyEmail: null,
    locale: "en",
    enabled: true,
    pausedReason: null,
    nextRunAt: now,
    createdAt: now,
    updatedAt: now,
  };
}

beforeEach(() => {
  vi.stubEnv("AGENT_RUNTIME_SERVICE_TOKEN", "synthetic-service-token");
  state.tasks.clear();
  state.runs.clear();
  state.credential = null;
  live = null;
  assistant.create.mockReset();
  assistant.start.mockReset();
});

describe("scheduled runs with a dead credential", () => {
  it("fail and pause the task until the owner's next visit with a login renews the credential", async () => {
    const t = task();
    state.tasks.set(t.id, t);
    await ensureScheduledCredential(owner, { token: "login" });
    live = null; // The internal Key stopped authenticating, e.g. the member was removed and added again.

    const failed = (await startScheduledRun(t, "schedule")) as RunRecord;
    expect(failed.status).toBe("failed");
    expect(failed.error?.code).toBe("credential_invalid");
    expect(state.tasks.get(t.id).pausedReason).toBe("credential_invalid");
    expect(state.credential?.state).toBe("invalid");
    expect(assistant.create).not.toHaveBeenCalled();

    // A visit without a login (e.g. an API Key caller) cannot renew it.
    const withoutLogin = await scheduledTaskService.list(owner, { apiKey: "external" });
    expect(withoutLogin.tasks[0]!.pausedReason).toBe("credential_invalid");
    expect(withoutLogin.tasks[0]!.nextRunAt).toBeNull();

    const renewed = await scheduledTaskService.list(owner, { token: "login" });
    expect(renewed.tasks[0]!.pausedReason).toBeNull();
    expect(renewed.tasks[0]!.nextRunAt).not.toBeNull();
    expect(state.credential?.state).toBe("valid");

    const next = (await startScheduledRun(state.tasks.get(t.id), "schedule")) as RunRecord;
    expect(next.status).toBe("running");
    expect(assistant.create).toHaveBeenCalledWith(expect.any(String), owner, { agentId: t.agentId }, "scheduled");
    expect(assistant.start.mock.calls[0]![4]).toMatchObject({ apiKey: live });
  });

  it("keep a working credential instead of issuing one that would end it", async () => {
    await ensureScheduledCredential(owner, { token: "login" });
    const first = live;
    await ensureScheduledCredential(owner, { token: "login" });
    expect(live).toBe(first);
    expect(issued).toBeGreaterThan(0);
  });
});
