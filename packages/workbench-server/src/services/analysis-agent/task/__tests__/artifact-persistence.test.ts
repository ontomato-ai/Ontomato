import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { configureI18n } from "../../../../i18n";
import { appTextEn } from "../../../../i18n/app-text-en";
import { en, enLocaleMeta } from "../../../../i18n/locales/en";
import type { DeepAnalysisTaskPayload } from "@ontomato/contracts/analysis-presentation";
import type { DeepAnalysisEmittedEvent } from "@ontomato/contracts/analysis-events";
import type { AnalysisTaskService } from "../task-service";
import { createDeepAnalysisArtifactStore } from "../artifacts";

const persist = vi.hoisted(() => vi.fn<Parameters<AnalysisTaskService["updateTaskArtifacts"]>, Promise<void>>());
vi.mock("../task-service", () => ({ getAnalysisTaskService: () => ({ updateTaskArtifacts: persist }) }));

const saved = new Map<string, DeepAnalysisTaskPayload>();
let gate: Promise<void> | undefined;
let failNext = false;
let refuseTerminal = false;
let inFlight = 0;
let maxInFlight = 0;
const refusal = new Error("synthetic persistence refusal");
const md = (payload: DeepAnalysisTaskPayload, sectionId: string) => payload.sections.find(section => section.sectionId === sectionId)?.markdown;
const terminal = (event: DeepAnalysisEmittedEvent) => event.type === "analysis_run_state" && event.content.status !== "running";
const open = (id: string, events: DeepAnalysisEmittedEvent[] = []) => createDeepAnalysisArtifactStore({
  taskId: id, identity: { runId: `${id}:run` }, requestSeq: 7, executionMode: "loop", emit: event => events.push(event),
});

beforeAll(() => configureI18n({ defaultLocale: "en", languageSwitchEnabled: false, appTextLocale: "en",
  packs: { en: { messages: { ...en, ...appTextEn }, ...enLocaleMeta } } }));
beforeEach(() => {
  saved.clear(); gate = undefined; failNext = false; refuseTerminal = false; inFlight = 0; maxInFlight = 0;
  persist.mockReset();
  persist.mockImplementation(async (id, input) => {
    inFlight += 1;
    maxInFlight = Math.max(maxInFlight, inFlight);
    try {
      await gate;
      if (failNext || (refuseTerminal && input.analysisPayload!.runState.status !== "running")) {
        failNext = false;
        throw refusal;
      }
      saved.set(id, structuredClone(input.analysisPayload!));
    } finally { inFlight -= 1; }
  });
});

describe("artifact persistence boundary", () => {
  it("serializes slow writes and publishes completion only after the cumulative final body is saved", async () => {
    const events: DeepAnalysisEmittedEvent[] = [];
    const store = open("slow", events);
    let release!: () => void;
    gate = new Promise<void>(resolve => { release = resolve; });
    const activityId = store.start("evidence", { questions: [{ questionId: "q1", question: "Q", status: "running" }] });
    await vi.waitFor(() => expect(inFlight).toBe(1));
    for (let i = 0; i < 10; i++) {
      store.section({ sectionId: "report", markdown: `part-${i};`, mode: "append" });
      store.thinking({ thinking: `t${i}`, mode: "replace", thinkingState: { summary: `t${i}`, status: "running", branches: [] }, activityId, questionId: "q1" });
    }
    store.question(activityId, "q1", { status: "completed" });
    store.section({ sectionId: "summary", markdown: "summary body", mode: "replace" });
    const finishing = store.finish("completed", undefined, "final answer");
    expect(saved.has("slow")).toBe(false);
    expect(events.filter(terminal)).toEqual([]);
    release(); gate = undefined;
    const finished = await finishing;
    expect(maxInFlight).toBe(1);
    const final = saved.get("slow")!;
    expect(final).toEqual(finished);
    expect(final.runState.status).toBe("completed");
    expect(final.finalAnswer).toBe("final answer");
    expect(md(final, "report")).toBe(Array.from({ length: 10 }, (_, i) => `part-${i};`).join(""));
    expect(md(final, "summary")).toBe("summary body");
    expect(final.activities[0].questions?.[0]).toMatchObject({ status: "completed", execution: { thinkingState: { summary: "t9" } } });
    expect(events.filter(terminal)).toHaveLength(1);
    // Every snapshot is attributed to the run captured when the accumulator opened.
    for (const [taskId, input, identity] of persist.mock.calls) {
      expect({ taskId, requestSeq: input.requestSeq, identity }).toEqual({ taskId: "slow", requestSeq: 7, identity: { runId: "slow:run" } });
    }
  });

  it.each(["failed", "cancelled"] as const)("keeps cumulative sections and query facts on %s", async status => {
    const store = open(status);
    const activityId = store.start("evidence", { questions: [{ questionId: "q1", question: "Q", status: "running" }] });
    store.section({ sectionId: "report", markdown: "kept body", mode: "append" });
    store.question(activityId, "q1", { execution: { thinkingState: { summary: "last thought", status: "running", branches: [] } } });
    await store.finish(status, "stop reason");
    const final = saved.get(status)!;
    expect(final.runState).toMatchObject({ status, error: "stop reason" });
    expect(md(final, "report")).toBe("kept body");
    expect(final.activities[0].questions?.[0].execution?.thinkingState?.summary).toBe("last thought");
  });

  it("retains cumulative content after an intermediate refusal", async () => {
    const store = open("retry");
    failNext = true;
    store.section({ sectionId: "report", markdown: "first;", mode: "append" });
    await vi.waitFor(() => expect(failNext).toBe(false));
    store.section({ sectionId: "report", markdown: "second;", mode: "append" });
    await store.finish("completed");
    expect(md(saved.get("retry")!, "report")).toBe("first;second;");
  });

  it("rejects a refused final write without publishing completion, then permits a sequential retry", async () => {
    const events: DeepAnalysisEmittedEvent[] = [];
    const store = open("final", events);
    store.section({ sectionId: "report", markdown: "body", mode: "append" });
    await vi.waitFor(() => expect(saved.has("final")).toBe(true));
    refuseTerminal = true;
    await expect(store.finish("completed")).rejects.toBe(refusal);
    expect(saved.get("final")!.runState.status).toBe("running");
    expect(events.filter(terminal)).toEqual([]);
    refuseTerminal = false;
    await store.finish("completed");
    expect(saved.get("final")!.runState.status).toBe("completed");
    expect(events.filter(terminal)).toHaveLength(1);
  });
});
