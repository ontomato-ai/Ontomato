import { getPostgresPool, qualifiedTable } from "../../infrastructure/postgres";
import { createLogger } from "../../logging/logger";
import { HttpError } from "../../utils/errors";

const logger = createLogger("turn-run");

export interface TurnRun {
  threadId: string;
  requestSeq: number;
  status: "running" | "completed" | "failed" | "cancelled" | string;
  source?: string;
  displayMessage?: string;
  startedAt: Date;
  answerCompletedAt?: Date;
  endedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

interface StartTurnRunInput {
  threadId: string;
  requestSeq: number;
  source?: string;
  startedAt?: Date;
}

interface FinishTurnRunInput {
  threadId: string;
  requestSeq: number;
  status: Exclude<TurnRun["status"], "running">;
  endedAt?: Date;
}

function mapTurnRunRow(row: any): TurnRun {
  return {
    threadId: row.thread_id,
    requestSeq: row.request_seq,
    status: row.status,
    source: row.source || undefined,
    displayMessage: row.display_message || undefined,
    startedAt: row.started_at,
    answerCompletedAt: row.answer_completed_at || undefined,
    endedAt: row.ended_at || undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/**
 * Time to the answer, excluding the later quality-check wait. Runs without a separate
 * answer boundary (including old stored rows) retain their recorded terminal duration.
 */
export function turnRunDurationMs(turn: TurnRun | null | undefined): number | undefined {
  if (!turn) return undefined;
  const completedAt = turn.answerCompletedAt ?? (turn.status === "running" ? undefined : turn.endedAt);
  if (!completedAt) return undefined;
  const durationMs = new Date(completedAt).getTime() - new Date(turn.startedAt).getTime();
  return Number.isFinite(durationMs) && durationMs > 0 ? durationMs : undefined;
}

/** Saves the answer boundary while the run remains open for quality-check results. */
export async function recordTurnAnswerCompletion(input: {
  threadId: string;
  requestSeq: number;
  completedAt: Date;
}): Promise<void> {
  await getPostgresPool().query(
    `UPDATE ${qualifiedTable("turn_runs")}
       SET answer_completed_at = $3
       WHERE thread_id = $1 AND request_seq = $2`,
    [input.threadId, input.requestSeq, input.completedAt]
  );
}

export async function startStandardTurnRun(input: {
  threadId: string;
  userId: string;
  domainId: string;
  title?: string;
  displayMessage: string;
  startedAt?: Date;
}): Promise<number> {
  const startedAt = input.startedAt ?? new Date();
  const result = await getPostgresPool().query(
    `WITH next_turn AS (
         INSERT INTO ${qualifiedTable("thread_metadata")}
           (thread_id, user_id, domain_id, title, thread_type, last_request_seq, created_at, updated_at)
         VALUES ($1, $2, $6, $3, 'qa', 0, $5, $5)
         ON CONFLICT (thread_id)
         DO UPDATE SET
           last_request_seq = COALESCE(${qualifiedTable("thread_metadata")}.last_request_seq, -1) + 1,
           title = COALESCE(${qualifiedTable("thread_metadata")}.title, EXCLUDED.title),
           updated_at = EXCLUDED.updated_at
         WHERE ${qualifiedTable("thread_metadata")}.user_id = EXCLUDED.user_id
           AND ${qualifiedTable("thread_metadata")}.domain_id = EXCLUDED.domain_id
         RETURNING last_request_seq
       )
       INSERT INTO ${qualifiedTable("turn_runs")}
         (thread_id, request_seq, status, source, display_message,
          started_at, created_at, updated_at)
       SELECT $1, next_turn.last_request_seq, 'running', 'chat', $4, $5, $5, $5
       FROM next_turn
       RETURNING request_seq`,
    [
      input.threadId,
      input.userId,
      input.title || null,
      input.displayMessage,
      startedAt,
      input.domainId,
    ]
  );
  if (!result.rows.length) throw new HttpError(403, "Thread access denied");
  return Number(result.rows[0].request_seq);
}

export async function startTurnRun(input: StartTurnRunInput): Promise<void> {
  const startedAt = input.startedAt ?? new Date();
  await getPostgresPool().query(
    `INSERT INTO ${qualifiedTable("turn_runs")}
        (thread_id, request_seq, status, source, started_at, created_at, updated_at)
       VALUES ($1,$2,'running',$3,$4,$4,$4)
       ON CONFLICT (thread_id, request_seq)
       DO UPDATE SET
         status = CASE
           WHEN ${qualifiedTable("turn_runs")}.ended_at IS NULL THEN 'running'
           ELSE ${qualifiedTable("turn_runs")}.status
         END,
         source = COALESCE(EXCLUDED.source, ${qualifiedTable("turn_runs")}.source),
         started_at = LEAST(${qualifiedTable("turn_runs")}.started_at, EXCLUDED.started_at),
         updated_at = CASE
           WHEN ${qualifiedTable("turn_runs")}.ended_at IS NULL THEN EXCLUDED.updated_at
           ELSE ${qualifiedTable("turn_runs")}.updated_at
         END`,
    [input.threadId, input.requestSeq, input.source || null, startedAt]
  );
}

/** The first terminal write wins: a turn already ended (e.g. at a user cancel) keeps its status and end. */
export async function finishTurnRun(input: FinishTurnRunInput): Promise<TurnRun | null> {
  const endedAt = input.endedAt ?? new Date();
  const result = await getPostgresPool().query(
    `INSERT INTO ${qualifiedTable("turn_runs")}
        (thread_id, request_seq, status, started_at, ended_at, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$4,$4,$4)
       ON CONFLICT (thread_id, request_seq)
       DO UPDATE SET
         status = CASE
           WHEN ${qualifiedTable("turn_runs")}.ended_at IS NULL THEN EXCLUDED.status
           ELSE ${qualifiedTable("turn_runs")}.status
         END,
         ended_at = COALESCE(${qualifiedTable("turn_runs")}.ended_at, EXCLUDED.ended_at),
         updated_at = CASE
           WHEN ${qualifiedTable("turn_runs")}.ended_at IS NULL THEN EXCLUDED.updated_at
           ELSE ${qualifiedTable("turn_runs")}.updated_at
         END
       RETURNING *`,
    [input.threadId, input.requestSeq, input.status, endedAt]
  );
  return result.rows[0] ? mapTurnRunRow(result.rows[0]) : null;
}

export async function getTurnRun(threadId: string, requestSeq: number): Promise<TurnRun | null> {
  const result = await getPostgresPool().query(
    `SELECT * FROM ${qualifiedTable("turn_runs")}
       WHERE thread_id = $1 AND request_seq = $2
       LIMIT 1`,
    [threadId, requestSeq]
  );
  return result.rows[0] ? mapTurnRunRow(result.rows[0]) : null;
}

export async function listTurnRuns(threadId: string): Promise<TurnRun[]> {
  const result = await getPostgresPool().query(
    `SELECT * FROM ${qualifiedTable("turn_runs")}
       WHERE thread_id = $1
       ORDER BY request_seq`,
    [threadId]
  );
  return result.rows.map(mapTurnRunRow);
}

export async function deleteThreadTurnRuns(threadId: string): Promise<void> {
  await getPostgresPool().query(`DELETE FROM ${qualifiedTable("turn_runs")} WHERE thread_id = $1`, [
    threadId,
  ]);
}

export async function recordTurnRunStart(input: StartTurnRunInput): Promise<void> {
  try {
    await startTurnRun(input);
  } catch (error) {
    logger.warn("Turn run start record failed", {
      threadId: input.threadId,
      requestSeq: input.requestSeq,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

export async function recordTurnRunFinish(input: FinishTurnRunInput): Promise<TurnRun | null> {
  try {
    return await finishTurnRun(input);
  } catch (error) {
    logger.warn("Turn run finish record failed", {
      threadId: input.threadId,
      requestSeq: input.requestSeq,
      status: input.status,
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}
