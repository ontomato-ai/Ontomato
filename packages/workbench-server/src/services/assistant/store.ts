import { randomUUID, createHash } from "node:crypto";
import type pg from "pg";
import {
  getPostgresPool,
  qualifiedTable as table,
} from "../../infrastructure/postgres";
import { transaction } from "../data-retrieval/store";
import { HttpError } from "../../utils/errors";
import { getPromptTemplate } from "../../core/prompts/loader";
import type { RuntimeSkillRef } from "@ontomato/contracts/agent-runtime-skills";
export interface AssistantOwner {
  domainId: string;
  userId: string;
}
export interface SessionRow {
  id: string;
  domain_id: string;
  owner_id: string;
  agent_id: string;
  title: string;
  latest_run_id: string | null;
  created_at: Date;
  updated_at: Date;
}
export interface TurnRow {
  id: string;
  session_id: string;
  request_seq: number;
  input_hash: string;
  class_names: string[];
  open: boolean;
  admitted: boolean;
  created_at: Date;
}
export interface AgentRow {
  id: string;
  domain_id: string;
  kind: string;
  name: string;
  description: string;
  icon: string | null;
  enabled: boolean;
  system_prompt: string;
  model_role: string;
  skills: RuntimeSkillRef[];
  class_names: string[];
  graph_scope: import("@ontomato/contracts/assistant-chat").AssistantGraphScope;
  enabled_mcp_service_ids: string[];
  sort_order: number;
}
const db = () => getPostgresPool();
export const assistantStore = {
  async agents(domainId: string, _locale?: string): Promise<AgentRow[]> {
    if (
      !(
        await db().query(
          `SELECT 1 FROM ${table("assistant_agents")} WHERE domain_id=$1 LIMIT 1`,
          [domainId],
        )
      ).rowCount
    ) {
      for (const kind of ["regular", "analysis"])
        await db().query(
          `INSERT INTO ${table("assistant_agents")} (id,domain_id,kind,name,description,system_prompt,skills,sort_order) VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT(domain_id,kind) DO NOTHING`,
          [
            randomUUID(),
            domainId,
            kind,
            kind === "regular" ? "Assistant" : "Analyst",
            kind === "regular"
              ? "Ask questions about your data"
              : "Investigate questions and produce reports",
            getPromptTemplate(`assistant.${kind}.system`),
            JSON.stringify([
              {
                namespace: { kind: "provider", provider: "workbench" },
                name: "assistant-retrieval",
              },
              {
                namespace: { kind: "provider", provider: "workbench" },
                name: "assistant-report",
              },
            ]),
            kind === "regular" ? 0 : 1,
          ],
        );
    }
    return (
      await db().query(
        `SELECT * FROM ${table("assistant_agents")} WHERE domain_id=$1 ORDER BY sort_order,name,id`,
        [domainId],
      )
    ).rows;
  },
  async agent(id: string, owner: AssistantOwner): Promise<AgentRow> {
    const r = await db().query(
      `SELECT * FROM ${table("assistant_agents")} WHERE id=$1 AND domain_id=$2`,
      [id, owner.domainId],
    );
    if (!r.rowCount) throw new HttpError(404, "Agent not found", "NOT_FOUND");
    return r.rows[0];
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
  async domainSession(id: string, domainId: string): Promise<SessionRow> {
    const r = await db().query(
      `SELECT * FROM ${table("assistant_sessions")} WHERE id=$1 AND domain_id=$2`,
      [id, domainId],
    );
    if (!r.rowCount)
      throw new HttpError(404, "Conversation not found", "NOT_FOUND");
    return r.rows[0];
  },
  async create(id: string, owner: AssistantOwner, agentId: string) {
    const existing = await db().query(
      `SELECT id FROM ${table("assistant_sessions")} WHERE id=$1`,
      [id],
    );
    if (existing.rowCount) {
      const row = await this.session(id, owner);
      if (row.agent_id !== agentId)
        throw new HttpError(
          409,
          "Idempotency key reused",
          "IDEMPOTENCY_CONFLICT",
        );
      return { row, replayed: true };
    }
    const a = await this.agent(agentId, owner);
    if (!a.enabled)
      throw new HttpError(409, "Agent disabled", "AGENT_DISABLED");
    const r = await db().query(
      `INSERT INTO ${table("assistant_sessions")} (id,domain_id,owner_id,agent_id) VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING`,
      [id, owner.domainId, owner.userId, agentId],
    );
    const row = await this.session(id, owner);
    if (row.agent_id !== agentId)
      throw new HttpError(
        409,
        "Idempotency key reused",
        "IDEMPOTENCY_CONFLICT",
      );
    return { row, replayed: !r.rowCount };
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
  async close(id: string) {
    await db().query(
      `UPDATE ${table("assistant_turns")} SET open=false WHERE id=$1`,
      [id],
    );
  },
  async turns(sessionId: string): Promise<TurnRow[]> {
    return (
      await db().query(
        `SELECT * FROM ${table("assistant_turns")} WHERE session_id=$1 AND admitted ORDER BY request_seq`,
        [sessionId],
      )
    ).rows;
  },
  async requireOpen(
    id: string,
    owner: AssistantOwner,
    c: pg.Pool | pg.PoolClient = db(),
  ) {
    const r = await c.query(
      `SELECT t.* FROM ${table("assistant_turns")} t JOIN ${table("assistant_sessions")} s ON s.id=t.session_id WHERE t.id=$1 AND t.open AND s.domain_id=$2 AND s.owner_id=$3 FOR UPDATE OF t`,
      [id, owner.domainId, owner.userId],
    );
    if (!r.rowCount)
      throw new HttpError(409, "Run is closed", "ASSISTANT_RUN_CLOSED");
    return r.rows[0] as TurnRow;
  },
};
