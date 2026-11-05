import { describe, expect, it, vi, type Mock } from "vitest";
import PlatformSchedulesList from "../components/PlatformSchedulesList.vue";
import type { SchedulesApi } from "../api";
import type { PlatformTaskInput, PlatformTaskRunPage } from "@ontomato/contracts/platform-schedules";
import { flushPromises, mount, pageGlobal, task, text, translate, testI18n, run } from "./fixtures";

const i18n = testI18n();
const t = translate(i18n);
const global = pageGlobal(i18n);

const AGENT = { id: "22222222-2222-4222-8222-222222222222", name: "Analyst", description: "", icon: null, enabled: true };
const FUNCTION = { id: "f-1", name: "Refresh revenue", description: "Rebuilds the revenue table" };

/**
 * A fake API that records what the page asked and answers it: every method is a mock, and a test replaces the one it
 * cares about. The page only needs the real shape, so the fakes are handed over as `SchedulesApi`.
 */
function fakeApi(overrides: Record<string, Mock> = {}) {
  const api = {
    list: vi.fn(async () => ({
      tasks: [
        task({ name: "Nightly summary" }),
        task({
          id: "55555555-5555-4555-8555-555555555555",
          appId: "ontology",
          ownerId: null,
          name: "Refresh revenue",
          target: { kind: "function", functionId: "f-1" },
        }),
      ],
      timeZone: "Asia/Shanghai",
    })),
    renewCredential: vi.fn(async () => undefined),
    create: vi.fn(async (input: PlatformTaskInput) => task({ name: input.name, target: input.target, enabled: true })),
    update: vi.fn(async (id: string, input: PlatformTaskInput) => task({ id, name: input.name })),
    setEnabled: vi.fn(async (id: string, enabled: boolean) => task({ id, enabled, nextRunAt: enabled ? "2026-11-06T01:00:00Z" : null })),
    remove: vi.fn(async () => undefined),
    runNow: vi.fn(async () => run()),
    runs: vi.fn(async (): Promise<PlatformTaskRunPage> => ({ runs: [], nextCursor: null })),
    run: vi.fn(async () => run()),
    errorCode: vi.fn(() => null),
    ...overrides,
  };
  return api;
}

function mountList(api: SchedulesApi, props: Record<string, unknown> = {}) {
  return mount(PlatformSchedulesList, {
    props: { api, agents: [AGENT], functions: [FUNCTION], locale: "en", t, ...props },
    global,
  });
}

describe("platform schedules list", () => {
  it("renews the background credential before reading the list, and shows what the service returns", async () => {
    const api = fakeApi();
    const wrapper = mountList(api);
    await flushPromises();

    expect(api.renewCredential).toHaveBeenCalledOnce();
    expect(api.renewCredential.mock.invocationCallOrder[0]!).toBeLessThan(api.list.mock.invocationCallOrder[0]!);
    expect(text(wrapper)).toContain("Nightly summary");
    expect(text(wrapper)).toContain("Refresh revenue");
    // The row names what runs, not the raw id of the agent or the function.
    expect(text(wrapper)).toContain("Analyst");
    expect(text(wrapper)).toContain("Every day at 09:00");
    expect(text(wrapper)).not.toContain("22222222-2222-4222-8222-222222222222");
  });

  it("keeps the list readable when the credential cannot be renewed", async () => {
    const api = fakeApi({ renewCredential: vi.fn(async () => Promise.reject(new Error("403"))) });
    const wrapper = mountList(api);
    await flushPromises();

    expect(text(wrapper)).toContain("Nightly summary");
  });

  it("narrows the shown rows by application without asking the service again", async () => {
    const api = fakeApi();
    const wrapper = mountList(api);
    await flushPromises();

    const filter = wrapper.findAllComponents({ name: "ElSelect" })[0]!;
    await filter.vm.$emit("update:modelValue", "ontology");
    await flushPromises();

    expect(text(wrapper)).toContain("Refresh revenue");
    expect(text(wrapper)).not.toContain("Nightly summary");
    expect(api.list).toHaveBeenCalledOnce();
  });

  it("shows only the scoped agent's tasks and hides the application filter", async () => {
    const api = fakeApi();
    const wrapper = mountList(api, { agentId: AGENT.id });
    await flushPromises();

    expect(api.list).toHaveBeenCalledWith({ agentId: AGENT.id });
    expect(text(wrapper)).toContain("Tasks for this agent");
    expect(wrapper.findAllComponents({ name: "ElSelect" })).toHaveLength(0);
  });

  it("registers an agent task from the dialog with the contract's input", async () => {
    const api = fakeApi();
    const wrapper = mountList(api);
    await flushPromises();

    await wrapper.findAll("button").find((button) => button.text().includes("New task"))!.trigger("click");
    await flushPromises();

    const form = wrapper.findComponent({ name: "PlatformScheduleForm" });
    form.vm.$emit("submit", {
      name: "Weekly report",
      description: null,
      target: { kind: "agent", agentId: AGENT.id, prompt: "Summarise the week" },
      frequency: { kind: "weekly", weekday: 1, time: "08:30" },
      timeZone: "Asia/Shanghai",
      notifyEmail: "ops@example.com",
    });
    await flushPromises();

    expect(api.create).toHaveBeenCalledWith({
      name: "Weekly report",
      description: null,
      target: { kind: "agent", agentId: AGENT.id, prompt: "Summarise the week" },
      frequency: { kind: "weekly", weekday: 1, time: "08:30" },
      timeZone: "Asia/Shanghai",
      notifyEmail: "ops@example.com",
    });
    expect(text(wrapper)).toContain("Weekly report");
  });

  it("registers a function task, which carries no agent prompt", async () => {
    const api = fakeApi();
    const wrapper = mountList(api);
    await flushPromises();

    await wrapper.findAll("button").find((button) => button.text().includes("New task"))!.trigger("click");
    await flushPromises();

    wrapper.findComponent({ name: "PlatformScheduleForm" }).vm.$emit("submit", {
      name: "Refresh revenue nightly",
      description: null,
      target: { kind: "function", functionId: "f-1" },
      frequency: { kind: "cron", expression: "0 30 2 * * *" },
      timeZone: "Asia/Shanghai",
      notifyEmail: null,
    });
    await flushPromises();

    expect(api.create).toHaveBeenCalledWith(
      expect.objectContaining({ target: { kind: "function", functionId: "f-1" }, frequency: { kind: "cron", expression: "0 30 2 * * *" } }),
    );
  });

  it("edits the task the row's edit action names", async () => {
    const api = fakeApi();
    const wrapper = mountList(api);
    await flushPromises();

    await wrapper.find('[title="Edit"]').trigger("click");
    await flushPromises();
    wrapper.findComponent({ name: "PlatformScheduleForm" }).vm.$emit("submit", {
      name: "Renamed",
      description: null,
      target: { kind: "agent", agentId: AGENT.id, prompt: "Summarise again" },
      frequency: { kind: "daily", time: "07:00" },
      timeZone: "Asia/Shanghai",
      notifyEmail: null,
    });
    await flushPromises();

    expect(api.create).not.toHaveBeenCalled();
    expect(api.update).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ name: "Renamed" }));
  });

  it("switches a task off and back on through the service", async () => {
    const api = fakeApi();
    const wrapper = mountList(api);
    await flushPromises();

    wrapper.findAllComponents({ name: "ElSwitch" })[0]!.vm.$emit("update:modelValue", false);
    await flushPromises();

    expect(api.setEnabled).toHaveBeenCalledWith(expect.any(String), false);
    expect(api.setEnabled).toHaveBeenCalledOnce();
  });

  it("starts a run now and shows the run's own state", async () => {
    const api = fakeApi();
    const wrapper = mountList(api);
    await flushPromises();

    await wrapper.find('[title="Run now"]').trigger("click");
    await flushPromises();

    expect(api.runNow).toHaveBeenCalledWith(expect.any(String));
    // The response replaces that row's last run, so the table shows the new run without a second read.
    expect(wrapper.find('[title="Run now"]').exists()).toBe(true);
  });

  it("opens one task's run history under its row", async () => {
    const api = fakeApi({ runs: vi.fn(async () => ({ runs: [run({ status: "failed", error: { code: "start_failed", message: null } })], nextCursor: null })) });
    const wrapper = mountList(api);
    await flushPromises();

    await wrapper.find('[title="History"]').trigger("click");
    await flushPromises();

    expect(api.runs).toHaveBeenCalledWith(expect.any(String), null);
    expect(text(wrapper)).toContain("The conversation could not start.");

    // Clicking it again closes the history rather than opening a second copy.
    await wrapper.find('[title="History"]').trigger("click");
    await flushPromises();
    expect(wrapper.findAllComponents({ name: "PlatformScheduleRuns" })).toHaveLength(0);
  });

  it("shows a paused task's reason with the action that resumes it", async () => {
    const api = fakeApi({
      list: vi.fn(async () => ({
        tasks: [task({ pausedReason: "credential_invalid", nextRunAt: null })],
        timeZone: "Asia/Shanghai",
      })),
    });
    const wrapper = mountList(api);
    await flushPromises();

    expect(text(wrapper)).toContain("Paused: credential expired");
    expect(text(wrapper)).toContain("Resume");
  });

  it("reports a failed read instead of drawing an empty table", async () => {
    const api = fakeApi({ list: vi.fn(async () => Promise.reject(new Error("500"))) });
    const wrapper = mountList(api);
    await flushPromises();

    expect(text(wrapper)).toContain("Couldn't load the scheduled tasks.");
    expect(text(wrapper)).toContain("Retry");
  });
});
