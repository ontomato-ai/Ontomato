import { randomUUID } from "node:crypto";
import {
  agentHostAgentListSchema,
  agentHostRunSnapshotSchema,
} from "@ontomato/contracts/agent-host";
import { environment } from "../../../../config/environment";
import { buildTurnKey } from "../../../../logging/log-context";
import { finalText } from "../../../agent-runtime/runtime";
import { runOutcome } from "../../../agent-runtime/projection";
import type { ExecutionResult } from "../types";
import { autotestConfig } from "../config";
export interface ApiChatOptions {
  domainId: string;
  question: string;
  threadId?: string;
  userId?: string;
  tk?: string;
  signal?: AbortSignal;
  caseTimeoutMs?: number;
  onStep?: (label: string) => void;
}
/** Exercise the same authenticated admission and snapshot boundary as the browser. */
export async function executeApiChat(
  o: ApiChatOptions,
): Promise<ExecutionResult> {
  const started = Date.now(),
    sessionId = randomUUID(),
    runId = randomUUID(),
    base = environment.agentRuntime().callbackUrl.replace(/\/$/, ""),
    signal = o.signal
      ? AbortSignal.any([
          o.signal,
          AbortSignal.timeout(o.caseTimeoutMs ?? autotestConfig.caseTimeoutMs),
        ])
      : AbortSignal.timeout(o.caseTimeoutMs ?? autotestConfig.caseTimeoutMs);
  async function request(
    path: string,
    method = "GET",
    body?: unknown,
    key?: string,
    requestSignal: AbortSignal | undefined = signal,
  ) {
    const r = await fetch(base + "/api/assistant" + path, {
      method,
      headers: {
        "Content-Type": "application/json",
        tk: o.tk ?? "",
        ...(key ? { "Idempotency-Key": key } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: requestSignal,
    });
    const data = await r.json();
    if (!r.ok)
      throw new Error(data.error?.message ?? `Assistant HTTP ${r.status}`);
    return data;
  }
  let admitted = false;
  try {
    const { agents } = agentHostAgentListSchema.parse(await request("/agents"));
    const agent = agents[0];
    if (!agent?.enabled) throw new Error("Query assistant is unavailable");
    await request("/sessions", "POST", { agentId: agent.id }, sessionId);
    await request(
      `/sessions/${sessionId}/runs`,
      "POST",
      { message: o.question },
      runId,
    );
    admitted = true;
    for (;;) {
      signal.throwIfAborted();
      const s = agentHostRunSnapshotSchema.parse(
        await request(`/sessions/${sessionId}/runs/${runId}`),
      );
      if (s.run.status === "stopped") {
        const outcome = runOutcome(s.run);
        return {
          turnKey: buildTurnKey(sessionId, 0),
          durationMs: Date.now() - started,
          status:
            outcome === "completed"
              ? "success"
              : outcome === "cancelled"
                ? "cancelled"
                : "error",
          finalAnswer: finalText(s),
          error: s.run.errorMessage ?? undefined,
        };
      }
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  } catch (error) {
    if (signal.aborted && admitted)
      await request(
        `/sessions/${sessionId}/runs/${runId}/cancel`,
        "POST",
        {},
        undefined,
        AbortSignal.timeout(30000),
      );
    return {
      turnKey: buildTurnKey(sessionId, 0),
      durationMs: Date.now() - started,
      status: signal.aborted ? "cancelled" : "error",
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
