import { randomUUID } from "node:crypto";
import { agentRunIntentSchema, type AgentRunIntent, type AgentRunContext, type AgentExecutionRef, type AgentInput, type AgentRef, type AgentActorRef, type AgentNotification } from "@ontomato/contracts/agent-channel";
import type { RuntimeStore, Scope, MessageRow } from "./store";
import { digest } from "./store";
import { RuntimeError } from "./errors";

export interface ChannelBinding { agent: AgentRef; actor: AgentActorRef; parent: AgentExecutionRef | null; context?: AgentRunIntent["context"] }
/** Channel facts extend existing sessions, admissions and messages; no second task or input store. */
export class ChannelStore {
  constructor(readonly store: RuntimeStore) {}
  private key(scope: Scope) { return [scope.hostId, scope.domainId]; }
  async bind(scope: Scope, sessionId: string, binding: ChannelBinding) {
    await this.store.pool.query(`UPDATE ${this.store.table("sessions")} SET channel=$4 WHERE host_id=$1 AND domain_id=$2 AND id=$3`, [...this.key(scope), sessionId, binding]);
  }
  async binding(scope: Scope, sessionId: string): Promise<ChannelBinding> {
    await this.store.session(scope, sessionId);
    const { rows } = await this.store.pool.query(`SELECT channel FROM ${this.store.table("sessions")} WHERE host_id=$1 AND domain_id=$2 AND id=$3`, [...this.key(scope), sessionId]);
    if (!rows[0].channel) throw new RuntimeError(409, "CHANNEL_UNAVAILABLE", "Session has no registered agent provider");
    return rows[0].channel;
  }
  async receive(scope: Scope, sessionId: string, message: AgentInput): Promise<MessageRow> {
    return this.store.transaction(async c => {
      const row = (await c.query(`UPDATE ${this.store.table("sessions")} SET message_seq=message_seq+1,updated_at=now() WHERE host_id=$1 AND domain_id=$2 AND id=$3 RETURNING message_seq`, [...this.key(scope), sessionId])).rows[0];
      const record = { id: randomUUID(), runId: null, messageSeq: Number(row.message_seq), message };
      await c.query(`INSERT INTO ${this.store.table("messages")} (host_id,domain_id,id,session_id,run_id,seq,message,intent_id) VALUES($1,$2,$3,$4,NULL,$5,$6,(SELECT preparing_run_id FROM ${this.store.table("sessions")} WHERE host_id=$1 AND domain_id=$2 AND id=$4))`, [...this.key(scope), record.id, sessionId, record.messageSeq, message]);
      return record;
    });
  }
  async pending(scope: Scope, sessionId: string): Promise<MessageRow[]> {
    const { rows } = await this.store.pool.query(`SELECT m.id,m.run_id,m.seq,m.message FROM ${this.store.table("messages")} m LEFT JOIN ${this.store.table("admissions")} a ON a.host_id=m.host_id AND a.domain_id=m.domain_id AND a.key=m.intent_id WHERE m.host_id=$1 AND m.domain_id=$2 AND m.session_id=$3 AND m.run_id IS NULL AND (a.intent IS NULL OR a.intent->>'status' NOT IN ('failed','cancelled')) ORDER BY m.seq`, [...this.key(scope),sessionId]);
    return rows.map(row => ({ id: row.id,runId: null,messageSeq: Number(row.seq),message: row.message }));
  }
  async reserve(scope: Scope, sessionId: string, runId: string, inputId: string, channel: AgentRunContext, options: { language: string; context?: AgentRunIntent["context"]; title?: string; create?: { binding: ChannelBinding; input: AgentNotification } }) {
    const intent: AgentRunIntent = { id: runId, session: { providerId: channel.agent.providerId, sessionId }, channel, language: options.language, inputId, context: options.context, title: options.title, status: "starting", createdAt: new Date().toISOString(), error: null, cancelled: false };
    await this.store.transaction(async c => {
      if (channel.requestedBy) {
        const parent = (await c.query(`SELECT intent FROM ${this.store.table("admissions")} WHERE domain_id=$1 AND key=$2 AND intent->'session'=$3::jsonb FOR UPDATE`, [scope.domainId,channel.requestedBy.runId,JSON.stringify(channel.requestedBy.session)])).rows[0];
        if (parent.intent.cancelled) { intent.cancelled = true; intent.status = "cancelled"; }
      }
      if (options.create) {
        await this.store.admission(c,scope,sessionId,"session",digest({}),sessionId);
        await c.query(`INSERT INTO ${this.store.table("sessions")} (host_id,domain_id,id,channel,message_seq) VALUES($1,$2,$3,$4,1)`,[...this.key(scope),sessionId,options.create.binding]);
        await c.query(`INSERT INTO ${this.store.table("messages")} (host_id,domain_id,id,session_id,run_id,seq,message) VALUES($1,$2,$3,$4,NULL,1,$5)`,[...this.key(scope),inputId,sessionId,options.create.input]);
      }
      const occupied = await c.query(`UPDATE ${this.store.table("sessions")} SET preparing_run_id=$4 WHERE host_id=$1 AND domain_id=$2 AND id=$3 AND active_run_id IS NULL AND preparing_run_id IS NULL RETURNING id`, [...this.key(scope), sessionId, intent.cancelled ? null : runId]);
      if (!occupied.rowCount) throw new RuntimeError(409, "SESSION_BUSY", "Session already has an execution intent");
      await c.query(`UPDATE ${this.store.table("messages")} SET intent_id=$4 WHERE host_id=$1 AND domain_id=$2 AND session_id=$3 AND run_id IS NULL AND intent_id IS NULL`, [...this.key(scope),sessionId,runId]);
      await c.query(`INSERT INTO ${this.store.table("admissions")} (host_id,domain_id,key,operation,fingerprint,session_id,intent) VALUES($1,$2,$3,'run','',$4,$5)`, [...this.key(scope), runId, sessionId, intent]);
    });
    return intent;
  }
  async preparing(scope: Scope, sessionId: string): Promise<string | null> {
    return (await this.store.pool.query(`SELECT preparing_run_id FROM ${this.store.table("sessions")} WHERE host_id=$1 AND domain_id=$2 AND id=$3`, [...this.key(scope), sessionId])).rows[0].preparing_run_id;
  }
  async intent(scope: Scope, id: string): Promise<AgentRunIntent> {
    const row = (await this.store.pool.query(`SELECT intent FROM ${this.store.table("admissions")} WHERE host_id=$1 AND domain_id=$2 AND key=$3 AND intent IS NOT NULL`, [...this.key(scope), id])).rows[0];
    if (!row) throw new RuntimeError(404, "NOT_FOUND", "Agent execution not found");
    return agentRunIntentSchema.parse(row.intent);
  }
  async update(scope: Scope, intent: AgentRunIntent) {
    await this.store.transaction(async c => {
      await c.query(`UPDATE ${this.store.table("admissions")} SET intent=$4 WHERE host_id=$1 AND domain_id=$2 AND key=$3`, [...this.key(scope), intent.id, intent]);
      if (intent.status !== "starting") await c.query(`UPDATE ${this.store.table("sessions")} SET preparing_run_id=NULL WHERE host_id=$1 AND domain_id=$2 AND id=$3 AND preparing_run_id=$4`, [...this.key(scope), intent.session.sessionId, intent.id]);
    });
  }
  async latest(scope: Scope, sessionId: string): Promise<AgentRunIntent> {
    const row = (await this.store.pool.query(`SELECT intent FROM ${this.store.table("admissions")} WHERE host_id=$1 AND domain_id=$2 AND session_id=$3 AND intent IS NOT NULL ORDER BY intent->>'createdAt' DESC,key DESC LIMIT 1`, [...this.key(scope),sessionId])).rows[0];
    return agentRunIntentSchema.parse(row.intent);
  }
  async intents(domainId: string): Promise<Array<{ scope: Scope; intent: AgentRunIntent }>> {
    const { rows } = await this.store.pool.query(`SELECT host_id,intent FROM ${this.store.table("admissions")} WHERE domain_id=$1 AND intent IS NOT NULL ORDER BY intent->>'createdAt',key`, [domainId]);
    return rows.map(row => ({ scope: { hostId: row.host_id, domainId }, intent: agentRunIntentSchema.parse(row.intent) }));
  }
  async preparationFailures(scope: Scope, sessionId: string) {
    const { rows } = await this.store.pool.query(`SELECT a.intent FROM ${this.store.table("admissions")} a LEFT JOIN ${this.store.table("runs")} r ON r.host_id=a.host_id AND r.domain_id=a.domain_id AND r.id=a.key WHERE a.host_id=$1 AND a.domain_id=$2 AND a.session_id=$3 AND a.intent->>'status'='failed' AND r.id IS NULL ORDER BY a.intent->>'createdAt',a.key`,[...this.key(scope),sessionId]);
    return rows.map(row => ({ runId: row.intent.id,inputId: row.intent.inputId,error: row.intent.error as string,createdAt: row.intent.createdAt as string }));
  }
  async children(domainId: string, source: AgentExecutionRef): Promise<Array<{ scope: Scope; intent: AgentRunIntent }>> {
    const { rows } = await this.store.pool.query(`SELECT host_id,intent FROM ${this.store.table("admissions")} WHERE domain_id=$1 AND intent->'channel'->'requestedBy'=$2::jsonb ORDER BY key`,[domainId,JSON.stringify(source)]);
    return rows.map(row => ({ scope: { hostId: row.host_id,domainId },intent: agentRunIntentSchema.parse(row.intent) }));
  }
  async consume(scope: Scope, sessionId: string, runId: string, ids: string[]) {
    await this.store.transaction(async c => {
      for (const id of ids) {
        const current = (await c.query(`UPDATE ${this.store.table("sessions")} SET context_seq=context_seq+1 WHERE host_id=$1 AND domain_id=$2 AND id=$3 RETURNING context_seq`, [...this.key(scope),sessionId])).rows[0];
        await c.query(`UPDATE ${this.store.table("messages")} SET run_id=$4,context_seq=$5 WHERE host_id=$1 AND domain_id=$2 AND session_id=$3 AND id=$6 AND run_id IS NULL`, [...this.key(scope),sessionId,runId,current.context_seq,id]);
      }
    });
  }
}
