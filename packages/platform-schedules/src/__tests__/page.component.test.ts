import { describe, expect, it, vi } from "vitest";
import PlatformSchedulesPage from "../pages/PlatformSchedulesPage.vue";
import type { PlatformSchedulesHost } from "../host";
import { flushPromises, mount, pageGlobal, run, task, text } from "./fixtures";

const AGENT = { id: "22222222-2222-4222-8222-222222222222", name: "Analyst", description: "", icon: null, enabled: true };
const FUNCTION_TARGETS = [{ id: "f-1", name: "Refresh revenue", description: "Rebuilds the revenue table" }];

/** A host that answers its paths and records them; `functionTargets` sets what the service says to that one path. */
function host(
  options: { functionTargets?: { status: number; body?: unknown }; overrides?: Partial<PlatformSchedulesHost> } = {},
) {
  const paths: string[] = [];
  const request = vi.fn(async (path: string) => {
    paths.push(path);
    if (path.endsWith("/credential/renew")) return { status: 204, ok: true, json: async () => null } as Response;
    if (path.endsWith("/function-targets")) {
      const answer = options.functionTargets ?? { status: 200, body: FUNCTION_TARGETS };
      return { status: answer.status, ok: answer.status < 400, json: async () => answer.body ?? null } as Response;
    }
    return { status: 200, ok: true, json: async () => ({ tasks: [task()], timeZone: "Asia/Shanghai" }) } as Response;
  });
  const full: PlatformSchedulesHost = { request, agents: async () => [AGENT], ...options.overrides };
  return { host: full, paths };
}

describe("platform schedules page", () => {
  it("reads the list and the function targets through the host's request function", async () => {
    const { host: pageHost, paths } = host();
    const wrapper = mount(PlatformSchedulesPage, { props: { host: pageHost }, global: pageGlobal() });
    await flushPromises();

    // The renewal comes first; the list and the function targets are asked for together after it.
    expect(paths[0]).toBe("/api/data-query/platform/scheduled-tasks/credential/renew");
    expect(paths.slice(1).sort()).toEqual([
      "/api/data-query/platform/scheduled-tasks",
      "/api/data-query/platform/scheduled-tasks/function-targets",
    ]);
    expect(text(wrapper)).toContain("Nightly summary");
    expect(text(wrapper)).toContain("Analyst");
  });

  it("narrows to the agent the host names, for the agent platform's entry", async () => {
    const { host: pageHost, paths } = host();
    mount(PlatformSchedulesPage, {
      props: { host: pageHost, agentId: AGENT.id },
      global: pageGlobal(),
    });
    await flushPromises();

    expect(paths).toContain(`/api/data-query/platform/scheduled-tasks?agentId=${AGENT.id}`);
  });

  it("offers the functions the service lists, and only those", async () => {
    const { host: pageHost } = host();
    const wrapper = mount(PlatformSchedulesPage, { props: { host: pageHost }, global: pageGlobal() });
    await flushPromises();

    await wrapper.findAll("button").find((button) => button.text().includes("New task"))!.trigger("click");
    await flushPromises();
    await wrapper.findComponent({ name: "ElSegmented" }).vm.$emit("update:modelValue", "function");

    const form = wrapper.findComponent({ name: "PlatformScheduleForm" });
    expect(form.props("functions")).toEqual(FUNCTION_TARGETS);
    expect(form.props("functionsRefused")).toBe(false);
  });

  it("says functions are not available to an account the service refuses, and still schedules agent tasks", async () => {
    const { host: pageHost } = host({ functionTargets: { status: 403 } });
    const wrapper = mount(PlatformSchedulesPage, { props: { host: pageHost }, global: pageGlobal() });
    await flushPromises();

    // A refused function list leaves the page usable: the answer is a refusal, not a failure.
    expect(text(wrapper)).toContain("Nightly summary");

    await wrapper.findAll("button").find((button) => button.text().includes("New task"))!.trigger("click");
    await flushPromises();
    const form = wrapper.findComponent({ name: "PlatformScheduleForm" });
    expect(form.props("functions")).toEqual([]);
    expect(form.props("functionsRefused")).toBe(true);

    await wrapper.findComponent({ name: "ElSegmented" }).vm.$emit("update:modelValue", "function");
    expect(text(wrapper)).toContain("Scheduling functions needs the function tasks permission.");

    // The agent side is untouched by the refusal.
    await wrapper.findComponent({ name: "ElSegmented" }).vm.$emit("update:modelValue", "agent");
    form.vm.$emit("submit", {
      name: "Nightly summary",
      description: null,
      target: { kind: "agent", agentId: AGENT.id, prompt: "Summarise yesterday's orders" },
      frequency: { kind: "daily", time: "09:00" },
      timeZone: "Asia/Shanghai",
      notifyEmail: null,
    });
    await flushPromises();
    expect(pageHost.request).toHaveBeenCalledWith(
      "/api/data-query/platform/scheduled-tasks",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("treats a failed function-target read as an empty list, not a refusal", async () => {
    const { host: pageHost } = host({ functionTargets: { status: 500 } });
    const wrapper = mount(PlatformSchedulesPage, { props: { host: pageHost }, global: pageGlobal() });
    await flushPromises();

    await wrapper.findAll("button").find((button) => button.text().includes("New task"))!.trigger("click");
    await flushPromises();
    const form = wrapper.findComponent({ name: "PlatformScheduleForm" });
    expect(form.props("functions")).toEqual([]);
    expect(form.props("functionsRefused")).toBe(false);
  });

  it("opens the run history of the task the address named, without asking the service for it separately", async () => {
    const { host: pageHost, paths } = host();
    const wrapper = mount(PlatformSchedulesPage, {
      props: { host: pageHost, taskId: task().id },
      global: pageGlobal(),
    });
    await flushPromises();

    expect(wrapper.findAllComponents({ name: "PlatformScheduleRuns" })).toHaveLength(1);
    expect(paths).toContain(`/api/data-query/platform/scheduled-tasks/${task().id}/runs`);
  });

  it("shows the plain list when the address names a task this caller cannot see", async () => {
    const { host: pageHost } = host();
    const wrapper = mount(PlatformSchedulesPage, {
      props: { host: pageHost, taskId: "99999999-9999-4999-8999-999999999999" },
      global: pageGlobal(),
    });
    await flushPromises();

    expect(text(wrapper)).toContain("Nightly summary");
    expect(wrapper.findAllComponents({ name: "PlatformScheduleRuns" })).toHaveLength(0);
  });

  it("hands a run's session to the host's openSession", async () => {
    const openSession = vi.fn();
    const { host: pageHost } = host({
      overrides: {
        openSession,
        request: vi.fn(async (path: string) => {
          if (path.endsWith("/credential/renew")) return { status: 204, ok: true, json: async () => null } as Response;
          if (path.endsWith("/function-targets")) return { status: 200, ok: true, json: async () => FUNCTION_TARGETS } as Response;
          if (path.includes("/runs")) return { status: 200, ok: true, json: async () => ({ runs: [run()], nextCursor: null }) } as Response;
          return { status: 200, ok: true, json: async () => ({ tasks: [task()], timeZone: "Asia/Shanghai" }) } as Response;
        }),
      },
    });
    const wrapper = mount(PlatformSchedulesPage, { props: { host: pageHost }, global: pageGlobal() });
    await flushPromises();

    await wrapper.findAll("button").find((button) => button.text().includes("History"))!.trigger("click");
    await flushPromises();
    await wrapper.findAll("button").find((button) => button.text() === "Open conversation")!.trigger("click");

    expect(openSession).toHaveBeenCalledWith(run().sessionId);
    expect(wrapper.emitted("openSession")).toEqual([[run().sessionId]]);
  });

  it("keeps the list usable when the agent catalog fails to load", async () => {
    const { host: pageHost } = host({ overrides: { agents: async () => Promise.reject(new Error("403")) } });
    const wrapper = mount(PlatformSchedulesPage, { props: { host: pageHost }, global: pageGlobal() });
    await flushPromises();

    expect(text(wrapper)).toContain("Nightly summary");
  });
});
