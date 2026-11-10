import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { reactive } from "vue";
import { flushPromises, mount } from "@vue/test-utils";
import ElementPlus from "element-plus";
import publicEn from "../../../locales/en";
import { workbenchI18n } from "../../../i18n";
import PreviewTab from "../components/PreviewTab.vue";
import { builderPlatformKey, type AppBuilderPlatform } from "../platform";
import type { WorkspaceView } from "../workspace-view";

/*
 * The preview runs the page on the workspace's test data and its frame says so at all times: the line on top names the
 * sample and Java's deadline while the data is ready, or the stage that leaves none to run on, and the agent's run notes
 * share that line instead of covering it. Every stage without usable data explains under the line what it means for the
 * page's business calls and what brings the data back; a missing test or an unread status is never shown as ready or as
 * empty data. The page loads once Java has first answered, so opening loads it once; it loads again when Java answers
 * another context or stage, which takes expired or ended data's results off the page, and never for a failed read, as
 * Java checks every business call itself. The page previews in every stage Java answers, and nothing offers real data.
 */

const text = publicEn.appBuilder;
const NOW = Date.UTC(2026, 10, 11, 7, 0, 0);
const SAMPLE = "test-data/sample.json";
const clock = (time: number) => new Intl.DateTimeFormat("en", { timeStyle: "short" }).format(time);

/** Java's record of the workspace's test context, as the workbench passes it on. */
function javaContext(status: string, fields: Record<string, unknown> = {}) {
  return {
    contextId: "context-1", workspaceId: "w1", status, expiresAt: NOW + 42.5 * 60_000, classNames: ["Material"],
    sampleSummary: { name: SAMPLE, classes: 1, sha256: "f".repeat(64) }, prepareError: null, cleanupError: null,
    resources: [], ...fields,
  };
}

/** What the workbench answers: the current context (null for none, or a failed read), and a new token per load. */
let current: unknown = null;
let statusFails = false;
/** While set, status reads wait for it: Java has not answered yet. */
let held: Promise<void> | null = null;
let tokens = 0;
let statusReads = 0;
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

beforeEach(() => {
  vi.useFakeTimers({ now: NOW, toFake: ["setInterval", "clearInterval", "Date"] });
  current = null;
  statusFails = false;
  held = null;
  tokens = 0;
  statusReads = 0;
  vi.stubGlobal("fetch", async (input: string, init?: Parameters<typeof fetch>[1]) => {
    const method = init?.method ?? "GET";
    const path = new URL(input, "http://workbench.test").pathname;
    if (method === "GET" && path === "/api/workspaces/w1/build-tests") {
      statusReads++;
      if (held) await held;
      return statusFails ? json({ error: { code: "UPSTREAM_FAILED", message: "Data engine unavailable" } }, 502) : json(current);
    }
    if (method === "POST" && path === "/api/workspaces/w1/preview-token") return json({ token: `token-${++tokens}`, expiresAt: "" });
    throw new Error(`Unexpected ${method} ${path}`);
  });
});
const wrappers: ReturnType<typeof mount>[] = [];
afterEach(() => {
  wrappers.splice(0).forEach((wrapper) => wrapper.unmount());
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

/** The preview of workspace w1 as the builder shows it, once the first status and the first page load are read. */
async function openPreview({ files = ["index.html"], flash = null as string | null } = {}) {
  const view = reactive({
    workspace: { id: "w1", name: "Overdue orders", headCommit: "a".repeat(40), activeRunId: null as string | null, createdAt: "", updatedAt: "" },
    files: files.map((path) => ({ path, size: 1 })),
    filesState: "ready",
    loadFiles: vi.fn(),
  });
  const platform: AppBuilderPlatform = {
    registerPreviewFrame: () => ({ update: vi.fn(), dispose: vi.fn() }),
    subscribePageContext: () => () => {},
    catalog: { applications: { value: [] }, error: { value: null }, loading: { value: false }, refresh: async () => {} },
    openApplication: vi.fn(),
    permissions: { value: null },
  } as unknown as AppBuilderPlatform;
  const wrapper = mount(PreviewTab, {
    props: { view: view as unknown as WorkspaceView, reload: 0, flash, frameWindow: null },
    global: { plugins: [ElementPlus, workbenchI18n()], provide: { [builderPlatformKey as symbol]: platform } },
  });
  wrappers.push(wrapper);
  await flushPromises();
  return { wrapper, view };
}

const line = (wrapper: ReturnType<typeof mount>) => wrapper.find(".frame-line").text();
const notice = (wrapper: ReturnType<typeof mount>) => wrapper.find(".frame-notice .el-alert");
const frameSrc = (wrapper: ReturnType<typeof mount>) => wrapper.find("iframe").attributes("src");
/** Moves Java's clock and this page's timers on, and lets the reads they start come back. */
async function wait(ms: number) {
  await vi.advanceTimersByTimeAsync(ms);
  await flushPromises();
}

describe("the preview's test data", () => {
  it("names the sample and Java's deadline while the data is ready, beside the run's notes rather than under them", async () => {
    current = javaContext("READY");
    const { wrapper, view } = await openPreview();

    expect(line(wrapper)).toContain(text.testData);
    expect(line(wrapper)).toContain(SAMPLE);
    expect(line(wrapper)).toContain(`Expires at ${clock(NOW + 42.5 * 60_000)}, 43 min left`);
    expect(notice(wrapper).exists()).toBe(false);
    expect(frameSrc(wrapper)).toContain("/preview/token-");

    view.workspace.activeRunId = "run-1";
    await flushPromises();
    expect(line(wrapper)).toContain(text.previewRunning);
    expect(line(wrapper)).toContain(SAMPLE);
    expect(line(wrapper)).toContain("43 min left");

    view.workspace.activeRunId = null;
    await wrapper.setProps({ flash: "Refreshed to commit 2222222" });
    expect(line(wrapper)).toContain("Refreshed to commit 2222222");
    expect(line(wrapper)).toContain(SAMPLE);
    expect(line(wrapper)).toContain("43 min left");
  });

  it("counts down to Java's deadline, asks Java there and reloads the page without the last round's results", async () => {
    current = javaContext("READY", { expiresAt: NOW + 92_000 });
    const { wrapper } = await openPreview();
    const firstFrame = frameSrc(wrapper);
    expect(line(wrapper)).toContain("2 min left");

    await wait(60_000);
    expect(line(wrapper)).toContain("1 min left");

    // Java expires the data; the page asks at the deadline (92s), before its next regular read (95s).
    await wait(31_000);
    current = javaContext("EXPIRED", { expiresAt: NOW + 92_000 });
    const reads = statusReads;
    await wait(1_000);
    expect(statusReads).toBe(reads + 1);
    expect(line(wrapper)).toContain(`Expired at ${clock(NOW + 92_000)}`);
    expect(notice(wrapper).classes()).toContain("el-alert--warning");
    expect(notice(wrapper).text()).toContain(text.testExpiredHint);
    expect(frameSrc(wrapper)).not.toBe(firstFrame);
  });

  it("says that no business test has started, while the page itself still previews", async () => {
    const { wrapper } = await openPreview();

    expect(line(wrapper)).toContain(text.testData);
    expect(line(wrapper)).toContain(text.testNone);
    expect(line(wrapper)).not.toContain(SAMPLE);
    expect(notice(wrapper).classes()).toContain("el-alert--info");
    expect(notice(wrapper).text()).toBe(text.testNoneHint);
    expect(frameSrc(wrapper)).toContain("/preview/token-");
    // Real data shows once the application is published; the preview has no control that switches to it (2026-11-10).
    expect(wrapper.findAll("input, select, [role=switch]")).toHaveLength(0);
  });

  it("says the test data is being prepared from the sample", async () => {
    current = javaContext("PREPARING");
    const { wrapper } = await openPreview();

    expect(line(wrapper)).toContain(SAMPLE);
    expect(line(wrapper)).toContain(text.testPreparing);
    expect(notice(wrapper).classes()).toContain("el-alert--info");
    expect(notice(wrapper).text()).toBe(text.testPreparingHint);
  });

  it("says preparing failed, with Java's reason", async () => {
    current = javaContext("PREPARE_FAILED", { prepareError: "permission denied for schema public" });
    const { wrapper } = await openPreview();

    expect(line(wrapper)).toContain(SAMPLE);
    expect(line(wrapper)).toContain(text.testFailed);
    expect(notice(wrapper).classes()).toContain("el-alert--error");
    expect(notice(wrapper).find(".el-alert__title").text()).toBe(text.testFailedHint);
    expect(notice(wrapper).find(".el-alert__description").text()).toBe("permission denied for schema public");
  });

  it("asks for a new test once the test ended, drops the last round's results and reports a failed cleanup", async () => {
    current = javaContext("READY");
    const { wrapper } = await openPreview();
    const readyFrame = frameSrc(wrapper);

    current = javaContext("CLOSED", { cleanupError: "drop table failed" });
    await wait(5_000);

    expect(line(wrapper)).toContain(SAMPLE);
    expect(line(wrapper)).toContain(text.testClosed);
    expect(line(wrapper)).not.toContain("left");
    expect(notice(wrapper).classes()).toContain("el-alert--warning");
    expect(notice(wrapper).find(".el-alert__title").text()).toBe(text.testClosedHint);
    expect(notice(wrapper).find(".el-alert__description").text()).toBe("Removing the test data failed: drop table failed");
    expect(frameSrc(wrapper)).not.toBe(readyFrame);
  });

  it("says an expired test needs a new start even when the page opens after the deadline", async () => {
    current = javaContext("EXPIRED", { expiresAt: NOW - 60_000 });
    const { wrapper } = await openPreview();

    expect(line(wrapper)).toContain(`Expired at ${clock(NOW - 60_000)}`);
    expect(notice(wrapper).find(".el-alert__title").text()).toBe(text.testExpiredHint);
    expect(notice(wrapper).find(".el-alert__description").exists()).toBe(false);
  });

  it("loads the page once, after Java's first answer, and never says no test has started before it", async () => {
    let answer!: () => void;
    held = new Promise((resolve) => (answer = resolve));
    current = javaContext("READY");
    const { wrapper } = await openPreview();

    expect(line(wrapper)).toContain(publicEn.assistant.loading);
    expect(line(wrapper)).not.toContain(text.testNone);
    expect(notice(wrapper).exists()).toBe(false);
    expect(wrapper.find("iframe").exists()).toBe(false);
    expect(tokens).toBe(0);

    held = null;
    answer();
    await flushPromises();
    expect(line(wrapper)).toContain(SAMPLE);
    expect(line(wrapper)).toContain("43 min left");
    expect(frameSrc(wrapper)).toBe("/api/workspaces/w1/preview/token-1/index.html");
    expect(tokens).toBe(1);
  });

  it("keeps the page through a failed read and says only that the status could not be read", async () => {
    current = javaContext("READY");
    const { wrapper } = await openPreview();
    expect(frameSrc(wrapper)).toBe("/api/workspaces/w1/preview/token-1/index.html");

    statusFails = true;
    await wait(5_000);
    expect(line(wrapper)).toContain(text.testUnavailable);
    expect(line(wrapper)).not.toContain(SAMPLE);
    expect(notice(wrapper).classes()).toContain("el-alert--error");
    expect(notice(wrapper).find(".el-alert__title").text()).toBe(text.testUnavailableHint);
    expect(notice(wrapper).find(".el-alert__description").text()).toBe("Data engine unavailable");
    expect(frameSrc(wrapper)).toBe("/api/workspaces/w1/preview/token-1/index.html");

    statusFails = false;
    await wait(5_000);
    expect(line(wrapper)).toContain("43 min left");
    expect(notice(wrapper).exists()).toBe(false);
    expect(frameSrc(wrapper)).toBe("/api/workspaces/w1/preview/token-1/index.html");
    expect(tokens).toBe(1);
  });

  it("waits for a status it can read before loading the page, never showing an unread status as ready or as no data", async () => {
    statusFails = true;
    const { wrapper } = await openPreview();

    expect(line(wrapper)).toContain(text.testUnavailable);
    expect(line(wrapper)).not.toContain(text.testNone);
    expect(notice(wrapper).find(".el-alert__title").text()).toBe(text.testUnavailableHint);
    expect(wrapper.find("iframe").exists()).toBe(false);
    expect(tokens).toBe(0);

    statusFails = false;
    await wait(5_000);
    expect(line(wrapper)).toContain(text.testNone);
    expect(frameSrc(wrapper)).toBe("/api/workspaces/w1/preview/token-1/index.html");
  });

  it("starts the page afresh when the data it waited for is ready", async () => {
    current = javaContext("PREPARING");
    const { wrapper } = await openPreview();
    expect(frameSrc(wrapper)).toBe("/api/workspaces/w1/preview/token-1/index.html");

    current = javaContext("READY");
    await wait(5_000);
    expect(line(wrapper)).toContain("43 min left");
    expect(frameSrc(wrapper)).toBe("/api/workspaces/w1/preview/token-2/index.html");
  });
});
