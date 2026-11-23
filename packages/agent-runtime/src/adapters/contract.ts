import type { Readable, Writable } from "node:stream";
import type { RuntimeStopReason } from "@ontomato/contracts/agent-runtime-values";
import type { RuntimeMessage, RuntimeToolDeclaration } from "@ontomato/contracts/agent-runtime-messages";
import type {
  RuntimeAgentEvent,
  RuntimeToolOutcome,
  RuntimeToolResult,
  RuntimeUsageUpdate,
} from "@ontomato/contracts/agent-runtime-events";
import type { RuntimeJsonObject } from "@ontomato/contracts/agent-runtime-values";
import type { CodeLimits } from "@ontomato/contracts/agent-runtime-code";

/**
 * The one interface between the runtime and an execution engine: the layer that runs the model-and-tool
 * loop and keeps the model's own context (PI today, Codex next).
 *
 * The runtime keeps everything a conversation is: sessions, receipts and consumption order, the channel,
 * delegation, artifacts, identity and authorization, the host's events and the human-readable record. An
 * engine only translates what it is handed into its own native calls, and its native events back into the
 * events below. It never persists platform facts, never decides permissions, and never emits
 * `input_received`, `artifact_registered`, `pending_questions_changed`, `agent_start` or `agent_end` —
 * those belong to the runtime.
 *
 * What a plugin must guarantee is written per capability in `CAPABILITIES.md` beside this file; that table
 * is also the checklist a new engine fills in before it is delivered.
 */
export interface HarnessPlugin {
  /** Registry key, stored on the session when it first runs and never changed afterwards. */
  readonly id: HarnessEngineId;
  /** The rows of `CAPABILITIES.md` this engine answers, with the program version they were verified on. */
  readonly capabilities: HarnessCapabilities;
  /** Open or resume this session's native state. Throws rather than silently starting a new native session. */
  open(request: HarnessOpenRequest): Promise<HarnessSession>;
}
export type HarnessEngineId = string;

/** Row ids are the table in CAPABILITIES.md, in its order. */
export const HARNESS_CAPABILITIES = [
  "open",
  "startTurn",
  "messages",
  "interrupt",
  "stopReason",
  "close",
  "steer",
  "platformTools",
  "gatewayModel",
  "skills",
  "usage",
  "optionalDetails",
] as const;
export type HarnessCapabilityId = (typeof HARNESS_CAPABILITIES)[number];
export type HarnessCapabilityState = "supported" | "limited" | "unsupported" | "unverified";
export interface HarnessCapabilities {
  /** The native program and version the states were verified against, e.g. `pi-ai 1.4.0`. */
  readonly version: string;
  readonly entries: Readonly<Record<HarnessCapabilityId, HarnessCapabilityState>>;
}

/** Runs a plugin's session: one open native session, one turn at a time. */
export interface HarnessSession {
  /** The engine's own session identifier; the runtime persists it and hands it back to resume. */
  readonly engineRef: string;
  /**
   * Run one turn to completion and report why it ended. The runtime calls this once per run, never
   * concurrently, and reads the returned stop reason as the run's own.
   */
  startTurn(turn: HarnessTurnRequest, signal: AbortSignal): Promise<HarnessTurnResult>;
  /**
   * Hand an input that arrived during the run to the running turn. The runtime pushes every such input here;
   * the engine never pulls. Acceptance is the RPC's; consumption is reported separately through
   * `host.consumed`. When the engine refuses (its turn has already ended), the input stays in the channel and
   * the runtime takes it into the next turn.
   */
  steer(input: HarnessTurnInput): Promise<HarnessSteerResult>;
  /**
   * Stop the running turn: end the engine's own commands, report in-flight tool calls as unsettled in the
   * turn result, and return once the engine is no longer working on it.
   */
  interrupt(reason: string | null): Promise<void>;
  /** Release the engine's process and communication resources. Persisted files belong to the session. */
  close(): Promise<void>;
}

export interface HarnessOpenRequest {
  readonly sessionId: string;
  readonly domainId: string;
  /** Native session to resume; null for a new one. A missing native session is an error, never a new one. */
  readonly engineRef: string | null;
  /**
   * The model context of a session that ran before engines kept their own state, given once: when `engineRef`
   * is null and the session already has history. The engine writes it into its new native session before
   * `open` returns; the runtime stores the returned `engineRef` only after that. Null for every other open.
   */
  readonly previousContext: readonly RuntimeMessage[] | null;
  /** Where the engine program runs. Paths in `directories` and `model.baseUrl` are as seen inside it. */
  readonly sandbox: HarnessSandbox;
  readonly directories: HarnessDirectories;
  readonly model: HarnessModelAccess;
  readonly prompt: HarnessPrompt;
  /**
   * Platform tools, declared once when the native session is created and kept by the engine with its own
   * session state; when resuming, the engine uses the list it kept and ignores this one. Every call is still authorized by the runtime at
   * the moment it is invoked; a tool the definition gained later appears only in new sessions.
   */
  readonly tools: readonly RuntimeToolDeclaration[];
  readonly limits: CodeLimits;
  readonly language: string;
  readonly signal: AbortSignal;
}

/**
 * The session's isolated process space, prepared by the sandbox manager: its own mounts, a loopback-only
 * network bridged to the model gateway and the session's callback, and no host credentials.
 */
export interface HarnessSandbox {
  /** Start the engine program inside the sandbox. */
  spawn(command: string, args: readonly string[], env: Readonly<Record<string, string>>): HarnessProcess;
}
export interface HarnessProcess {
  readonly stdin: Writable;
  readonly stdout: Readable;
  readonly stderr: Readable;
  /** Settles once the process tree has ended, with its exit code, or null when it was killed by a signal. */
  readonly exited: Promise<number | null>;
  kill(): void;
}

/** What the engine may see on disk. Nothing else of the host is reachable from it. */
export interface HarnessDirectories {
  /** This session's workspace. Files it writes under `outputs/` become artifacts. */
  readonly workspace: string;
  /** This engine's own persistent session files, one directory per session. */
  readonly state: string;
  /** Selected skill versions, read-only, by skill name. */
  readonly skills: readonly { readonly name: string; readonly directory: string }[];
}

/**
 * How the engine reaches models: only through this session's lease on the platform gateway. The engine
 * never sees an upstream provider address or key.
 */
export interface HarnessModelAccess {
  readonly baseUrl: string;
  /** Lease token, valid for as long as this engine process lives. */
  readonly token: string;
  /** Public model name selected for this session. */
  readonly model: string;
  /** Real context length of that model, so the engine can size its own compaction. */
  readonly contextWindow: number;
  /** Upstream maximum output, or null when the model does not declare one. */
  readonly maxOutputTokens: number | null;
}

export interface HarnessPrompt {
  /**
   * The system prompt fixed for the native session: agent instructions, skill catalog and language. Host
   * context is not part of it; it travels with the turn and with steered inputs.
   */
  readonly system: string;
}

export interface HarnessTurnRequest {
  readonly runId: string;
  /** Inputs the turn starts with, in order. Their ids are what the engine reports as consumed. */
  readonly inputs: readonly HarnessTurnInput[];
  /** Host context at the start of this turn; the engine puts it ahead of the inputs. */
  readonly context: string | null;
  readonly host: HarnessTurnHost;
}

/** One platform input, with the receipt id the runtime assigned when it received it. */
export interface HarnessTurnInput {
  readonly id: string;
  readonly message: RuntimeMessage;
  /** Host context that changed with this input; the engine puts it ahead of the message. */
  readonly context: string | null;
}

/**
 * What a running turn may ask of the runtime. Every call is already bound to this session and run; an
 * engine cannot address another session, another run or another execution identity.
 */
export interface HarnessTurnHost {
  /** Report one event of this turn, in the order it happened. Awaited: later events must not overtake it. */
  emit(event: HarnessEvent): Promise<void>;
  /** Run a platform tool. The runtime checks the current definition and permissions before it runs. */
  invokeTool(call: HarnessToolCall): Promise<HarnessToolCallResult>;
  /**
   * Report that the engine has put this input into its model context, at the position where that happened.
   * The runtime advances the platform's consumption order only from this report.
   */
  consumed(inputId: string): Promise<void>;
}

/** A platform tool call, in PI's `tool_execution_start` fields. */
export interface HarnessToolCall {
  readonly toolCallId: string;
  readonly toolName: string;
  readonly args: RuntimeJsonObject;
  readonly signal: AbortSignal;
  /** Partial output while the tool runs, replacing the previous partial for the same call. */
  readonly onUpdate: (partialResult: HarnessToolPartialResult) => void;
}
export type HarnessToolPartialResult = PublicEvent<"tool_execution_update">["partialResult"];
/**
 * A tool result as an engine reports it: the public result without the artifact ids, which the runtime
 * collects itself for the call.
 */
export interface HarnessToolResult {
  readonly content: RuntimeToolResult["content"];
  readonly details: Omit<RuntimeToolResult["details"], "artifactIds">;
}
export interface HarnessToolCallResult {
  readonly result: HarnessToolResult;
  readonly outcome: RuntimeToolOutcome;
}

export interface HarnessTurnResult {
  readonly stopReason: RuntimeStopReason;
  readonly errorMessage: string | null;
  /**
   * Tool calls this turn dispatched and did not get a result for. The runtime settles them once as
   * `unknown`, so a call's platform record is never split or doubled and is never replayed automatically.
   */
  readonly unsettledToolCalls: readonly HarnessUnsettledToolCall[];
}
export type HarnessUnsettledToolCall = Omit<PublicEvent<"tool_execution_start">, "type">;

export type HarnessSteerResult =
  | { readonly accepted: true }
  | { readonly accepted: false; readonly reason: string };

type PublicEvent<T extends RuntimeAgentEvent["type"]> = Extract<RuntimeAgentEvent, { type: T }>;
type Native<E, PlatformFields extends keyof E> = Omit<E, PlatformFields> & { readonly nativeId: string };

/**
 * The event face: what an engine may report, and all it may report. It is the public event contract, which is
 * PI's agent events, minus what only the runtime knows; the runtime adds those and gives every event its
 * sequence number and cursor. A PI plugin forwards PI's events nearly as they are; any other engine
 * translates into PI's shapes.
 *
 * Where it differs from the public events, and why:
 * - Messages are named by the engine's own item id (`nativeId`): an engine never invents a platform id. The
 *   runtime allocates `messageId` on `message_start` and the session sequence numbers on `message_end`.
 * - `message_update` keeps PI's partial `message`, the snapshot a reader may take at that point; the public
 *   event carries only the delta.
 * - A tool result has no artifact ids, and its `outcome` replaces `isError`, which the runtime derives
 *   (anything but `success` is an error to the model).
 * - Usage names its message by `nativeId`, null when it cannot be attributed to one; a `run_detail` with
 *   `message` scope names its message in `ref` by `nativeId` too. The runtime replaces both with `messageId`.
 * - `agent_start`, `agent_end`, `turn_start`, `turn_end`, `input_received`, `artifact_registered` and
 *   `pending_questions_changed` are the runtime's and are absent here.
 */
export type HarnessEvent =
  | Native<PublicEvent<"message_start">, "messageId">
  | Native<PublicEvent<"message_update">, "messageId"> & { readonly message: RuntimeMessage }
  | Native<PublicEvent<"message_end">, "messageId" | "messageSeq" | "contextSeq">
  | PublicEvent<"tool_execution_start">
  | PublicEvent<"tool_execution_update">
  | Omit<PublicEvent<"tool_execution_end">, "result" | "isError" | "outcome"> & {
      readonly result: HarnessToolResult;
      readonly outcome: RuntimeToolOutcome;
    }
  | PublicEvent<"run_detail">
  | {
      readonly type: "usage_updated";
      readonly usage: Omit<RuntimeUsageUpdate, "messageId"> & { readonly nativeId: string | null };
    };
