import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentEvent, AgentState } from "../../../core/agent-loop/types";
import { HttpError } from "../../../utils/errors";
import type { AgentLoopHooks } from "../../../core/agent-loop/agent-loop";

const order = vi.hoisted(() => [] as string[]);
const loop = vi.hoisted(() => ({
  run: async (
    _state: AgentState,
    _emit: (event: AgentEvent) => void,
    _signal: AbortSignal,
    _persist: () => Promise<void>
  ) => {},
}));
const captured = vi.hoisted(() => ({ persist: async () => {} }));
const turns = vi.hoisted(() => ({ next: 0 }));

vi.mock("../store", () => {
  const record = () => ({
    id: "g1",
    harnessSessionId: "g1",
    work: {
      summary: "",
      notes: "",
      reviewedKnowledgeIds: [] as string[],
      knowledgeTotal: null,
      issues: [],
      sources: [],
    },
    error: null,
  });
  return {
    governanceStore: {
      create: vi.fn(async () => record()),
      get: vi.fn(async () => record()),
      authorize: vi.fn(async () => {}),
      save: vi.fn(async () => {
        order.push("save");
      }),
    },
    publicGovernanceSession: (value: unknown) => value,
  };
});
vi.mock("../../../infrastructure/harness-sessions", () => ({
  HarnessSessionBusyError: class extends Error {},
  harnessSessions: {
    beginTurn: vi.fn(async () => ({ turnId: `t${++turns.next}` })),
    finishTurn: vi.fn(async (_id: string, _turn: string, status: string) => {
      order.push(`finish:${status}`);
    }),
  },
}));
vi.mock("../../../config/model-resolver", () => ({
  ModelNotConfiguredError: class extends Error {},
  resolveModelForRole: vi.fn(async () => ({
    baseUrl: "http://model.invalid",
    apiKey: "",
    modelName: "test",
    contextWindow: 1000,
  })),
}));
vi.mock("../../../core/agent-loop/session-run", () => ({ createHarnessRun: vi.fn(async () => ({})) }));
vi.mock("../../../core/prompts/loader", () => ({ renderPrompt: () => "system" }));
vi.mock("../tools", () => ({
  createGovernanceTools: (_record: unknown, _credentials: unknown, persist: () => Promise<void>) => {
    captured.persist = persist;
    return [];
  },
}));
vi.mock("../../../core/agent-loop/agent-loop", () => ({
  runAgentLoop: async (
    _message: string,
    state: AgentState,
    _config: unknown,
    emit: (event: AgentEvent) => void,
    signal: AbortSignal,
    hooks: AgentLoopHooks
  ) => {
    await hooks.beforeTurn?.(state);
    await loop.run(state, emit, signal, captured.persist);
    return [];
  },
}));

const { GovernanceRuntime } = await import("../runtime");
const { governanceStore } = await import("../store");
const owner = { domainId: "d", userId: "u" };
const credentials = { domainId: "d", token: "", apiKey: "" };

function collect(stream: { subscribe: (after: number, fn: (e: { event: unknown }) => void) => void }) {
  const events: Array<{ type: string } & Record<string, unknown>> = [];
  stream.subscribe(0, ({ event }) => {
    events.push(event as { type: string });
    if ((event as { type: string }).type === "response_end") order.push("terminal");
  });
  return events;
}

beforeEach(() => {
  order.length = 0;
  turns.next = 0;
});

describe("governance response stream", () => {
  it("relays text and tools, sends saved work, and ends only after the turn is settled", async () => {
    let open!: () => void;
    const subscribed = new Promise<void>((resolve) => {
      open = resolve;
    });
    loop.run = async (_state, emit, _signal, persist) => {
      await subscribed;
      const message = { role: "assistant", content: [] } as never;
      emit({ type: "message_update", message, assistantMessageEvent: { type: "thinking_delta", delta: "hidden" } });
      emit({ type: "message_update", message, assistantMessageEvent: { type: "text_delta", delta: "Reading" } });
      emit({ type: "tool_execution_start", toolCallId: "c1", toolName: "read_knowledge", args: { offset: 0 } });
      await persist();
      emit({
        type: "tool_execution_end",
        toolCallId: "c1",
        toolName: "read_knowledge",
        result: { content: [{ type: "text", text: "rule" }] },
        isError: false,
      });
    };
    const runtime = new GovernanceRuntime();
    await runtime.start(owner, credentials, "en", "Check the dates");
    const stream = (await runtime.responseStream("g1", owner, "t1"))!;
    const events = collect(stream);
    open();
    await runtime.wait("g1");

    expect(events.map((event) => event.type)).toEqual([
      "response_started",
      "token",
      "tool_start",
      "work",
      "tool_end",
      "response_end",
    ]);
    expect(events[0]).toEqual({ type: "response_started", message: "Check the dates" });
    expect(order.slice(-3)).toEqual(["save", "finish:completed", "terminal"]);
    // Once settled, the history snapshot is the only source; no tail is replayed.
    expect(await runtime.responseStream("g1", owner, "t1")).toBeUndefined();
  });

  it("binds each stream to its Harness turn from admission on", async () => {
    loop.run = async () => {};
    const runtime = new GovernanceRuntime();
    let reread!: () => void;
    const get = vi.mocked(governanceStore.get);
    const record = await get.getMockImplementation()!("g1", owner);
    get
      .mockImplementationOnce(async () => record)
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            reread = () => resolve(record);
          })
      );
    const first = runtime.respond("g1", owner, credentials, "en", "First");
    await vi.waitFor(() => expect(reread).toBeDefined());
    // A snapshot taken right after admission already finds this turn's stream.
    const firstStream = await runtime.responseStream("g1", owner, "t1");
    expect(firstStream?.status).toBe("running");
    reread();
    await first;
    await runtime.wait("g1");

    await runtime.respond("g1", owner, credentials, "en", "Second");
    // A cursor kept for the first turn never resolves to the second turn's stream.
    expect(await runtime.responseStream("g1", owner, "t1")).toBeUndefined();
    const events = collect((await runtime.responseStream("g1", owner, "t2"))!);
    expect(events[0]).toEqual({ type: "response_started", message: "Second" });
    await runtime.wait("g1");
  });

  it("Stop cancels the turn through its stream; detaching a subscriber does not", async () => {
    let release!: () => void;
    loop.run = (_state, _emit, signal) =>
      new Promise<void>((resolve) => {
        release = resolve;
        signal.addEventListener("abort", () => resolve());
      });
    const runtime = new GovernanceRuntime();
    await runtime.start(owner, credentials, "en", "Check");
    const stream = (await runtime.responseStream("g1", owner, "t1"))!;
    const unsubscribe = stream.subscribe(0, () => {});
    unsubscribe();
    expect(stream.controller.signal.aborted).toBe(false);

    await runtime.stop("g1", owner);
    await runtime.wait("g1");
    expect(stream.status).toBe("cancelled");
    expect(order).toContain("finish:cancelled");
    release();
  });
  it.each([
    ["another user", { domainId: "d", userId: "other" }],
    ["another domain", { domainId: "other", userId: "u" }],
  ])("honors the authorizer's refusal for %s without exposing or stopping the active turn", async (_case, caller) => {
    loop.run = (_state, _emit, signal) => new Promise(resolve => signal.addEventListener("abort", () => resolve()));
    const runtime = new GovernanceRuntime();
    await runtime.start(owner, credentials, "en", "Private question");
    const stream = (await runtime.responseStream("g1", owner, "t1"))!;
    const refusal = new HttpError(404, "unavailable");
    const authorize = vi.mocked(governanceStore.authorize);
    try {
      authorize.mockRejectedValueOnce(refusal);
      await expect(runtime.responseStream("g1", caller, "t1")).rejects.toBe(refusal);
      expect(authorize).toHaveBeenLastCalledWith("g1", caller);
      authorize.mockRejectedValueOnce(refusal);
      await expect(runtime.stop("g1", caller)).rejects.toBe(refusal);
      expect(authorize).toHaveBeenLastCalledWith("g1", caller);
      expect(stream.controller.signal.aborted).toBe(false);
      expect(stream.status).toBe("running");
      // The same refusal on the read boundary must also prevent admission of a new turn.
      vi.mocked(governanceStore.get).mockRejectedValueOnce(refusal);
      await expect(runtime.respond("g1", caller, credentials, "en", "Intrusion")).rejects.toBe(refusal);
      expect(governanceStore.get).toHaveBeenLastCalledWith("g1", caller);
      expect(await runtime.responseStream("g1", owner, "t1")).toBe(stream);
    } finally {
      await runtime.stop("g1", owner);
      await runtime.wait("g1");
    }
    expect(stream.status).toBe("cancelled");
  });

});
