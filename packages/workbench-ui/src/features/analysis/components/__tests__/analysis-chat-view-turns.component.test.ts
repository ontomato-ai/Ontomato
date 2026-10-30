import { beforeEach, describe, expect, it, vi } from "vitest";
import { nextTick } from "vue";
import { flushPromises, mount } from "@vue/test-utils";
import { createI18n } from "vue-i18n";
import ElementPlus from "element-plus";
import { createPinia, setActivePinia } from "pinia";
import AnalysisChatView from "../AnalysisChatView.vue";
import { useAnalysisStore, type TaskSession } from "../../stores/analysis";
import en from "../../../../locales/en";
import type { AnalysisAgent } from "@ontomato/contracts/analysis-agent";
import type { EgressMessage } from "@ontomato/contracts/agent-egress";
import type {
  AnalysisTask,
  AnalysisTaskRun,
} from "@ontomato/contracts/analysis-task";
import type {
  AnalysisActivity,
  AnalysisRunState,
  DeepAnalysisTaskPayload,
} from "@ontomato/contracts/analysis-presentation";
import type { Message, ResponseSnapshot } from "../../../../types/chat";
import { turnDiagnosisAccessKey } from "../../../diagnosis/access";

const getRunSnapshot = vi.fn();
const getLoopSubagentTrace = vi.fn();
const getQuestionExecution = vi.fn(async (..._args: unknown[]) => ({}));
const getTurns = vi.fn();

vi.mock("../../api", () => ({
  analysisAgentApi: {},
  analysisTaskApi: {
    getLoopSubagentTrace: (...args: unknown[]) => getLoopSubagentTrace(...args),
    getRunSnapshot: (...args: unknown[]) => getRunSnapshot(...args),
    getQuestionExecution: (...args: unknown[]) => getQuestionExecution(...args),
    getTurns: (...args: unknown[]) => getTurns(...args),
  },
  analysisReportApi: {},
  streamTaskExecution: vi.fn(() => () => {}),
  streamFollowUp: vi.fn(() => () => {}),
  streamFollowUpRun: vi.fn(() => () => {}),
  cancelDeepAnalysisRun: vi.fn(),
  cancelFollowUpRun: vi.fn(async () => ({ ok: true })),
}));

function activity(narrative: string): AnalysisActivity {
  return {
    activityId: `activity-${narrative}`,
    seq: 1,
    revision: 1,
    kind: "narrative",
    status: "completed",
    startedAt: 1,
    narrative,
  };
}

function runState(status: AnalysisRunState["status"], done: number): AnalysisRunState {
  return { status, revision: 1, progress: { done, label: "" } };
}

function execution(
  activities: AnalysisActivity[],
  patch: Partial<DeepAnalysisTaskPayload> = {}
): DeepAnalysisTaskPayload {
  return {
    executionMode: "loop",
    runState: runState("completed", activities.length),
    activities,
    sections: [],
    charts: [],
    chartDiagnostics: [],
    ...patch,
  };
}

function answerMessage(
  id: number,
  answer: string,
  narrative: string,
  patch: Partial<DeepAnalysisTaskPayload> = {},
  trace: EgressMessage[] = []
): Message {
  return {
    id,
    role: "assistant",
    content: answer,
    snapshot: {
      mode: "deep-analysis",
      status: "completed",
      source: "history",
      primaryText: answer,
      trace,
      deepAnalysis: execution([activity(narrative)], { finalAnswer: answer, ...patch }),
    },
  };
}

function agent(reportDeliverableEnabled: boolean): AnalysisAgent {
  return {
    id: "agent-1",
    name: "Harness",
    description: "",
    executionMode: "loop",
    graphScope: { mode: "panorama" },
    reportDeliverableEnabled,
    summarizerPrompt: "",
    conclusionMakerPrompt: "",
    isEnabled: true,
    createdAt: 1,
    updatedAt: 1,
  };
}

function taskFixture(patch: Partial<AnalysisTask> = {}): AnalysisTask {
  return {
    id: "task-1",
    agentId: "agent-1",
    userId: "owner",
    name: "conversation-task",
    description: "",
    status: "completed",
    reportDeliverableEnabled: false,
    question: "task-question",
    scheduleEnabled: false,
    notifyOnComplete: false,
    triggerSource: "manual",
    createdAt: 1,
    updatedAt: 1,
    ...patch,
  };
}

function sessionFixture(
  messages: Message[],
  streamingSnapshot: ResponseSnapshot | null = null
): TaskSession {
  return {
    taskId: "task-1",
    agentId: "agent-1",
    threadId: "thread-1",
    taskName: "conversation-task",
    messages,
    input: "",
    isLoading: false,
    streamingSnapshot,
    stopRequested: false,
  };
}

function seed(options: {
  messages: Message[];
  streamingSnapshot?: ResponseSnapshot | null;
  report?: boolean;
  taskPatch?: Partial<AnalysisTask>;
  runs?: AnalysisTaskRun[];
  runIndex?: number;
}) {
  const store = useAnalysisStore();
  const report = options.report ?? false;
  store.agents = [agent(report)];
  store.selectedAgentId = "agent-1";
  store.tasks = [taskFixture({ reportDeliverableEnabled: report, ...options.taskPatch })];
  store.currentTaskId = "task-1";
  store.taskRuns = options.runs ?? [];
  store.taskRunIndex = options.runIndex ?? 0;
  store.sessions = {
    "task-1": sessionFixture(options.messages, options.streamingSnapshot ?? null),
  };
}

function streamingExecution(activities: AnalysisActivity[]): ResponseSnapshot {
  return {
    mode: "deep-analysis",
    status: "streaming",
    source: "live",
    primaryText: "",
    deepAnalysis: execution(activities, { runState: runState("running", 0) }),
  };
}

function render(diagnosisVisible = false) {
  return mount(AnalysisChatView, {
    global: {
      plugins: [createI18n({ legacy: false, locale: "en", messages: { en } }), ElementPlus],
      stubs: { DeepAnalysisResult: true, QueryExecutionView: true },
      // The turn diagnosis entry is injected by the app; here permissions are not loaded, so the entry is hidden.
      provide: {
        [turnDiagnosisAccessKey as symbol]: { prepare: () => {}, visible: () => diagnosisVisible },
      },
    },
  });
}

function occurrences(text: string, value: string): number {
  return text.split(value).length - 1;
}

/** Opens every turn's execution process, which is collapsed by default. */
async function openProcesses(wrapper: ReturnType<typeof render>) {
  for (const toggle of wrapper.findAll(".loop-process-toggle")) await toggle.trigger("click");
}

function userTrace(text: string): EgressMessage {
  return { role: "user", content: [{ type: "text", text }] };
}

function toolCallTrace(name: string, args: Record<string, unknown>): EgressMessage {
  return {
    role: "assistant",
    content: [{ type: "toolCall", id: `call-${name}`, name, arguments: args }],
  };
}

function toolResultTrace(toolName: string, text: string): EgressMessage {
  return {
    role: "toolResult",
    toolCallId: `call-${toolName}`,
    toolName,
    content: [{ type: "text", text }],
  };
}

beforeEach(() => {
  setActivePinia(createPinia());
  vi.clearAllMocks();
});

// Public surface under test: first-turn message layout; observable result: a report task shows the user question before the system acknowledgment, while a regular loop conversation omits report-only system bubbles.
it("shows the user's question before the analysis acknowledgment for report tasks and omits it for regular loop sessions", () => {
  seed({
    report: true,
    messages: [
      { id: 1, role: "user", content: "user-analysis-question" },
      answerMessage(2, "analysis-answer", "analysis-activity"),
    ],
  });

  const reportRows = render().findAll(".chat-msg");
  expect(reportRows[0].classes()).toContain("user");
  expect(reportRows[0].text()).toContain("user-analysis-question");
  expect(reportRows[1].classes()).toContain("analysis-acknowledgment");

  seed({
    report: false,
    messages: [
      { id: 1, role: "user", content: "regular-question" },
      answerMessage(2, "regular-answer", "regular-activity"),
    ],
  });
  const regularWrapper = render();
  expect(regularWrapper.find(".analysis-acknowledgment").exists()).toBe(false);
  expect(regularWrapper.find(".completed-notice").exists()).toBe(false);
});

it("shows the run switcher below the user's question", () => {
  seed({
    report: true,
    messages: [
      { id: 1, role: "user", content: "user-analysis-question" },
      answerMessage(2, "analysis-answer", "analysis-activity"),
    ],
    runs: [
      { id: "run-1", status: "completed" },
      { id: "run-2", status: "completed" },
    ],
    runIndex: 1,
  });

  const children = render().find(".messages-inner").element.children;
  expect(children[0].classList).toContain("user");
  expect(children[1].classList).toContain("run-switcher-row");
  expect(children[2].classList).toContain("analysis-acknowledgment");
});

// Public surface under test: execution output consumed once per turn; observable result: narration is the visible body, L1 steps sit in a collapsed process, and replies are not repeated.
it("renders every turn's question, narration body and reply with L1 steps inside a collapsed process", async () => {
  seed({
    messages: [
      { id: 1, role: "user", content: "first-question" },
      answerMessage(2, "first-answer", "first-round-writing", {
        activities: [
          activity("first-round-writing"),
          {
            activityId: "activity-evidence",
            seq: 2,
            revision: 1,
            kind: "evidence",
            status: "completed",
            startedAt: 1,
            questions: [
              {
                questionId: "q-1",
                question: "data-query-question",
                status: "completed",
                execution: {},
              },
            ],
          },
        ],
      }),
      { id: 3, role: "user", content: "second-question" },
      answerMessage(4, "second-answer", "second-round-writing"),
    ],
  });
  const wrapper = render();
  const text = wrapper.text();

  expect(text).toContain("first-question");
  expect(text).toContain("second-question");
  expect(text).toContain("first-round-writing");
  expect(text).toContain("second-round-writing");
  expect(wrapper.find(".loop-content .loop-narrative").exists()).toBe(true);
  // The process is collapsed by default; only the first turn has steps, so only it gets a process entry.
  expect(wrapper.findAll(".loop-process")).toHaveLength(1);
  expect(wrapper.find(".loop-process-toggle").attributes("aria-expanded")).toBe("false");
  expect(wrapper.find(".loop-activity-header").exists()).toBe(false);
  await openProcesses(wrapper);
  // Once Node fills in question.execution in /turns, clicking the L1 evidence header mounts QueryExecutionView in L2.
  for (const header of wrapper.findAll(".loop-activity-header")) await header.trigger("click");
  expect(wrapper.find("query-execution-view-stub").exists()).toBe(true);
  expect(occurrences(text, "first-answer")).toBe(1);
  expect(occurrences(text, "second-answer")).toBe(1);
});

// Public surface under test: partial body of a cancelled turn and the streaming tail; observable result: the partial body stays without duplication and the streaming turn renders normally.
it("keeps a cancelled turn's partial answer and stopped notice while the next turn streams", () => {
  seed({
    messages: [
      { id: 1, role: "user", content: "first-question" },
      answerMessage(2, "completed-partial-answer", "completed-round-writing", {
        runState: runState("cancelled", 1),
      }),
      { id: 3, role: "user", content: "second-question" },
    ],
    streamingSnapshot: streamingExecution([activity("in-progress-round-writing")]),
  });
  const wrapper = render();
  const text = wrapper.text();

  expect(text).toContain("completed-partial-answer");
  expect(text).toContain("completed-round-writing");
  expect(text).toContain("in-progress-round-writing");
  expect(wrapper.find(".stopped-notice").exists()).toBe(true);
  expect(occurrences(text, "completed-partial-answer")).toBe(1);
});

// Public surface under test: streaming body of a standard follow-up; observable result: the body and typing tail appear in that turn.
it("shows the streaming carrier text for a standard follow-up turn", () => {
  seed({
    messages: [
      { id: 1, role: "user", content: "report-question" },
      answerMessage(2, "report-reply", "report-round-activity"),
      { id: 3, role: "user", content: "follow-up-question" },
    ],
    streamingSnapshot: {
      mode: "standard",
      status: "streaming",
      source: "live",
      primaryText: "follow-up-streaming-body",
    },
  });
  const wrapper = render();

  expect(wrapper.text()).toContain("follow-up-streaming-body");
  expect(wrapper.find(".typing-cursor").exists()).toBe(true);
});

// Public surface under test: the authoritative source of per-turn replies; observable result: a finished turn's answer is not carried into the unfinished new turn (task metadata carries no answer).
it("keeps a finished turn's answer out of the next unfinished turn", () => {
  seed({
    messages: [
      { id: 1, role: "user", content: "question-A" },
      answerMessage(2, "answer-A", "round-A-activity"),
      { id: 3, role: "user", content: "question-B" },
    ],
    streamingSnapshot: streamingExecution([activity("round-B-in-progress")]),
  });
  const text = render().text();

  expect(text).toContain("question-A");
  expect(text).toContain("question-B");
  expect(text).toContain("round-B-in-progress");
  expect(occurrences(text, "answer-A")).toBe(1);
});

// Public surface under test: history run selection of report tasks; observable result: without a run snapshot the report body
// is not disguised as a chat message; the report view still renders the report body.
it("does not show a historical run's report body in the conversation view", () => {
  seed({
    report: true,
    messages: [
      { id: 1, role: "user", content: "current-question" },
      answerMessage(2, "current-answer", "current-round-activity"),
    ],
    runs: [
      { id: "run-1", status: "completed", resultReport: "first-run-body" },
      { id: "run-2", status: "completed", resultReport: "second-run-body" },
    ],
    runIndex: 0,
  });
  const text = render().text();

  expect(text).toContain("task-question");
  expect(text).not.toContain("first-run-body");
  expect(text).not.toContain("second-run-body");
  // Run records have no public messages, so no empty "messages and tools" panel should appear.
  expect(render().findAll(".message-trace-list")).toHaveLength(0);
});

// Public surface under test: per-turn public messages and tool results; observable result: expanding does not mix turns and internal thinking fields are never read.
it("does not leak partial report text from a cancelled run into chat", async () => {
  const cancelledPayload = execution([activity("pre-cancel-activity")], {
    runState: runState("cancelled", 1),
    sections: [
      {
        sectionId: "report",
        order: 0,
        revision: 1,
        markdown: "pre-cancel-partial-report",
        status: "success",
      },
    ],
  });
  // Run lists carry no replay snapshot; selecting the old run reads its own.
  getRunSnapshot.mockResolvedValue({
    mode: "deep-analysis",
    status: "failed",
    source: "history",
    primaryText: "pre-cancel-partial-report",
    deepAnalysis: cancelledPayload,
  });
  seed({
    report: true,
    messages: [],
    runs: [
      { id: "run-cancelled", status: "cancelled", resultReport: "pre-cancel-partial-report" },
      { id: "run-current", status: "completed", resultReport: "current-report" },
    ],
    runIndex: 1,
  });
  await useAnalysisStore().selectRun(0);
  expect(getRunSnapshot).toHaveBeenCalledWith("task-1", "run-cancelled");

  const text = render().text();
  expect(text).toContain("pre-cancel-activity");
  expect(text).not.toContain("pre-cancel-partial-report");
});

/** Opens every tool record detail inside opened processes. */
async function openToolRecords(wrapper: ReturnType<typeof render>) {
  for (const toggle of wrapper.findAll(".loop-process-body .loop-trace-toggle")) await toggle.trigger("click");
}

// Public surface under test: records saved before activities carried a call identity; observable result: their tool
// calls and results stay once as "other tool records" in the turn's process, never in a separate bottom block, per turn,
// without repeating the user question, the body or internal thinking.
it("keeps legacy tool records once inside each turn's own process without repeating question or body", async () => {
  seed({
    messages: [
      { id: 1, role: "user", content: "first-question" },
      answerMessage(2, "first-answer", "first-round-writing", {}, [
        userTrace("first-question"),
        {
          role: "assistant",
          content: [
            { type: "text", text: "first-round-writing" },
            { type: "toolCall", id: "call-orders_query", name: "orders_query", arguments: { region: "north" } },
          ],
        },
        toolResultTrace("orders_query", "[Orders](https://example.com/orders) orders-result-A"),
        toolResultTrace("orders_json", '{"sku":"SKU42","qty":3}'),
        toolResultTrace("orders_html", '<img src=x onerror="alert(1)">'),
        { ...userTrace("hidden-message"), thinking: "internal-thinking-A" } as unknown as EgressMessage,
        { role: "assistant", content: [{ type: "text", text: "first-answer" }] },
      ]),
      { id: 3, role: "user", content: "second-question" },
      answerMessage(
        4,
        "second-answer",
        "unused",
        {
          // A legacy step without call identity: the record is not claimed by it.
          activities: [
            step("probe-legacy", 1, { kind: "probe", probeTool: "probe_classes" }),
            narration("n-2", 2, "second-round-writing"),
          ],
        },
        [toolCallTrace("stock_query", { sku: "SKU42" }), toolResultTrace("stock_query", "stock-result-B")]
      ),
    ],
  });
  const wrapper = render();

  // One process per turn here; no separate turn-level tool block.
  expect(wrapper.findAll(".loop-process")).toHaveLength(2);
  expect(wrapper.text()).not.toContain("orders-result-A");

  await openProcesses(wrapper);
  const [first, second] = wrapper.findAll(".loop-process");
  expect(first.find(".loop-timeline").exists()).toBe(false);
  expect(second.find(".loop-timeline-item .loop-trace-toggle").exists()).toBe(false);
  await openToolRecords(wrapper);

  expect(first.find(".loop-other-tools").text()).toContain("orders_query");
  expect(first.text()).toContain("north");
  expect(first.text()).toContain("orders-result-A");
  expect(first.text()).not.toContain("stock_query");
  expect(second.find(".loop-other-tools").text()).toContain("stock-result-B");
  expect(wrapper.text()).not.toContain("internal-thinking-A");
  expect(wrapper.text()).not.toContain("hidden-message");
  // The user question and the assistant text stay in their own places, once.
  expect(occurrences(wrapper.text(), "first-question")).toBe(1);
  expect(occurrences(wrapper.text(), "first-round-writing")).toBe(1);
  expect(occurrences(wrapper.text(), "first-answer")).toBe(1);
  expect(occurrences(wrapper.text(), "orders-result-A")).toBe(1);
  expect(occurrences(wrapper.text(), "stock-result-B")).toBe(1);
  // Tool results reuse the safe renderer: Markdown links and JSON code blocks are kept and raw HTML is not executed.
  expect(first.find('.loop-trace-text a[href="https://example.com/orders"]').exists()).toBe(true);
  const codeBlock = first.find(".loop-trace-text pre code");
  expect(codeBlock.exists()).toBe(true);
  expect(codeBlock.text()).toContain('"sku"');
  expect(first.find(".loop-trace-text img").exists()).toBe(false);
  expect(first.text()).toContain("onerror");
});

function step(
  activityId: string,
  seq: number,
  patch: Partial<AnalysisActivity> & Pick<AnalysisActivity, "kind">
): AnalysisActivity {
  return { activityId, seq, revision: 1, status: "completed", startedAt: seq, ...patch };
}

function narration(activityId: string, seq: number, text: string, status: AnalysisActivity["status"] = "completed") {
  return step(activityId, seq, { kind: "narrative", narrative: text, status });
}

/** Rendered order of a turn's loop blocks: "process" for a folded stretch, otherwise the narration text. */
function loopBlockOrder(wrapper: ReturnType<typeof render>): string[] {
  return wrapper
    .findAll(".loop-process, .loop-content, .chat-bubble.assistant:not(.loop-content)")
    .map((node) => (node.classes("loop-process") ? "process" : node.text()));
}

// Public surface under test: the turn follows the agent's real rhythm; observable result: each stretch of process
// activities is its own collapsed block, stage summaries sit between them in acceptance order, and the final reply closes the turn.
it("interleaves collapsed process stretches with stage summaries in acceptance order before the final reply", async () => {
  const activities = [
    step("ext-1", 1, { kind: "external_tool", status: "failed", serviceName: "erp", toolName: "sync", error: "mcp-down" }),
    step("ev-1", 2, {
      kind: "evidence",
      questions: [{ questionId: "q-1", question: "gap-question", status: "failed", error: "no-rows" }],
    }),
    narration("n-1", 3, "stage-summary-one"),
    step("disp-1", 4, { kind: "dispatch", topic: "channel-check" }),
    narration("n-2", 5, "final-reply"),
  ];
  seed({
    messages: [
      { id: 1, role: "user", content: "question" },
      answerMessage(2, "final-reply", "unused", { activities, finalAnswer: "final-reply" }),
    ],
  });
  const wrapper = render();

  expect(loopBlockOrder(wrapper)).toEqual(["process", "stage-summary-one", "process", "final-reply"]);
  const [first, second] = wrapper.findAll(".loop-process");
  expect(first.find(".loop-process-toggle").attributes("aria-expanded")).toBe("false");
  expect(second.find(".loop-process-toggle").attributes("aria-expanded")).toBe("false");
  // Failures and result gaps are readable on the folded header; the details stay folded.
  expect(first.find(".loop-process-failures").text()).toContain("2");
  expect(second.find(".loop-process-failures").exists()).toBe(false);
  expect(wrapper.text()).not.toContain("mcp-down");

  await first.find(".loop-process-toggle").trigger("click");
  expect(first.text()).toContain("mcp-down");
  expect(first.text()).not.toContain("channel-check");
  expect(second.find(".loop-process-body").exists()).toBe(false);
});

// Public surface under test: live query progress inside its own stretch; observable result: the running stretch shows
// progress while folded, an opened stretch keeps showing the query as it advances, a new stretch arrives folded, and the
// user's choices survive the turn settling into history.
it("keeps a live stretch open while its query advances and new stretches arrive folded, through settling into history", async () => {
  const runningQuery = step("ev-1", 2, {
    kind: "evidence",
    status: "running",
    questions: [{ questionId: "q-1", question: "orders-by-region", status: "running", execution: {} }],
  });
  const live = (activities: AnalysisActivity[], label: string): ResponseSnapshot => ({
    mode: "deep-analysis",
    status: "streaming",
    source: "live",
    primaryText: "",
    requestSeq: 9,
    deepAnalysis: execution(activities, {
      runState: { status: "running", revision: 1, progress: { done: 1, label } },
    }),
  });
  seed({
    messages: [{ id: 1_700_000_000_000, role: "user", content: "question" }],
    streamingSnapshot: live([narration("n-0", 1, "opening-note"), runningQuery], "querying-orders"),
  });
  const wrapper = render();
  const header = wrapper.find(".loop-process-toggle");
  expect(header.attributes("aria-expanded")).toBe("false");
  expect(header.text()).toContain("querying-orders");

  await header.trigger("click");
  await wrapper.find(".loop-activity-header").trigger("click");
  expect(wrapper.find(".loop-question-row").text()).toContain("Querying");

  // The query finishes, a stage summary streams and the next stretch starts.
  const session = useAnalysisStore().sessions["task-1"];
  const doneQuery = step("ev-1", 2, {
    kind: "evidence",
    questions: [
      { questionId: "q-1", question: "orders-by-region", status: "completed", dataCount: 5, execution: {} },
    ],
  });
  const later = [
    narration("n-0", 1, "opening-note"),
    doneQuery,
    narration("n-1", 3, "stage-summary-one"),
    step("probe-1", 4, { kind: "probe", status: "running", probeTool: "probe_classes" }),
  ];
  session.streamingSnapshot = live(later, "probing");
  await nextTick();

  expect(loopBlockOrder(wrapper)).toEqual(["opening-note", "process", "stage-summary-one", "process"]);
  let processes = wrapper.findAll(".loop-process");
  expect(processes[0].find(".loop-process-toggle").attributes("aria-expanded")).toBe("true");
  expect(processes[0].find(".loop-question-row").text()).toContain("5 rows");
  expect(processes[1].find(".loop-process-toggle").attributes("aria-expanded")).toBe("false");
  expect(processes[1].text()).toContain("probing");
  // Progress belongs to the running stretch only.
  expect(processes[0].find(".loop-process-toggle").text()).not.toContain("probing");

  session.streamingSnapshot = null;
  session.messages = [
    { id: 1, role: "user", content: "question" },
    {
      id: 2,
      role: "assistant",
      content: "final-reply",
      snapshot: {
        mode: "deep-analysis",
        status: "completed",
        source: "history",
        primaryText: "final-reply",
        requestSeq: 9,
        deepAnalysis: execution(
          [...later.slice(0, 3), { ...later[3], status: "completed" }, narration("n-2", 5, "final-reply")],
          { finalAnswer: "final-reply" }
        ),
      },
    },
  ];
  await nextTick();

  processes = wrapper.findAll(".loop-process");
  expect(processes[0].find(".loop-process-toggle").attributes("aria-expanded")).toBe("true");
  expect(processes[0].find(".loop-question-row").text()).toContain("5 rows");
  expect(processes[1].find(".loop-process-toggle").attributes("aria-expanded")).toBe("false");
  expect(occurrences(wrapper.text(), "final-reply")).toBe(1);
});

// Public surface under test: tool records follow their real call identity; observable result: each step offers its
// own call and result inside its stretch (a parallel message is split per call), a call without a business activity
// stays once in the first stretch's "other tool records", and every record appears exactly once.
it("places each tool call and result under the step that made it, splitting parallel calls, with unattributed records kept once", async () => {
  const activities = [
    step("ev-1", 1, {
      kind: "evidence",
      toolCallId: "c-ev",
      questions: [{ questionId: "q-1", question: "orders-by-region", status: "completed", execution: {} }],
    }),
    narration("n-1", 2, "stage-summary-one"),
    step("probe-1", 3, { kind: "probe", toolCallId: "c-probe", probeTool: "probe_classes" }),
    step("ext-1", 4, { kind: "external_tool", toolCallId: "c-ext", serviceName: "erp", toolName: "sync" }),
    narration("n-2", 5, "final-reply"),
  ];
  const call = (id: string, name: string, args: Record<string, unknown> = {}) =>
    ({ type: "toolCall", id, name, arguments: args }) as const;
  const result = (id: string, toolName: string, text: string): EgressMessage => ({
    role: "toolResult",
    toolCallId: id,
    toolName,
    content: [{ type: "text", text }],
  });
  seed({
    messages: [
      { id: 1, role: "user", content: "question" },
      answerMessage(2, "final-reply", "unused", { activities, finalAnswer: "final-reply" }, [
        userTrace("question"),
        { role: "assistant", content: [call("c-ev", "collect_evidence", { questions: ["orders-by-region"] })] },
        result("c-ev", "collect_evidence", "evidence-result"),
        {
          role: "assistant",
          content: [
            { type: "text", text: "stage-summary-one" },
            call("c-probe", "probe_classes"),
            call("c-ext", "mcp__erp__sync", { order: "ext-arg" }),
            call("c-skill-file", "read_skill_file", { path: "guide.md" }),
          ],
        },
        // Parallel results arrive out of call order.
        result("c-ext", "mcp__erp__sync", "ext-result"),
        result("c-skill-file", "read_skill_file", "skill-file-result"),
        result("c-probe", "probe_classes", "probe-result"),
        { role: "assistant", content: [{ type: "text", text: "final-reply" }] },
      ]),
    ],
  });
  const wrapper = render();

  expect(loopBlockOrder(wrapper)).toEqual(["process", "stage-summary-one", "process", "final-reply"]);
  await openProcesses(wrapper);
  const [first, second] = wrapper.findAll(".loop-process");
  // Steps have no separate tool switch: opening the step shows its details and its own records together.
  expect(wrapper.find(".loop-timeline-item .loop-trace-toggle").exists()).toBe(false);
  expect(wrapper.find(".loop-tool-trace").exists()).toBe(false);
  const stepRecords = async (stepIndex: number, segment: typeof first) => {
    const item = segment.findAll(".loop-timeline-item")[stepIndex];
    await item.find(".loop-activity-header").trigger("click");
    return item;
  };

  const evidenceStep = await stepRecords(0, first);
  expect(evidenceStep.find(".loop-question-row").text()).toContain("orders-by-region");
  const evidence = evidenceStep.find(".loop-tool-trace").text();
  expect(evidence).toContain("collect_evidence");
  expect(evidence).toContain("evidence-result");
  await evidenceStep.find(".loop-activity-header").trigger("click");
  expect(evidenceStep.find(".loop-question-row").exists()).toBe(false);
  expect(evidenceStep.find(".loop-tool-trace").exists()).toBe(false);
  await evidenceStep.find(".loop-activity-header").trigger("click");
  const probe = (await stepRecords(0, second)).find(".loop-tool-trace").text();
  expect(probe).toContain("probe-result");
  expect(probe).not.toContain("ext-result");
  expect(probe).not.toContain("read_skill_file");
  const ext = (await stepRecords(1, second)).find(".loop-tool-trace").text();
  expect(ext).toContain("ext-arg");
  expect(ext).toContain("ext-result");
  expect(ext).not.toContain("probe-result");

  // The call with no business activity is not claimed by any step and appears only in the first stretch.
  expect(second.find(".loop-other-tools").exists()).toBe(false);
  await first.find(".loop-other-tools .loop-trace-toggle").trigger("click");
  expect(first.find(".loop-other-tools").text()).toContain("skill-file-result");
  expect(first.find(".loop-other-tools").text()).not.toContain("probe-result");

  const text = wrapper.text();
  for (const value of ["evidence-result", "probe-result", "ext-result", "skill-file-result", "stage-summary-one"]) {
    expect(occurrences(text, value)).toBe(1);
  }
  expect(occurrences(text, "final-reply")).toBe(1);
  expect(wrapper.findAll(".loop-process")).toHaveLength(2);
});

// Public surface under test: a regular continuous session does not switch by run history; observable result: all turns and activities stay present,
// the unfinished turn's streaming tail is still visible, and the "can continue" flag the store gives the input is true.
it("keeps every turn visible for a regular conversation with run history", () => {
  seed({
    messages: [
      { id: 1, role: "user", content: "first-question" },
      answerMessage(2, "first-answer", "first-round-writing"),
      { id: 3, role: "user", content: "second-question" },
      answerMessage(4, "second-answer", "second-round-writing"),
      { id: 5, role: "user", content: "third-question" },
    ],
    streamingSnapshot: streamingExecution([activity("third-round-in-progress")]),
    runs: [
      { id: "run-1", status: "completed", resultReport: "first-run-body" },
      { id: "run-2", status: "completed", resultReport: "second-run-body" },
    ],
    runIndex: 0,
  });
  const store = useAnalysisStore();
  const wrapper = render();
  const text = wrapper.text();

  expect(text).toContain("first-question");
  expect(text).toContain("second-question");
  expect(text).toContain("first-round-writing");
  expect(text).toContain("second-round-writing");
  expect(text).toContain("third-question");
  expect(text).toContain("third-round-in-progress");
  expect(store.isSelectedLatestRun).toBe(true);
  expect(store.displayStreamingSnapshot?.mode).toBe("deep-analysis");
  store.sessions["task-1"].isLoading = true;
  expect(store.displayIsLoading).toBe(true);
  expect(text).not.toContain("first-run-body");
  expect(wrapper.find(".typing-cursor, .streaming-dots").exists()).toBe(false);
});

// Public surface under test: one report-task execution plus a standard follow-up; observable result: the report body stays in the report view and the follow-up renders as-is.
it("keeps one execution block plus standard follow-up turns for a report task", () => {
  seed({
    report: true,
    messages: [
      { id: 1, role: "user", content: "report-question" },
      answerMessage(2, "report-body-ABC", "report-round-activity", {
        sections: [{ sectionId: "s1", order: 0, revision: 1, markdown: "report-body-ABC" }],
      }),
      { id: 3, role: "user", content: "follow-up-question" },
      {
        id: 4,
        role: "assistant",
        content: "follow-up-answer",
        snapshot: {
          mode: "standard",
          status: "completed",
          source: "history",
          primaryText: "follow-up-answer",
        },
      },
    ],
  });
  const wrapper = render();
  const text = wrapper.text();

  expect(text).toContain("report-question");
  expect(text).toContain("report-round-activity");
  expect(wrapper.find(".follow-up-divider").exists()).toBe(true);
  expect(text).toContain("follow-up-question");
  expect(text).toContain("follow-up-answer");
  expect(text).not.toContain("report-body-ABC");
});

// The report turn closes with its completion notice when a report artifact exists; the turn's diagnosis entry follows as a secondary tool.
it("ends a completed report turn with the completion notice, then this turn's diagnosis entry", () => {
  const answer = answerMessage(2, "final-answer", "closing-activity", {
    sections: [{ sectionId: "report", order: 0, revision: 1, markdown: "report-markdown", status: "success" }],
  });
  answer.snapshot = { ...answer.snapshot!, threadId: "thread-1", requestSeq: 4 };
  seed({
    report: true,
    messages: [{ id: 1, role: "user", content: "question" }, answer],
  });

  const html = render(true).html();
  const notice = html.indexOf("completed-notice");
  const diagnose = html.indexOf("turn-diagnose-btn");
  expect(notice).toBeGreaterThan(-1);
  expect(diagnose).toBeGreaterThan(notice);
});

it("does not show the report completion notice for a loop report run without report sections, and shows failure notice before diagnosis on failure", () => {
  const emptyReport = answerMessage(2, "", "loop-activity", { sections: [] });
  emptyReport.snapshot = { ...emptyReport.snapshot!, threadId: "thread-1", requestSeq: 1 };
  seed({
    report: true,
    messages: [{ id: 1, role: "user", content: "question" }, emptyReport],
  });
  expect(render(true).find(".completed-notice").exists()).toBe(false);

  const failedTurn = answerMessage(2, "", "loop-activity", {
    runState: { ...runState("failed", 1), error: "upstream-timeout" },
  });
  failedTurn.snapshot = { ...failedTurn.snapshot!, threadId: "thread-1", requestSeq: 2 };
  seed({
    report: false,
    messages: [{ id: 1, role: "user", content: "question" }, failedTurn],
  });
  const wrapper = render(true);
  expect(wrapper.find(".failed-notice").text()).toContain("Analysis Failed");
  expect(wrapper.find(".failed-notice").text()).toContain("upstream-timeout");
  const html = wrapper.html();
  expect(html.indexOf("turn-diagnose-btn")).toBeGreaterThan(html.indexOf("failed-notice"));
});

// Public surface under test: Q2 narrow narrative deduplication; observable result: only a finished regular turn's trailing narrative identical to finalAnswer is deduplicated, while middle narrations and differing texts are kept.
it("deduplicates only a finished regular turn's trailing narrative when identical to finalAnswer, preserving middle narrations and differing texts", async () => {
  const originalActivities: AnalysisActivity[] = [
    {
      activityId: "narr-middle",
      seq: 1,
      revision: 1,
      kind: "narrative",
      status: "completed",
      startedAt: 1,
      narrative: "middle-narration-text",
    },
    {
      activityId: "probe-1",
      seq: 2,
      revision: 1,
      kind: "probe",
      status: "completed",
      startedAt: 2,
      probeTool: "probe_class_data",
      probeArguments: { className: "Orders" },
    },
    {
      activityId: "narr-final",
      seq: 3,
      revision: 1,
      kind: "narrative",
      status: "completed",
      startedAt: 3,
      narrative: "identical-final-answer",
    },
  ];
  const turnSame = answerMessage(2, "identical-final-answer", "unused", {
    activities: originalActivities,
    finalAnswer: "identical-final-answer",
  });
  const turnDiff = answerMessage(4, "distinct-final-answer", "distinct-trailing-narrative");

  seed({
    report: false,
    messages: [
      { id: 1, role: "user", content: "q1" },
      turnSame,
      { id: 3, role: "user", content: "q2" },
      turnDiff,
    ],
  });

  const wrapper = render();
  await openProcesses(wrapper);
  const text = wrapper.text();

  // Middle narration and probe summary are preserved; trailing duplicate narrative is carried once by the assistant bubble.
  expect(text).toContain("middle-narration-text");
  expect(text).toContain("probe_class_data");
  expect(text).toContain('{"className":"Orders"}');
  expect(occurrences(text, "identical-final-answer")).toBe(1);
  // Underlying payload activities are not mutated.
  expect(turnSame.snapshot?.deepAnalysis?.activities).toHaveLength(3);

  // Differing trailing narrative and finalAnswer are both kept.
  expect(text).toContain("distinct-trailing-narrative");
  expect(occurrences(text, "distinct-final-answer")).toBe(1);
});

it("renders chart references from each regular turn's own artifacts in both narrative and final answer", () => {
  const chart = (html: string) => ({
    chartId: "report-3-1", scopeId: "summary", title: "Sales", chartType: "line",
    sourceSubQuestion: "Daily sales", skillId: "echarts", dataCount: 31, html,
  });
  const firstHtml = '<div class="chart-container">first-turn-chart</div>';
  const secondHtml = '<div class="chart-container">second-turn-chart</div>';
  seed({
    report: false,
    messages: [
      { id: 1, role: "user", content: "first" },
      answerMessage(2, "Sales\n\n[chart:summary:report-3-1]\n\nConclusion", "first-stage", { charts: [chart(firstHtml)] }),
      { id: 3, role: "user", content: "second" },
      answerMessage(4, "second-answer", "Stage\n\n[chart:summary:report-3-1]", { charts: [chart(secondHtml)] }),
    ],
  });
  const wrapper = render();
  const frames = wrapper.findAll("iframe.message-chart");
  expect(frames).toHaveLength(2);
  expect(frames.map(frame => frame.attributes("srcdoc"))).toEqual([firstHtml, secondHtml]);
  expect(wrapper.text()).not.toContain("[chart:");
  expect(wrapper.text()).toContain("Conclusion");
});

it("renders loop narrative as the body and workerSummary as safe Markdown without executing raw HTML, with L1 tool summaries in the process", async () => {
  seed({
    report: false,
    messages: [
      { id: 1, role: "user", content: "question" },
      answerMessage(2, "final-reply", "unused", {
        activities: [
          {
            activityId: "narr-md",
            seq: 1,
            revision: 1,
            kind: "narrative",
            status: "completed",
            startedAt: 1,
            narrative: "**Bold narrative** with <img src=x onerror=alert(1)>",
          },
          {
            activityId: "ext-mcp",
            seq: 2,
            revision: 1,
            kind: "external_tool",
            status: "failed",
            startedAt: 2,
            serviceName: "erp-service",
            toolName: "sync_order",
            error: "mcp-connection-reset",
          },
          {
            activityId: "disp-md",
            seq: 3,
            revision: 1,
            kind: "dispatch",
            status: "completed",
            startedAt: 3,
            topic: "check-channel",
            workerSummary: "**Worker bold** with <img src=x onerror=alert(2)>",
          },
        ],
      }),
    ],
  });

  const wrapper = render();
  expect(wrapper.find(".loop-content .loop-narrative strong").text()).toBe("Bold narrative");
  expect(wrapper.find(".loop-narrative img").exists()).toBe(false);
  await openProcesses(wrapper);
  expect(wrapper.text()).toContain("erp-service");
  expect(wrapper.text()).toContain("sync_order");
  expect(wrapper.text()).toContain("mcp-connection-reset");

  await wrapper.find(".loop-activity-header:not([disabled])").trigger("click");
  expect(wrapper.find(".loop-worker-summary strong").text()).toBe("Worker bold");
  expect(wrapper.find(".loop-worker-summary img").exists()).toBe(false);
});

// Public surface under test: dimension orchestration baseline structure; observable result: running shows 4 step cards + compact thinking-tree, completed shows 4 step cards + DeepAnalysisResult compact.
it("preserves the baseline dimension orchestration structure for running and completed runs", async () => {
  const dimActivities: AnalysisActivity[] = [
    {
      activityId: "plan-1",
      seq: 1,
      revision: 1,
      kind: "plan",
      status: "completed",
      startedAt: 1,
      dimensions: [
        {
          dimensionId: "d1",
          name: "Regional Sales",
          reason: "Check regional breakdown",
          questions: [{ questionId: "q1", question: "East region sales?" }],
        },
      ],
    },
    {
      activityId: "ev-d1",
      seq: 2,
      revision: 1,
      kind: "evidence",
      groupId: "d1",
      status: "running",
      startedAt: 2,
      questions: [{ questionId: "q1", question: "East region sales?", status: "running" }],
    },
  ];

  seed({
    report: true,
    messages: [{ id: 1, role: "user", content: "dimension-topic" }],
    streamingSnapshot: {
      mode: "deep-analysis",
      status: "streaming",
      source: "live",
      primaryText: "",
      deepAnalysis: {
        executionMode: "dimension",
        runState: { status: "running", revision: 1, progress: { done: 20, total: 100, label: "Collecting metrics" } },
        activities: dimActivities,
        sections: [],
        charts: [],
        chartDiagnostics: [],
      },
    },
  });

  const wrapper = render();
  expect(wrapper.findAll(".step-card")).toHaveLength(4);
  expect(wrapper.find(".thinking-tree .tree-dimension").text()).toContain("1. Regional Sales");
  expect(wrapper.find("deep-analysis-result-stub").exists()).toBe(false);

  // Transition to completed: mounts DeepAnalysisResult with compact=true and shows completed-notice.
  const session = useAnalysisStore().sessions["task-1"];
  session.streamingSnapshot = null;
  session.messages = [
    { id: 1, role: "user", content: "dimension-topic" },
    {
      id: 2,
      role: "assistant",
      content: "",
      snapshot: {
        mode: "deep-analysis",
        status: "completed",
        source: "history",
        primaryText: "",
        deepAnalysis: {
          executionMode: "dimension",
          runState: { status: "completed", revision: 2, progress: { done: 100, total: 100, label: "" } },
          activities: dimActivities,
          sections: [{ sectionId: "summary", order: 0, revision: 1, markdown: "summary", status: "success" }],
          charts: [],
          chartDiagnostics: [],
        },
      },
    },
  ];
  await nextTick();

  expect(wrapper.findAll(".step-card")).toHaveLength(4);
  expect(wrapper.find("deep-analysis-result-stub").exists()).toBe(true);
  expect(wrapper.find(".completed-notice").exists()).toBe(true);
});

it("reads a regular turn's deferred query facts from that turn's own requestSeq", async () => {
  const deferredTurn = (question: string) =>
    execution([
      {
        activityId: `evidence-${question}`,
        seq: 1,
        revision: 1,
        kind: "evidence",
        status: "completed",
        startedAt: 1,
        questions: [
          { questionId: question, question, status: "completed", execution: {}, executionDeferred: true },
        ],
      },
    ]);
  seed({
    messages: [
      { id: 1, role: "user", content: "first" },
      {
        id: 2,
        role: "assistant",
        content: "a1",
        snapshot: {
          mode: "deep-analysis",
          status: "completed",
          source: "history",
          primaryText: "a1",
          requestSeq: 3,
          deepAnalysis: deferredTurn("q-first"),
        },
      },
      { id: 3, role: "user", content: "second" },
      {
        id: 4,
        role: "assistant",
        content: "a2",
        snapshot: {
          mode: "deep-analysis",
          status: "completed",
          source: "history",
          primaryText: "a2",
          requestSeq: 5,
          deepAnalysis: deferredTurn("q-second"),
        },
      },
    ],
  });
  const wrapper = render();
  await openProcesses(wrapper);
  const headers = wrapper.findAll(".loop-activity-header");
  await headers[1].trigger("click");

  expect(getQuestionExecution).toHaveBeenCalledTimes(1);
  expect(getQuestionExecution).toHaveBeenCalledWith("task-1", "q-second", {
    runId: undefined,
    requestSeq: 5,
  });
});

it("keeps the user's L2 expansion when a live turn settles into history with rebuilt message ids", async () => {
  const liveActivities: AnalysisActivity[] = [
    {
      activityId: "dispatch-live",
      seq: 1,
      revision: 1,
      kind: "dispatch",
      status: "completed",
      startedAt: 1,
      topic: "live-dispatch-topic",
      workerSummary: "live-worker-summary",
    },
  ];
  seed({
    messages: [{ id: 1_700_000_000_000, role: "user", content: "question" }],
    streamingSnapshot: {
      mode: "deep-analysis",
      status: "streaming",
      source: "live",
      primaryText: "",
      requestSeq: 7,
      deepAnalysis: execution(liveActivities, { runState: runState("running", 1) }),
    },
  });
  const wrapper = render();
  await openProcesses(wrapper);
  await wrapper.find(".loop-activity-header").trigger("click");
  expect(wrapper.text()).toContain("live-worker-summary");

  // Turn history replaces the live ids with 1-based ids, and a later reload rebuilds them again.
  const session = useAnalysisStore().sessions["task-1"];
  for (const ids of [
    [1, 2],
    [1_800_000_000_000, 1_800_000_000_001],
  ]) {
    session.streamingSnapshot = null;
    session.messages = [
      { id: ids[0], role: "user", content: "question" },
      {
        id: ids[1],
        role: "assistant",
        content: "final-answer",
        snapshot: {
          mode: "deep-analysis",
          status: "completed",
          source: "history",
          primaryText: "final-answer",
          requestSeq: 7,
          deepAnalysis: execution(liveActivities, { finalAnswer: "final-answer" }),
        },
      },
    ];
    await nextTick();

    expect(wrapper.text()).toContain("live-worker-summary");
  }
});

it("does not carry L2 expansion or L3 worker traces between historical runs that reuse activity ids", async () => {
  const dispatchRun = (runId: string) =>
    execution([
      {
        activityId: "dispatch-1",
        seq: 1,
        revision: 1,
        kind: "dispatch",
        status: "completed",
        startedAt: 1,
        topic: `topic-${runId}`,
      },
    ]);
  getRunSnapshot.mockImplementation(async (_taskId: string, runId: string) => ({
    mode: "deep-analysis",
    status: "completed",
    source: "history",
    primaryText: "",
    deepAnalysis: dispatchRun(runId),
  }));
  getLoopSubagentTrace.mockResolvedValue({
    messages: [{ role: "assistant", content: [{ type: "text", text: "worker-trace-text" }] }],
  });
  seed({
    report: true,
    messages: [
      { id: 1, role: "user", content: "question" },
      {
        id: 2,
        role: "assistant",
        content: "",
        snapshot: {
          mode: "deep-analysis",
          status: "completed",
          source: "history",
          primaryText: "",
          requestSeq: 2,
          deepAnalysis: dispatchRun("run-latest"),
        },
      },
    ],
    runs: [
      { id: "run-a", status: "completed", requestSeq: 1 },
      { id: "run-b", status: "completed", requestSeq: 1 },
      { id: "run-latest", status: "completed", requestSeq: 2 },
    ],
    runIndex: 2,
  });
  const store = useAnalysisStore();
  await store.selectRun(0);
  const wrapper = render();
  await openProcesses(wrapper);
  await wrapper.find(".loop-activity-header").trigger("click");
  await wrapper.find(".loop-dispatch-detail .loop-trace-toggle").trigger("click");
  await flushPromises();
  expect(wrapper.text()).toContain("topic-run-a");
  expect(wrapper.text()).toContain("worker-trace-text");

  await store.selectRun(1);
  await flushPromises();
  // Another run starts with its own collapsed process.
  expect(wrapper.find(".loop-process-toggle").attributes("aria-expanded")).toBe("false");
  await openProcesses(wrapper);
  expect(wrapper.text()).toContain("topic-run-b");
  expect(wrapper.find(".loop-dispatch-detail").exists()).toBe(false);
  expect(wrapper.text()).not.toContain("worker-trace-text");

  await wrapper.find(".loop-activity-header").trigger("click");
  expect(wrapper.text()).not.toContain("worker-trace-text");
  await wrapper.find(".loop-dispatch-detail .loop-trace-toggle").trigger("click");
  await flushPromises();
  expect(getLoopSubagentTrace).toHaveBeenCalledTimes(2);

  await store.selectRun(2);
  await nextTick();
  await openProcesses(wrapper);
  expect(wrapper.text()).toContain("topic-run-latest");
  expect(wrapper.find(".loop-dispatch-detail").exists()).toBe(false);
  expect(wrapper.text()).not.toContain("worker-trace-text");
});

// Public surface under test: the conversation area's loading placeholder; observable result: it shows only while a
// selected task's saved conversation is being read, and an idle empty view (no task, empty or failed read) stays static.
describe("conversation loading placeholder", () => {
  it("stays static with no task selected", () => {
    const store = useAnalysisStore();
    store.agents = [agent(false)];
    store.selectedAgentId = "agent-1";
    store.tasks = [];
    store.currentTaskId = null;
    store.sessions = {};
    const wrapper = render();
    expect(wrapper.find(".el-skeleton").exists()).toBe(false);
    expect(wrapper.find(".messages-scroll").exists()).toBe(true);
  });

  it.each([
    ["an empty history", (finish: Deferred) => finish.resolve([])],
    ["a failed read", (finish: Deferred) => finish.reject(new Error("history unavailable"))],
  ])("shows loading while the history is read and stops after %s", async (_case, settle) => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    let finish!: Deferred;
    getTurns.mockReturnValue(
      new Promise((resolve, reject) => {
        finish = { resolve, reject };
      })
    );
    const store = useAnalysisStore();
    store.agents = [agent(false)];
    store.selectedAgentId = "agent-1";
    const empty = taskFixture({ question: "" });
    store.tasks = [empty];
    store.currentTaskId = empty.id;
    const wrapper = render();
    const opening = store.openSession(empty);
    await nextTick();
    expect(wrapper.find(".el-skeleton").exists()).toBe(true);

    settle(finish);
    await opening;
    await nextTick();
    expect(wrapper.find(".el-skeleton").exists()).toBe(false);
  });
});

interface Deferred {
  resolve: (value: unknown) => void;
  reject: (reason: unknown) => void;
}
