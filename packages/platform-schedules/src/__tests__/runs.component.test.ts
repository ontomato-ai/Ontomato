import { afterEach, describe, expect, it, vi } from "vitest";
import type { VueWrapper } from "@vue/test-utils";
import { createSchedulesApi } from "../api";
import ScheduleRunsDrawer from "../components/ScheduleRunsDrawer.vue";
import { BASE, fakeHost, flushPromises, mount, pageGlobal, run, task, text, type Answer, type Call } from "./fixtures";

const agents = task("agents-instruction");
const going = run("agents-running");
const earlier = run("agents-running", {
  id: "30000000-0000-4000-8000-00000000000b",
  trigger: "schedule",
  status: "completed",
  scheduledAt: "2026-11-05T02:00:00Z",
  startedAt: "2026-11-05T02:00:01Z",
  finishedAt: "2026-11-05T02:02:00Z",
  resultSummary: "Stock fell in two warehouses",
  spendTime: 119000,
});

let mounted: VueWrapper[] = [];
afterEach(() => {
  mounted.forEach((wrapper) => wrapper.unmount());
  mounted = [];
  vi.useRealTimers();
});

async function mountDrawer(route: (call: Call) => Answer) {
  const service = fakeHost(route);
  const wrapper = mount(ScheduleRunsDrawer, {
    props: { api: createSchedulesApi(service.host), task: agents },
    global: pageGlobal(),
  });
  mounted.push(wrapper);
  await flushPromises();
  return { wrapper, ...service };
}

describe("a task's run records", () => {
  it("reads them a page at a time, newest first", async () => {
    const { wrapper, calls } = await mountDrawer((call) =>
      call.path.includes("cursor=")
        ? { status: 200, body: { runs: [earlier], nextCursor: null } }
        : { status: 200, body: { runs: [{ ...going, status: "failed", finishedAt: "2026-11-06T02:02:00Z", error: { code: "interrupted", message: null } }], nextCursor: "page-2" } },
    );

    expect(text(wrapper)).toContain("It was interrupted; check what it did before running it again");
    await wrapper.find(".more button").trigger("click");
    await flushPromises();

    expect(calls.map((call) => call.path)).toEqual([`${BASE}/${agents.id}/runs`, `${BASE}/${agents.id}/runs?cursor=page-2`]);
    expect(wrapper.findAll("[data-run]").map((item) => item.attributes("data-run"))).toEqual([going.id, earlier.id]);
    expect(text(wrapper)).toContain("Stock fell in two warehouses");
    expect(wrapper.find(".more").exists()).toBe(false);
  });

  it("reads a run that is going again every five seconds until it stops, and says when it did", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const done = { ...going, status: "completed" as const, finishedAt: "2026-11-06T02:03:00Z", resultSummary: "Summary sent", spendTime: 120000 };
    let reads = 0;
    const { wrapper, calls } = await mountDrawer((call) => {
      if (call.path === `${BASE}/${agents.id}/runs`) return { status: 200, body: { runs: [going, earlier], nextCursor: null } };
      reads += 1;
      return { status: 200, body: reads === 1 ? going : done };
    });

    await vi.advanceTimersByTimeAsync(5000);
    await flushPromises();
    expect(calls.filter((call) => call.path === `${BASE}/${agents.id}/runs/${going.id}`)).toHaveLength(1);
    expect(wrapper.emitted("settled")).toBeUndefined();

    await vi.advanceTimersByTimeAsync(5000);
    await flushPromises();
    expect(text(wrapper.find(`[data-run="${going.id}"]`))).toContain("Summary sent");
    expect(wrapper.emitted("settled")).toHaveLength(1);

    // Nothing is going any more: the drawer stops reading, and the finished run is never read again.
    await vi.advanceTimersByTimeAsync(20000);
    expect(calls.filter((call) => call.path.includes("/runs/"))).toHaveLength(2);
  });
});
