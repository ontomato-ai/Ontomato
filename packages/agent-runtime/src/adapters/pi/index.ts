import { z } from "zod";
import type {
  RuntimeImage, RuntimeMessage, RuntimeText,
} from "@ontomato/contracts/agent-runtime-messages";
import type {
  HarnessOpenRequest, HarnessPlugin, HarnessProcess, HarnessSession, HarnessSteerResult,
  HarnessToolCallResult, HarnessTurnInput, HarnessTurnRequest, HarnessTurnResult, HarnessUnsettledToolCall,
} from "../contract";
import { PiEvents } from "./events";
import { PiTransport, deferred, type PiBridgeFrame, type PiRpcFrame } from "./transport";

const program = "/usr/local/lib/ontomato-pi/import.mjs";
const text = (value: string): RuntimeText => ({ type: "text", text: value });

function notification(message: Extract<RuntimeMessage, { role: "notification" }>) {
  return `[Agent notification: ${JSON.stringify({
    kind: message.kind, source: message.source, replyTo: message.replyTo, selectedOption: message.selectedOption,
    answerId: message.answerId, outcome: message.outcome,
  })}]\n${message.content}${message.defaultAssumption ? `\nDefault assumption: ${message.defaultAssumption}` : ""}`;
}

function inputContent(input: HarnessTurnInput): (RuntimeText | RuntimeImage)[] {
  const message = input.message;
  const context = input.context ? [text(input.context)] : [];
  if (message.role === "notification") return [...context, text(notification(message))];
  if (message.role !== "user") throw new Error(`Invalid PI input role ${message.role}`);
  return [...context, ...(typeof message.content === "string" ? [text(message.content)] : message.content)];
}

function importContext(message: RuntimeMessage) {
  if (message.role === "notification")
    return { role: "user", content: notification(message), timestamp: message.timestamp };
  if (message.role === "assistant" && message.origin === "runtime")
    return { role: "user", content: `Runtime notice: ${message.errorMessage ?? message.stopReason}`, timestamp: message.timestamp };
  return message;
}

type BridgeRequest = Extract<PiBridgeFrame, { type: "request" }>;
type ToolCall = Extract<BridgeRequest, { method: "invoke" }>["data"];

interface ActiveTurn {
  readonly host: HarnessTurnRequest["host"];
  readonly events: PiEvents;
  readonly abort: AbortController;
  readonly done: ReturnType<typeof deferred<HarnessTurnResult>>;
  readonly calls: Map<string, ToolCall>;
  readonly invokes: Map<number, { controller: AbortController; done: Promise<void> }>;
  readonly steer: Map<string, boolean>;
  readonly started: Promise<{ success: boolean; error?: string }>;
  toolError?: string;
  interrupt?: Promise<void>;
  accepting: boolean;
  order: Promise<void>;
}

class PiSession implements HarnessSession {
  private active?: ActiveTurn;

  constructor(
    readonly engineRef: string,
    private readonly process: HarnessProcess,
    private readonly transport: PiTransport,
  ) {}

  async startTurn(turn: HarnessTurnRequest, signal: AbortSignal): Promise<HarnessTurnResult> {
    if (this.active) throw new Error("PI already has an active turn");
    if (signal.aborted) return { stopReason: "aborted", errorMessage: null, unsettledToolCalls: [] };
    const content = [...(turn.context ? [text(turn.context)] : []), ...turn.inputs.flatMap(inputContent)];
    const started = this.transport.rpc("prompt", {
      message: JSON.stringify({ type: "startTurn", ids: turn.inputs.map(input => input.id), content }),
    });
    const active: ActiveTurn = {
      host: turn.host, events: new PiEvents(turn.host), abort: new AbortController(),
      calls: new Map(), invokes: new Map(), steer: new Map(), started,
      accepting: true, order: Promise.resolve(), done: deferred(),
    };
    this.active = active;
    const interrupt = () => { void this.interrupt(null).catch(error => this.transport.fail(error)); };
    const exited = () => {
      void this.failed(active, this.transport.exited.reason.message).then(active.done.resolve, active.done.reject);
    };
    signal.addEventListener("abort", interrupt, { once: true });
    this.transport.exited.addEventListener("abort", exited, { once: true });
    try {
      const response = await started;
      if (!response.success) return this.failed(active, response.error ?? "PI rejected the prompt");
      return await active.done.promise;
    } catch (error) {
      return await this.failed(active, error instanceof Error ? error.message : String(error));
    } finally {
      signal.removeEventListener("abort", interrupt);
      this.transport.exited.removeEventListener("abort", exited);
      this.active = undefined;
    }
  }

  private async failed(active: ActiveTurn, errorMessage: string): Promise<HarnessTurnResult> {
    active.accepting = false;
    const aborted = active.interrupt !== undefined;
    active.abort.abort();
    await this.waitForInvocations(active);
    await active.order.catch(error => {
      errorMessage = error instanceof Error ? error.message : String(error);
    });
    return { stopReason: aborted ? "aborted" : "error", errorMessage, unsettledToolCalls: unsettled(active) };
  }

  async steer(input: HarnessTurnInput): Promise<HarnessSteerResult> {
    const active = this.active;
    const ended = { accepted: false, reason: "PI turn has ended" } as const;
    if (!active?.accepting || !(await active.started).success || !active.accepting) return ended;
    const response = await this.transport.rpc("steer", {
      message: JSON.stringify({ type: "steer", id: input.id, content: inputContent(input) }),
    });
    const accepted = active.steer.get(input.id);
    active.steer.delete(input.id);
    if (!response.success) return { accepted: false, reason: response.error ?? "PI refused the input" };
    return accepted ? { accepted: true } : ended;
  }

  async interrupt(_reason: string | null) {
    const active = this.active;
    if (!active) return;
    active.interrupt ??= (async () => {
      active.accepting = false;
      if (!(await active.started).success) return;
      const queue = await this.transport.rpc("clear_queue");
      if (!queue.success) throw new Error(queue.error);
      const response = await this.transport.rpc("abort");
      if (!response.success) throw new Error(response.error);
    })();
    await active.interrupt;
    await active.done.promise;
  }

  async close() {
    this.process.stdin.end();
    await this.process.exited;
  }

  private ordered(active: ActiveTurn, operation: () => Promise<void>) {
    active.order = active.order.then(operation);
    void active.order.catch(error => this.transport.fail(error));
    return active.order;
  }

  onRpc(frame: PiRpcFrame) {
    const active = this.active;
    if (!active) return;
    if (frame.type === "agent_settled") {
      active.accepting = false;
      const { aborted } = z.object({ aborted: z.boolean() }).parse(frame);
      void this.ordered(active, async () => {
        if (active.interrupt) await active.interrupt;
        await this.waitForInvocations(active);
        const terminal = active.toolError && !active.interrupt
          ? { stopReason: "error" as const, errorMessage: active.toolError }
          : active.events.terminal(aborted || active.interrupt !== undefined);
        active.done.resolve({ ...terminal, unsettledToolCalls: unsettled(active) });
      });
    } else {
      void this.ordered(active, () => active.events.detail(frame));
    }
  }

  onFrame(frame: PiBridgeFrame) {
    const active = this.active;
    if (!active) throw new Error("PI bridge request outside a turn");
    if (frame.type === "cancel") {
      active.invokes.get(frame.id)?.controller.abort();
    } else if (frame.method === "invoke") {
      this.invoke(active, frame.id, frame.data);
    } else {
      void this.ordered(active, async () => {
        const data = await this.handle(active, frame);
        this.transport.send({ type: "response", id: frame.id, data });
      });
    }
  }

  private async handle(active: ActiveTurn, request: Exclude<BridgeRequest, { method: "invoke" }>) {
    const { host, calls } = active;
    switch (request.method) {
      case "event":
        await active.events.message(request.data);
        break;
      case "consume":
        for (const id of request.data) await host.consumed(id);
        break;
      case "steer":
        active.steer.set(request.data.id, request.data.accepted);
        break;
      case "toolStart":
        await host.emit({ type: "tool_execution_start", ...request.data });
        calls.set(request.data.toolCallId, request.data);
        return { allowed: active.interrupt === undefined };
      case "toolUpdate": {
        const call = calls.get(request.data.toolCallId);
        if (call) await host.emit({ type: "tool_execution_update", ...call, partialResult: request.data.partialResult });
        break;
      }
      case "toolEnd": {
        const { toolCallId, toolName, isError, result } = request.data;
        if (isError === null) break;
        await host.emit({ type: "tool_execution_end", toolCallId, toolName, isError, result });
        calls.delete(toolCallId);
        break;
      }
    }
  }

  private invoke(active: ActiveTurn, id: number, call: ToolCall) {
    if (!active.calls.has(call.toolCallId)) throw new Error("PI called a tool before its start was recorded");
    const controller = new AbortController();
    const signal = AbortSignal.any([controller.signal, active.abort.signal]);
    const done = (async () => {
      let data: HarnessToolCallResult | null;
      try {
        signal.throwIfAborted();
        data = await active.host.invokeTool({
          toolCallId: call.toolCallId,
          toolName: call.toolName,
          args: call.args,
          signal,
          onUpdate: update => this.transport.send({ type: "progress", id, update }),
        });
      } catch (error) {
        data = null;
        if (!signal.aborted) active.toolError = error instanceof Error ? error.message : String(error);
      }
      this.transport.send({ type: "response", id, data });
    })().finally(() => active.invokes.delete(id));
    active.invokes.set(id, { controller, done });
  }

  private async waitForInvocations(active: ActiveTurn) {
    await Promise.all([...active.invokes.values()].map(invoke => invoke.done));
  }
}

function unsettled(active: ActiveTurn): HarnessUnsettledToolCall[] {
  return [...active.calls.keys()].map(toolCallId => ({ toolCallId }));
}

async function open(request: HarnessOpenRequest): Promise<HarnessSession> {
  request.signal.throwIfAborted();
  const process = request.sandbox.spawn("/usr/local/bin/node", [program], {});
  const abort = () => process.kill();
  request.signal.addEventListener("abort", abort, { once: true });
  let session: PiSession | undefined;
  const transport = new PiTransport(
    process, (process as HarnessProcess & { readonly channel: import("node:stream").Duplex }).channel,
    frame => session?.onRpc(frame),
    frame => {
      if (!session) throw new Error("PI bridge request before open");
      session.onFrame(frame);
    },
  );
  try {
    const { engineRef, previousContext, directories, model, prompt, tools, engineTools } = request;
    transport.send({
      type: "init",
      data: { engineRef, previousContext: previousContext?.map(importContext) ?? null, directories, model, prompt, tools, engineTools },
    });
    const reply = await transport.rpc("get_state");
    if (!reply.success) throw new Error(reply.error);
    const state = z.object({ sessionId: z.string(), sessionFile: z.string() }).parse(reply.data);
    if (engineRef !== null && state.sessionId !== engineRef) throw new Error("PI returned a different session ID");
    session = new PiSession(state.sessionId, process, transport);
    return session;
  } catch (error) {
    process.kill();
    await process.exited;
    throw error;
  } finally {
    request.signal.removeEventListener("abort", abort);
  }
}

export const piPlugin: HarnessPlugin = {
  id: "pi",
  capabilities: {
    version: "@earendil-works/pi-coding-agent 1.4.0",
    entries: {
      open: "supported", startTurn: "supported", messages: "supported",
      interrupt: "supported", stopReason: "supported", close: "supported",
      steer: "supported", platformTools: "supported", gatewayModel: "supported",
      skills: "supported", usage: "supported", optionalDetails: "supported",
    },
  },
  open,
};
