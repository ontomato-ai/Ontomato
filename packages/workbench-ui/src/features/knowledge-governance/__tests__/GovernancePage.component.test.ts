import { mount, flushPromises } from "@vue/test-utils";
import { createRouter, createMemoryHistory } from "vue-router";
import { createI18n } from "vue-i18n";
import { afterEach, describe, expect, it, vi } from "vitest";
import GovernancePage from "../GovernancePage.vue";
import en from "../../../locales/en";
import type {
  GovernanceSession,
  GovernanceStreamEvent,
} from "@ontomato/contracts/knowledge-governance";
import { governanceApi } from "../api";
import { ApiRequestError } from "../../../utils/api";

vi.mock("../api", () => ({
  governanceApi: {
    list: vi.fn(),
    read: vi.fn(),
    start: vi.fn(),
    respond: vi.fn(),
    stream: vi.fn(),
    stop: vi.fn(),
    source: vi.fn(),
  },
}));
const firstId = "00000000-0000-4000-8000-000000000001";
const secondId = "00000000-0000-4000-8000-000000000002";
function session(id = firstId): GovernanceSession {
  return {
    id,
    domainId: "a",
    initiatorId: "initiator",
    createdAt: "2026-09-10T01:00:00Z",
    updatedAt: "2026-09-10T01:00:00Z",
    revision: 1,
    status: "idle",
    activeTurnId: null,
    messages: [{ role: "assistant", content: "Which date applies to new postdocs?" }],
    error: null,
    work: {
      summary: "One date scope needs clarification",
      notes: "",
      reviewedKnowledgeIds: ["k1"],
      knowledgeTotal: 1,
      sources: [
        {
          id: "s1",
          kind: "knowledge",
          target: "k1",
          title: "Date definition",
          excerpt: "Reporting date",
        },
      ],
      issues: [
        {
          id: "i1",
          category: "knowledge",
          status: "pending",
          title: "Postdoc dates",
          problem: "Two dates overlap",
          before: "Campus or reporting date",
          after: "Clarify reporting-date scope",
          basis: "Two original rules",
          sourceIds: ["s1"],
        },
      ],
    },
  };
}
function running(id = firstId, turnId = "t1"): GovernanceSession {
  return { ...session(id), status: "running", activeTurnId: turnId, revision: 2 };
}
/** Resolves only when the test says so, to hold an exchange across an async boundary. */
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
/** A controllable SSE body numbered from `firstSeq`, like the server's replay buffer. */
function sse(firstSeq = 1) {
  const encoder = new TextEncoder();
  let seq = firstSeq;
  let controller!: ReadableStreamDefaultController<Uint8Array>;
  const body = new ReadableStream<Uint8Array>({
    start(value) {
      controller = value;
    },
  });
  return {
    response: new Response(body, { headers: { "content-type": "text/event-stream" } }),
    push(...events: GovernanceStreamEvent[]) {
      for (const event of events)
        controller.enqueue(encoder.encode(`id: ${seq++}\ndata: ${JSON.stringify(event)}\n\n`));
    },
    /** Like the server, the no-tail answer carries no sequence id and ends the body. */
    unavailable() {
      controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: "response_unavailable" })}\n\n`));
      controller.close();
    },
    close() {
      controller.close();
    },
  };
}
const wrappers: ReturnType<typeof mount>[] = [];
async function open(id = firstId, query = "") {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      {
        name: "KnowledgeGovernance",
        path: "/admin/knowledge-governance/:sessionId?",
        component: GovernancePage,
      },
      { path: "/admin/:page(.*)", component: { template: "<p>Admin page</p>" } },
    ],
  });
  await router.push(`/admin/knowledge-governance/${id}${query}`);
  await router.isReady();
  const wrapper = mount(GovernancePage, {
    global: { plugins: [router, createI18n({ legacy: false, locale: "en", messages: { en } })] },
  });
  wrappers.push(wrapper);
  await flushPromises();
  return { wrapper, router };
}
function button(wrapper: ReturnType<typeof mount>, text: string) {
  return wrapper.findAll("button").find((item) => item.text().includes(text))!;
}
function streamSignal(call: number) {
  return vi.mocked(governanceApi.stream).mock.calls[call]![3];
}
afterEach(() => {
  for (const wrapper of wrappers.splice(0)) wrapper.unmount();
  vi.clearAllMocks();
});

describe("governance page contract", () => {
  it("replaces a resumed snapshot before appending its tail, without duplicating the reply",async()=>{
    const turnId="00000000-0000-4000-8000-000000000003";
    const current=running(firstId,turnId),stream=sse();
    vi.mocked(governanceApi.list).mockResolvedValue([]);
    vi.mocked(governanceApi.read).mockResolvedValue(current);
    vi.mocked(governanceApi.stream).mockResolvedValue(stream.response);
    const {wrapper}=await open(firstId);
    const messages=[{role:"user" as const,content:"Question"},{role:"assistant" as const,content:"A saved reply"}];
    stream.push({type:"snapshot",runId:turnId,messages,work:current.work},{type:"token",content:" continues"});
    await flushPromises();expect(wrapper.text()).toContain("A saved reply continues");
    stream.push({type:"snapshot",runId:turnId,messages:[messages[0]!,{role:"assistant",content:"A saved reply continues"}],work:current.work},{type:"token",content:"."});
    await flushPromises();expect(wrapper.text()).toContain("A saved reply continues.");
    expect(wrapper.text().split("A saved reply")).toHaveLength(2);
  });
  it("opens directly writable, runs nothing until the first message, then shows live text and tools once", async () => {
    vi.mocked(governanceApi.list).mockReturnValue(new Promise(() => {}));
    const { wrapper, router } = await open("");
    const textarea = wrapper.get("textarea");
    expect(textarea.attributes("disabled")).toBeUndefined();
    expect(governanceApi.start).not.toHaveBeenCalled();
    expect(governanceApi.stream).not.toHaveBeenCalled();

    const created = running();
    created.messages = [];
    created.work = { ...created.work, issues: [], reviewedKnowledgeIds: [], knowledgeTotal: null };
    vi.mocked(governanceApi.start).mockResolvedValue(created);
    const live = sse();
    vi.mocked(governanceApi.stream).mockResolvedValue(live.response);
    await textarea.setValue("Is the reporting date rule complete?");
    await textarea.trigger("keydown", { key: "Enter" });
    await flushPromises();
    expect(governanceApi.start).toHaveBeenCalledTimes(1);
    expect(governanceApi.start).toHaveBeenCalledWith(
      "Is the reporting date rule complete?",
      expect.any(AbortSignal)
    );
    expect(router.currentRoute.value.params.sessionId).toBe(firstId);
    expect(governanceApi.stream).toHaveBeenCalledWith(firstId, "t1", 0, expect.any(AbortSignal));

    live.push(
      { type: "response_started", message: "Is the reporting date rule complete?" },
      { type: "token", content: "Checking the rule." },
      { type: "tool_start", toolCallId: "call-1", tool: "read_knowledge", args: { offset: 0 } }
    );
    await flushPromises();
    expect(wrapper.text()).toContain("Checking the rule.");
    expect(wrapper.get(".agent-tool__name").text()).toBe("read_knowledge");
    expect(wrapper.text()).toContain(en.diagnosis.executing);
    await wrapper.get(".agent-tool__header").trigger("keydown", { key: "Enter" });
    expect(wrapper.get(".agent-tool__detail").text()).toContain('"offset": 0');

    const settled = session();
    settled.revision = 3;
    settled.messages = [
      { role: "user", content: "Is the reporting date rule complete?" },
      {
        role: "assistant",
        content: "Checking the rule.",
        segments: [
          { type: "text", content: "Checking the rule." },
          {
            type: "tool_call",
            toolCallId: "call-1",
            tool: "read_knowledge",
            args: '{\n  "offset": 0\n}',
            result: { content: [{ type: "text", text: "Rule text" }] },
            isError: false,
            status: "done",
          },
        ],
      },
    ];
    vi.mocked(governanceApi.read).mockResolvedValue(settled);
    live.push(
      {
        type: "tool_end",
        toolCallId: "call-1",
        tool: "read_knowledge",
        result: { content: [{ type: "text", text: "Rule text" }] },
        isError: false,
      },
      { type: "work", work: settled.work },
      { type: "response_end", status: "completed" }
    );
    await flushPromises();
    // Navigating to the new round did not reload it; only the settled history is read.
    expect(governanceApi.read).toHaveBeenCalledTimes(1);
    expect(wrapper.text().split("Is the reporting date rule complete?")).toHaveLength(2);
    expect(wrapper.findAll(".agent-tool")).toHaveLength(1);
    expect(wrapper.text()).toContain(en.common.complete);
    expect(wrapper.text()).toContain("Reviewed 1 of 1 knowledge entries");
  });

  it("sends the Start checking suggestion as the first user message", async () => {
    vi.mocked(governanceApi.list).mockResolvedValue([]);
    vi.mocked(governanceApi.start).mockResolvedValue(running());
    vi.mocked(governanceApi.stream).mockResolvedValue(sse().response);
    const { wrapper } = await open("");
    await button(wrapper, en.governance.startCheck).trigger("click");
    await flushPromises();
    expect(governanceApi.start).toHaveBeenCalledWith(
      en.governance.startCheck,
      expect.any(AbortSignal)
    );
    expect(governanceApi.respond).not.toHaveBeenCalled();
  });

  it("shows a saved question, report and original source and accepts free-text clarification", async () => {
    vi.mocked(governanceApi.list).mockResolvedValue([]);
    vi.mocked(governanceApi.read).mockResolvedValueOnce(session());
    vi.mocked(governanceApi.respond).mockResolvedValue(running());
    const live = sse();
    vi.mocked(governanceApi.stream).mockResolvedValue(live.response);
    vi.mocked(governanceApi.source).mockResolvedValue({
      source: session().work.sources[0]!,
      page: {
        items: [
          {
            id: "k1",
            title: "Date definition",
            text: "Original reporting date rule",
            start: 0,
            end: 28,
            totalChars: 28,
          },
        ],
        totalItems: 1,
        matchedItems: 1,
        next: null,
      },
    });
    const { wrapper } = await open();
    expect(wrapper.text()).toContain("Which date applies to new postdocs?");
    await button(wrapper, "Report").trigger("click");
    expect(wrapper.text()).toContain("Clarify reporting-date scope");
    await button(wrapper, "Date definition").trigger("click");
    await flushPromises();
    expect(wrapper.text()).toContain("Original reporting date rule");
    await wrapper.get("textarea").setValue("Reporting date, but only for new postdocs.");
    await wrapper.get(".chat-input-action").trigger("click");
    await flushPromises();
    expect(governanceApi.respond).toHaveBeenCalledWith(
      firstId,
      "Reporting date, but only for new postdocs.",
      expect.any(AbortSignal)
    );
    expect(wrapper.get<HTMLTextAreaElement>("textarea").element.value).toBe("");

    const next = session();
    next.revision = 3;
    next.work.issues[0]!.status = "confirmed";
    next.messages.push(
      { role: "user", content: "Reporting date, but only for new postdocs." },
      { role: "assistant", content: "The proposal now uses reporting date." }
    );
    vi.mocked(governanceApi.read).mockResolvedValueOnce(next);
    live.push(
      { type: "response_started", message: "Reporting date, but only for new postdocs." },
      { type: "token", content: "The proposal now uses reporting date." },
      { type: "response_end", status: "completed" }
    );
    await flushPromises();
    expect(wrapper.text()).toContain("The proposal now uses reporting date.");
    expect(wrapper.text().split("The proposal now uses reporting date.")).toHaveLength(2);
  });

  it("resumes a running round from replay without duplicating history or replaying tools", async () => {
    vi.mocked(governanceApi.list).mockResolvedValue([]);
    const current = running();
    current.messages.push({ role: "user", content: "Earlier answer" });
    vi.mocked(governanceApi.read).mockResolvedValueOnce(current);
    const first = sse();
    const second = sse(3);
    vi.mocked(governanceApi.stream)
      .mockResolvedValueOnce(first.response)
      .mockResolvedValueOnce(second.response);
    const { wrapper } = await open();
    first.push(
      { type: "response_started", message: "Current question" },
      { type: "tool_start", toolCallId: "call-1", tool: "query", args: { text: "date" } }
    );
    first.close();
    await flushPromises();
    await vi.waitFor(() => expect(governanceApi.stream).toHaveBeenCalledTimes(2));
    expect(governanceApi.stream).toHaveBeenLastCalledWith(
      firstId,
      "t1",
      2,
      expect.any(AbortSignal)
    );

    const settled = session();
    settled.revision = 4;
    settled.messages.push(
      { role: "user", content: "Earlier answer" },
      { role: "user", content: "Current question" },
      {
        role: "assistant",
        content: "",
        segments: [
          {
            type: "tool_call",
            toolCallId: "call-1",
            tool: "query",
            args: '{\n  "text": "date"\n}',
            result: { content: [] },
            isError: false,
            status: "done",
          },
        ],
      }
    );
    vi.mocked(governanceApi.read).mockResolvedValueOnce(settled);
    second.push(
      { type: "tool_end", toolCallId: "call-1", tool: "query", result: { content: [] }, isError: false },
      { type: "response_end", status: "completed" }
    );
    await flushPromises();
    for (const text of ["Earlier answer", "Current question"])
      expect(wrapper.text().split(text)).toHaveLength(2);
    expect(wrapper.findAll(".agent-tool")).toHaveLength(1);
  });

  it("ignores late reads and stream events from a previous round and navigation never sends Stop", async () => {
    vi.mocked(governanceApi.list).mockResolvedValue([]);
    const old = sse();
    vi.mocked(governanceApi.stream).mockResolvedValue(old.response);
    const next = session(secondId);
    next.messages[0]!.content = "Current round question";
    vi.mocked(governanceApi.read).mockImplementation((id) =>
      Promise.resolve(id === firstId ? running() : next)
    );
    const { wrapper, router } = await open();
    expect(governanceApi.stream).toHaveBeenCalledTimes(1);
    await router.push(`/admin/knowledge-governance/${secondId}`);
    await flushPromises();
    expect(streamSignal(0).aborted).toBe(true);
    old.push(
      { type: "response_started", message: "Old round question" },
      { type: "token", content: "Old round answer" }
    );
    await flushPromises();
    expect(wrapper.text()).toContain("Current round question");
    expect(wrapper.text()).not.toContain("Old round");
    wrapper.unmount();
    expect(governanceApi.stop).not.toHaveBeenCalled();
  });

  it("a settled turn saved per model iteration reads as one run of tool calls, as it did live", async () => {
    const tool = (id: string) => ({
      type: "tool_call" as const,
      toolCallId: id,
      tool: "read_knowledge",
      args: "{}",
      status: "done" as const,
    });
    const saved = session();
    saved.messages = [
      { role: "user", content: "Check revenue rules" },
      { role: "assistant", content: "Looking.", segments: [{ type: "text", content: "Looking." }, tool("c1")] },
      ...["c2", "c3", "c4", "c5"].map((id) => ({ role: "assistant" as const, content: "", segments: [tool(id)] })),
      { role: "assistant", content: "Which date?", segments: [{ type: "text", content: "Which date?" }] },
    ];
    vi.mocked(governanceApi.list).mockResolvedValue([]);
    vi.mocked(governanceApi.read).mockResolvedValue(saved);
    const { wrapper } = await open();
    expect(wrapper.findAll(".agent-msg--assistant")).toHaveLength(1);
    expect(wrapper.findAll(".agent-step--group")).toHaveLength(1);
    expect(wrapper.get(".agent-step--group").text()).toContain("5 tool calls");
    expect(wrapper.text().indexOf("Looking.")).toBeLessThan(wrapper.text().indexOf("5 tool calls"));
    expect(wrapper.text().indexOf("5 tool calls")).toBeLessThan(wrapper.text().indexOf("Which date?"));
  });

  it("Back returns to the from page and switching rounds keeps from; without a valid from it returns to system agents", async () => {
    vi.mocked(governanceApi.list).mockResolvedValue([
      { id: secondId, createdAt: "2026-09-10T02:00:00Z", updatedAt: "2026-09-10T02:00:00Z", status: "idle" },
    ]);
    vi.mocked(governanceApi.read).mockImplementation((id) => Promise.resolve(session(id)));
    const from = "/admin/ontology-manager?view=knowledge";
    const { wrapper, router } = await open(firstId, `?from=${encodeURIComponent(from)}`);
    await wrapper.get("summary").trigger("click");
    await wrapper.get(".kg-history a").trigger("click");
    await flushPromises();
    expect(router.currentRoute.value.params.sessionId).toBe(secondId);
    expect(router.currentRoute.value.query.from).toBe(from);
    await wrapper.get(`[aria-label="${en.governance.back}"]`).trigger("click");
    await flushPromises();
    expect(router.currentRoute.value.fullPath).toBe(from);

    for (const query of ["", "?from=https://example.com/admin/"]) {
      const direct = await open(firstId, query);
      await direct.wrapper.get(`[aria-label="${en.governance.back}"]`).trigger("click");
      await flushPromises();
      expect(direct.router.currentRoute.value.path).toBe("/admin/system-agents");
    }
  });

  it("explicit Stop is distinct from detaching a running page", async () => {
    vi.mocked(governanceApi.list).mockResolvedValue([]);
    vi.mocked(governanceApi.read).mockResolvedValue(running());
    vi.mocked(governanceApi.stream).mockResolvedValue(sse().response);
    vi.mocked(governanceApi.stop).mockResolvedValue(undefined);
    const { wrapper } = await open();
    await wrapper.get(`[aria-label="${en.common.stop}"]`).trigger("click");
    await flushPromises();
    expect(governanceApi.stop).toHaveBeenCalledWith(firstId, expect.any(AbortSignal));
    expect(wrapper.text()).toContain("Stopping…");
    wrapper.unmount();
    expect(streamSignal(0).aborted).toBe(true);
    expect(governanceApi.stop).toHaveBeenCalledTimes(1);
  });
  it("switching to a new conversation while a saved round is loading is writable at once", async () => {
    vi.mocked(governanceApi.list).mockResolvedValue([]);
    vi.mocked(governanceApi.read).mockReturnValue(deferred<GovernanceSession>().promise);
    const { wrapper, router } = await open();
    expect(wrapper.find("textarea").exists()).toBe(false);
    await router.push("/admin/knowledge-governance");
    await flushPromises();
    expect(wrapper.find("textarea").exists()).toBe(true);
  });

  it("keeps text typed while a message is being sent and clears only the sent part", async () => {
    vi.mocked(governanceApi.list).mockResolvedValue([]);
    vi.mocked(governanceApi.read).mockResolvedValue(session());
    const reply = deferred<GovernanceSession>();
    vi.mocked(governanceApi.respond).mockReturnValue(reply.promise);
    vi.mocked(governanceApi.stream).mockResolvedValue(sse().response);
    const { wrapper } = await open();
    const textarea = wrapper.get("textarea");
    await textarea.setValue("Reporting date.");
    await textarea.trigger("keydown", { key: "Enter" });
    await textarea.setValue("Reporting date. Also the campus date");
    reply.resolve(running());
    await flushPromises();
    expect(textarea.element.value).toBe(" Also the campus date");
  });

  it("keeps text typed while the first message creates the round", async () => {
    vi.mocked(governanceApi.list).mockResolvedValue([]);
    const reply = deferred<GovernanceSession>();
    vi.mocked(governanceApi.start).mockReturnValue(reply.promise);
    vi.mocked(governanceApi.stream).mockResolvedValue(sse().response);
    const { wrapper, router } = await open("");
    const textarea = wrapper.get("textarea");
    await textarea.setValue("Hello");
    await textarea.trigger("keydown", { key: "Enter" });
    await textarea.setValue("Hello and another question");
    reply.resolve(running());
    await flushPromises();
    expect(router.currentRoute.value.params.sessionId).toBe(firstId);
    expect(wrapper.get<HTMLTextAreaElement>("textarea").element.value).toBe(" and another question");
  });

  it.each(["idle", "failed"] as const)(
    "shows a first response that is already %s without subscribing to a stream",
    async (status) => {
      vi.mocked(governanceApi.list).mockResolvedValue([]);
      const settled = { ...session(), status, error: status === "failed" ? "Model missing" : null };
      settled.messages = [
        { role: "user", content: "Hello" },
        { role: "assistant", content: "Hello there" },
      ];
      vi.mocked(governanceApi.start).mockResolvedValue(settled);
      const { wrapper } = await open("");
      await wrapper.get("textarea").setValue("Hello");
      await wrapper.get("textarea").trigger("keydown", { key: "Enter" });
      await flushPromises();
      expect(governanceApi.stream).not.toHaveBeenCalled();
      expect(wrapper.text()).toContain("Hello there");
      expect(wrapper.text()).not.toContain(en.governance.disconnected);
      expect(wrapper.find(`[aria-label="${en.common.stop}"]`).exists()).toBe(false);
    }
  );

  it("a stream that stays unavailable for a running turn ends with a visible retry", async () => {
    vi.useFakeTimers();
    try {
      vi.mocked(governanceApi.list).mockResolvedValue([]);
      vi.mocked(governanceApi.read).mockResolvedValue(running());
      vi.mocked(governanceApi.stream).mockImplementation(async () => {
        const missing = sse();
        missing.unavailable();
        return missing.response;
      });
      const { wrapper } = await open();
      for (let step = 0; step < 12; step++) await vi.advanceTimersByTimeAsync(500);
      expect(wrapper.text()).toContain(en.governance.disconnected);
      expect(button(wrapper, en.common.retry).exists()).toBe(true);
      expect(governanceApi.stop).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it("an HTTP failure of the live stream is shown with a retry and never sends Stop", async () => {
    vi.mocked(governanceApi.list).mockResolvedValue([]);
    vi.mocked(governanceApi.read).mockResolvedValue(running());
    vi.mocked(governanceApi.stream).mockRejectedValueOnce(new ApiRequestError("Session expired", 401));
    const { wrapper } = await open();
    expect(governanceApi.stream).toHaveBeenCalledTimes(1);
    expect(wrapper.get('[role="alert"]').text()).toContain("Session expired");
    expect(wrapper.text()).toContain(en.governance.disconnected);
    // Not shown as running any more: the input offers Send, not Stop.
    expect(wrapper.find(`[aria-label="${en.common.stop}"]`).exists()).toBe(false);
    expect(governanceApi.stop).not.toHaveBeenCalled();

    const live = sse();
    vi.mocked(governanceApi.stream).mockResolvedValueOnce(live.response);
    await button(wrapper, en.common.retry).trigger("click");
    await flushPromises();
    live.push({ type: "response_started", message: "Resumed question" });
    await flushPromises();
    expect(wrapper.text()).toContain("Resumed question");
    expect(wrapper.text()).not.toContain(en.governance.disconnected);
  });

  it("a reply that settles at once after a lost stream clears the old disconnected notice", async () => {
    vi.mocked(governanceApi.list).mockResolvedValue([]);
    vi.mocked(governanceApi.read).mockResolvedValue(running());
    vi.mocked(governanceApi.stream).mockRejectedValueOnce(new ApiRequestError("Session expired", 401));
    const { wrapper } = await open();
    expect(wrapper.text()).toContain(en.governance.disconnected);

    const settled = session();
    settled.revision = 3;
    settled.messages.push(
      { role: "user", content: "Any update?" },
      { role: "assistant", content: "Nothing new yet." }
    );
    vi.mocked(governanceApi.respond).mockResolvedValue(settled);
    await wrapper.get("textarea").setValue("Any update?");
    await wrapper.get("textarea").trigger("keydown", { key: "Enter" });
    await flushPromises();
    expect(wrapper.text()).toContain("Nothing new yet.");
    expect(wrapper.text()).not.toContain(en.governance.disconnected);
    expect(governanceApi.stream).toHaveBeenCalledTimes(1);
  });

  it("a failed final snapshot read after the turn ends is not shown as still running", async () => {
    vi.mocked(governanceApi.list).mockResolvedValue([]);
    vi.mocked(governanceApi.read)
      .mockResolvedValueOnce(running())
      .mockRejectedValueOnce(new ApiRequestError("Backend unavailable", 503));
    const live = sse();
    vi.mocked(governanceApi.stream).mockResolvedValue(live.response);
    const { wrapper } = await open();
    live.push(
      { type: "response_started", message: "Question" },
      { type: "response_end", status: "completed" }
    );
    await flushPromises();
    expect(wrapper.text()).toContain("Backend unavailable");
    expect(wrapper.text()).toContain(en.governance.disconnected);
    expect(wrapper.find(`[aria-label="${en.common.stop}"]`).exists()).toBe(false);
  });

  it("a cursor of an earlier turn is never applied to the turn that replaced it", async () => {
    vi.mocked(governanceApi.list).mockResolvedValue([]);
    vi.mocked(governanceApi.read).mockResolvedValueOnce(running(firstId, "t1"));
    const first = sse();
    const stale = sse();
    const next = sse();
    vi.mocked(governanceApi.stream)
      .mockResolvedValueOnce(first.response)
      .mockResolvedValueOnce(stale.response)
      .mockResolvedValueOnce(next.response);
    const { wrapper } = await open();
    first.push(
      { type: "response_started", message: "First turn" },
      { type: "token", content: "First answer" }
    );
    first.close();
    await flushPromises();
    // Another tab started turn t2 meanwhile; the server no longer holds t1.
    const settled = running(firstId, "t2");
    settled.revision = 5;
    settled.messages.push(
      { role: "user", content: "First turn" },
      { role: "assistant", content: "First answer" }
    );
    vi.mocked(governanceApi.read).mockResolvedValueOnce(settled);
    await vi.waitFor(() => expect(governanceApi.stream).toHaveBeenCalledTimes(2));
    expect(governanceApi.stream).toHaveBeenLastCalledWith(firstId, "t1", 2, expect.any(AbortSignal));
    stale.unavailable();
    await flushPromises();
    expect(governanceApi.stream).toHaveBeenLastCalledWith(firstId, "t2", 0, expect.any(AbortSignal));
    next.push(
      { type: "response_started", message: "Second turn" },
      { type: "token", content: "Second answer" }
    );
    await flushPromises();
    for (const text of ["First answer", "Second turn", "Second answer"])
      expect(wrapper.text().split(text)).toHaveLength(2);
  });

  it("a running turn whose stream is not ready yet is followed once it is", async () => {
    vi.mocked(governanceApi.list).mockResolvedValue([]);
    vi.mocked(governanceApi.read).mockResolvedValue(running(firstId, "t1"));
    const early = sse();
    const ready = sse();
    vi.mocked(governanceApi.stream)
      .mockResolvedValueOnce(early.response)
      .mockResolvedValueOnce(ready.response);
    const { wrapper } = await open();
    early.unavailable();
    await vi.waitFor(() => expect(governanceApi.stream).toHaveBeenCalledTimes(2));
    expect(governanceApi.stream).toHaveBeenLastCalledWith(firstId, "t1", 0, expect.any(AbortSignal));
    ready.push({ type: "response_started", message: "Admitted question" });
    await flushPromises();
    expect(wrapper.text()).toContain("Admitted question");
    expect(wrapper.text()).not.toContain(en.governance.disconnected);
  });
});
