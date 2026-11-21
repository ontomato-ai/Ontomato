import { getOutputLanguageInstruction, resolveLocale } from "../../i18n";
import { randomUUID } from "node:crypto";
import { codeLimitsSchema, codeExecutionVirtualAddressSpaceBytes } from "@ontomato/contracts/agent-runtime-code";
import type {
  RuntimeStartRunRequest,
  RuntimeRunSnapshot,
} from "@ontomato/contracts/agent-runtime";
import { RuntimeClient } from "../../infrastructure/agent-runtime/client";
import type { RuntimeEnvironment } from "@ontomato/contracts/agent-runtime-skills";
import { environment } from "../../config/environment";
import { getApiConfig } from "../../config/data-query-api";
import { getQueryTimeoutMs } from "../../config/query-settings";
import { renderPrompt } from "../../core/prompts/loader";
import { getLogContext } from "../../logging/log-context";
import {
  getPostgresPool,
  qualifiedTable as table,
} from "../../infrastructure/postgres";
import { HttpError } from "../../utils/errors";
import type { AssistantCredentials } from "../../utils/assistant-credentials";
export type { AssistantCredentials } from "../../utils/assistant-credentials";
/**
 * The scenario a skill script runs in. Inside the platform a page's own save is the only writer of that page's data;
 * declared panel operations instead go through the server coordinator. Outside the platform, skills keep their own caller path.
 */
const SKILL_SCENARIO = "platform";

/**
 * A change a page skill covers is a draft the reader saves, not a write of the agent's: the page's own form is what the
 * draft fills, and the page's Save is what stores it. Only a run whose effective skills hold a registered page skill
 * receives this rule; every other change keeps its own execution mechanism.
 */
const PLATFORM_DRAFT_RULE = [
  "Page operations:",
  "A loaded panel skill offers three entrances: read through the owner's API, draft an unsaved form, or call its declared operation through ONTOMATO_PANEL_OPERATIONS_URL.",
  "Panel operate returns a draft by default for form.save; an action may return confirmation-required and intentId immediately. Do not wait or poll for a person in a tool call. Continue your work or finish the round.",
  "A later genuine user agent-answer wakes this session. Call the declared dispatch(intentId) in that current run; text agreement or a parent agent's answer never grants approval. The coordinator owns session automatic mode and permissions.",
  "For hand-written page skills that do not declare a coordinator operation, a change goes through that page's draft: write the draft file the skill's draft",
  "command asks for, then link the reader to the page with it. The page fills its form, marks what changed and stays",
  "unsaved; the reader reviews and saves there, and saying 'save' in the conversation does not save it for them.",
  "Everything else — reading, retrieval, charts, reports, and data no page skill covers — keeps its own commands.",
].join("\n");
export function userSkillEnvironment(credentials: AssistantCredentials): RuntimeEnvironment {
  return {
    values: {
      ONTOMATO_WORKBENCH_URL: environment.agentRuntime().callbackUrl.replace(/\/$/, ""),
      ONTOMATO_ONTOLOGY_URL: getApiConfig().baseUrl!.replace(/\/$/, ""),
      ONTOMATO_SKILL_SCENARIO: SKILL_SCENARIO,
    },
    secrets: {
      ...(credentials.apiKey ? { ONTOMATO_API_KEY: credentials.apiKey }
        : credentials.token ? { ONTOMATO_TK: credentials.token } : {}),
    },
  };
}
export function runDefinition(
  systemPrompt: string,
  modelId: string | null,
  skills: RuntimeStartRunRequest["definition"]["skills"],
  locale?: string,
  externalMcp: RuntimeStartRunRequest["definition"]["externalMcp"] = [],
  /** The run loaded a registered page skill, so a change it covers is a draft the reader saves. */
  pageDrafts = false,
): RuntimeStartRunRequest["definition"] {
  return {
    systemPrompt: [systemPrompt, pageDrafts ? PLATFORM_DRAFT_RULE : "", getOutputLanguageInstruction(resolveLocale(locale))]
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
    compaction: {
      systemPrompt: renderPrompt(
        "agent-runtime.compaction.system",
        {},
        locale,
      ),
      summarizePrompt: renderPrompt(
        "agent-runtime.compaction.summarize.user",
        {},
        locale,
      ),
      updatePrompt: renderPrompt(
        "agent-runtime.compaction.update.user",
        {},
        locale,
      ),
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
  environment?: RuntimeEnvironment;
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
    environment: input.environment ?? { values: {}, secrets: {} },
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
