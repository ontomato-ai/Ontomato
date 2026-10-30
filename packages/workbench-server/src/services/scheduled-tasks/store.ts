import type pg from "pg";
import {
  scheduledTaskFrequencySchema,
  scheduledTaskPauseReasonSchema,
  scheduledTaskRunErrorCodeSchema,
  type ScheduledTaskFrequency,
  type ScheduledTaskInput,
  type ScheduledTaskPauseReason,
  type ScheduledTaskRunErrorCode,
} from "@ontomato/contracts/scheduled-tasks";
import { getPostgresPool, qualifiedTable as table } from "../../infrastructure/postgres";
import { transaction } from "../../infrastructure/postgres-transaction";

export interface ScheduledTaskOwner {
  domainId: string;
  userId: string;
}

export interface TaskRecord {
  id: string;
  domainId: string;
  ownerId: string;
  agentId: string;
  prompt: string;
  frequency: ScheduledTaskFrequency;
  notifyEmail: string | null;
  locale: string;
  enabled: boolean;
  pausedReason: ScheduledTaskPauseReason | null;
  nextRunAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface RunRecord {
  id: string;
  taskId: string;
  sessionId: string | null;
  trigger: "schedule" | "manual";
  status: "running" | "completed" | "failed";
  error: { code: ScheduledTaskRunErrorCode; message: string } | null;
  startedAt: Date;
  finishedAt: Date | null;
}

export interface RunFailure {
  code: ScheduledTaskRunErrorCode;
  message: string;
}

const db = () => getPostgresPool();
const tasks = () => table("scheduled_tasks");
const runs = () => table("scheduled_task_runs");
const credentials = () => table("scheduled_task_credentials");

function task(row: Record<string, any>): TaskRecord {
  return {
    id: row.id,
    domainId: row.domain_id,
    ownerId: row.owner_id,
    agentId: row.agent_id,
    prompt: row.prompt,
    frequency: scheduledTaskFrequencySchema.parse(row.frequency),
    notifyEmail: row.notify_email,
    locale: row.locale,
    enabled: row.enabled,
    pausedReason: row.paused_reason === null ? null : scheduledTaskPauseReasonSchema.parse(row.paused_reason),
    nextRunAt: row.next_run_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function run(row: Record<string, any>): RunRecord {
  return {
    id: row.id,
    taskId: row.task_id,
    sessionId: row.session_id,
    trigger: row.trigger,
    status: row.status,
    error:
      row.error_code === null
        ? null
        : { code: scheduledTaskRunErrorCodeSchema.parse(row.error_code), message: row.error_message ?? "" },
    startedAt: row.started_at,
    finishedAt: row.finished_at,
  };
}

/** A task with its newest run, as the list shows it. */
export interface TaskWithLastRun {
  task: TaskRecord;
  lastRun: RunRecord | null;
}

const LAST_RUN_SQL = (alias: string) => `LEFT JOIN LATERAL (
    SELECT * FROM ${runs()} r WHERE r.task_id=${alias}.id ORDER BY r.started_at DESC, r.id DESC LIMIT 1
  ) last ON true`;

function withLastRun(row: Record<string, any>): TaskWithLastRun {
  const lastRun = row.last_id
    ? run({
        id: row.last_id,
        task_id: row.id,
        session_id: row.last_session_id,
        trigger: row.last_trigger,
        status: row.last_status,
        error_code: row.last_error_code,
        error_message: row.last_error_message,
        started_at: row.last_started_at,
        finished_at: row.last_finished_at,
      })
    : null;
  return { task: task(row), lastRun };
}

const TASK_WITH_LAST_RUN = `t.*, last.id AS last_id, last.session_id AS last_session_id, last.trigger AS last_trigger,
  last.status AS last_status, last.error_code AS last_error_code, last.error_message AS last_error_message,
  last.started_at AS last_started_at, last.finished_at AS last_finished_at`;

export const scheduledTaskStore = {
  async list(owner: ScheduledTaskOwner): Promise<TaskWithLastRun[]> {
    const r = await db().query(
      `SELECT ${TASK_WITH_LAST_RUN} FROM ${tasks()} t ${LAST_RUN_SQL("t")}
       WHERE t.domain_id=$1 AND t.owner_id=$2 ORDER BY t.created_at DESC, t.id DESC`,
      [owner.domainId, owner.userId],
    );
    return r.rows.map(withLastRun);
  },

  async withLastRun(id: string, owner: ScheduledTaskOwner): Promise<TaskWithLastRun | null> {
    const r = await db().query(
      `SELECT ${TASK_WITH_LAST_RUN} FROM ${tasks()} t ${LAST_RUN_SQL("t")}
       WHERE t.id=$1 AND t.domain_id=$2 AND t.owner_id=$3`,
      [id, owner.domainId, owner.userId],
    );
    return r.rowCount ? withLastRun(r.rows[0]) : null;
  },

  async get(id: string, owner: ScheduledTaskOwner, c: pg.Pool | pg.PoolClient = db()): Promise<TaskRecord | null> {
    const r = await c.query(`SELECT * FROM ${tasks()} WHERE id=$1 AND domain_id=$2 AND owner_id=$3`, [
      id,
      owner.domainId,
      owner.userId,
    ]);
    return r.rowCount ? task(r.rows[0]) : null;
  },

  /**
   * Inserts a task unless its ID exists. Returns the stored row, whoever wrote it, and whether this call wrote it;
   * the owner's task count is checked under a per-owner lock so concurrent creations cannot pass the limit.
   */
  async create(
    id: string,
    owner: ScheduledTaskOwner,
    input: ScheduledTaskInput,
    locale: string,
    nextRunAt: Date,
    limit: number,
  ): Promise<{ task: TaskRecord | null; created: boolean; overLimit: boolean }> {
    return transaction(async (c) => {
      await c.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`scheduled-tasks:${owner.domainId}:${owner.userId}`]);
      const existing = await c.query(`SELECT * FROM ${tasks()} WHERE id=$1`, [id]);
      if (existing.rowCount) {
        const row = task(existing.rows[0]);
        return { task: row.domainId === owner.domainId && row.ownerId === owner.userId ? row : null, created: false, overLimit: false };
      }
      const count = await c.query(`SELECT count(*)::int AS n FROM ${tasks()} WHERE domain_id=$1 AND owner_id=$2`, [
        owner.domainId,
        owner.userId,
      ]);
      if (count.rows[0].n >= limit) return { task: null, created: false, overLimit: true };
      const r = await c.query(
        `INSERT INTO ${tasks()} (id,domain_id,owner_id,agent_id,prompt,frequency,notify_email,locale,next_run_at)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
        [id, owner.domainId, owner.userId, input.agentId, input.prompt, JSON.stringify(input.frequency), input.notifyEmail, locale, nextRunAt],
      );
      return { task: task(r.rows[0]), created: true, overLimit: false };
    });
  },

  /** Replaces the definition and clears a system pause; the next run is recomputed when the task is on. */
  async update(
    id: string,
    owner: ScheduledTaskOwner,
    input: ScheduledTaskInput,
    locale: string,
    nextRunAt: Date,
  ): Promise<TaskRecord | null> {
    const r = await db().query(
      `UPDATE ${tasks()} SET agent_id=$4,prompt=$5,frequency=$6,notify_email=$7,locale=$8,paused_reason=NULL,
         next_run_at=CASE WHEN enabled THEN $9::timestamptz ELSE NULL END,updated_at=now()
       WHERE id=$1 AND domain_id=$2 AND owner_id=$3 RETURNING *`,
      [id, owner.domainId, owner.userId, input.agentId, input.prompt, JSON.stringify(input.frequency), input.notifyEmail, locale, nextRunAt],
    );
    return r.rowCount ? task(r.rows[0]) : null;
  },

  /** Switching on clears a system pause and schedules from now; switching off stops scheduling. */
  async setEnabled(id: string, owner: ScheduledTaskOwner, enabled: boolean, nextRunAt: Date | null): Promise<TaskRecord | null> {
    const r = await db().query(
      `UPDATE ${tasks()} SET enabled=$4,paused_reason=CASE WHEN $4 THEN NULL ELSE paused_reason END,
         next_run_at=$5,updated_at=now()
       WHERE id=$1 AND domain_id=$2 AND owner_id=$3 RETURNING *`,
      [id, owner.domainId, owner.userId, enabled, nextRunAt],
    );
    return r.rowCount ? task(r.rows[0]) : null;
  },

  async delete(id: string, owner: ScheduledTaskOwner): Promise<boolean> {
    const r = await db().query(`DELETE FROM ${tasks()} WHERE id=$1 AND domain_id=$2 AND owner_id=$3`, [
      id,
      owner.domainId,
      owner.userId,
    ]);
    return (r.rowCount ?? 0) > 0;
  },

  async due(now: Date, limit: number): Promise<TaskRecord[]> {
    const r = await db().query(
      `SELECT * FROM ${tasks()} WHERE enabled AND paused_reason IS NULL AND next_run_at<=$1 ORDER BY next_run_at LIMIT $2`,
      [now, limit],
    );
    return r.rows.map(task);
  },

  /** Advances one due slot. Only the caller that moves the slot it read wins, so a slot fires once across instances. */
  async claim(t: TaskRecord, nextRunAt: Date): Promise<TaskRecord | null> {
    const r = await db().query(
      `UPDATE ${tasks()} SET next_run_at=$3 WHERE id=$1 AND enabled AND paused_reason IS NULL AND next_run_at=$2 RETURNING *`,
      [t.id, t.nextRunAt, nextRunAt],
    );
    return r.rowCount ? task(r.rows[0]) : null;
  },

  /** Stops scheduling until the owner resumes the task, or a renewed credential does (credential_invalid). */
  async pause(id: string, reason: ScheduledTaskPauseReason) {
    await db().query(`UPDATE ${tasks()} SET paused_reason=$2,next_run_at=NULL,updated_at=now() WHERE id=$1 AND enabled`, [
      id,
      reason,
    ]);
  },

  async credentialPaused(owner: ScheduledTaskOwner): Promise<TaskRecord[]> {
    const r = await db().query(
      `SELECT * FROM ${tasks()} WHERE domain_id=$1 AND owner_id=$2 AND enabled AND paused_reason='credential_invalid'`,
      [owner.domainId, owner.userId],
    );
    return r.rows.map(task);
  },

  async resume(id: string, reason: ScheduledTaskPauseReason, nextRunAt: Date) {
    await db().query(
      `UPDATE ${tasks()} SET paused_reason=NULL,next_run_at=$3,updated_at=now() WHERE id=$1 AND enabled AND paused_reason=$2`,
      [id, reason, nextRunAt],
    );
  },

  /**
   * Records a started run. Null when another run of the task is still running (the partial unique index); a repeated
   * ID returns the existing run of the same task.
   */
  async startRun(id: string, taskId: string, trigger: RunRecord["trigger"]): Promise<{ run: RunRecord; replayed: boolean } | null> {
    const r = await db().query(
      `INSERT INTO ${runs()} (id,task_id,trigger,status) VALUES($1,$2,$3,'running') ON CONFLICT DO NOTHING RETURNING *`,
      [id, taskId, trigger],
    );
    if (r.rowCount) return { run: run(r.rows[0]), replayed: false };
    const existing = await db().query(`SELECT * FROM ${runs()} WHERE id=$1 AND task_id=$2`, [id, taskId]);
    return existing.rowCount ? { run: run(existing.rows[0]), replayed: true } : null;
  },

  async attachSession(id: string, sessionId: string | null) {
    await db().query(`UPDATE ${runs()} SET session_id=$2 WHERE id=$1`, [id, sessionId]);
  },

  /** Ends a running run once; the caller that ends it owns the follow-up (pause, mail). */
  async finishRun(id: string, failure: RunFailure | null): Promise<RunRecord | null> {
    const r = await db().query(
      `UPDATE ${runs()} SET status=$2,error_code=$3,error_message=$4,finished_at=now()
       WHERE id=$1 AND status='running' RETURNING *`,
      [id, failure ? "failed" : "completed", failure?.code ?? null, failure?.message ?? null],
    );
    return r.rowCount ? run(r.rows[0]) : null;
  },

  async running(limit: number): Promise<(RunRecord & { task: TaskRecord })[]> {
    const r = await db().query(
      `SELECT r.id AS run_id,r.task_id,r.session_id,r.trigger,r.status,r.error_code,r.error_message,r.started_at,r.finished_at,t.*
       FROM ${runs()} r JOIN ${tasks()} t ON t.id=r.task_id WHERE r.status='running' ORDER BY r.started_at LIMIT $1`,
      [limit],
    );
    return r.rows.map((row) => ({ ...run({ ...row, id: row.run_id }), task: task(row) }));
  },

  async runs(
    taskId: string,
    cursor: { startedAt: string; id: string } | null,
    limit: number,
  ): Promise<RunRecord[]> {
    const r = await db().query(
      `SELECT * FROM ${runs()} WHERE task_id=$1 AND ($2::timestamptz IS NULL OR (started_at,id)<($2,$3::uuid))
       ORDER BY started_at DESC, id DESC LIMIT $4`,
      [taskId, cursor?.startedAt ?? null, cursor?.id ?? null, limit],
    );
    return r.rows.map(run);
  },

  async credential(owner: ScheduledTaskOwner): Promise<{ sealedKey: string | null; state: "valid" | "invalid" } | null> {
    const r = await db().query(`SELECT sealed_key,state FROM ${credentials()} WHERE domain_id=$1 AND owner_id=$2`, [
      owner.domainId,
      owner.userId,
    ]);
    return r.rowCount ? { sealedKey: r.rows[0].sealed_key, state: r.rows[0].state } : null;
  },

  async saveCredential(owner: ScheduledTaskOwner, sealedKey: string | null) {
    await db().query(
      `INSERT INTO ${credentials()} (domain_id,owner_id,sealed_key,state) VALUES($1,$2,$3,'valid')
       ON CONFLICT (domain_id,owner_id) DO UPDATE SET sealed_key=EXCLUDED.sealed_key,state='valid',updated_at=now()`,
      [owner.domainId, owner.userId, sealedKey],
    );
  },

  /** Marks the stored credential dead unless another call has already replaced it. */
  async invalidateCredential(owner: ScheduledTaskOwner, sealedKey: string | null) {
    await db().query(
      `UPDATE ${credentials()} SET state='invalid',updated_at=now()
       WHERE domain_id=$1 AND owner_id=$2 AND sealed_key IS NOT DISTINCT FROM $3`,
      [owner.domainId, owner.userId, sealedKey],
    );
  },

  async deleteByUser(userId: string) {
    await transaction(async (c) => {
      await c.query(`DELETE FROM ${tasks()} WHERE owner_id=$1`, [userId]);
      await c.query(`DELETE FROM ${credentials()} WHERE owner_id=$1`, [userId]);
    });
  },
};
