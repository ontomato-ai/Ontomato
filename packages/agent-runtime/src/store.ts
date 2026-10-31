import { historyCursor, historyPosition, type SessionHistoryQuery } from "@ontomato/contracts/session-history";
import { runtimeRunViewSchema, type RuntimeRunView } from "@ontomato/contracts/agent-runtime";
import { runtimeHistoryRecordSchema, type RuntimeHistoryQuery } from "@ontomato/contracts/agent-runtime-history";
import { getServiceLogContext, updateServiceLogContext } from "@ontomato/service-logging";
import { runtimeLogger } from "./logging";
import { createHash, randomUUID } from "node:crypto";
import pg, { type PoolClient } from "pg";
import type {
  RuntimeRun,
  RuntimeSession,
  RuntimeSessionStatus,
} from "@ontomato/contracts/agent-runtime";
import type {
  RuntimeAgentEvent,
  RuntimeEventEnvelope,
} from "@ontomato/contracts/agent-runtime-events";
import type { RuntimeArtifact } from "@ontomato/contracts/agent-runtime-artifacts";
import type { RuntimeMessage } from "@ontomato/contracts/agent-runtime-messages";
import type { RuntimeStopReason } from "@ontomato/contracts/agent-runtime-values";
import { RuntimeError, missing } from "./errors";

export interface Scope {
  hostId: string;
  domainId: string;
}
export interface MessageRow {
  id: string;
  runId: string;
  messageSeq: number;
  message: RuntimeMessage;
}
export function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object")
    return `{${Object.entries(value)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`)
      .join(",")}}`;
  return JSON.stringify(value);
}
export const digest = (value: unknown) =>
  createHash("sha256").update(canonical(value)).digest("hex");
const values = (scope: Scope) => [scope.hostId, scope.domainId];
const HISTORY_MIN_MESSAGES = 50, HISTORY_MIN_RUNS = 2, HISTORY_MAX_MESSAGES = 500;

/** This schema belongs only to the runtime. No host table or business record is accessed. */
export class RuntimeStore {
  readonly pool: pg.Pool;
  private lease?: PoolClient;
  constructor(
    readonly connectionString: string,
    readonly schema: string,
  ) {
    if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(schema))
      throw new Error("Invalid runtime schema");
    this.pool = new pg.Pool({ connectionString });
    this.pool.on("error", () =>
      runtimeLogger.error("Runtime database connection failed"),
    );
  }
  table(name: string) {
    return `"${this.schema}"."${name}"`;
  }
  async transaction<T>(fn: (c: PoolClient) => Promise<T>): Promise<T> {
    const c = await this.pool.connect();
    try {
      await c.query("BEGIN");
      const result = await fn(c);
      await c.query("COMMIT");
      return result;
    } catch (e) {
      await c.query("ROLLBACK");
      throw e;
    } finally {
      c.release();
    }
  }
  async initialize() {
    await this.transaction(async (c) => {
      await c.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
        `${this.schema}:migrations`,
      ]);
      await c.query(`CREATE SCHEMA IF NOT EXISTS "${this.schema}"`);
      await c.query(
        `CREATE TABLE IF NOT EXISTS ${this.table("schema_migrations")} (version int PRIMARY KEY)`,
      );
      await c.query(`CREATE TABLE IF NOT EXISTS ${this.table("model_settings")} (domain_id text PRIMARY KEY, settings jsonb NOT NULL)`);
      const versions = (
        await c.query(`SELECT version FROM ${this.table("schema_migrations")}`)
      ).rows;
      await c.query(`CREATE TABLE IF NOT EXISTS ${this.table("mcp_services")} (
        host_id text NOT NULL, domain_id text NOT NULL, id uuid NOT NULL,
        name text NOT NULL, url text NOT NULL, headers jsonb NOT NULL DEFAULT '{}',
        PRIMARY KEY(host_id,domain_id,id), UNIQUE(host_id,domain_id,name));`);
      if (versions.some((row) => row.version === 2)) {
        await c.query(`ALTER TABLE ${this.table("runs")} ADD COLUMN IF NOT EXISTS log_context jsonb NOT NULL DEFAULT '{}'`);
        await c.query(`CREATE TABLE IF NOT EXISTS ${this.table("code_executions")} (
          host_id text NOT NULL, domain_id text NOT NULL, id uuid NOT NULL,
          fingerprint text NOT NULL, execution jsonb NOT NULL, outputs jsonb NOT NULL DEFAULT '{}',
          PRIMARY KEY(host_id,domain_id,id))`);
        await c.query(`ALTER TABLE ${this.table("code_executions")} ADD COLUMN IF NOT EXISTS log_context jsonb NOT NULL DEFAULT '{}'`);
        return;
      }
      if (versions.length)
        throw new Error(
          "Legacy runtime data requires the release conversion before startup",
        );
      await c.query(`
        CREATE TABLE ${this.table("sessions")} (
          host_id text NOT NULL, domain_id text NOT NULL, id uuid NOT NULL,
          worker_uid bigint, active_run_id uuid, latest_run_id uuid, message_seq bigint NOT NULL DEFAULT 0,
          created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
          PRIMARY KEY(host_id,domain_id,id));
        CREATE TABLE ${this.table("admissions")} (
          host_id text NOT NULL, domain_id text NOT NULL, key uuid NOT NULL, operation text NOT NULL,
          fingerprint text NOT NULL, session_id uuid NOT NULL, deleted boolean NOT NULL DEFAULT false,
          PRIMARY KEY(host_id,domain_id,key));
        CREATE TABLE ${this.table("runs")} (
          host_id text NOT NULL, domain_id text NOT NULL, id uuid NOT NULL, session_id uuid NOT NULL,
          run jsonb NOT NULL, log_context jsonb NOT NULL DEFAULT '{}', seq bigint NOT NULL DEFAULT 0, stream_id uuid NOT NULL,
          PRIMARY KEY(host_id,domain_id,id),
          FOREIGN KEY(host_id,domain_id,session_id) REFERENCES ${this.table("sessions")}(host_id,domain_id,id) ON DELETE CASCADE);
        CREATE UNIQUE INDEX ON ${this.table("runs")}(host_id,domain_id,session_id) WHERE run->>'status'='running';
        CREATE TABLE ${this.table("messages")} (
          host_id text NOT NULL, domain_id text NOT NULL, id uuid NOT NULL, session_id uuid NOT NULL,
          run_id uuid NOT NULL, seq bigint NOT NULL, message jsonb NOT NULL,
          PRIMARY KEY(host_id,domain_id,id), UNIQUE(host_id,domain_id,session_id,seq),
          FOREIGN KEY(host_id,domain_id,run_id) REFERENCES ${this.table("runs")}(host_id,domain_id,id) ON DELETE CASCADE);
        CREATE TABLE ${this.table("events")} (
          host_id text NOT NULL, domain_id text NOT NULL, run_id uuid NOT NULL, seq bigint NOT NULL, envelope jsonb NOT NULL,
          PRIMARY KEY(host_id,domain_id,run_id,seq),
          FOREIGN KEY(host_id,domain_id,run_id) REFERENCES ${this.table("runs")}(host_id,domain_id,id) ON DELETE CASCADE);
        CREATE TABLE ${this.table("artifacts")} (
          host_id text NOT NULL, domain_id text NOT NULL, id uuid NOT NULL, session_id uuid NOT NULL, run_id uuid NOT NULL,
          tool_call_id text, path text NOT NULL, sha256 text NOT NULL, size bigint NOT NULL, media_type text NOT NULL,
          created_at timestamptz NOT NULL, seq bigint NOT NULL,
          PRIMARY KEY(host_id,domain_id,id),
          FOREIGN KEY(host_id,domain_id,run_id) REFERENCES ${this.table("runs")}(host_id,domain_id,id) ON DELETE CASCADE);
        CREATE TABLE ${this.table("compactions")} (
          host_id text NOT NULL, domain_id text NOT NULL, session_id uuid NOT NULL, covered_seq bigint NOT NULL,
          summary text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
          PRIMARY KEY(host_id,domain_id,session_id,covered_seq),
          FOREIGN KEY(host_id,domain_id,session_id) REFERENCES ${this.table("sessions")}(host_id,domain_id,id) ON DELETE CASCADE);
        CREATE TABLE ${this.table("skills")} (
          identity text NOT NULL, digest text NOT NULL, metadata jsonb NOT NULL, PRIMARY KEY(identity,digest));
        CREATE TABLE ${this.table("skill_names")} (identity text PRIMARY KEY, digest text NOT NULL);
        CREATE TABLE ${this.table("model_calls")} (
          id uuid PRIMARY KEY, host_id text NOT NULL, domain_id text NOT NULL, run_id uuid NOT NULL,
          record jsonb NOT NULL,
          FOREIGN KEY(host_id,domain_id,run_id) REFERENCES ${this.table("runs")}(host_id,domain_id,id) ON DELETE CASCADE);
        CREATE TABLE ${this.table("code_executions")} (
          host_id text NOT NULL, domain_id text NOT NULL, id uuid NOT NULL,
          fingerprint text NOT NULL, execution jsonb NOT NULL, outputs jsonb NOT NULL DEFAULT '{}',
          log_context jsonb NOT NULL DEFAULT '{}',
          PRIMARY KEY(host_id,domain_id,id));
        INSERT INTO ${this.table("schema_migrations")} VALUES (2);
      `);
    });
    this.lease = await this.pool.connect();
    const claimed = await this.lease.query(
      "SELECT pg_try_advisory_lock(hashtext($1)) AS owned",
      [`${this.schema}:runtime-owner`],
    );
    if (!claimed.rows[0].owned) {
      this.lease.release();
      this.lease = undefined;
      throw new Error("Another runtime owns this schema");
    }
    // Losing the ownership connection must stop this process before a second owner recovers its runs.
    this.lease.on("error", () => {
      runtimeLogger.error("Runtime ownership connection lost");
      process.exit(1);
    });
  }
  async close() {
    if (this.lease) {
      await this.lease.query("SELECT pg_advisory_unlock(hashtext($1))", [
        `${this.schema}:runtime-owner`,
      ]);
      this.lease.release();
      this.lease = undefined;
    }
    await this.pool.end();
  }
  async admission(
    c: PoolClient,
    scope: Scope,
    key: string,
    operation: string,
    fingerprint: string,
    sessionId: string,
  ) {
    // Serializes the same key even when two requests target different sessions.
    await c.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
      canonical([...values(scope), key]),
    ]);
    const old = (
      await c.query(
        `SELECT * FROM ${this.table("admissions")} WHERE host_id=$1 AND domain_id=$2 AND key=$3`,
        [...values(scope), key],
      )
    ).rows[0];
    if (old) {
      if (old.deleted)
        throw new RuntimeError(410, "RESOURCE_DELETED", "Resource was deleted");
      if (
        old.operation !== operation ||
        old.fingerprint !== fingerprint ||
        old.session_id !== sessionId
      )
        throw new RuntimeError(
          409,
          "IDEMPOTENCY_CONFLICT",
          "Admission key already has different input",
        );
      return true;
    }
    await c.query(
      `INSERT INTO ${this.table("admissions")} VALUES ($1,$2,$3,$4,$5,$6,false)`,
      [...values(scope), key, operation, fingerprint, sessionId],
    );
    return false;
  }
  /** Close an owned creation intent without admitting work after a lost response. */
  async closeAdmission(
    scope: Scope,
    id: string,
    operation: "run" | "code",
    sessionId = id,
  ) {
    return this.transaction(async (c) => {
      await c.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
        canonical([...values(scope), id]),
      ]);
      const previous = (
        await c.query(
          `SELECT * FROM ${this.table("admissions")} WHERE host_id=$1 AND domain_id=$2 AND key=$3`,
          [...values(scope), id],
        )
      ).rows[0];
      if (previous) {
        if (
          previous.operation !== operation ||
          previous.session_id !== sessionId
        )
          throw new RuntimeError(
            409,
            "IDEMPOTENCY_CONFLICT",
            "Admission belongs to another operation",
          );
        return !previous.deleted;
      }
      await c.query(
        `INSERT INTO ${this.table("admissions")} VALUES($1,$2,$3,$4,'',$5,true)`,
        [...values(scope), id, operation, sessionId],
      );
      return false;
    });
  }
  async createSession(scope: Scope, id: string) {
    const replayed = await this.transaction(async (c) => {
      const repeat = await this.admission(
        c,
        scope,
        id,
        "session",
        digest({}),
        id,
      );
      if (!repeat)
        await c.query(
          `INSERT INTO ${this.table("sessions")} (host_id,domain_id,id) VALUES ($1,$2,$3)`,
          [...values(scope), id],
        );
      return repeat;
    });
    return { session: await this.session(scope, id), replayed };
  }
  async session(
    scope: Scope,
    id: string,
    c: pg.Pool | PoolClient = this.pool,
  ): Promise<RuntimeSession> {
    const row = (
      await c.query(
        `SELECT * FROM ${this.table("sessions")} WHERE host_id=$1 AND domain_id=$2 AND id=$3`,
        [...values(scope), id],
      )
    ).rows[0];
    if (!row) missing();
    updateServiceLogContext({ sessionId: id, domainId: scope.domainId });
    return {
      id,
      domainId: scope.domainId,
      activeRunId: row.active_run_id,
      latestRunId: row.latest_run_id,
      createdAt: row.created_at.toISOString(),
      updatedAt: row.updated_at.toISOString(),
    };
  }
  async sessionStatuses(
    scope: Scope,
    ids: string[],
  ): Promise<RuntimeSessionStatus[]> {
    if (!ids.length) return [];
    // One statement gives session pointers and latest statuses the same MVCC snapshot.
    const { rows } = await this.pool.query(
      `SELECT s.id,s.active_run_id,s.latest_run_id,s.created_at,s.updated_at,
        r.id AS run_id,r.run->>'status' AS run_status,r.run->>'stopReason' AS stop_reason
       FROM ${this.table("sessions")} s LEFT JOIN ${this.table("runs")} r
         ON r.host_id=s.host_id AND r.domain_id=s.domain_id AND r.session_id=s.id AND r.id=s.latest_run_id
       WHERE s.host_id=$1 AND s.domain_id=$2 AND s.id=ANY($3::uuid[])`,
      [...values(scope), ids],
    );
    const byId = new Map(rows.map((row) => [row.id, row]));
    return ids.map((id) => {
      const row = byId.get(id);
      if (!row) missing();
      return {
        session: {
          id,
          domainId: scope.domainId,
          activeRunId: row.active_run_id,
          latestRunId: row.latest_run_id,
          createdAt: row.created_at.toISOString(),
          updatedAt: row.updated_at.toISOString(),
        },
        latestRun: row.run_id
          ? {
              id: row.run_id,
              status: row.run_status,
              stopReason: row.stop_reason,
            }
          : null,
      };
    });
  }
  async admit(
    scope: Scope,
    run: RuntimeRun,
    fingerprint: string,
    input: RuntimeMessage,
  ) {
    return this.transaction(async (c) => {
      if (
        await this.admission(
          c,
          scope,
          run.id,
          "run",
          fingerprint,
          run.sessionId,
        )
      )
        return { run: (await this.run(scope, run.id, c)).run, replayed: true };
      const session = (
        await c.query(
          `SELECT * FROM ${this.table("sessions")} WHERE host_id=$1 AND domain_id=$2 AND id=$3 FOR UPDATE`,
          [...values(scope), run.sessionId],
        )
      ).rows[0];
      if (!session) missing();
      if (session.active_run_id)
        throw new RuntimeError(
          409,
          "SESSION_BUSY",
          "Session already has an active run",
        );
      const streamId = randomUUID();
      const messageId = randomUUID();
      const messageSeq = Number(session.message_seq) + 1;
      await c.query(
        `INSERT INTO ${this.table("runs")} (host_id,domain_id,id,session_id,run,stream_id,seq,log_context) VALUES ($1,$2,$3,$4,$5,$6,3,$7)`,
        [...values(scope), run.id, run.sessionId, run, streamId, { userId: getServiceLogContext().userId ?? null }],
      );
      await c.query(
        `UPDATE ${this.table("sessions")} SET active_run_id=$4,latest_run_id=$4,message_seq=$5,updated_at=now() WHERE host_id=$1 AND domain_id=$2 AND id=$3`,
        [...values(scope), run.sessionId, run.id, messageSeq],
      );
      await c.query(
        `INSERT INTO ${this.table("messages")} VALUES($1,$2,$3,$4,$5,$6,$7)`,
        [...values(scope), messageId, run.sessionId, run.id, messageSeq, input],
      );
      const events: RuntimeAgentEvent[] = [
        { type: "agent_start" },
        { type: "message_start", messageId, message: input },
        { type: "message_end", messageId, messageSeq, message: input },
      ];
      for (const [index, event] of events.entries())
        await c.query(
          `INSERT INTO ${this.table("events")} VALUES($1,$2,$3,$4,$5)`,
          [
            ...values(scope),
            run.id,
            index + 1,
            {
              sessionId: run.sessionId,
              cursor: { runId: run.id, seq: index + 1, streamId },
              timestamp: run.createdAt,
              event,
            },
          ],
        );
      return { run, replayed: false };
    });
  }
  async run(
    scope: Scope,
    id: string,
    c: pg.Pool | PoolClient = this.pool,
  ): Promise<{ run: RuntimeRun; seq: number; streamId: string }> {
    const row = (
      await c.query(
        `SELECT * FROM ${this.table("runs")} WHERE host_id=$1 AND domain_id=$2 AND id=$3`,
        [...values(scope), id],
      )
    ).rows[0];
    if (!row) missing();
    updateServiceLogContext({ runId: row.run.id, sessionId: row.run.sessionId, domainId: scope.domainId });
    return { run: row.run, seq: Number(row.seq), streamId: row.stream_id };
  }
  async messages(
    scope: Scope,
    sessionId: string,
    c: pg.Pool | PoolClient = this.pool,
    runId?: string,
  ): Promise<MessageRow[]> {
    return (
      await c.query(
        `SELECT id,run_id AS "runId",seq,message FROM ${this.table("messages")} WHERE host_id=$1 AND domain_id=$2 AND session_id=$3 AND ($4::uuid IS NULL OR run_id=$4) ORDER BY seq`,
        [...values(scope), sessionId, runId ?? null],
      )
    ).rows.map((row) => ({
      id: row.id,
      runId: row.runId,
      messageSeq: Number(row.seq),
      message: row.message,
    }));
  }
  /** Select a bounded message range before loading bodies. A Run is one admitted user turn. */
  async historyWindow(scope: Scope, sessionId: string, query: SessionHistoryQuery) {
    const head = Number((await this.pool.query(
      `SELECT message_seq FROM ${this.table("sessions")} WHERE host_id=$1 AND domain_id=$2 AND id=$3`,
      [...values(scope), sessionId],
    )).rows[0].message_seq);
    let before: number | undefined, after: number | undefined, through: number;
    try {
      before = query.before === undefined ? undefined : historyPosition(query.before, sessionId);
      after = query.after === undefined ? undefined : historyPosition(query.after, sessionId);
      through = query.through === undefined ? head : historyPosition(query.through, sessionId);
      if (through > head || (before !== undefined && before > head + 1) || (after !== undefined && after > through))
        throw new Error("History cursor is beyond the read boundary");
    } catch (error) {
      throw new RuntimeError(400, "INVALID_REQUEST", error instanceof Error ? error.message : "Invalid history cursor");
    }
    const forward = after !== undefined;
    let low = after ?? 0, high = before === undefined ? through : Math.max(0, before - 1);
    const candidates = (await this.pool.query(
      `SELECT seq,run_id,message->>'role' AS role FROM ${this.table("messages")}
       WHERE host_id=$1 AND domain_id=$2 AND session_id=$3 AND seq>$4 AND seq<=$5
         AND message->>'role' IN ('user','assistant') ORDER BY seq ${forward ? "ASC" : "DESC"} LIMIT ${HISTORY_MAX_MESSAGES + 1}`,
      [...values(scope), sessionId, low, high],
    )).rows as { seq: string; run_id: string; role: string }[];
    const turns = new Set<string>();
    for (let i = 0; i < Math.min(candidates.length, HISTORY_MAX_MESSAGES); i++) {
      const row = candidates[i];
      turns.add(row.run_id);
      const boundary = forward ? candidates[i + 1]?.run_id !== row.run_id : row.role === "user";
      if (i + 1 === HISTORY_MAX_MESSAGES || (i + 1 >= HISTORY_MIN_MESSAGES && turns.size >= HISTORY_MIN_RUNS && boundary) || i === candidates.length - 1) {
        if (forward) high = candidates[i + 1] ? Number(candidates[i + 1].seq) - 1 : through;
        else low = Number(row.seq) - 1;
        break;
      }
    }
    const messages = (await this.pool.query(
      `SELECT id,run_id AS "runId",seq,message FROM ${this.table("messages")}
       WHERE host_id=$1 AND domain_id=$2 AND session_id=$3 AND seq>$4 AND seq<=$5
         AND message->>'role'<>'system' ORDER BY seq`,
      [...values(scope), sessionId, low, high],
    )).rows.map(row => ({ id: row.id, runId: row.runId, messageSeq: Number(row.seq), message: row.message })) as MessageRow[];
    const first = messages[0]?.messageSeq;
    const older = first !== undefined && (await this.pool.query(
      `SELECT 1 FROM ${this.table("messages")} WHERE host_id=$1 AND domain_id=$2 AND session_id=$3
       AND seq<$4 AND message->>'role'<>'system' LIMIT 1`, [...values(scope), sessionId, first],
    )).rowCount !== 0;
    return {
      messages,
      page: {
        olderCursor: older ? historyCursor(sessionId, first!) : null,
        nextCursor: forward && high < through ? historyCursor(sessionId, high) : null,
        throughCursor: historyCursor(sessionId, through),
        messageSeq: high,
      },
    };
  }
  async historyRuns(scope: Scope, ids: string[]): Promise<RuntimeRunView[]> {
    if (!ids.length) return [];
    const fields = Object.keys(runtimeRunViewSchema.shape).map(name => `'${name}',run->'${name}'`).join(",");
    return (await this.pool.query(
      `SELECT jsonb_build_object(${fields}) AS run FROM ${this.table("runs")}
       WHERE host_id=$1 AND domain_id=$2 AND id=ANY($3::uuid[]) ORDER BY run->>'createdAt',id`,
      [...values(scope), ids],
    )).rows.map(row => row.run);
  }
  async toolEvents(scope: Scope, runId: string, unsettledOnly = false) {
    return (await this.pool.query(
      `SELECT e.envelope FROM ${this.table("events")} e WHERE e.host_id=$1 AND e.domain_id=$2 AND e.run_id=$3
       AND e.envelope->'event'->>'type' IN ('tool_execution_start','tool_execution_end')
       AND (NOT $4::boolean OR NOT EXISTS (
         SELECT 1 FROM ${this.table("messages")} m WHERE m.host_id=e.host_id AND m.domain_id=e.domain_id AND m.run_id=e.run_id
         AND m.message->>'role'='toolResult' AND m.message->>'toolCallId'=e.envelope->'event'->>'toolCallId'
       )) ORDER BY e.seq`, [...values(scope), runId, unsettledOnly],
    )).rows.map(row => row.envelope as RuntimeEventEnvelope);
  }
  async events(scope: Scope, runId: string) {
    return (
      await this.pool.query(
        `SELECT envelope FROM ${this.table("events")} WHERE host_id=$1 AND domain_id=$2 AND run_id=$3 ORDER BY seq`,
        [...values(scope), runId],
      )
    ).rows.map((r) => r.envelope as RuntimeEventEnvelope);
  }
  private artifactRow(row: Record<string, any>): RuntimeArtifact {
    return {
      id: row.id,
      sessionId: row.session_id,
      runId: row.run_id,
      toolCallId: row.tool_call_id,
      path: row.path,
      sha256: row.sha256,
      size: Number(row.size),
      mediaType: row.media_type,
      createdAt: row.created_at.toISOString(),
      seq: Number(row.seq),
    };
  }
  async artifact(scope: Scope, id: string): Promise<RuntimeArtifact> {
    const row = (
      await this.pool.query(
        `SELECT * FROM ${this.table("artifacts")} WHERE host_id=$1 AND domain_id=$2 AND id=$3`,
        [...values(scope), id],
      )
    ).rows[0];
    if (!row) missing();
    return this.artifactRow(row);
  }
  async artifacts(scope: Scope, runId: string): Promise<RuntimeArtifact[]> {
    return (
      await this.pool.query(
        `SELECT * FROM ${this.table("artifacts")} WHERE host_id=$1 AND domain_id=$2 AND run_id=$3 ORDER BY seq,id`,
        [...values(scope), runId],
      )
    ).rows.map((r) => this.artifactRow(r));
  }
  private historyProjection() {
    // Only the user input and the last assistant message of a settled run are public history.
    const text = (alias: string) => `CASE WHEN jsonb_typeof(${alias}.message->'content')='string'
      THEN ${alias}.message->>'content' ELSE COALESCE((SELECT string_agg(part->>'text', E'\\n' ORDER BY n)
      FROM jsonb_array_elements(${alias}.message->'content') WITH ORDINALITY AS p(part,n)
      WHERE part->>'type'='text'),'') END`;
    return `SELECT r.host_id,r.domain_id,r.id,r.run,${text("u")} AS question,
      CASE WHEN r.run->>'status'='stopped' AND r.run->>'stopReason' IN ('stop','length')
      AND a.message IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM jsonb_array_elements(a.message->'content') part WHERE part->>'type'='toolCall'
      ) THEN ${text("a")} ELSE NULL END AS answer
      FROM ${this.table("runs")} r
      LEFT JOIN LATERAL (SELECT message FROM ${this.table("messages")} m
        WHERE m.host_id=r.host_id AND m.domain_id=r.domain_id AND m.run_id=r.id
        AND m.message->>'role'='user' ORDER BY seq LIMIT 1) u ON true
      LEFT JOIN LATERAL (SELECT message FROM ${this.table("messages")} m
        WHERE m.host_id=r.host_id AND m.domain_id=r.domain_id AND m.run_id=r.id
        AND m.message->>'role'='assistant' ORDER BY seq DESC LIMIT 1) a ON true`;
  }
  private async historyRow(row: Record<string, any>) {
    return runtimeHistoryRecordSchema.parse({
      hostId: row.host_id, runId: row.id, sessionId: row.run.sessionId,
      agentId: row.run.definition.agentId ?? null,
      createdAt: row.run.createdAt, finishedAt: row.run.finishedAt,
      question: row.question ?? "", answer: row.answer,
      artifacts: await this.artifacts({ hostId: row.host_id, domainId: row.domain_id }, row.id),
    });
  }
  async searchHistory(scope: Scope, allHosts: boolean, input: RuntimeHistoryQuery) {
    const rows = (await this.pool.query(`SELECT * FROM (${this.historyProjection()}) h
      WHERE domain_id=$1 AND ($2::text IS NULL OR host_id=$2)
      AND ($3::text IS NULL OR run->'definition'->>'agentId'=$3)
      AND ($4::timestamptz IS NULL OR (run->>'createdAt')::timestamptz >= $4)
      AND ($5::timestamptz IS NULL OR (run->>'createdAt')::timestamptz < $5)
      AND ($6='' OR strpos(lower(COALESCE(question,'') || E'\\n' || COALESCE(answer,'')),lower($6))>0)
      ORDER BY run->>'createdAt' DESC,host_id,id DESC OFFSET $7 LIMIT $8`,
      [scope.domainId, allHosts ? null : scope.hostId, input.agentId ?? null, input.from ?? null,
        input.to ?? null, input.query, input.offset, input.limit + 1])).rows;
    return { records: await Promise.all(rows.slice(0,input.limit).map(row => this.historyRow(row))),
      nextOffset: rows.length > input.limit ? input.offset + input.limit : null };
  }
  async history(scope: Scope, allHosts: boolean, hostId: string, runId: string) {
    if (!allHosts && hostId !== scope.hostId) missing();
    const row = (await this.pool.query(`${this.historyProjection()}
      WHERE r.domain_id=$1 AND r.host_id=$2 AND r.id=$3`, [scope.domainId,hostId,runId])).rows[0];
    if (!row) missing();
    return this.historyRow(row);
  }
  async resolveArtifacts(
    scope: Scope,
    runId: string,
    path?: string,
    atSeq?: number,
  ) {
    const { run, seq } = await this.run(scope, runId);
    if (atSeq !== undefined && atSeq > seq)
      throw new RuntimeError(
        400,
        "INVALID_REQUEST",
        "Artifact cursor is in the future",
      );
    const rows = (
      await this.pool.query(
        `SELECT a.* FROM ${this.table("artifacts")} a
      JOIN ${this.table("runs")} r ON r.host_id=a.host_id AND r.domain_id=a.domain_id AND r.id=a.run_id
      WHERE a.host_id=$1 AND a.domain_id=$2 AND a.session_id=$3
      AND (a.run_id=$4 AND a.seq<=$5 OR
        (SELECT min(seq) FROM ${this.table("messages")} WHERE host_id=$1 AND domain_id=$2 AND run_id=a.run_id)<
        (SELECT min(seq) FROM ${this.table("messages")} WHERE host_id=$1 AND domain_id=$2 AND run_id=$4))
      ORDER BY r.run->>'createdAt',a.seq`,
        [...values(scope), run.sessionId, runId, atSeq ?? seq],
      )
    ).rows;
    const latest = new Map<string, RuntimeArtifact>();
    for (const row of rows)
      if (path === undefined || path === row.path)
        latest.set(row.path, this.artifactRow(row));
    return [...latest.values()];
  }
  async registerArtifact(
    scope: Scope,
    runId: string,
    toolCallId: string | null,
    file: import("./files").OutputFile,
  ) {
    const { run } = await this.run(scope, runId);
    const artifact: RuntimeArtifact = {
      ...file,
      id: randomUUID(),
      sessionId: run.sessionId,
      runId,
      toolCallId,
      createdAt: new Date().toISOString(),
      seq: 0,
    };
    return this.append(scope, runId, { type: "artifact_registered", artifact });
  }
  async append(scope: Scope, runId: string, event: RuntimeAgentEvent) {
    return this.transaction(async (c) => {
      const row = (
        await c.query(
          `SELECT * FROM ${this.table("runs")} WHERE host_id=$1 AND domain_id=$2 AND id=$3 FOR UPDATE`,
          [...values(scope), runId],
        )
      ).rows[0];
      if (!row) missing();
      const run = row.run as RuntimeRun;
      if (run.status !== "running")
        throw new RuntimeError(409, "RUN_CLOSED", "Run is no longer active");
      const seq = Number(row.seq) + 1;
      if (event.type === "message_end") {
        const session = (
          await c.query(
            `UPDATE ${this.table("sessions")} SET message_seq=message_seq+1 WHERE host_id=$1 AND domain_id=$2 AND id=$3 RETURNING message_seq`,
            [...values(scope), run.sessionId],
          )
        ).rows[0];
        event.messageSeq = Number(session.message_seq);
        await c.query(
          `INSERT INTO ${this.table("messages")} VALUES($1,$2,$3,$4,$5,$6,$7)`,
          [
            ...values(scope),
            event.messageId,
            run.sessionId,
            runId,
            event.messageSeq,
            event.message,
          ],
        );
      }
      if (event.type === "artifact_registered") {
        event.artifact.seq = seq;
        const a = event.artifact;
        await c.query(
          `INSERT INTO ${this.table("artifacts")} VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
          [
            ...values(scope),
            a.id,
            a.sessionId,
            runId,
            a.toolCallId,
            a.path,
            a.sha256,
            a.size,
            a.mediaType,
            a.createdAt,
            seq,
          ],
        );
      }
      if (event.type === "message_end" && event.message.role === "assistant") {
        run.stopReason =
          event.message.stopReason === "pending"
            ? null
            : event.message.stopReason;
        run.errorMessage = event.message.errorMessage ?? null;
      }
      const envelope: RuntimeEventEnvelope = {
        sessionId: run.sessionId,
        cursor: { runId, seq, streamId: row.stream_id },
        timestamp: new Date().toISOString(),
        event,
      };
      if (
        event.type !== "message_update" &&
        event.type !== "tool_execution_update"
      )
        await c.query(
          `INSERT INTO ${this.table("events")} VALUES($1,$2,$3,$4,$5)`,
          [...values(scope), runId, seq, envelope],
        );
      if (event.type === "agent_end") {
        run.status = event.status;
        run.finishedAt = envelope.timestamp;
        run.stopReason = event.stopReason;
        run.errorMessage = event.errorMessage;
        await c.query(
          `UPDATE ${this.table("sessions")} SET active_run_id=NULL,updated_at=now() WHERE host_id=$1 AND domain_id=$2 AND id=$3 AND active_run_id=$4`,
          [...values(scope), run.sessionId, runId],
        );
      }
      await c.query(
        `UPDATE ${this.table("runs")} SET seq=$4,run=$5 WHERE host_id=$1 AND domain_id=$2 AND id=$3`,
        [...values(scope), runId, seq, run],
      );
      return envelope;
    });
  }
  async recover() {
    const rows = (
      await this.pool.query(
        `SELECT host_id,domain_id,id FROM ${this.table("runs")} WHERE run->>'status'='running'`,
      )
    ).rows;
    for (const row of rows) {
      const scope = { hostId: row.host_id, domainId: row.domain_id };
      await this.pool.query(
        `UPDATE ${this.table("runs")} SET stream_id=$4 WHERE host_id=$1 AND domain_id=$2 AND id=$3`,
        [...values(scope), row.id, randomUUID()],
      );
      await this.finish(
        scope,
        row.id,
        "aborted",
        "Runtime restarted; unfinished tool outcomes are unknown",
      );
    }
  }
  async finish(
    scope: Scope,
    id: string,
    reason?: RuntimeStopReason,
    errorMessage?: string | null,
  ) {
    const { run } = await this.run(scope, id);
    let messages = (await this.messages(scope, run.sessionId))
      .filter((m) => m.runId === id)
      .map((m) => m.message);
    const last = [...messages].reverse().find((m) => m.role === "assistant");
    if (
      reason &&
      (last?.role !== "assistant" ||
        last.stopReason !== reason ||
        last.errorMessage !== (errorMessage ?? undefined))
    ) {
      await this.append(scope, id, {
        type: "message_end",
        messageId: randomUUID(),
        messageSeq: 0,
        message: {
          role: "assistant",
          content: [],
          api: null,
          provider: null,
          model: null,
          usage: null,
          origin: "runtime",
          timestamp: Date.now(),
          stopReason: reason,
          errorMessage: errorMessage ?? undefined,
        },
      });
      messages = (await this.messages(scope, run.sessionId))
        .filter((m) => m.runId === id)
        .map((m) => m.message);
    }
    const final = [...messages].reverse().find((m) => m.role === "assistant");
    const stopReason =
      reason ??
      (final?.role === "assistant" && final.stopReason !== "pending"
        ? final.stopReason
        : "error");
    const text =
      errorMessage ??
      (final?.role === "assistant" ? final.errorMessage : null) ??
      null;
    const envelope = await this.append(scope, id, {
      type: "agent_end",
      messages,
      status: "stopped",
      stopReason,
      errorMessage: text,
    });
    return envelope;
  }
  async deleteSession(scope: Scope, id: string) {
    await this.transaction(async (c) => {
      const row = (
        await c.query(
          `SELECT * FROM ${this.table("sessions")} WHERE host_id=$1 AND domain_id=$2 AND id=$3 FOR UPDATE`,
          [...values(scope), id],
        )
      ).rows[0];
      if (!row) missing();
      if (row.active_run_id)
        throw new RuntimeError(
          409,
          "SESSION_BUSY",
          "Cancel the active run before deleting the session",
        );
      await c.query(
        `UPDATE ${this.table("admissions")} SET deleted=true WHERE host_id=$1 AND domain_id=$2 AND session_id=$3`,
        [...values(scope), id],
      );
      await c.query(
        `DELETE FROM ${this.table("sessions")} WHERE host_id=$1 AND domain_id=$2 AND id=$3`,
        [...values(scope), id],
      );
    });
  }
}
