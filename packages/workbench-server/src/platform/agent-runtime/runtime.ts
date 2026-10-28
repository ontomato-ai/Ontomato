import { getOutputLanguageInstruction } from "../../i18n";
import { randomUUID } from "node:crypto";
import { codeLimitsSchema } from "@ontomato/contracts/agent-runtime-code";
import type {
  RuntimeStartRunRequest,
  RuntimeRunSnapshot,
} from "@ontomato/contracts/agent-runtime";
import { RuntimeClient } from "../../infrastructure/agent-runtime/client";
import { getQueryTimeoutMs } from "../../config/query-settings";
import { renderPrompt } from "../../core/prompts/loader";
import { getLogContext } from "../../logging/log-context";
import {
  getPostgresPool,
  qualifiedTable as table,
} from "../../infrastructure/postgres";
import { HttpError } from "../../utils/errors";
export interface AssistantCredentials {
  token?: string;
  apiKey?: string;
  locale?: string;
}
export function runDefinition(
  systemPrompt: string,
  modelRole: string,
  skills: RuntimeStartRunRequest["definition"]["skills"],
  locale?: string,
): RuntimeStartRunRequest["definition"] {
  return {
    systemPrompt: systemPrompt + "\n\n" + getOutputLanguageInstruction(locale),
    modelRole,
    skills,
    externalMcp: [],
    sandbox: {
      limits: codeLimitsSchema.parse({
        memoryBytes: 16 * 1024 ** 3,
        wallTimeMs: getQueryTimeoutMs(),
        cpuSeconds: Math.ceil(getQueryTimeoutMs() / 1000),
      }),
    },
    compaction: {
      systemPrompt: renderPrompt(
        "knowledge-governance.compaction.system",
        {},
        locale,
      ),
      summarizePrompt: renderPrompt(
        "knowledge-governance.compaction.summarize.user",
        {},
        locale,
      ),
      updatePrompt: renderPrompt(
        "knowledge-governance.compaction.update.user",
        {},
        locale,
      ),
    },
  };
}
export function modelCredential(
  c: AssistantCredentials,
): RuntimeStartRunRequest["modelCredential"] {
  return c.apiKey
    ? { kind: "api_key", value: c.apiKey }
    : c.token
      ? { kind: "token", value: c.token }
      : { kind: "none" };
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
export function finalText(s: Pick<RuntimeRunSnapshot, "messages">) {
  return (
    [...s.messages]
      .reverse()
      .filter((m) => m.message.role === "assistant")
      .map((m) => messageText(m.message))
      .find(Boolean) ?? ""
  );
}
export async function waitForRun(
  client: RuntimeClient,
  id: string,
  signal?: AbortSignal,
) {
  try {
    for (;;) {
      signal?.throwIfAborted();
      const s = await client.run(id);
      if (s.run.status === "stopped") return s;
      await new Promise<void>((resolve) => setTimeout(resolve, 250));
    }
  } catch (error) {
    if (signal?.aborted) await client.cancel(id);
    throw error;
  }
}
/** Auxiliary model consumers use ordinary sessions and retain only their ownership reference. */
export async function runAuxiliary(input: {
  systemPrompt: string;
  message: string;
  modelRole?: string;
  signal?: AbortSignal;
  domainId?: string;
  userId?: string;
  credentials?: AssistantCredentials;
}) {
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
    language: credentials.locale ?? "en",
    input: { role: "user", content: input.message, timestamp: Date.now() },
    definition: runDefinition(
      input.systemPrompt,
      input.modelRole ?? "general",
      [],
      credentials.locale,
    ),
    environment: { values: {}, secrets: {} },
    modelCredential: modelCredential(credentials),
  });
  const s = await waitForRun(client, runId, input.signal);
  if (s.run.stopReason !== "stop")
    throw new Error(s.run.errorMessage ?? `Model stopped: ${s.run.stopReason}`);
  return finalText(s);
}
