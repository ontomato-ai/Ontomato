import { describe, expect, it, vi } from "vitest";
import PlatformScheduleRuns from "../components/PlatformScheduleRuns.vue";
import type { SchedulesApi } from "../api";
import { flushPromises, mount, pageGlobal, run, task, text, translate, testI18n } from "./fixtures";

const i18n = testI18n();
const t = translate(i18n);

/** The run list only reads, so a test replaces those two methods and reads how they were called. */
function mountRuns(api: Partial<Pick<SchedulesApi, "runs" | "run">>, props: Record<string, unknown> = {}) {
  // The other methods belong to the list, not to one task's history; a test that reaches them is wrong.
  const unused = () => Promise.reject(new Error("not read by the run history"));
  const full: SchedulesApi = {
    list: unused,
    renewCredential: unused,
    create: unused,
    update: unused,
    setEnabled: unused,
    remove: unused,
    runNow: unused,
    functionTargets: unused,
    errorCode: () => null,
    statusOf: () => null,
    runs: async () => ({ runs: [run()], nextCursor: null }),
    run: async () => run(),
    ...api,
  };
  return {
    api: full,
    wrapper: mount(PlatformScheduleRuns, {
      props: { api: full, task: task(), t, ...props },
      global: pageGlobal(i18n),
    }),
  };
}

describe("platform schedule runs", () => {
  it("reads the first page on mount and pages forward with the service's cursor", async () => {
    const runs = vi.fn(async (_id: string, cursor: string | null) =>
      cursor
        ? { runs: [run({ id: "66666666-6666-4666-8666-666666666666", startedAt: "2026-11-04T01:00:00Z" })], nextCursor: null }
        : { runs: [run()], nextCursor: "cursor-2" },
    );
    const { wrapper } = mountRuns({ runs });
    await flushPromises();

    expect(runs).toHaveBeenCalledWith(task().id, null);
    expect(text(wrapper)).toContain("Page 1");

    await wrapper.findAll("button").find((button) => button.text() === "Next")!.trigger("click");
    await flushPromises();

    expect(runs).toHaveBeenLastCalledWith(task().id, "cursor-2");
    expect(text(wrapper)).toContain("Page 2");
    // The next page replaced the first: the older run is gone and the newer one stays.
    expect(text(wrapper)).toContain("Nov 4, 2026");
    expect(text(wrapper)).not.toContain("Nov 5, 2026");
    expect(wrapper.findAll("button").find((button) => button.text() === "Next")!.attributes("disabled")).toBeDefined();
  });

  it("goes back to the page it came from", async () => {
    const runs = vi.fn(async (_id: string, cursor: string | null) =>
      cursor ? { runs: [run()], nextCursor: null } : { runs: [run()], nextCursor: "cursor-2" },
    );
    const { wrapper } = mountRuns({ runs });
    await flushPromises();

    await wrapper.findAll("button").find((button) => button.text() === "Next")!.trigger("click");
    await flushPromises();
    await wrapper.findAll("button").find((button) => button.text() === "Previous")!.trigger("click");
    await flushPromises();

    expect(runs).toHaveBeenLastCalledWith(task().id, null);
    expect(text(wrapper)).toContain("Page 1");
  });

  it("opens the conversation an agent run started", async () => {
    const { wrapper } = mountRuns({});
    await flushPromises();

    wrapper.findAll("button").find((button) => button.text() === "Open conversation")!.trigger("click");
    expect(wrapper.emitted("openSession")).toEqual([[run().sessionId]]);
  });

  it("shows a function run's error and duration, and its result once asked for", async () => {
    const functionRun = run({
      target: { kind: "function", functionId: "f-1" },
      sessionId: null,
      status: "failed",
      error: { code: "run_failed", message: "exit 1" },
      result: null,
    });
    const { wrapper } = mountRuns({
      runs: vi.fn(async () => ({ runs: [functionRun], nextCursor: null })),
      run: vi.fn(async () => ({ ...functionRun, result: "12 rows written" })),
    });
    await flushPromises();

    expect(text(wrapper)).toContain("The run ended with an error or was cancelled. exit 1");
    expect(text(wrapper)).toContain("Took 1.2s");
    // A function run has no conversation, so it names no session and offers no conversation link.
    expect(text(wrapper)).not.toContain("Open conversation");

    await wrapper.findAll("button").find((button) => button.text() === "Details")!.trigger("click");
    await flushPromises();

    expect(text(wrapper)).toContain("12 rows written");
    expect(wrapper.findAll("button").some((button) => button.text() === "Hide")).toBe(true);
  });

  it("says so when the history cannot be read, and retries the same page", async () => {
    const runs = vi
      .fn()
      .mockRejectedValueOnce(new Error("500"))
      .mockResolvedValue({ runs: [run()], nextCursor: null });
    const { wrapper } = mountRuns({ runs });
    await flushPromises();

    expect(text(wrapper)).toContain("Couldn't load the run history.");

    await wrapper.findAll("button").find((button) => button.text() === "Retry")!.trigger("click");
    await flushPromises();

    expect(runs).toHaveBeenLastCalledWith(task().id, null);
    expect(text(wrapper)).toContain("Completed");
  });

  it("says so when there are no runs", async () => {
    const { wrapper } = mountRuns({ runs: vi.fn(async () => ({ runs: [], nextCursor: null })) });
    await flushPromises();

    expect(text(wrapper)).toContain("No runs yet.");
  });
});
