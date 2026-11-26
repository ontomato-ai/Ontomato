import { tApp, tForLocale } from "../../i18n";
import type { AbcQuestionMode } from "@ontomato/contracts/system-model";
import type { QcState, ThreadQualityCheckResponse } from "@ontomato/contracts/query-thinking";
import { createLogger } from "../../logging/logger";
import { BackendResponseError } from "../../utils/backend-client";
import { streamSelfCheckSSE } from "./quality-check";
import type { QueryRunIdentity } from "./query-fact";
import {
  getQueryRunQualityCheck,
  STANDARD_QUERY_SOURCE_KIND,
  STANDARD_QUERY_SOURCE_REF,
  updateQueryRunQualityCheck,
} from "./query-run-store";

const logger = createLogger("data-query:late-fact");

export const LATE_FACT_SETTLE_TIMEOUT_MS = 120_000;

/** Observes analysis quality checks, which write results for later review. */
export class PendingLateFacts {
  private readonly pending = new Set<Promise<void>>();

  register(settled: Promise<void>): void {
    const tracked = settled.catch(() => undefined).then(() => undefined);
    this.pending.add(tracked);
    void tracked.finally(() => this.pending.delete(tracked));
  }
}

export interface QualityCheckSettlementInput {
  identity: QueryRunIdentity;
  sessionId: string;
  abcQuestionMode: AbcQuestionMode;
  token?: string;
  apiKey?: string;
  userId?: string;
  locale?: string;
  signal?: AbortSignal;
}

function unsettledQualityCheck(state: QcState, timedOut: boolean, locale?: string): QcState {
  return {
    status: "unsettled",
    steps: [...state.steps, {
      summary: tForLocale(locale, timedOut ? "query.qcProcess.timedOut" : "query.qcProcess.cancelled"),
      status: "failed",
      timestamp: Date.now(),
    }],
  };
}

/** Saves the pending check before the answer closes, so history and live views can pick it up. */
export async function startTrackedQualityCheck(
  input: QualityCheckSettlementInput
): Promise<QcState | undefined> {
  const deadlineAt = Date.now() + LATE_FACT_SETTLE_TIMEOUT_MS;
  const qcState: QcState = { status: "running", steps: [], deadlineAt };
  const updated = await updateQueryRunQualityCheck({
    ...input.identity,
    qcState,
    previousStatus: null,
  });
  if (updated === 0) return;

  void startQualityCheckSettlement(input, deadlineAt).catch(() => undefined);
  return qcState;
}

/** Reads the original query and settles an expired check if its background reader was interrupted. */
export async function readTrackedQualityCheck(
  threadId: string,
  requestSeq: number,
  locale: string
): Promise<ThreadQualityCheckResponse> {
  const identity = {
    threadId,
    requestSeq,
    sourceKind: STANDARD_QUERY_SOURCE_KIND,
    sourceRef: STANDARD_QUERY_SOURCE_REF,
  };
  const check = await getQueryRunQualityCheck(identity);
  if (
    check?.qcState.status !== "running" ||
    check.qcState.deadlineAt === undefined ||
    check.qcState.deadlineAt > Date.now()
  ) {
    return check;
  }

  const qcState = unsettledQualityCheck(check.qcState, true, locale);
  const updated = await updateQueryRunQualityCheck({ ...identity, qcState, previousStatus: "running" });
  return updated ? { qcState } : getQueryRunQualityCheck(identity);
}

/** Reads one quality check and writes its result back to the original execution facts. */
export async function startQualityCheckSettlement(
  input: QualityCheckSettlementInput,
  deadlineAt?: number
): Promise<void> {
  const { identity, sessionId, signal } = input;
  let state: QcState = { status: "running", steps: [] };
  const bound = new AbortController();
  const abortOnCaller = () => bound.abort();
  if (signal?.aborted) bound.abort();
  else signal?.addEventListener("abort", abortOnCaller);
  let timedOut = false;
  const waitMs = deadlineAt === undefined
    ? LATE_FACT_SETTLE_TIMEOUT_MS
    : Math.max(0, deadlineAt - Date.now());
  const timer = setTimeout(() => {
    timedOut = true;
    bound.abort();
  }, waitMs);

  try {
    const result = await streamSelfCheckSSE({
      sessionId,
      abcQuestionMode: input.abcQuestionMode,
      token: input.token,
      apiKey: input.apiKey,
      userId: input.userId,
      locale: input.locale,
      signal: bound.signal,
      onStep: (step) => {
        state.steps.push({
          summary: step.summary,
          meaning: step.meaning,
          status: "done",
          timestamp: Date.now(),
        });
      },
      onFinish: (finished) => {
        state.status = "completed";
        state.result = {
          conclusion: finished.conclusion,
          score: finished.score,
          fittedQuestion: finished.fittedQuestion,
        };
      },
      onError: (error) => {
        if (bound.signal.aborted) return;
        state.status = "failed";
        state.steps.push({
          summary: tForLocale(input.locale, "query.qcProcess.readFailed"),
          meaning: error instanceof BackendResponseError ? error.detail : error.message,
          status: "failed",
          timestamp: Date.now(),
        });
      },
    });
    if (state.status === "running" && (timedOut || signal?.aborted)) {
      state = unsettledQualityCheck(state, timedOut, input.locale);
    }

    const updated = await updateQueryRunQualityCheck({
      ...identity,
      qcResult: result ?? undefined,
      qcState: state,
      previousStatus: deadlineAt === undefined ? undefined : "running",
    });
    if (updated === 0 && deadlineAt === undefined) {
      logger.warn(tApp("queryFixed.259"), {
        sourceKind: identity.sourceKind,
        sourceRef: identity.sourceRef,
      });
    }
  } catch (error) {
    logger.warn(tApp("queryFixed.260"), {
      sourceKind: identity.sourceKind,
      sourceRef: identity.sourceRef,
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", abortOnCaller);
  }
}
