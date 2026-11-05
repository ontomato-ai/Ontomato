import { describe, expect, it, vi } from "vitest";
import PlatformSchedulesPage from "../pages/PlatformSchedulesPage.vue";
import type { PlatformSchedulesHost } from "../host";
import { flushPromises, mount, pageGlobal, run, task, text } from "./fixtures";

const AGENT = { id: "22222222-2222-4222-8222-222222222222", name: "Analyst", description: "", icon: null, enabled: true };

/** A host that answers the list and records the paths the page asked for. */
function host(overrides: Partial<PlatformSchedulesHost> = {}) {
  const paths: string[] = [];
  const request = vi.fn(async (path: string) => {
    paths.push(path);
    if (path.endsWith("/credential/renew")) return { status: 204, ok: true, json: async () => null } as Response;
    return { status: 200, ok: true, json: async () => ({ tasks: [task()], timeZone: "Asia/Shanghai" }) } as Response;
  });
  const full: PlatformSchedulesHost = {
    request,
    agents: async () => [AGENT],
    functions: async () => [{ id: "f-1", name: "Refresh revenue" }],
    ...overrides,
  };
  return { host: full, paths };
}

describe("platform schedules page", () => {
  it("reads the host's list through its request function and shows the rows", async () => {
    const { host: pageHost, paths } = host();
    const wrapper = mount(PlatformSchedulesPage, { props: { host: pageHost }, global: pageGlobal() });
    await flushPromises();

    expect(paths).toEqual([
      "/api/data-query/platform/scheduled-tasks/credential/renew",
      "/api/data-query/platform/scheduled-tasks",
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

    expect(paths[1]).toBe(`/api/data-query/platform/scheduled-tasks?agentId=${AGENT.id}`);
  });

  it("hands a run's session to the host's openSession", async () => {
    const openSession = vi.fn();
    const { host: pageHost } = host({
      openSession,
      request: vi.fn(async (path: string) => {
        if (path.endsWith("/credential/renew")) return { status: 204, ok: true, json: async () => null } as Response;
        if (path.includes("/runs")) return { status: 200, ok: true, json: async () => ({ runs: [run()], nextCursor: null }) } as Response;
        return { status: 200, ok: true, json: async () => ({ tasks: [task()], timeZone: "Asia/Shanghai" }) } as Response;
      }),
    });
    const wrapper = mount(PlatformSchedulesPage, { props: { host: pageHost }, global: pageGlobal() });
    await flushPromises();

    await wrapper.findAll("button").find((button) => button.text().includes("History"))!.trigger("click");
    await flushPromises();
    await wrapper.findAll("button").find((button) => button.text() === "Open conversation")!.trigger("click");

    expect(openSession).toHaveBeenCalledWith(run().sessionId);
    expect(wrapper.emitted("openSession")).toEqual([[run().sessionId]]);
  });

  it("keeps the list usable when a catalog fails to load", async () => {
    const { host: pageHost } = host({ functions: async () => Promise.reject(new Error("403")) });
    const wrapper = mount(PlatformSchedulesPage, { props: { host: pageHost }, global: pageGlobal() });
    await flushPromises();

    expect(text(wrapper)).toContain("Nightly summary");
  });
});
