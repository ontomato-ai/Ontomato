import { randomUUID } from "node:crypto";
import { agentRunIntentSchema, type AgentRunIntent, type AgentRunContext, type AgentExecutionRef, type AgentInput, type AgentRef, type AgentActorRef, type AgentNotification, type AgentPendingQuestion } from "@ontomato/contracts/agent-channel";
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
  async receive(scope: Scope, sessionId: string, message: AgentInput, options: { mode?: "followup" | "steer"; outputRunId?: string; id?: string; intentId?: string } = {}): Promise<MessageRow> {
    return this.store.transaction(async c => {
      const row = (await c.query(`UPDATE ${this.store.table("sessions")} SET message_seq=message_seq+1,updated_at=now() WHERE host_id=$1 AND domain_id=$2 AND id=$3 RETURNING message_seq`, [...this.key(scope), sessionId])).rows[0];
      const record = { id: options.id ?? randomUUID(), contextSeq: null, runId: options.outputRunId ?? null, messageSeq: Number(row.message_seq), message };
      await c.query(`INSERT INTO ${this.store.table("messages")} (host_id,domain_id,id,session_id,run_id,seq,message,intent_id,input_mode) VALUES($1,$2,$3,$4,$7,$5,$6,COALESCE($9::uuid,(SELECT preparing_run_id FROM ${this.store.table("sessions")} WHERE host_id=$1 AND domain_id=$2 AND id=$4)),$8)`, [...this.key(scope), record.id, sessionId, record.messageSeq, message,record.runId,options.mode ?? "followup",options.intentId ?? null]);
      return record;
    });
  }
  async pending(scope: Scope, sessionId: string, mode?: "steer"): Promise<MessageRow[]> {
    const { rows } = await this.store.pool.query(`SELECT m.id,m.run_id,m.seq,m.context_seq,m.message FROM ${this.store.table("messages")} m LEFT JOIN ${this.store.table("admissions")} a ON a.host_id=m.host_id AND a.domain_id=m.domain_id AND a.key=m.intent_id WHERE m.host_id=$1 AND m.domain_id=$2 AND m.session_id=$3 AND m.run_id IS NULL AND ($4::text IS NULL OR m.input_mode=$4) AND (a.intent IS NULL OR a.intent->>'status' NOT IN ('failed','cancelled')) ORDER BY m.seq`, [...this.key(scope),sessionId,mode ?? null]);
    return rows.map(row => ({ id: row.id,runId: null,messageSeq: Number(row.seq),contextSeq: null,message: row.message }));
  }
  async receipt(scope: Scope, id: string): Promise<(MessageRow & { sessionId: string; intentId: string | null }) | null> {
    const { rows } = await this.store.pool.query(`SELECT id,session_id,run_id,intent_id,seq,context_seq,message FROM ${this.store.table("messages")} WHERE host_id=$1 AND domain_id=$2 AND id=$3`,[...this.key(scope),id]);
    const row=rows[0];
    return row ? {id:row.id,sessionId:row.session_id,intentId:row.intent_id,runId:row.run_id,messageSeq:Number(row.seq),contextSeq:row.context_seq === null ? null : Number(row.context_seq),message:row.message} : null;
  }
  async pendingQuestions(scope: Scope, sessionId: string): Promise<AgentPendingQuestion[]> {
    const { rows } = await this.store.pool.query(`SELECT q.id,q.message FROM ${this.store.table("messages")} q
      WHERE q.host_id=$1 AND q.domain_id=$2 AND q.session_id=$3 AND q.message->>'kind'='agent-question'
      AND (q.message->>'recipient'='user' OR q.message->'source'->'session'->>'sessionId'=q.session_id::text)
      AND NOT EXISTS(SELECT 1 FROM ${this.store.table("messages")} a WHERE a.host_id=q.host_id AND a.domain_id=q.domain_id AND a.session_id=q.session_id AND a.message->>'kind'='agent-answer' AND a.message->>'replyTo'=q.id::text AND (q.message->>'recipient' IS DISTINCT FROM 'user' OR a.message->'source'->>'kind'='user'))
      ORDER BY q.seq`,[...this.key(scope),sessionId]);
    return rows.map(row=>({requestId:row.id,source:row.message.source,message:row.message.content,defaultAssumption:row.message.defaultAssumption,...(row.message.options ? {options:row.message.options} : {})}));
  }
  async question(domainId:string,id:string) {
    const row = (await this.store.pool.query(`SELECT message FROM ${this.store.table("messages")} WHERE domain_id=$1 AND id=$2 AND message->>'role'='notification' AND message->>'kind'='agent-question'`,[domainId,id])).rows[0];
    if (!row) throw new RuntimeError(400,"INVALID_REPLY","replyTo must identify a question received by this caller");
    return row.message as AgentNotification;
  }
  /** The receiving receipt is the authority, even when a different provider asked the question. */
  async userQuestion(domainId: string, id: string) {
    const row = (await this.store.pool.query(`SELECT host_id,session_id,id,run_id,seq,message FROM ${this.store.table("messages")} WHERE domain_id=$1 AND id=$2 AND message->>'kind'='agent-question' AND message->>'recipient'='user'`, [domainId,id])).rows[0];
    if (!row) throw new RuntimeError(404,"NOT_FOUND","User question not found");
    return { scope: { hostId: row.host_id as string, domainId }, sessionId: row.session_id as string,
      record: { id: row.id as string,runId:row.run_id as string,messageSeq:Number(row.seq),contextSeq:null,message:row.message as AgentNotification } };
  }
  async userAnswer(scope: Scope, questionId: string, answerId: string) {
    const question = await this.userQuestion(scope.domainId,questionId);
    const source = question.record.message.source as AgentExecutionRef;
    const origin = await this.task(scope.domainId,source.runId);
    if (scope.hostId !== question.scope.hostId && scope.hostId !== origin!.scope.hostId)
      throw new RuntimeError(403,"FORBIDDEN","Question belongs to another provider");
    const answer = await this.receipt(question.scope,answerId);
    if (!answer || answer.sessionId !== question.sessionId || answer.message.role !== "notification" ||
      answer.message.kind !== "agent-answer" || answer.message.replyTo !== questionId ||
      !("kind" in answer.message.source) || answer.message.source.kind !== "user" || !answer.message.respondent)
      throw new RuntimeError(404,"NOT_FOUND","Human answer receipt not found");
    return { questionId,answerId,source:answer.message.source,respondent:answer.message.respondent,
      recipientSession: origin!.intent.channel.userRecipient!.session,selectedOption:answer.message.selectedOption ?? null,text:answer.message.content };
  }
  async delivered(scope: Scope,sessionId: string,source: AgentExecutionRef) {
    const row=(await this.store.pool.query(`SELECT id FROM ${this.store.table("messages")} WHERE host_id=$1 AND domain_id=$2 AND session_id=$3 AND message->>'role'='notification' AND message->>'kind'='agent-result' AND message->'source'=$4::jsonb LIMIT 1`,[...this.key(scope),sessionId,JSON.stringify(source)])).rows[0];
    return row?.id as string | undefined;
  }
  async hasRun(scope: Scope,runId: string) {
    return (await this.store.pool.query(`SELECT id FROM ${this.store.table("runs")} WHERE host_id=$1 AND domain_id=$2 AND id=$3`,[...this.key(scope),runId])).rowCount!==0;
  }
  async questions(scope: Scope,execution: AgentExecutionRef) {
    const {rows}=await this.store.pool.query(`SELECT q.id,q.message,EXISTS(SELECT 1 FROM ${this.store.table("messages")} answer
      WHERE answer.domain_id=$1 AND answer.message->>'replyTo'=q.id::text AND answer.message->>'kind'='agent-answer'
      AND CASE WHEN q.message->>'recipient'='user'
        THEN answer.host_id=q.host_id AND answer.session_id=q.session_id AND answer.message->'source'->>'kind'='user'
        ELSE answer.host_id=$3 AND answer.session_id=$4 END) AS answered
      FROM ${this.store.table("messages")} q WHERE q.domain_id=$1 AND q.message->>'role'='notification'
      AND q.message->>'kind'='agent-question' AND q.message->'source'=$2::jsonb ORDER BY q.seq`,[scope.domainId,JSON.stringify(execution),scope.hostId,execution.session.sessionId]);
    return rows.map(row=>({id:row.id,message:row.message.content as string,defaultAssumption:row.message.defaultAssumption as string,answered:row.answered as boolean,...(row.message.options ? {options:row.message.options} : {})}));
  }
  async reserve(scope: Scope, sessionId: string, runId: string, inputId: string, channel: AgentRunContext, options: { language: string; context?: AgentRunIntent["context"]; title?: string; executionUserId?:string|null; afterRunId?: string; create?: { binding: ChannelBinding; input: AgentNotification } }) {
    const intent: AgentRunIntent = { id: runId, session: { providerId: channel.agent.providerId, sessionId }, channel, language: options.language, inputId, context: options.context, title: options.title, status: "starting", createdAt: new Date().toISOString(), error: null, cancelled: false,executionUserId:options.executionUserId };
    await this.store.transaction(async c => {
      if (channel.requestedBy) {
        const parent = (await c.query(`SELECT intent FROM ${this.store.table("admissions")} WHERE domain_id=$1 AND key=$2 AND intent IS NOT NULL AND intent->'session'=$3::jsonb FOR UPDATE`, [scope.domainId,channel.requestedBy.runId,JSON.stringify(channel.requestedBy.session)])).rows[0];
        if (parent.intent.cancelled) { intent.cancelled = true; intent.status = "cancelled"; }
      }
      if (options.create) {
        await this.store.admission(c,scope,sessionId,"session",digest({}),sessionId);
        await c.query(`INSERT INTO ${this.store.table("sessions")} (host_id,domain_id,id,channel,message_seq) VALUES($1,$2,$3,$4,1)`,[...this.key(scope),sessionId,options.create.binding]);
        await c.query(`INSERT INTO ${this.store.table("messages")} (host_id,domain_id,id,session_id,run_id,seq,message) VALUES($1,$2,$3,$4,NULL,1,$5)`,[...this.key(scope),inputId,sessionId,options.create.input]);
      }
      const occupied = await c.query(`UPDATE ${this.store.table("sessions")} SET preparing_run_id=$4 WHERE host_id=$1 AND domain_id=$2 AND id=$3 AND (active_run_id IS NULL OR active_run_id=$5) AND preparing_run_id IS NULL RETURNING id`, [...this.key(scope), sessionId, intent.cancelled ? null : runId, options.afterRunId ?? null]);
      if (!occupied.rowCount) throw new RuntimeError(409, "SESSION_BUSY", "Session already has an execution intent");
      await c.query(`UPDATE ${this.store.table("messages")} SET intent_id=$4 WHERE host_id=$1 AND domain_id=$2 AND session_id=$3 AND run_id IS NULL AND intent_id IS NULL`, [...this.key(scope),sessionId,runId]);
      await this.store.readOpenAdmission(scope, runId, c);
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
  async task(domainId: string, taskId: string): Promise<{ scope: Scope; intent: AgentRunIntent } | null> {
    const row = (await this.store.pool.query(`SELECT host_id,intent FROM ${this.store.table("admissions")} WHERE domain_id=$1 AND key=$2 AND intent IS NOT NULL`,[domainId,taskId])).rows[0];
    return row ? { scope: { hostId: row.host_id,domainId },intent: agentRunIntentSchema.parse(row.intent) } : null;
  }
  /** Only this conversation's direct delegations and their execution descendants. */
  async descendants(domainId: string, sessions: AgentExecutionRef["session"][]): Promise<Array<{ scope: Scope; intent: AgentRunIntent; rootRunId: string }>> {
    const { rows } = await this.store.pool.query(`WITH RECURSIVE delegated AS (
      SELECT a.host_id,a.intent,a.intent->'channel'->'requestedBy'->>'runId' AS root_run_id
      FROM ${this.store.table("admissions")} a
      WHERE a.domain_id=$1 AND a.intent IS NOT NULL AND a.intent->'channel'->'requestedBy'->'session'=ANY($2::jsonb[])
      UNION ALL
      SELECT child.host_id,child.intent,parent.root_run_id
      FROM delegated parent JOIN ${this.store.table("admissions")} child
        ON child.domain_id=$1 AND child.intent IS NOT NULL
        AND child.intent->'channel'->'requestedBy'=jsonb_build_object('session',parent.intent->'session','runId',parent.intent->>'id')
    ) SELECT host_id,intent,root_run_id FROM delegated ORDER BY intent->>'createdAt',intent->>'id'`,[domainId,sessions.map(session => JSON.stringify(session))]);
    return rows.map(row => ({ scope: { hostId: row.host_id,domainId },intent: agentRunIntentSchema.parse(row.intent),rootRunId: row.root_run_id }));
  }
  async preparationFailures(scope: Scope, sessionId: string) {
    const { rows } = await this.store.pool.query(`SELECT a.intent FROM ${this.store.table("admissions")} a LEFT JOIN ${this.store.table("runs")} r ON r.host_id=a.host_id AND r.domain_id=a.domain_id AND r.id=a.key WHERE a.host_id=$1 AND a.domain_id=$2 AND a.session_id=$3 AND a.intent IS NOT NULL AND a.intent->>'status'='failed' AND r.id IS NULL ORDER BY a.intent->>'createdAt',a.key`,[...this.key(scope),sessionId]);
    return rows.map(row => ({ runId: row.intent.id,inputId: row.intent.inputId,error: row.intent.error as string,createdAt: row.intent.createdAt as string }));
  }
  async children(domainId: string, source: AgentExecutionRef): Promise<Array<{ scope: Scope; intent: AgentRunIntent }>> {
    const { rows } = await this.store.pool.query(`SELECT host_id,intent FROM ${this.store.table("admissions")} WHERE domain_id=$1 AND intent IS NOT NULL AND intent->'channel'->'requestedBy'=$2::jsonb ORDER BY key`,[domainId,JSON.stringify(source)]);
    return rows.map(row => ({ scope: { hostId: row.host_id,domainId },intent: agentRunIntentSchema.parse(row.intent) }));
  }
  async closePending(scope:Scope,sessionId:string,runId:string) {
    await this.store.pool.query(`UPDATE ${this.store.table("messages")} SET intent_id=$4 WHERE host_id=$1 AND domain_id=$2 AND session_id=$3 AND run_id IS NULL AND intent_id IS NULL`,[...this.key(scope),sessionId,runId]);
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
