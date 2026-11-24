import { z } from "zod";
import type {
  HarnessOpenRequest, HarnessPlugin, HarnessProcess, HarnessSession, HarnessSteerResult,
  HarnessTurnInput, HarnessTurnRequest, HarnessTurnResult,
} from "../contract";
import { CodexEvents } from "./events";
import { toolOutput, toolRequest, userInput } from "./items";
import { CodexRpcError, CodexTransport, deferred, type CodexNotice, type RpcId } from "./transport";

const binary = "/usr/local/lib/ontomato-codex/bin/codex";
const launcher = "/usr/local/lib/ontomato-codex/launch.mjs";
const nativeTurn = z.object({ id: z.string(), status: z.string(),
  error: z.object({ message: z.string() }).nullish(),
});
type NativeTurn = z.infer<typeof nativeTurn>;
const errorMessage = (error: unknown) => error instanceof Error ? error.message : String(error);

interface ActiveTurn {
  readonly host: HarnessTurnRequest["host"];
  readonly events: CodexEvents;
  readonly started: Promise<NativeTurn>;
  readonly terminal: ReturnType<typeof deferred<NativeTurn>>;
  readonly calls: Map<RpcId, Promise<void>>;
  readonly abort: AbortController;
  order: Promise<void>;
  interrupt?: Promise<void>;
  ended: boolean;
}

class CodexSession implements HarnessSession {
  private active?: ActiveTurn;

  constructor(
    readonly engineRef: string,
    private readonly process: HarnessProcess,
    private readonly transport: CodexTransport,
    private readonly model: string,
    private readonly workspace: string,
  ) {}

  async startTurn(turn: HarnessTurnRequest, signal: AbortSignal): Promise<HarnessTurnResult> {
    if (this.active) throw new Error("Codex already has an active turn");
    if (signal.aborted) return { stopReason: "aborted", errorMessage: null, unsettledToolCalls: [] };
    const [input] = turn.inputs;
    if (!input || turn.inputs.length !== 1) throw new Error("Codex turn/start requires one associated opening input");
    const started = Promise.resolve().then(() => this.transport.request("turn/start", {
      threadId: this.engineRef, clientUserMessageId: input.id, input: userInput(input, turn.context),
    })).then(reply => z.object({ turn: nativeTurn }).parse(reply).turn);
    const active: ActiveTurn = {
      host: turn.host, events: new CodexEvents(turn.host, this.model, this.workspace),
      started, terminal: deferred<NativeTurn>(), calls: new Map(),
      abort: new AbortController(), order: Promise.resolve(), ended: false,
    };
    this.active = active;
    const exited = () => active.terminal.reject(this.transport.signal.reason);
    const interrupt = () => { void this.interrupt(null).catch(error => this.transport.fail(error)); };
    this.transport.signal.addEventListener("abort", exited, { once: true });
    signal.addEventListener("abort", interrupt, { once: true });
    try {
      const [native] = await Promise.all([active.terminal.promise, started]);
      await active.interrupt;
      await active.order;
      await Promise.all(active.calls.values());
      await active.events.end();
      const stopReason = active.events.terminal(native.status);
      return {
        stopReason,
        errorMessage: native.error?.message ?? active.events.failure,
        unsettledToolCalls: active.events.unsettled(),
      };
    } catch (error) {
      active.ended = true;
      active.abort.abort(error);
      await Promise.allSettled(active.calls.values());
      return {
        stopReason: signal.aborted ? "aborted" : "error",
        errorMessage: errorMessage(error),
        unsettledToolCalls: active.events.unsettled(),
      };
    } finally {
      this.active = undefined;
      this.transport.signal.removeEventListener("abort", exited);
      signal.removeEventListener("abort", interrupt);
    }
  }

  async steer(input: HarnessTurnInput): Promise<HarnessSteerResult> {
    const active = this.active;
    const ended = { accepted: false, reason: "Codex turn has ended" } as const;
    if (!active || active.ended || active.abort.signal.aborted) return ended;
    const { id } = await active.started;
    if (active.ended || active.abort.signal.aborted) return ended;
    try {
      await this.transport.request("turn/steer", {
        threadId: this.engineRef, expectedTurnId: id, clientUserMessageId: input.id, input: userInput(input),
      });
      return { accepted: true };
    } catch (error) {
      if (error instanceof CodexRpcError && error.code === -32600)
        return { accepted: false, reason: error.message };
      throw error;
    }
  }

  async interrupt(_reason: string | null) {
    const active = this.active;
    if (!active) return;
    active.abort.abort();
    active.interrupt ??= (async () => {
      const { id } = await active.started;
      if (!active.ended) await this.transport.request("turn/interrupt", { threadId: this.engineRef, turnId: id });
      await active.terminal.promise;
      await this.transport.request("thread/backgroundTerminals/clean", { threadId: this.engineRef });
      await Promise.all(active.calls.values());
    })();
    await active.interrupt;
  }

  async close() {
    this.process.kill();
    await this.process.exited;
  }

  private ordered(active: ActiveTurn, operation: () => Promise<void>) {
    active.order = active.order.then(operation);
    void active.order.catch(error => this.transport.fail(error));
    return active.order;
  }

  receive(frame: CodexNotice) {
    if (frame.params.threadId !== undefined && frame.params.threadId !== this.engineRef) return;
    if (frame.id !== undefined && frame.method !== "item/tool/call") {
      this.transport.send({ id: frame.id, error: { code: -32601, message: `Unsupported Codex server request ${frame.method}` } });
      if (this.active) {
        const active = this.active;
        void this.ordered(active, () => active.events.diagnostic("warning", `Unexpected Codex request ${frame.method}`));
      }
      return;
    }
    const active = this.active;
    if (!active) {
      if (frame.id !== undefined) throw new Error("Codex requested a tool outside a turn");
      return;
    }
    if (frame.method === "turn/completed") {
      const turn = nativeTurn.parse(frame.params.turn);
      void this.ordered(active, async () => {
        if (turn.id !== (await active.started).id) return;
        active.ended = true;
        active.abort.abort();
        active.terminal.resolve(turn);
      });
    } else if (frame.method === "item/tool/call") {
      this.invoke(active, frame.id!, toolRequest.parse(frame.params));
    } else {
      void this.ordered(active, async () => {
        if (typeof frame.params.turnId === "string" && frame.params.turnId !== (await active.started).id) return;
        await active.events.notification(frame);
      });
    }
  }

  private invoke(active: ActiveTurn, id: RpcId, call: z.infer<typeof toolRequest>) {
    const signal = active.abort.signal;
    const ready = this.ordered(active, async () => {
      if (call.turnId !== (await active.started).id) throw new Error("Codex tool request referred to another turn");
      await active.events.startTool(call.callId, call.tool, call.arguments);
    });
    const invocation = (async () => {
      await ready;
      if (signal.aborted) return;
      try {
        const result = await active.host.invokeTool({
          toolCallId: call.callId, toolName: call.tool, args: call.arguments, signal,
          onUpdate: update => { void this.ordered(active, () => active.events.progress(call.callId, update)); },
        });
        if (signal.aborted) return;
        active.events.reply(call.callId, result);
        this.transport.send({ id, result: { success: !result.isError, contentItems: toolOutput(result.result.content) } });
      } catch (error) {
        if (signal.aborted) return;
        this.transport.send({ id, error: { code: -32603, message: errorMessage(error) } });
        throw error;
      }
    })().finally(() => active.calls.delete(id));
    active.calls.set(id, invocation);
    void invocation.catch(error => this.transport.fail(error));
  }
}

export function createCodexPlugin(program = binary, entrypoint = launcher): HarnessPlugin {
  return {
    id: "codex",
    capabilities: {
      version: "Codex CLI 0.171.0",
      entries: {
        open: "supported", startTurn: "supported", messages: "supported", interrupt: "supported",
        stopReason: "limited", close: "supported", steer: "supported", platformTools: "supported",
        gatewayModel: "supported", skills: "supported", usage: "supported", optionalDetails: "limited",
      },
    },
    async open(request: HarnessOpenRequest) {
      request.signal.throwIfAborted();
      if (request.previousContext?.length) throw new Error("Codex requires its native thread to resume existing context");
      const { directories, model, prompt, engineTools, engineRef, tools } = request;
      const { token, ...access } = model;
      const process = request.sandbox.spawn("/usr/local/bin/node", [entrypoint], {
        CODEX_GATEWAY_TOKEN: token,
        ONTOMATO_CODEX_BOOT: JSON.stringify({
          binary: program, directories, model: access, prompt: prompt.system, engineTools, resume: engineRef !== null,
        }),
      });
      const abort = () => process.kill();
      request.signal.addEventListener("abort", abort, { once: true });
      let session: CodexSession | undefined;
      const transport = new CodexTransport(process, frame => session?.receive(frame));
      try {
        await transport.request("initialize", {
          clientInfo: { name: "ontomato", version: "1" }, capabilities: { experimentalApi: true },
        });
        transport.send({ method: "initialized" });
        const thread = { cwd: directories.workspace, model: access.model, baseInstructions: prompt.system };
        const response = engineRef === null
          ? await transport.request("thread/start", { ...thread, dynamicTools: tools.map(tool => ({
              type: "function", name: tool.name, description: tool.description, inputSchema: tool.parameters,
            })) })
          : await transport.request("thread/resume", { ...thread, threadId: engineRef, excludeTurns: true });
        const { thread: { id } } = z.object({ thread: z.object({ id: z.string() }) }).parse(response);
        if (engineRef !== null && id !== engineRef) throw new Error("Codex returned a different thread ID");
        session = new CodexSession(id, process, transport, access.model, directories.workspace);
        return session;
      } catch (error) {
        process.kill();
        await process.exited;
        throw error;
      } finally {
        request.signal.removeEventListener("abort", abort);
      }
    },
  };
}

export const codexPlugin = createCodexPlugin();
