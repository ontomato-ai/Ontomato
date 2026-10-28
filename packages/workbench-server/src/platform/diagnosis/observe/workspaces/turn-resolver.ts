import { HttpError } from "../../../../utils/errors";
import type { WorkspaceUpstreamTurn } from "@ontomato/contracts/observe";
import type { QueryBackendSession } from "@ontomato/contracts/query-execution";
import type { BackendLogTimeWindow } from "../workspace-artifact/log-collector";
import type { LogFileTimeWindow } from "../../../../logging/log-file-transport";
import {
  assistantEvidenceReader,
  type DiagnosticAssistantEvidence,
  type DiagnosticTurnTimes,
  type DiagnosticQueryEvidence,
  type AssistantEvidenceReader,
} from "./assistant-source";
import {
  buildTurnIdentity,
  buildTurnKey,
  parseTurnKey,
  type TurnIdentity,
} from "../../../../logging/log-context";
const BACKEND_LOG_WINDOW_PADDING_MS = 5000;
const FRONTEND_LOG_WINDOW_PADDING_MS = 5000;
export interface TurnResolverDeps {
  domainId: string;
  readEvidence?: AssistantEvidenceReader["readTurn"];
  includePreviousNoQueryTurn?: boolean;
}
export interface ResolvedUpstreamTurn extends WorkspaceUpstreamTurn {
  snapshot?: unknown;
}
export interface ResolvedTurnWorkspaceContext {
  turn: TurnIdentity;
  question?: string;
  finalAnswer?: string;
  snapshot?: DiagnosticAssistantEvidence;
  turnRun?: DiagnosticTurnTimes | null;
  selectedQueryRun?: DiagnosticQueryEvidence | null;
  primaryQueryRun?: DiagnosticQueryEvidence | null;
  frontendLogTimeWindow?: LogFileTimeWindow;
  upstreamTurns: ResolvedUpstreamTurn[];
}
type TurnWorkspaceInput = Pick<TurnIdentity, "threadId" | "requestSeq"> &
  Partial<
    Pick<TurnIdentity, "turnKey" | "parentTurnKey" | "sourceKind" | "sourceRef">
  >;
export function parseTurnKeyOrThrow(turnKey: string): TurnIdentity {
  const turn = parseTurnKey(turnKey);
  if (!turn) throw new Error("Invalid turnKey");
  return turn;
}
export async function resolveTurnWorkspaceContext(
  input: TurnWorkspaceInput,
  deps: TurnResolverDeps,
): Promise<ResolvedTurnWorkspaceContext> {
  const turn = normalizeTurnWorkspaceInput(input),
    reader = deps.readEvidence ?? assistantEvidenceReader().readTurn;
  const evidence = await reader(turn.threadId, turn.requestSeq, {
    domainId: deps.domainId,
    scope: "domain",
  });
  const query = turn.sourceRef
    ? evidence.queries.find((q) => q.sourceRef === turn.sourceRef)
    : evidence.queries[0];
  if (turn.sourceRef && !query)
    throw new Error("Retrieval evidence is unavailable");
  const previous =
    deps.includePreviousNoQueryTurn === false
      ? null
      : await resolvePreviousNoQueryTurn(turn, deps);
  const start = evidence.turnRun.startedAt.getTime(),
    end = evidence.turnRun.endedAt?.getTime() ?? Date.now();
  return {
    turn,
    question: turn.sourceRef ? query?.question : evidence.question,
    finalAnswer: turn.sourceRef ? query?.fullContent : evidence.answer,
    snapshot: evidence,
    turnRun: evidence.turnRun,
    selectedQueryRun: query,
    primaryQueryRun: turn.sourceRef ? undefined : query,
    frontendLogTimeWindow: {
      startTime: new Date(
        Math.max(0, start - FRONTEND_LOG_WINDOW_PADDING_MS),
      ).toISOString(),
      endTime: new Date(end + FRONTEND_LOG_WINDOW_PADDING_MS).toISOString(),
    },
    upstreamTurns: previous ? [previous] : [],
  };
}
export async function resolvePreviousNoQueryTurn(
  target: Pick<TurnIdentity, "threadId" | "requestSeq">,
  deps: TurnResolverDeps,
): Promise<ResolvedUpstreamTurn | null> {
  const seq = target.requestSeq - 1;
  if (seq < 0) return null;
  let evidence;
  try {
    evidence = await (deps.readEvidence ?? assistantEvidenceReader().readTurn)(
      target.threadId,
      seq,
      { domainId: deps.domainId, scope: "domain" },
    );
  } catch (error) {
    if (error instanceof HttpError && error.status === 404) return null;
    throw error;
  }
  if (evidence.retrievalRequested) return null;
  return {
    turnKey: buildTurnKey(target.threadId, seq),
    threadId: target.threadId,
    requestSeq: seq,
    relation: "previous_no_query",
    reason: "previous turn admitted no retrieval",
    question: evidence.question,
    finalAnswer: evidence.answer,
    snapshotMode: "assistant",
    snapshotStatus: evidence.turnRun.status,
    queryRunCount: 0,
    executionEventCount: evidence.runs.reduce(
      (count, run) => count + run.toolExecutions.length,
      0,
    ),
    snapshot: evidence,
  };
}
export function resolveQueryRunBackendSessions(
  queryRun?: DiagnosticQueryEvidence | null,
): QueryBackendSession[] {
  return queryRun?.backendSessions ?? [];
}

export function resolveTurnRunBackendTimeWindow(
  turnRun?: DiagnosticTurnTimes | null,
): BackendLogTimeWindow | undefined {
  if (!turnRun) return undefined;
  const start = parseTimestamp(turnRun.startedAt);
  if (start === null) return undefined;
  const minTs = Math.max(0, start - BACKEND_LOG_WINDOW_PADDING_MS);
  if (turnRun.status === "running") {
    return { minTs, turnRunning: true };
  }

  const end =
    parseTimestamp(turnRun.endedAt) ?? parseTimestamp(turnRun.updatedAt);
  if (end === null || end < start) return undefined;
  return {
    minTs,
    maxTs: end + BACKEND_LOG_WINDOW_PADDING_MS,
    turnRunning: false,
  };
}

export interface TurnActualTimes {
  startedAt: string;
  endedAt?: string;
}

/** Actual query start/end (turn run), without log time-window padding, kept separate from the workspace generation time in the manifest. */
export function resolveTurnRunActualTimes(
  turnRun?: DiagnosticTurnTimes | null,
): TurnActualTimes | undefined {
  if (!turnRun) return undefined;
  const startedAt = toIsoString(turnRun.startedAt);
  if (!startedAt) return undefined;
  const endedAt = toIsoString(turnRun.endedAt);
  return endedAt ? { startedAt, endedAt } : { startedAt };
}

function toIsoString(value: unknown): string | undefined {
  const ts = parseTimestamp(value);
  return ts === null ? undefined : new Date(ts).toISOString();
}

function parseTimestamp(value: unknown): number | null {
  if (value instanceof Date) {
    const time = value.getTime();
    return Number.isFinite(time) ? time : null;
  }
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const time = Date.parse(value);
    return Number.isFinite(time) ? time : null;
  }
  return null;
}

function normalizeTurnWorkspaceInput(input: TurnWorkspaceInput): TurnIdentity {
  if (input.turnKey) {
    const parsed = parseTurnKeyOrThrow(input.turnKey);
    if (
      parsed.threadId !== input.threadId ||
      parsed.requestSeq !== input.requestSeq
    ) {
      throw new Error("turnKey does not match threadId/requestSeq");
    }
    return parsed;
  }
  return buildTurnIdentity(input.threadId, input.requestSeq);
}
