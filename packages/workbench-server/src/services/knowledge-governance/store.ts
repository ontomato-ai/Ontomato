import { createHash, randomUUID } from "node:crypto";
import {
  governanceWorkSchema,
  type GovernanceWork,
  type GovernanceSkillCallIdentity,
} from "@ontomato/contracts/knowledge-governance";
import { getPostgresPool, qualifiedTable } from "../../infrastructure/postgres";
import { HttpError } from "../../utils/errors";
import { RuntimeClient } from "../agent-runtime/client";

export interface GovernanceOwner {
  domainId: string;
  userId: string;
}
export interface GovernanceRecord {
  id: string;
  domainId: string;
  initiatorId: string;
  runtimeSessionId: string | null;
  writeRunId: string | null;
  latestRunId: string | null;
  createdAt: string;
  updatedAt: string;
  revision: number;
  work: GovernanceWork;
  error: string | null;
}
const emptyWork = (): GovernanceWork => ({
  summary: "",
  notes: "",
  reviewedKnowledgeIds: [],
  knowledgeTotal: null,
  issues: [],
  sources: [],
});
function record(row: Record<string, any>): GovernanceRecord {
  return {
    id: row.id,
    domainId: row.domain_id,
    initiatorId: row.initiator_id,
    runtimeSessionId: row.runtime_session_id,
    writeRunId: row.write_run_id,
    latestRunId: row.latest_run_id,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
    revision: Number(row.revision),
    work: governanceWorkSchema.parse(row.work ?? row.payload.work),
    error: row.error ?? null,
  };
}
const selection =
  () => `SELECT s.*,w.work,w.error FROM ${qualifiedTable("knowledge_governance_sessions")} s
  LEFT JOIN ${qualifiedTable("knowledge_governance_run_work")} w ON w.run_id=s.latest_run_id`;
export const governanceStore = {
  async authorize(id: string, owner: GovernanceOwner) {
    const { rowCount } = await getPostgresPool().query(
      `SELECT 1 FROM ${qualifiedTable("knowledge_governance_sessions")} WHERE id=$1 AND domain_id=$2 AND initiator_id=$3`,
      [id, owner.domainId, owner.userId],
    );
    if (!rowCount) throw new HttpError(404, "Governance session not found");
  },
  async get(id: string, owner: GovernanceOwner): Promise<GovernanceRecord> {
    const { rows } = await getPostgresPool().query(
      `${selection()} WHERE s.id=$1 AND s.domain_id=$2 AND s.initiator_id=$3`,
      [id, owner.domainId, owner.userId],
    );
    if (!rows[0]) throw new HttpError(404, "Governance session not found");
    return record(rows[0]);
  },
  async list(owner: GovernanceOwner): Promise<GovernanceRecord[]> {
    const { rows } = await getPostgresPool().query(
      `${selection()} WHERE s.domain_id=$1 AND s.initiator_id=$2 ORDER BY s.updated_at DESC,s.id LIMIT 100`,
      [owner.domainId, owner.userId],
    );
    return rows.map(record);
  },
  async create(
    owner: GovernanceOwner,
    id: string = randomUUID(),
    external = false,
  ) {
    if (!external) await new RuntimeClient(owner.domainId).createSession(id);
    try {
      await getPostgresPool().query(
        `INSERT INTO ${qualifiedTable("knowledge_governance_sessions")} (id,domain_id,initiator_id,runtime_session_id,payload) VALUES($1,$2,$3,$5,$4) ON CONFLICT DO NOTHING`,
        [
          id,
          owner.domainId,
          owner.userId,
          { work: emptyWork(), error: null },
          external ? null : id,
        ],
      );
    } catch (error) {
      if (!external) await new RuntimeClient(owner.domainId).deleteSession(id);
      throw error;
    }
    return this.get(id, owner);
  },
  async openRun(
    id: string,
    owner: GovernanceOwner,
    runId: string,
    expiresAt: Date,
    input: unknown,
  ) {
    const hash = createHash("sha256")
      .update(JSON.stringify(input))
      .digest("hex");
    const client = await getPostgresPool().connect();
    try {
      await client.query("BEGIN");
      const row = (
        await client.query(
          `SELECT * FROM ${qualifiedTable("knowledge_governance_sessions")} WHERE id=$1 AND domain_id=$2 AND initiator_id=$3 FOR UPDATE`,
          [id, owner.domainId, owner.userId],
        )
      ).rows[0];
      if (!row) throw new HttpError(404, "Governance session not found");
      const old = (
        await client.query(
          `SELECT request_hash FROM ${qualifiedTable("knowledge_governance_run_work")} WHERE run_id=$1 AND session_id=$2`,
          [runId, id],
        )
      ).rows[0];
      if (old) {
        if (old.request_hash !== hash)
          throw new HttpError(409, "Run input changed");
        await client.query("COMMIT");
        return;
      }
      const previous = row.latest_run_id
        ? (
            await client.query(
              `SELECT work FROM ${qualifiedTable("knowledge_governance_run_work")} WHERE run_id=$1`,
              [row.latest_run_id],
            )
          ).rows[0]?.work
        : row.payload.work;
      // Closing the predecessor and seeding its successor share the session lock with every write.
      await client.query(
        `UPDATE ${qualifiedTable("knowledge_governance_run_work")} SET write_open=false WHERE session_id=$1 AND write_open`,
        [id],
      );
      await client.query(
        `INSERT INTO ${qualifiedTable("knowledge_governance_run_work")} (run_id,session_id,write_open,work,expires_at,request_hash) VALUES($1,$2,true,$3,$4,$5)`,
        [runId, id, previous ?? emptyWork(), expiresAt, hash],
      );
      await client.query(
        `UPDATE ${qualifiedTable("knowledge_governance_sessions")} SET write_run_id=$2,latest_run_id=$2,revision=revision+1,updated_at=now() WHERE id=$1`,
        [id, runId],
      );
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  },
  async closeRun(
    id: string,
    owner: GovernanceOwner,
    runId: string,
    error?: string,
  ) {
    const client = await getPostgresPool().connect();
    try {
      await client.query("BEGIN");
      const row = (
        await client.query(
          `SELECT * FROM ${qualifiedTable("knowledge_governance_sessions")} WHERE id=$1 AND domain_id=$2 AND initiator_id=$3 FOR UPDATE`,
          [id, owner.domainId, owner.userId],
        )
      ).rows[0];
      if (!row) throw new HttpError(404, "Governance session not found");
      await client.query(
        `UPDATE ${qualifiedTable("knowledge_governance_run_work")} SET write_open=false,error=COALESCE($3,error) WHERE session_id=$1 AND run_id=$2`,
        [id, runId, error ?? null],
      );
      if (row.write_run_id === runId)
        await client.query(
          `UPDATE ${qualifiedTable("knowledge_governance_sessions")} SET write_run_id=NULL,revision=revision+1,updated_at=now() WHERE id=$1`,
          [id],
        );
      await client.query("COMMIT");
    } catch (reason) {
      await client.query("ROLLBACK");
      throw reason;
    } finally {
      client.release();
    }
  },
  async mutate(
    identity: GovernanceSkillCallIdentity,
    owner: GovernanceOwner,
    change: (work: GovernanceWork) => void,
  ) {
    const client = await getPostgresPool().connect();
    try {
      await client.query("BEGIN");
      const row = (
        await client.query(
          `SELECT * FROM ${qualifiedTable("knowledge_governance_sessions")} WHERE id=$1 AND domain_id=$2 AND initiator_id=$3 FOR UPDATE`,
          [identity.governanceSessionId, owner.domainId, owner.userId],
        )
      ).rows[0];
      if (!row || row.id !== identity.sessionId)
        throw new HttpError(404, "Governance session not found");
      const run = (
        await client.query(
          `SELECT * FROM ${qualifiedTable("knowledge_governance_run_work")} WHERE session_id=$1 AND run_id=$2`,
          [identity.governanceSessionId, identity.runId],
        )
      ).rows[0];
      if (
        row.write_run_id !== identity.runId ||
        !run?.write_open ||
        new Date(run.expires_at).getTime() <= Date.now()
      ) {
        const error = new HttpError(409, "Governance run is closed");
        Object.assign(error, {
          code: "GOVERNANCE_RUN_CLOSED",
          runId: identity.runId,
        });
        throw error;
      }
      const work = governanceWorkSchema.parse(run.work);
      change(work);
      const updated = (
        await client.query(
          `UPDATE ${qualifiedTable("knowledge_governance_run_work")} SET work=$2,revision=revision+1 WHERE run_id=$1 RETURNING revision`,
          [identity.runId, governanceWorkSchema.parse(work)],
        )
      ).rows[0];
      await client.query(
        `UPDATE ${qualifiedTable("knowledge_governance_sessions")} SET revision=revision+1,updated_at=now() WHERE id=$1`,
        [identity.governanceSessionId],
      );
      await client.query("COMMIT");
      return {
        runId: identity.runId,
        revision: Number(updated.revision),
        work,
      };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  },
  async runWork(
    identity: Pick<
      GovernanceSkillCallIdentity,
      "governanceSessionId" | "sessionId" | "runId"
    >,
    owner: GovernanceOwner,
  ) {
    const current = await this.get(identity.governanceSessionId, owner);
    if (current.id !== identity.sessionId)
      throw new HttpError(404, "Governance session not found");
    const row = (
      await getPostgresPool().query(
        `SELECT work,write_open,expires_at FROM ${qualifiedTable("knowledge_governance_run_work")} WHERE session_id=$1 AND run_id=$2`,
        [current.id, identity.runId],
      )
    ).rows[0];
    if (!row) throw new HttpError(404, "Governance run not found");
    return {
      work: governanceWorkSchema.parse(row.work),
      open:
        Boolean(row.write_open) &&
        current.writeRunId === identity.runId &&
        new Date(row.expires_at).getTime() > Date.now(),
      expiresAt: new Date(row.expires_at).toISOString(),
    };
  },
  async deleteByUser(userId: string) {
    const rows = (
      await getPostgresPool().query(
        `SELECT id,domain_id,initiator_id,runtime_session_id,write_run_id FROM ${qualifiedTable("knowledge_governance_sessions")} WHERE initiator_id=$1 AND domain_id<>''`,
        [userId],
      )
    ).rows;
    for (const row of rows) {
      if (!row.runtime_session_id)
        throw new Error(
          "Governance session requires external upgrade before deletion",
        );
      const owner = { domainId: row.domain_id, userId };
      const client = new RuntimeClient(owner.domainId);
      if (row.write_run_id)
        await this.closeRun(row.id, owner, row.write_run_id);
      const session = await client.session(row.runtime_session_id);
      if (session.session.activeRunId)
        await client.cancel(session.session.activeRunId);
      await client.deleteSession(row.runtime_session_id);
      await getPostgresPool().query(
        `DELETE FROM ${qualifiedTable("knowledge_governance_sessions")} WHERE id=$1 AND domain_id=$2 AND initiator_id=$3`,
        [row.id, owner.domainId, userId],
      );
    }
  },
};
