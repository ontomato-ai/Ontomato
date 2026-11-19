import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount, type VueWrapper } from "@vue/test-utils";
import ElementPlus from "element-plus";
import { ref } from "vue";
import { pageDockSpaceKey } from "@ontomato/agent-shell-ui";
import type { RunEvent } from "@ontomato/contracts/autotest";
import { workbenchI18n } from "../../../../i18n";
import TestPage from "../test-run/TestPage.vue";
import LiveLogsPage from "../live-logs/LiveLogsPage.vue";

/*
 * Diagnosis pages in a background tab (design "long connections" 2 and acceptance 5): a hidden tab holds none of their
 * streams, and coming back restores what the user was watching from what the server holds.
 *
 * The test page only stops watching a run: it does not take the closed stream for a failure and never asks the server to
 * stop. Back in front it reads the same run again, its id unchanged; a settled run is rebuilt from its stored results and
 * an active one by the server replaying its whole event buffer onto an emptied log, so no line appears twice.
 *
 * The live log resumes, from the last sequence it was delivered, only the panels the user left connected: a paused panel
 * stays paused and shows nothing new, and a panel the user disconnected stays off.
 */

const i18n = workbenchI18n();
// The shell provides the room its dock takes at the page's foot.
const global = { plugins: [i18n, ElementPlus], provide: { [pageDockSpaceKey as symbol]: ref(0) } };

/** The browser's EventSource, as far as these pages use it. */
class FakeEventSource {
  static opened: FakeEventSource[] = [];
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  closed = false;
  // Like the browser's object, which Vue's reactivity leaves unwrapped.
  readonly [Symbol.toStringTag] = "EventSource";
  constructor(readonly url: string) {
    FakeEventSource.opened.push(this);
  }
  close() {
    this.closed = true;
  }
  send(data: unknown, id = "") {
    if (this.closed) throw new Error("A closed stream delivers nothing");
    this.onmessage?.(new MessageEvent("message", { data: typeof data === "string" ? data : JSON.stringify(data), lastEventId: id }));
  }
  get path() {
    return new URL(this.url, "http://workbench.test").pathname;
  }
  get query() {
    return new URL(this.url, "http://workbench.test").searchParams;
  }
}
const live = () => FakeEventSource.opened.filter((source) => !source.closed);

/** The browser reports the document going to the background or coming back. */
async function report(state: "visible" | "hidden") {
  Object.defineProperty(document, "visibilityState", { value: state, configurable: true });
  document.dispatchEvent(new Event("visibilitychange"));
  await flushPromises();
}

/** What the server holds for run-1, and every request the page made. */
let run: { status: string; results: unknown[] };
let requests: string[];
const json = (body: unknown) => new Response(JSON.stringify(body), { headers: { "Content-Type": "application/json" } });

const wrappers: VueWrapper[] = [];
beforeEach(() => {
  FakeEventSource.opened = [];
  run = { status: "running", results: [] };
  requests = [];
  vi.stubGlobal("EventSource", FakeEventSource);
  vi.stubGlobal("fetch", async (input: string, init?: RequestInit) => {
    const path = new URL(input, "http://workbench.test").pathname;
    requests.push(`${init?.method ?? "GET"} ${path}`);
    if (path === "/api/observe/autotest/case-sets") return json({ success: true, data: [] });
    if (path === "/api/observe/autotest/runs/run-1")
      return json({ success: true, data: { runId: "run-1", status: run.status, summary: { total: 2, correct: 0, wrong: 0, abnormal: 0 } } });
    if (path === "/api/observe/autotest/runs/run-1/results") return json({ success: true, data: { results: run.results } });
    throw new Error(`Unexpected request ${path}`);
  });
});
afterEach(async () => {
  wrappers.splice(0).forEach((wrapper) => wrapper.unmount());
  await report("visible");
  vi.unstubAllGlobals();
});

describe("test run", () => {
  const caseStart = (caseId: string): RunEvent => ({
    type: "case_start", runId: "run-1", timestamp: 1, data: { caseId, question: `question of ${caseId}`, index: 0 },
  });
  const logLines = (wrapper: VueWrapper) => wrapper.findAll(".log-terminal > span").map((line) => line.text());
  const count = (wrapper: VueWrapper, text: string) => logLines(wrapper).filter((line) => line.includes(text)).length;

  async function followRun() {
    const wrapper = mount(TestPage, { props: { initialRunId: "run-1" }, global });
    wrappers.push(wrapper);
    await flushPromises();
    const [stream] = live();
    expect(stream.path).toBe("/api/observe/autotest/runs/run-1/events");
    stream.send(caseStart("case-1"));
    await flushPromises();
    return { wrapper, stream };
  }

  it("rebuilds an active run from the replayed buffer, without taking the pause for a failure", async () => {
    const { wrapper, stream } = await followRun();

    await report("hidden");
    expect(stream.closed).toBe(true);
    expect(live()).toHaveLength(0);
    expect(wrapper.text()).not.toContain(i18n.global.t("diagnosis.sseDisconnected"));
    expect(wrapper.text()).not.toContain(i18n.global.t("diagnosis.runFailed"));
    expect(wrapper.emitted("run-settled")).toBeUndefined();

    await report("visible");
    expect(requests.filter((request) => request === "GET /api/observe/autotest/runs/run-1")).toHaveLength(2);
    const [replay] = live();
    expect(replay.path).toBe("/api/observe/autotest/runs/run-1/events");
    // The server replays its whole buffer: what was shown before and what happened meanwhile.
    replay.send(caseStart("case-1"));
    replay.send(caseStart("case-2"));
    await flushPromises();

    expect(count(wrapper, "question of case-1")).toBe(1);
    expect(count(wrapper, "question of case-2")).toBe(1);
    expect(count(wrapper, "Restored test batch run-1")).toBe(1);
    expect(wrapper.text()).toContain(i18n.global.t("diagnosis.running"));
    expect(requests.some((request) => request.startsWith("POST"))).toBe(false);
  });

  it("rebuilds a run that settled in the background from its stored results", async () => {
    const { wrapper } = await followRun();

    await report("hidden");
    run = {
      status: "completed",
      results: [
        { caseId: "case-1", verdict: "correct" },
        { caseId: "case-2", verdict: "wrong" },
      ],
    };
    await report("visible");

    expect(live()).toHaveLength(0);
    expect(count(wrapper, "question of case-1")).toBe(0);
    expect(count(wrapper, "Restored test batch run-1")).toBe(1);
    expect(wrapper.text()).toContain(i18n.global.t("task.completed"));
    expect(wrapper.text()).not.toContain(i18n.global.t("diagnosis.runFailed"));
    expect(wrapper.emitted("run-settled")).toEqual([["run-1"]]);
  });

  it("opens no stream for a run it starts following while hidden, until the tab is back", async () => {
    await report("hidden");
    const wrapper = mount(TestPage, { props: { initialRunId: "run-1" }, global });
    wrappers.push(wrapper);
    await flushPromises();
    expect(FakeEventSource.opened).toHaveLength(0);

    await report("visible");
    expect(live().map((source) => source.path)).toEqual(["/api/observe/autotest/runs/run-1/events"]);
  });
});

describe("live logs", () => {
  const record = (message: string) => ({ source: "backend", level: "info", message });
  const panels = (wrapper: VueWrapper) => wrapper.findAll(".log-panel");
  const button = (panel: ReturnType<typeof panels>[number], label: string) =>
    panel.findAll("button").find((item) => item.text() === i18n.global.t(label))!;

  async function open() {
    const wrapper = mount(LiveLogsPage, { global });
    wrappers.push(wrapper);
    const [left, right] = panels(wrapper);
    await button(left, "common.connect").trigger("click");
    await button(right, "common.connect").trigger("click");
    const [leftStream, rightStream] = live();
    expect(leftStream.query.has("since_seq")).toBe(false);
    return { wrapper, left, right, leftStream, rightStream };
  }

  it("resumes a connected panel from its last sequence and keeps a paused one paused", async () => {
    const { wrapper, left, right, leftStream, rightStream } = await open();
    leftStream.send(record("left line 1"), "11");
    rightStream.send(record("right line 1"), "12");
    await vi.waitFor(() => expect(wrapper.text()).toContain("right line 1"));
    await button(right, "common.pause").trigger("click");
    // Delivered while paused: never shown, but the stream has passed it.
    rightStream.send(record("right line 2"), "13");

    await report("hidden");
    expect(live()).toHaveLength(0);

    await report("visible");
    const [leftResumed, rightResumed] = live();
    expect(leftResumed.query.get("source")).toBe(leftStream.query.get("source"));
    expect(leftResumed.query.get("since_seq")).toBe("11");
    expect(rightResumed.query.get("source")).toBe("backend");
    expect(rightResumed.query.get("since_seq")).toBe("13");
    expect(button(right, "common.continue").exists()).toBe(true);

    leftResumed.send(record("left line 2"), "14");
    rightResumed.send(record("right line 3"), "15");
    await vi.waitFor(() => expect(wrapper.text()).toContain("left line 2"));
    expect(left.text()).toContain("left line 1");
    expect(right.text()).toContain("right line 1");
    expect(right.text()).not.toContain("right line 2");
    expect(right.text()).not.toContain("right line 3");
  });

  it("leaves a panel the user disconnected off", async () => {
    const { right, leftStream } = await open();
    await button(right, "common.disconnect").trigger("click");

    await report("hidden");
    await report("visible");

    expect(live()).toHaveLength(1);
    expect(live()[0].query.get("source")).toBe(leftStream.query.get("source"));
    expect(button(right, "common.connect").exists()).toBe(true);
  });
});
