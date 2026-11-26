import { Compile } from "typebox/compile";
import type { Express } from "express";
import {
  presentationResultSchema,
  type PresentationResult,
  type RuntimePresentationCallback,
} from "@ontomato/contracts/agent-presentation";
import type {
  RuntimeAgentDefinition,
  RuntimeStartRunRequest,
} from "@ontomato/contracts/agent-runtime";
import {
  runtimeToolDeclarationSchema,
  type RuntimeToolDeclaration,
} from "@ontomato/contracts/agent-runtime-messages";
import {
  runtimeIdSchema,
  runtimeKeySchema,
  type RuntimeJsonObject,
} from "@ontomato/contracts/agent-runtime-values";
import { BUILD_TEST_HEADER } from "@ontomato/contracts/build-tests";
import type {
  HarnessToolCall,
  HarnessToolCallResult,
  HarnessToolPartialResult,
  HarnessToolResult,
} from "./adapters/contract";
import { channelToolDeclaration } from "./channel";
import type { Scope } from "./store";

export type PlatformToolPartialResult = HarnessToolPartialResult;
export type PlatformToolResult = HarnessToolResult;
export type PlatformToolCallResult = HarnessToolCallResult;

/** Engine-neutral invocation payload for a platform tool. */
export interface PlatformToolCall {
  readonly toolCallId: string;
  readonly toolName: string;
  readonly args: RuntimeJsonObject;
  readonly signal: AbortSignal;
  readonly onUpdate?: (partialResult: PlatformToolPartialResult) => void;
}

/** Engine-independent declaration and execution binding for one platform tool. */
export interface PlatformTool {
  readonly declaration: RuntimeToolDeclaration;
  readonly label: string;
  readonly executionMode?: "sequential" | "parallel";
  readonly replay?: "never" | "safe";
  execute(call: PlatformToolCall): Promise<PlatformToolCallResult>;
}

/** Built-in engine tool names active when `engineTools` is enabled. */
export const ENGINE_TOOL_NAMES = ["read", "write", "edit", "bash"] as const;

/** Returns whether the engine's own file and command tools are enabled for this definition. */
export function usesEngineTools(
  definition: Pick<RuntimeAgentDefinition, "toolSurface">,
): boolean {
  return definition.toolSurface !== "product";
}

/** Rejects duplicate platform tool names and collisions with built-in engine tools when enabled. */
export function assertUniquePlatformToolNames(
  declarations: readonly RuntimeToolDeclaration[],
  engineTools: boolean,
): void {
  const seen = new Set<string>();
  const reserved = engineTools ? new Set<string>(ENGINE_TOOL_NAMES) : null;
  for (const declaration of declarations) {
    if (reserved?.has(declaration.name) || seen.has(declaration.name)) {
      throw new Error("Exposed tool names must be unique");
    }
    seen.add(declaration.name);
  }
}

interface PresentationBatchFailure {
  readonly toolName: string;
  readonly summary: string;
}

/**
 * Coordinates sequential execution and early-stop across page-control tool calls emitted in the same
 * assistant turn (product-layer standard detail 3.8).
 *
 * When any step in a batch fails to complete (`not_opened`, `load_error`, `not_filled`, `not_executed`,
 * `partially_executed`, `unknown`, `awaiting_confirmation`, HTTP error, or thrown error), all later
 * page-control calls in that same batch are skipped without sending requests to the host.
 */
export interface PresentationBatchController {
  /** Resets batch failure state whenever the agent loop advances to a new assistant turn. */
  beginTurn(turnToken: unknown): void;
  /** Manually resets batch failure state (useful for unit tests). */
  reset(): void;
  /** Runs one page-control step sequentially within the current batch. */
  runStep<T>(fn: () => Promise<T>): Promise<T>;
  /** Returns the earlier failure that aborted this batch, if any. */
  failure(): PresentationBatchFailure | null;
  /** Records that a page-control step in this batch did not succeed. */
  recordFailure(toolName: string, summary: string): void;
}

/** Creates a turn-scoped batch controller for presentation and display control tools. */
export function createPresentationBatchController(): PresentationBatchController {
  let activeTurn: unknown = Symbol("initial-turn");
  let failed: PresentationBatchFailure | null = null;
  let queue: Promise<unknown> = Promise.resolve();

  return {
    beginTurn(turnToken: unknown) {
      if (turnToken !== activeTurn) {
        activeTurn = turnToken;
        failed = null;
      }
    },
    reset() {
      failed = null;
    },
    runStep<T>(fn: () => Promise<T>): Promise<T> {
      const next = queue.catch(() => undefined).then(fn);
      queue = next.then(() => undefined, () => undefined);
      return next;
    },
    failure() {
      return failed;
    },
    recordFailure(toolName: string, summary: string) {
      if (!failed) failed = { toolName, summary };
    },
  };
}

function stepFailureSummary(toolName: string, result: PresentationResult): string | null {
  if (toolName === "present") {
    if (result.status === "opened" && result.reason === "target_selected") return null;
    return `${result.status}/${result.reason}`;
  }
  if (toolName === "observe_display") {
    if (result.status === "observed" && result.reason === "current_display") return null;
    return `${result.status}/${result.reason}`;
  }
  if (toolName === "fill_form") {
    if (result.status === "executed") return null;
    if (result.status === "filled") {
      return result.rejectedFields?.length
        ? `filled/partial_rejected:${result.rejectedFields.map((item) => item.path).join(",")}`
        : null;
    }
    return `${result.status}/${result.reason}`;
  }
  if (toolName === "page_action") {
    if (result.status === "executed") return null;
    return `${result.status}/${result.reason}`;
  }
  return null;
}

function skippedResultFor(
  toolName: "present" | "observe_display" | "fill_form" | "page_action",
  prior: PresentationBatchFailure,
  input: Record<string, unknown>,
): PresentationResult {
  const error = {
    code: "PREVIOUS_STEP_FAILED",
    message: `Not executed because earlier page step '${prior.toolName}' in this batch did not succeed (${prior.summary}).`,
  };
  const current = { known: false as const, reason: "previous_step_failed" };
  if (toolName === "present") {
    return { status: "not_opened", reason: "previous_step_failed", current, error };
  }
  if (toolName === "observe_display") {
    return { status: "observed", reason: "previous_step_failed", current, error };
  }
  if (toolName === "fill_form") {
    return {
      status: "not_filled",
      reason: "previous_step_failed",
      ...(typeof input.member === "string" ? { member: input.member } : {}),
      ...(Array.isArray(input.memberPath) ? { memberPath: input.memberPath as string[] } : {}),
      current,
      error,
    };
  }
  return {
    status: "not_executed",
    reason: "previous_step_failed",
    ...(typeof input.operation === "string" ? { operation: input.operation } : {}),
    current,
    error,
  };
}

const PRESENTATION_TOOL_SPECS: ReadonlyArray<{
  readonly declaration: RuntimeToolDeclaration;
  readonly label: string;
  readonly payload: (input: RuntimeJsonObject) => Record<string, unknown>;
}> = [
  {
    label: "Present",
    declaration: {
      name: "present",
      description:
        "Show an outputs/ artifact or navigate/update a registered site-relative page in the user's current conversation display right in this round. For a page, this performs a real navigation written to the browser address (preserved on refresh) without changing the user's side-by-side or full-page layout (opens side-by-side if no page is open). Optional state applies to any declared public state field of the page in place (not only deepLink fields) without reloading or triggering business writes, and must not duplicate a state query parameter. Use fill_form to populate a mounted live form and page_action to trigger save or other declared actions. The result reports what the view actually shows at receipt time, including the panel's declared public state values and current live form contents (including unsaved user edits). For an outputs/ artifact card, the display remains temporary and is not saved in the page address.",
      parameters: {
        type: "object",
        required: ["target"],
        properties: {
          target: { type: "string" },
          state: { type: "object", patternProperties: { "^.*$": {} } },
        },
        additionalProperties: false,
      },
    },
    payload: (input) => input,
  },
  {
    label: "Observe display",
    declaration: {
      name: "observe_display",
      description:
        "Read the latest live state of the page or artifact currently open beside the conversation — including its address, selection, highlights, all declared public state values (tabs, filters, view mode, etc.), and the current live values and unsaved status of any open forms (reflecting any edits the user made mid-round). Call `observe_display` (or `present`) before calling `fill_form` or `page_action`: the platform automatically binds subsequent `fill_form` and `page_action` calls to the latest snapshot delivered in this round so stale requests are rejected instead of operating on a changed page, form, or object. Read-only: does not navigate, reload, change layout, or trigger writes.",
      parameters: {
        type: "object",
        properties: {},
        additionalProperties: false,
      },
    },
    payload: () => ({ mode: "observe" }),
  },
  {
    label: "Fill form",
    declaration: {
      name: "fill_form",
      description:
        "Fill explicit fields into a live form currently displayed on the page beside the conversation, using the form's own editing entry so changed fields are highlighted, owner-driven dynamic updates run, and manual fields remain unsaved. Changing a field configured to save on blur or change requests the registered save operation for those fields: default mode returns awaiting_confirmation, and full-auto executes after checking the live form. The platform binds this call to the latest page snapshot in this round, starting with the page context attached to the user message. If no page context was attached, use `observe_display` or `present` first. It rejects as `stale` if the page, panel, form, target, or dashboard board/card changed. Keys in `values` are JSON Pointer field paths (e.g. \"/name\") or top-level field names (e.g. \"name\"). When the form has unsaved edits made by the user on any target field, refuses without overwriting (not_filled / blocked_unsaved) — ask the user first and pass overwriteUnsaved: true only after explicit user confirmation.",
      parameters: {
        type: "object",
        required: ["values"],
        properties: {
          member: { type: "string" },
          memberPath: { type: "array", items: { type: "string" }, minItems: 1 },
          values: { type: "object", patternProperties: { "^.*$": {} } },
          overwriteUnsaved: { type: "boolean" },
        },
        additionalProperties: false,
      },
    },
    payload: (input) => ({ mode: "fill_form", ...input }),
  },
  {
    label: "Page action",
    declaration: {
      name: "page_action",
      description:
        "Execute a declared operation or local page action on the page currently displayed beside the conversation, through the exact same UI entry a user clicks (for example saving a live form with its current contents, clicking a bound action button, running a list row/batch action, refreshing data with \"page.refresh\", or discarding form edits with \"<form>.discard\"). Never pass form field values here — fill the form with `fill_form` first, then invoke its save operation. The platform binds this call to the latest page snapshot in this round, starting with the page context attached to the user message. If no page context was attached, use `observe_display` or `present` first. It rejects as `stale` if the page, panel, entry, target object, checked rows, or dashboard board/card changed. For business writes in default mode (and discarding dirty form edits), this asks the user to confirm in the conversation (`awaiting_confirmation`); in full-auto sessions writes execute immediately (`executed`) after verifying page state is unchanged. For list row actions, pass `rowKey` using `<className>:<primaryKey>` (required for mixed-type or dynamic-type lists; plain `<primaryKey>` is allowed on single-type lists). If receipt is missing (`unknown`), check the returned `intentId` instead of retrying.",
      parameters: {
        type: "object",
        required: ["operation"],
        properties: {
          operation: { type: "string" },
          memberPath: { type: "array", items: { type: "string" }, minItems: 1 },
          rowKey: { type: "string" },
          input: { type: "object", patternProperties: { "^.*$": {} } },
        },
        additionalProperties: false,
      },
    },
    payload: (input) => ({ mode: "page_action", ...input }),
  },
];

/** Returns engine-independent declarations for the four page-control tools. */
export function presentationToolDeclarations(): RuntimeToolDeclaration[] {
  return PRESENTATION_TOOL_SPECS.map((spec) => spec.declaration);
}

async function executePresentationCall(
  toolName: "present" | "observe_display" | "fill_form" | "page_action",
  runId: string,
  callback: RuntimePresentationCallback,
  batch: PresentationBatchController,
  toolCallId: string,
  payloadInput: Record<string, unknown>,
  rawInput: Record<string, unknown>,
  signal: AbortSignal,
  fetchImpl: typeof fetch = fetch,
): Promise<PlatformToolCallResult> {
  return batch.runStep(async () => {
    signal.throwIfAborted();
    const prior = batch.failure();
    if (prior) {
      const skipped = presentationResultSchema.parse(skippedResultFor(toolName, prior, rawInput));
      return {
        result: {
          content: [{ type: "text" as const, text: JSON.stringify(skipped) }],
          details: {},
        },
        isError: false,
      };
    }
    try {
      const response = await fetchImpl(callback.url, {
        method: "POST",
        redirect: "error",
        headers: {
          "Content-Type": "application/json",
          "X-Ontomato-Callback-Credential": callback.credential,
          "X-Ontomato-Run-Id": runId,
        },
        body: JSON.stringify({ toolCallId, input: payloadInput }),
        signal,
      });
      const body: unknown = await response.json();
      if (!response.ok) {
        batch.recordFailure(toolName, `http_${response.status}`);
        return {
          result: {
            content: [{ type: "text" as const, text: JSON.stringify(body) }],
            details: {},
          },
          isError: true,
        };
      }
      const result = presentationResultSchema.parse(body);
      const failureSummary = stepFailureSummary(toolName, result);
      if (failureSummary !== null) {
        batch.recordFailure(toolName, failureSummary);
      }
      return {
        result: {
          content: [{ type: "text" as const, text: JSON.stringify(result) }],
          details: {},
        },
        isError: false,
      };
    } catch (error) {
      batch.recordFailure(toolName, error instanceof Error ? error.message : String(error));
      throw error;
    }
  });
}

/** Builds the four sequential live page-control tools bound to a shared batch early-stop controller. */
export function createPresentationTools(
  runId: string,
  callback: RuntimePresentationCallback,
  batch: PresentationBatchController = createPresentationBatchController(),
  fetchImpl: typeof fetch = fetch,
): PlatformTool[] {
  return PRESENTATION_TOOL_SPECS.map((spec) => ({
    declaration: spec.declaration,
    label: spec.label,
    executionMode: "sequential",
    replay: "never",
    execute(call) {
      const toolName = spec.declaration.name as
        | "present"
        | "observe_display"
        | "fill_form"
        | "page_action";
      return executePresentationCall(
        toolName,
        runId,
        callback,
        batch,
        call.toolCallId,
        spec.payload(call.args),
        call.args,
        call.signal,
        fetchImpl,
      );
    },
  }));
}

export interface DeclarePlatformToolsOptions {
  readonly definition: RuntimeAgentDefinition;
  readonly mcpTools?: readonly RuntimeToolDeclaration[];
  readonly hasChannel: boolean;
  readonly hasPresentation: boolean;
}

export interface PlatformToolSurface {
  readonly tools: readonly RuntimeToolDeclaration[];
  readonly engineTools: boolean;
}

/** Assembles the session-open tool declarations and `engineTools` switch from an agent definition. */
export function declarePlatformTools(options: DeclarePlatformToolsOptions): PlatformToolSurface {
  const engineTools = usesEngineTools(options.definition);
  const tools = [
    ...(engineTools ? (options.mcpTools ?? []) : []),
    ...(options.hasChannel ? [channelToolDeclaration()] : []),
    ...(options.hasPresentation ? presentationToolDeclarations() : []),
  ].map((declaration) => runtimeToolDeclarationSchema.parse(declaration));
  assertUniquePlatformToolNames(tools, engineTools);
  return { tools, engineTools };
}

export interface BindPlatformToolsOptions {
  readonly runId: string;
  readonly request: RuntimeStartRunRequest;
  readonly mcpTools?: readonly PlatformTool[];
  readonly channelTool?: PlatformTool;
  readonly presentationCallback?: RuntimePresentationCallback;
  readonly presentationBatch?: PresentationBatchController;
  readonly authorize?: (call: PlatformToolCall) => void | Promise<void>;
  readonly onClose?: () => Promise<void>;
}

/** Per-run authorized platform tool registry matching `HarnessTurnHost["invokeTool"]`. */
export interface BoundPlatformTools {
  readonly declarations: readonly RuntimeToolDeclaration[];
  readonly engineTools: boolean;
  readonly tools: readonly PlatformTool[];
  beginTurn(turnToken: unknown): void;
  invoke(call: HarnessToolCall): Promise<HarnessToolCallResult>;
  close(): Promise<void>;
}

const validatorCache = new WeakMap<object, ReturnType<typeof Compile>>();

function validateArgs(declaration: RuntimeToolDeclaration, args: RuntimeJsonObject): RuntimeJsonObject {
  let validator = validatorCache.get(declaration.parameters);
  if (!validator) {
    validator = Compile(declaration.parameters as Record<string, unknown>);
    validatorCache.set(declaration.parameters, validator);
  }
  if (validator.Check(args)) return args;
  const errors =
    [...validator.Errors(args)]
      .map((error) => `  - ${error.instancePath || "root"}: ${error.message}`)
      .join("\n") || "Unknown validation error";
  throw new Error(`Validation failed for tool "${declaration.name}":\n${errors}`);
}

function toolErrorResult(message: string): HarnessToolCallResult {
  return {
    result: {
      content: [{ type: "text", text: message }],
      details: {},
    },
    isError: true,
  };
}

/** Binds platform tools to one active run and checks authorization and schema at invocation time. */
export function bindPlatformTools(options: BindPlatformToolsOptions): BoundPlatformTools {
  const surface = declarePlatformTools({
    definition: options.request.definition,
    mcpTools: options.mcpTools?.map((tool) => tool.declaration),
    hasChannel: Boolean(options.channelTool),
    hasPresentation: Boolean(options.presentationCallback),
  });
  const presentationBatch = options.presentationCallback
    ? (options.presentationBatch ?? createPresentationBatchController())
    : undefined;
  const candidates: PlatformTool[] = [
    ...(surface.engineTools ? (options.mcpTools ?? []) : []),
    ...(options.channelTool ? [options.channelTool] : []),
    ...(options.presentationCallback
      ? createPresentationTools(options.runId, options.presentationCallback, presentationBatch)
      : []),
  ];
  const candidateByName = new Map<string, PlatformTool>();
  for (const tool of candidates) {
    if (candidateByName.has(tool.declaration.name)) {
      throw new Error("Exposed tool names must be unique");
    }
    candidateByName.set(tool.declaration.name, tool);
  }
  const tools = surface.tools.map((declaration) => {
    const tool = candidateByName.get(declaration.name);
    if (!tool) {
      throw new Error(`Missing platform tool implementation for "${declaration.name}"`);
    }
    return tool;
  });
  if (tools.length !== candidateByName.size) {
    const declaredNames = new Set(surface.tools.map((declaration) => declaration.name));
    for (const name of candidateByName.keys()) {
      if (!declaredNames.has(name)) {
        throw new Error(`Unexpected platform tool implementation for "${name}"`);
      }
    }
  }
  const byName = new Map(tools.map((tool) => [tool.declaration.name, tool]));

  return {
    declarations: surface.tools,
    engineTools: surface.engineTools,
    tools,
    beginTurn(turnToken: unknown) {
      presentationBatch?.beginTurn(turnToken);
    },
    async invoke(call: HarnessToolCall): Promise<HarnessToolCallResult> {
      call.signal.throwIfAborted();
      const tool = byName.get(call.toolName);
      if (!tool) {
        return toolErrorResult(`Tool "${call.toolName}" is not available or not authorized for this run`);
      }
      try {
        if (options.authorize) {
          await options.authorize(call);
          call.signal.throwIfAborted();
        }
        const validatedArgs = validateArgs(tool.declaration, call.args);
        return await tool.execute({
          toolCallId: call.toolCallId,
          toolName: call.toolName,
          args: validatedArgs,
          signal: call.signal,
          onUpdate: call.onUpdate,
        });
      } catch (error) {
        if (call.signal.aborted) throw error;
        return toolErrorResult(error instanceof Error ? error.message : String(error));
      }
    },
    async close() {
      await options.onClose?.();
    },
  };
}

/** Executes scoped skill commands without exposing host tokens or upstream credentials. */
export interface SessionSkillCallbackDispatcher {
  sessionChannelCommand(
    scope: Scope,
    sessionId: string,
    credential: string | undefined,
    executionContextHeader: string | undefined,
    body: unknown,
  ): Promise<unknown>;
}

/** Mounts only the callback command endpoint for the supplied dispatcher. */
export function registerSkillCallbackRoutes(app: Express, dispatcher: SessionSkillCallbackDispatcher): void {
  app.post("/v1/channel/hosts/:hostId/domains/:domainId/sessions/:sessionId/commands", (req, res, next) => {
    const handle = async () => {
      const scope = {
        hostId: runtimeKeySchema.parse(req.params.hostId),
        domainId: runtimeKeySchema.parse(req.params.domainId),
      };
      res.json(await dispatcher.sessionChannelCommand(
        scope, runtimeIdSchema.parse(req.params.sessionId),
        req.header("X-Ontomato-Callback-Credential"), req.header(BUILD_TEST_HEADER), req.body,
      ));
    };
    void handle().catch(next);
  });
}
