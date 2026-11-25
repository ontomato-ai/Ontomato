import { getOutputLanguageInstruction, resolveLocale } from "../../i18n";
import { randomUUID } from "node:crypto";
import { codeLimitsSchema, codeExecutionVirtualAddressSpaceBytes } from "@ontomato/contracts/agent-runtime-code";
import type {
  RuntimeStartRunRequest,
  RuntimeRunSnapshot,
} from "@ontomato/contracts/agent-runtime";
import { RuntimeClient } from "../../infrastructure/agent-runtime/client";
import { getQueryTimeoutMs } from "../../config/query-settings";
import { getLogContext } from "../../logging/log-context";
import {
  getPostgresPool,
  qualifiedTable as table,
} from "../../infrastructure/postgres";
import { HttpError } from "../../utils/errors";
import type { AssistantCredentials } from "../../utils/assistant-credentials";
export type { AssistantCredentials } from "../../utils/assistant-credentials";

/** Guidance for runs that load a registered page skill. */
const PAGE_CONTROL_RULE = [
  "Page operations:",
  "A loaded panel skill works through two layers: read persisted data via `$ONTOMATO_PANEL_OPERATIONS_URL/read` (and `/nested`), and control the displayed page beside the conversation via the live display tools (`observe_display`, `present`, `fill_form`, `page_action`).",
  "Use `present` to open a page or update declared public state in place, `fill_form` to edit fields directly in a mounted form (keeping it unsaved and marking changed fields), and `page_action` to invoke declared operations (including form save, button actions, row actions, batch actions, refresh, and discard) through the exact same UI entry a human clicks.",
  "Use `fill_form` for edits and let the page supply its current form values when saving. In default confirmation mode, `page_action` prepares the intent and returns `awaiting_confirmation` immediately while the confirmation prompt appears in the conversation; do not wait or poll. When the user confirms in the conversation, the page verifies that the instance, target, and form contents have not changed before dispatching. In full-auto sessions, `page_action` executes immediately.",
  "Everything else — reading, retrieval, charts, reports, and data no page skill covers — keeps its own commands.",
].join("\n");
export function runDefinition(
  systemPrompt: string,
  modelId: string | null,
  skills: RuntimeStartRunRequest["definition"]["skills"],
  locale?: string,
  externalMcp: RuntimeStartRunRequest["definition"]["externalMcp"] = [],
  /** The run loaded a registered page skill. */
  pageControl = false,
): RuntimeStartRunRequest["definition"] {
  return {
    systemPrompt: [systemPrompt, pageControl ? PAGE_CONTROL_RULE : "", getOutputLanguageInstruction(resolveLocale(locale))]
      .filter(Boolean).join("\n\n"),
    modelId,
    skills,
    externalMcp,
    sandbox: {
      limits: codeLimitsSchema.parse({
        memoryBytes: codeExecutionVirtualAddressSpaceBytes,
        wallTimeMs: getQueryTimeoutMs(),
        cpuSeconds: Math.ceil(getQueryTimeoutMs() / 1000),
      }),
    },
  };
}
export function messageText(m: { content: unknown }): string {
  return typeof m.content === "string"
    ? m.content
    : Array.isArray(m.content)
      ? m.content
          .filter((p) => p?.type === "text")
          .map((p) => p.text)
          .join("\n")
      : "";
}
/** The text of the message the runtime named as the run's answer; empty when the run has none. */
export function answerText(s: Pick<RuntimeRunSnapshot, "messages"> & { run: { answerMessageId: string | null } }) {
  const answer = s.messages.find((m) => m.id === s.run.answerMessageId);
  return answer ? messageText(answer.message) : "";
}
const WAIT_STEP_MS = 30_000;
/**
 * Waits for the runtime to report the stop, by repeated bounded waits rather than polling. Returns the stopped
 * view, or the last view once the deadline passes.
 */
export async function waitUntilStopped(
  client: RuntimeClient,
  id: string,
  options: { deadline?: number; signal?: AbortSignal } = {},
) {
  for (;;) {
    options.signal?.throwIfAborted();
    const left = options.deadline === undefined ? WAIT_STEP_MS : Math.min(WAIT_STEP_MS, options.deadline - Date.now());
    const view = await client.waitStopped(id, left, options.signal);
    if (view.status === "stopped" || (options.deadline !== undefined && Date.now() >= options.deadline)) return view;
  }
}
export async function waitForRun(
  client: RuntimeClient,
  id: string,
  signal?: AbortSignal,
) {
  try {
    await waitUntilStopped(client, id, { signal });
    return await client.run(id);
  } catch (error) {
    if (signal?.aborted) await client.cancel(id);
    throw error;
  }
}
/** Auxiliary model consumers use ordinary sessions and retain only their ownership reference. */
interface AuxiliaryInput {
  systemPrompt: string;
  message: string;
  signal?: AbortSignal;
  domainId?: string;
  userId?: string;
  credentials?: AssistantCredentials;
}
export async function startAuxiliary(input: AuxiliaryInput) {
  const ctx = getLogContext(),
    domainId = input.domainId ?? ctx?.domainId;
  if (!domainId || !(input.userId ?? ctx?.userId))
    throw new HttpError(
      400,
      "Verified user and domain are required for an auxiliary run",
    );
  const credentials = input.credentials ?? {
      token: ctx?.token,
      apiKey: ctx?.apiKey,
    },
    client = new RuntimeClient(domainId),
    sessionId = randomUUID(),
    runId = randomUUID();
  await getPostgresPool().query(
    `INSERT INTO ${table("assistant_auxiliary_sessions")} (id,domain_id,owner_id,parent_session_id) VALUES($1,$2,$3,$4)`,
    [
      sessionId,
      domainId,
      input.userId ?? ctx?.userId ?? "",
      ctx?.turn?.threadId ?? null,
    ],
  );
  await client.createSession(sessionId);
  await client.start(sessionId, runId, {
    language: resolveLocale(credentials.locale),
    input: { role: "user", content: input.message, timestamp: Date.now() },
    definition: runDefinition(
      input.systemPrompt,
      null,
      [],
      credentials.locale,
    ),
  });
  return { client, runId, sessionId };
}
export async function runAuxiliary(input: AuxiliaryInput) {
  const { client, runId } = await startAuxiliary(input);
  const s = await waitForRun(client, runId, input.signal);
  if (s.run.stopReason !== "stop")
    throw new Error(s.run.errorMessage ?? `Model stopped: ${s.run.stopReason}`);
  return answerText(s);
}
