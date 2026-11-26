import type { AssistantAgentDefinition } from "@ontomato/contracts/assistant-chat";
import { APP_BUILDER_KIND, isAppBuilderKind } from "../app-builder/definition";
import { OPS_DIAGNOSIS_KIND } from "../ops-diagnosis/definition";
import type { ModelSelection } from "@ontomato/contracts/model-settings";
import { lockSessionClaim, assertUnclaimedSession } from "../agent-host/session-claim";
import { createHash } from "node:crypto";
import type pg from "pg";
import {
  getPostgresPool,
  qualifiedTable as table,
} from "../../infrastructure/postgres";
import { transaction } from "../../infrastructure/postgres-transaction";
import { HttpError } from "../../utils/errors";
import { objectVisibilitySql, type ObjectVisibilityRange } from "../product-governance/authorization";
import type { RuntimeSkillRef } from "@ontomato/contracts/agent-runtime-skills";
import type { HomeState } from "@ontomato/contracts/platform-home";
export interface AssistantOwner {
  domainId: string;
  userId: string;
}
export interface SessionRow {
  id: string;
  domain_id: string;
  owner_id: string;
  agent_id: string;
  workspace_id: string | null;
  title: string;
  origin: "user" | "scheduled" | "delegated";
  latest_run_id: string | null;
  created_at: Date;
  updated_at: Date;
}
export interface TurnRow {
  id: string;
  session_id: string;
  request_seq: number;
  retrieval_scope_id: string | null;
  governance_record_id: string | null;
  input_hash: string;
  class_names: string[];
  admitted: boolean;
  // The turn's child retrievals have been closed after it ended.
  settled: boolean;
  created_at: Date;
}
export interface AgentRow {
  owner_id: string | null;
  execution_user_id: string | null;
  id: string;
  domain_id: string;
  kind: string;
  name: string;
  description: string;
  icon: string | null;
  enabled: boolean;
  system_prompt: string | null;
  engine?: AssistantAgentDefinition["engine"];
  model_selection: ModelSelection;
  skills: RuntimeSkillRef[];
  class_names: string[];
  enabled_mcp_service_ids: string[];
  sort_order: number;
}
const db = () => getPostgresPool();
const agentDefinitionScope = "domain_id=$1 AND kind NOT IN ('app-builder','ops-diagnosis')";
const agentDefinitionColumns = { ownerId: "a.owner_id", id: "a.id::text" };

function agentDefinitionVisibility(domainId: string, view: ObjectVisibilityRange, includeSystem: boolean) {
  const values: unknown[] = [domainId];
  const kinds = includeSystem ? "domain_id=$1" : agentDefinitionScope;
  return { where: `${kinds} AND ${objectVisibilitySql(view, agentDefinitionColumns, values)}`, values };
}

export type AgentDefinitionSummaryRow = Pick<AgentRow, "id" | "name" | "description" | "icon" | "enabled" | "kind" | "sort_order"> & {
  editable: boolean;
};

type AgentDefinitionRead = {
  includeSystem: boolean;
  editRange?: ObjectVisibilityRange;
  limit?: number;
  after?: { sortOrder: number; name: string; id: string };
};

export const assistantStore = {
  async agentDefinitionSummaries(domainId: string, view: ObjectVisibilityRange, { includeSystem, editRange, limit, after }: AgentDefinitionRead) {
    const { where, values } = agentDefinitionVisibility(domainId, view, includeSystem);
    const editable = editRange ? objectVisibilitySql(editRange, agentDefinitionColumns, values) : "FALSE";
    const continuation = after === undefined ? "" :
      `AND (a.sort_order,a.name,a.id) > ($${values.push(after.sortOrder)},$${values.push(after.name)},$${values.push(after.id)})`;
    const pageSize = limit === undefined ? "" : `LIMIT $${values.push(limit)}`;
    const { rows } = await db().query<AgentDefinitionSummaryRow>(
      `SELECT a.id,a.kind,a.name,a.description,a.icon,a.enabled,a.sort_order,${editable} AS editable
       FROM ${table("assistant_agents")} AS a WHERE ${where} ${continuation}
       ORDER BY a.sort_order,a.name,a.id ${pageSize}`, values,
    );
    return rows;
  },
  async countVisibleAgentDefinitions(domainId: string, view: ObjectVisibilityRange, { includeSystem }: Pick<AgentDefinitionRead, "includeSystem">) {
    const { where, values } = agentDefinitionVisibility(domainId, view, includeSystem);
    const { rows: [result] } = await db().query<{ total: number }>(
      `SELECT COUNT(*)::int AS total FROM ${table("assistant_agents")} AS a WHERE ${where}`, values,
    );
    return result.total;
  },
  async agents(domainId: string): Promise<AgentRow[]> {
    return (
      await db().query(
        `SELECT * FROM ${table("assistant_agents")} WHERE ${agentDefinitionScope} ORDER BY sort_order,name,id`,
        [domainId],
      )
    ).rows;
  },
  async registeredAgentIds(domainId: string, ids: readonly string[]): Promise<string[]> {
    const { rows } = await db().query<{ id: string }>(
      `SELECT id FROM ${table("assistant_agents")} WHERE domain_id=$1 AND id=ANY($2::text[])`, [domainId, ids],
    );
    return rows.map(row => row.id);
  },
  async channelAgents(domainId: string): Promise<AgentRow[]> {
    return (await db().query(
      `SELECT * FROM ${table("assistant_agents")} WHERE domain_id=$1 ORDER BY sort_order,name,id`,
      [domainId],
    )).rows;
  },
  async appBuilder(domainId: string): Promise<AgentRow> {
    const { rows } = await db().query<AgentRow>(
      `SELECT * FROM ${table("assistant_agents")} WHERE domain_id=$1 AND kind=$2`,
      [domainId, APP_BUILDER_KIND],
    );
    return rows[0];
  },
  async opsDiagnosis(domainId: string): Promise<AgentRow | undefined> {
    const { rows } = await db().query<AgentRow>(
      `SELECT * FROM ${table("assistant_agents")} WHERE domain_id=$1 AND kind=$2`,
      [domainId, OPS_DIAGNOSIS_KIND],
    );
    return rows[0];
  },
  async findAgent(id: string, domainId: string, c: pg.Pool | pg.PoolClient = db()): Promise<AgentRow | undefined> {
    const { rows } = await c.query<AgentRow>(
      `SELECT * FROM ${table("assistant_agents")} WHERE id=$1 AND domain_id=$2`,
      [id, domainId],
    );
    return rows[0];
  },
  async agent(id: string, owner: AssistantOwner, c?: pg.Pool | pg.PoolClient): Promise<AgentRow> {
    const agent = await this.findAgent(id, owner.domainId, c);
    if (!agent) throw new HttpError(404, "Agent not found", "NOT_FOUND");
    return agent;
  },
  async session(
    id: string,
    owner: AssistantOwner,
    c: pg.Pool | pg.PoolClient = db(),
  ): Promise<SessionRow> {
    const r = await c.query(
      `SELECT * FROM ${table("assistant_sessions")} WHERE id=$1 AND domain_id=$2 AND owner_id=$3`,
      [id, owner.domainId, owner.userId],
    );
    if (!r.rowCount)
      throw new HttpError(404, "Conversation not found", "NOT_FOUND");
    return r.rows[0];
  },
  /** The same owner/domain rule as session(), batched for a list's readability check. */
  async readableSessions(owner: AssistantOwner, ids: string[]): Promise<Set<string>> {
    if (!ids.length) return new Set();
    const rows = (await db().query(
      `SELECT id FROM ${table("assistant_sessions")} WHERE id=ANY($1::uuid[]) AND domain_id=$2 AND owner_id=$3`,
      [ids, owner.domainId, owner.userId],
    )).rows;
    return new Set(rows.map((row) => row.id));
  },
  async domainSession(id: string, domainId: string): Promise<SessionRow> {
    const r = await db().query(
      `SELECT * FROM ${table("assistant_sessions")} WHERE id=$1 AND domain_id=$2`,
      [id, domainId],
    );
    if (!r.rowCount)
      throw new HttpError(404, "Conversation not found", "NOT_FOUND");
    return r.rows[0];
  },
  /** The owner's latest conversations that ran at least once, newest first; scheduled runs do not count. */
  async recentConversations(
    owner: AssistantOwner,
  ): Promise<HomeState["recentConversations"]> {
    const result = await db().query(
      `SELECT id AS "sessionId", agent_id AS "agentId", title, updated_at AS "updatedAt"
       FROM ${table("assistant_sessions")}
       WHERE domain_id=$1 AND owner_id=$2 AND latest_run_id IS NOT NULL AND origin='user'
       ORDER BY updated_at DESC, id DESC
       LIMIT 6`,
      [owner.domainId, owner.userId],
    );
    return result.rows.map((row) => ({
      sessionId: row.sessionId,
      agentId: row.agentId,
      title: row.title,
      updatedAt: row.updatedAt.toISOString(),
    }));
  },
  /** Lists user-origin sessions for the current user in the current domain, newest first. */
  async listUserSessions(
    owner: AssistantOwner,
    options: { search?: string; limit?: number; agentKind?: string; agentId?: string } = {},
  ): Promise<Array<{ sessionId: string; agentId: string; agentName: string; title: string; updatedAt: string }>> {
    const limit = Math.max(1, Math.min(50, options.limit ?? 20));
    const search = options.search?.trim();
    const params: unknown[] = [owner.domainId, owner.userId];
    const where = [
      "s.domain_id=$1",
      "s.owner_id=$2",
      "s.latest_run_id IS NOT NULL",
      "s.origin='user'",
    ];
    if (search) {
      params.push(`%${search.replace(/[\\%_]/g, "\\$&")}%`);
      where.push(`(s.title ILIKE $${params.length} ESCAPE '\\' OR COALESCE(a.name, '') ILIKE $${params.length} ESCAPE '\\')`);
    }
    if (options.agentKind !== undefined) {
      params.push(options.agentKind);
      where.push(`a.kind=$${params.length}`);
    }
    if (options.agentId !== undefined) {
      params.push(options.agentId);
      where.push(`s.agent_id=$${params.length}`);
    }
    params.push(limit);
    const result = await db().query<{
      sessionId: string;
      agentId: string;
      agentName: string | null;
      title: string;
      updatedAt: Date;
    }>(
      `SELECT s.id AS "sessionId", s.agent_id AS "agentId", a.name AS "agentName", s.title, s.updated_at AS "updatedAt"
       FROM ${table("assistant_sessions")} s
       LEFT JOIN ${table("assistant_agents")} a ON a.id = s.agent_id AND a.domain_id = s.domain_id
       WHERE ${where.join(" AND ")}
       ORDER BY s.updated_at DESC, s.id DESC
       LIMIT $${params.length}`,
      params,
    );
    return result.rows.map(row => ({
      sessionId: row.sessionId,
      agentId: row.agentId,
      agentName: row.agentName ?? "",
      title: row.title,
      updatedAt: row.updatedAt.toISOString(),
    }));
  },
  /** Batch reads session metadata owned by the current user in the current domain. */
  async ownedSessionsByIds(
    owner: AssistantOwner,
    ids: readonly string[],
  ): Promise<Map<string, { sessionId: string; agentId: string; agentName: string; title: string; updatedAt: string }>> {
    if (!ids.length) return new Map();
    const result = await db().query<{
      sessionId: string;
      agentId: string;
      agentName: string | null;
      title: string;
      updatedAt: Date;
    }>(
      `SELECT s.id AS "sessionId", s.agent_id AS "agentId", a.name AS "agentName", s.title, s.updated_at AS "updatedAt"
       FROM ${table("assistant_sessions")} s
       LEFT JOIN ${table("assistant_agents")} a ON a.id = s.agent_id AND a.domain_id = s.domain_id
       WHERE s.id = ANY($1::uuid[]) AND s.domain_id=$2 AND s.owner_id=$3`,
      [ids, owner.domainId, owner.userId],
    );
    return new Map(result.rows.map(row => [row.sessionId, {
      sessionId: row.sessionId,
      agentId: row.agentId,
      agentName: row.agentName ?? "",
      title: row.title,
      updatedAt: row.updatedAt.toISOString(),
    }]));
  },
  /** Updates the title of a session owned by the current user. */
  async renameSession(
    owner: AssistantOwner,
    sessionId: string,
    title: string,
  ): Promise<{ sessionId: string; agentId: string; title: string; updatedAt: string }> {
    const trimmed = title.trim();
    if (!trimmed || trimmed.length > 200)
      throw new HttpError(400, "Session title must be between 1 and 200 characters", "INVALID_REQUEST");
    const result = await db().query<{ sessionId: string; agentId: string; title: string; updatedAt: Date }>(
      `UPDATE ${table("assistant_sessions")}
       SET title=$4
       WHERE id=$1 AND domain_id=$2 AND owner_id=$3
       RETURNING id AS "sessionId", agent_id AS "agentId", title, updated_at AS "updatedAt"`,
      [sessionId, owner.domainId, owner.userId, trimmed],
    );
    if (!result.rowCount)
      throw new HttpError(404, "Conversation not found", "NOT_FOUND");
    const row = result.rows[0]!;
    return {
      sessionId: row.sessionId,
      agentId: row.agentId,
      title: row.title,
      updatedAt: row.updatedAt.toISOString(),
    };
  },
  async create(id: string, owner: AssistantOwner, agentId: string, origin: SessionRow["origin"] = "user", workspaceId?: string, fromChannel = false) {
    return transaction(async (tx) => {
    await lockSessionClaim(tx, id);
    const existing = await tx.query(
      `SELECT id FROM ${table("assistant_sessions")} WHERE id=$1`,
      [id],
    );
    if (existing.rowCount) {
      const row = await this.session(id, owner, tx);
      if (row.agent_id !== agentId || row.workspace_id !== (workspaceId ?? null))
        throw new HttpError(
          409,
          "Idempotency key reused",
          "IDEMPOTENCY_CONFLICT",
        );
      return { row, replayed: true };
    }
    await assertUnclaimedSession(tx, id, owner, fromChannel);
    const a = await this.agent(agentId, owner);
    if (!a.enabled)
      throw new HttpError(409, "Agent disabled", "AGENT_DISABLED");
    const boundWorkspace = workspaceId ?? null;
    if (isAppBuilderKind(a.kind) && !boundWorkspace)
      throw new HttpError(400, "App builder conversations require a workspace", "INVALID_REQUEST");
    const r = await tx.query(
      `INSERT INTO ${table("assistant_sessions")} (id,domain_id,owner_id,agent_id,origin,workspace_id) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT DO NOTHING`,
      [id, owner.domainId, owner.userId, agentId, origin, boundWorkspace],
    );
    const row = await this.session(id, owner, tx);
    if (row.agent_id !== agentId || row.workspace_id !== boundWorkspace)
      throw new HttpError(
        409,
        "Idempotency key reused",
        "IDEMPOTENCY_CONFLICT",
      );
    return { row, replayed: !r.rowCount };
    });
  },
  /** A turn found by the service in its domain, with the owner the service then acts for. */
  async domainTurn(id: string, domainId: string): Promise<TurnRow & AssistantOwner> {
    const r = await db().query(
      `SELECT t.*,s.domain_id AS "domainId",s.owner_id AS "userId" FROM ${table("assistant_turns")} t JOIN ${table("assistant_sessions")} s ON s.id=t.session_id WHERE t.id=$1 AND s.domain_id=$2`,
      [id, domainId],
    );
    if (!r.rowCount) throw new HttpError(404, "Run not found", "NOT_FOUND");
    return r.rows[0];
  },
  async turn(id: string, owner: AssistantOwner): Promise<TurnRow> {
    const r = await db().query(
      `SELECT t.* FROM ${table("assistant_turns")} t JOIN ${table("assistant_sessions")} s ON s.id=t.session_id WHERE t.id=$1 AND s.domain_id=$2 AND s.owner_id=$3`,
      [id, owner.domainId, owner.userId],
    );
    if (!r.rowCount) throw new HttpError(404, "Run not found", "NOT_FOUND");
    return r.rows[0];
  },
  async reserve(
    sessionId: string,
    id: string,
    message: string,
    owner: AssistantOwner,
    classNames: string[],
  ) {
    return transaction(async (c) => {
      await this.session(sessionId, owner, c);
      await c.query(
        `SELECT id FROM ${table("assistant_sessions")} WHERE id=$1 FOR UPDATE`,
        [sessionId],
      );
      const old = await c.query(
        `SELECT * FROM ${table("assistant_turns")} WHERE id=$1`,
        [id],
      );
      if (old.rowCount) {
        if (
          old.rows[0].session_id !== sessionId ||
          old.rows[0].input_hash !==
            createHash("sha256").update(message).digest("hex")
        )
          throw new HttpError(
            409,
            "Idempotency key reused",
            "IDEMPOTENCY_CONFLICT",
          );
        return { row: old.rows[0] as TurnRow, replayed: true };
      }
      const result = await c.query(
        `INSERT INTO ${table("assistant_turns")} (id,session_id,request_seq,input_hash,class_names) SELECT $1,$2,COALESCE(MAX(request_seq),-1)+1,$3,$4 FROM ${table("assistant_turns")} WHERE session_id=$2 RETURNING *`,
        [
          id,
          sessionId,
          createHash("sha256").update(message).digest("hex"),
          JSON.stringify(classNames),
        ],
      );
      return { row: result.rows[0] as TurnRow, replayed: false };
    });
  },
  async recordRetrievalScope(id: string, owner: AssistantOwner, scopeId: string) {
    await db().query(`UPDATE ${table("assistant_turns")} t SET retrieval_scope_id=$4 FROM ${table("assistant_sessions")} s WHERE t.session_id=s.id AND t.id=$1 AND s.domain_id=$2 AND s.owner_id=$3`, [id,owner.domainId,owner.userId,scopeId]);
  },
  async recordGovernanceWindow(id: string, owner: AssistantOwner, recordId: string) {
    await db().query(`UPDATE ${table("assistant_turns")} t SET governance_record_id=$4 FROM ${table("assistant_sessions")} s WHERE t.session_id=s.id AND t.id=$1 AND s.domain_id=$2 AND s.owner_id=$3`, [id,owner.domainId,owner.userId,recordId]);
  },
  async governanceWindow(id: string, owner: AssistantOwner): Promise<string | null> {
    const row=(await db().query(`SELECT t.governance_record_id FROM ${table("assistant_turns")} t JOIN ${table("assistant_sessions")} s ON s.id=t.session_id WHERE t.id=$1 AND s.domain_id=$2 AND s.owner_id=$3`,[id,owner.domainId,owner.userId])).rows[0];
    return row?.governance_record_id ?? null;
  },
  async admitted(id: string, message: string) {
    await transaction(async (c) => {
      const r = await c.query(
        `UPDATE ${table("assistant_turns")} SET admitted=true WHERE id=$1 AND NOT admitted RETURNING session_id`,
        [id],
      );
      if (r.rowCount)
        await c.query(
          `UPDATE ${table("assistant_sessions")} SET title=CASE WHEN latest_run_id IS NULL THEN $2 ELSE title END,latest_run_id=$3,updated_at=now() WHERE id=$1`,
          [r.rows[0].session_id, message, id],
        );
    });
  },
  async settled(id: string) {
    await db().query(`UPDATE ${table("assistant_turns")} SET settled=true WHERE id=$1`, [id]);
  },
  /** Turns not yet settled, oldest first and after the given position, with the owner needed to finish them. */
  async unsettled(limit: number, after?: { createdAt: Date; id: string }): Promise<(TurnRow & AssistantOwner)[]> {
    return (
      await db().query(
        `SELECT t.*,s.domain_id AS "domainId",s.owner_id AS "userId" FROM ${table("assistant_turns")} t
         JOIN ${table("assistant_sessions")} s ON s.id=t.session_id
         WHERE NOT t.settled AND ($2::timestamptz IS NULL OR (t.created_at,t.id)>($2,$3::uuid))
         ORDER BY t.created_at,t.id LIMIT $1`,
        [limit, after?.createdAt ?? null, after?.id ?? null],
      )
    ).rows;
  },
  async turns(sessionId: string): Promise<TurnRow[]> {
    return (
      await db().query(
        `SELECT * FROM ${table("assistant_turns")} WHERE session_id=$1 AND admitted ORDER BY request_seq`,
        [sessionId],
      )
    ).rows;
  },
};
