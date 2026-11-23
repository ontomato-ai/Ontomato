import { readStoredPanelOperationIntent, type PanelOperationIntent, type PanelOperationOutcome } from "@ontomato/contracts/panel-agent";
import type { PanelFormTarget } from "@ontomato/contracts/panel-manifest";
import type { AgentSessionRef } from "@ontomato/contracts/agent-channel";
import { getPostgresPool, qualifiedTable as t } from "../../infrastructure/postgres";
import { HttpError } from "../../utils/errors";
import type { AssistantOwner } from "../assistant/store";

const db = () => getPostgresPool();
export const panelOperationStore = {
  async get(owner: AssistantOwner, id: string) {
    const row = (await db().query(`SELECT intent FROM ${t("panel_operation_intents")} WHERE domain_id=$1 AND owner_id=$2 AND id=$3`, [owner.domainId,owner.userId,id])).rows[0];
    if (!row) throw new HttpError(404,"Operation intent not found","NOT_FOUND");
    return readStoredPanelOperationIntent(row.intent);
  },
  async find(owner: AssistantOwner, id: string) {
    const row = (await db().query(`SELECT intent,owner_id FROM ${t("panel_operation_intents")} WHERE domain_id=$1 AND id=$2`, [owner.domainId,id])).rows[0];
    if (!row) return null;
    if (row.owner_id !== owner.userId) throw new HttpError(403,"Operation belongs to another user","FORBIDDEN");
    return readStoredPanelOperationIntent(row.intent);
  },
  async insert(owner: AssistantOwner, intent: PanelOperationIntent) {
    const questionId = intent.source.kind === "agent-page" ? intent.source.questionId : null;
    await db().query(`INSERT INTO ${t("panel_operation_intents")} (domain_id,id,owner_id,question_id,intent) VALUES($1,$2,$3,$4,$5) ON CONFLICT(domain_id,id) DO NOTHING`, [owner.domainId,intent.intentId,owner.userId,questionId,intent]);
    return this.get(owner,intent.intentId);
  },
  async findByAgentToolCall(owner: AssistantOwner, runId: string, toolCallId: string) {
    const row = (await db().query(
      `SELECT intent FROM ${t("panel_operation_intents")}
       WHERE domain_id=$1 AND owner_id=$2
         AND intent->'source'->>'kind'='agent-page'
         AND intent->'source'->>'runId'=$3
         AND intent->'source'->>'toolCallId'=$4
       LIMIT 1`,
      [owner.domainId, owner.userId, runId, toolCallId],
    )).rows[0];
    return row ? readStoredPanelOperationIntent(row.intent) : null;
  },
  async cancelIntent(owner: AssistantOwner, id: string, reason: { code: string; message: string }): Promise<boolean> {
    const result = await db().query(
      `UPDATE ${t("panel_operation_intents")}
       SET intent=jsonb_set(intent,'{invalidated}',$4::jsonb)
       WHERE domain_id=$1 AND owner_id=$2 AND id=$3
         AND intent->>'dispatched'='false'
         AND intent->'invalidated' IS NULL
       RETURNING id`,
      [owner.domainId, owner.userId, id, JSON.stringify(reason)],
    );
    return (result.rowCount ?? 0) > 0;
  },
  async cancelPendingAgentPageQuestion(
    owner: AssistantOwner,
    questionId: string,
    reason: { code: string; message: string },
  ): Promise<{ intentId: string } | null> {
    const row = (await db().query<{ id: string }>(
      `UPDATE ${t("panel_operation_intents")}
       SET intent=jsonb_set(intent,'{invalidated}',$4::jsonb)
       WHERE domain_id=$1 AND owner_id=$2 AND question_id=$3
         AND intent->'source'->>'kind'='agent-page'
         AND intent->>'dispatched'='false'
         AND intent->'invalidated' IS NULL
       RETURNING id`,
      [owner.domainId, owner.userId, questionId, JSON.stringify(reason)],
    )).rows[0];
    return row ? { intentId: row.id } : null;
  },
  async invalidatePendingFormSaves(
    owner: AssistantOwner,
    match: {
      applicationId: string;
      useId: string | null;
      panelId: string;
      projectionId: string | null;
      operationId: string;
      target: PanelFormTarget;
      excludeIntentId: string;
    },
    reason: { code: string; message: string },
  ): Promise<number> {
    if (match.target.kind === "object") {
      const result = await db().query(
        `UPDATE ${t("panel_operation_intents")}
         SET intent=jsonb_set(intent,'{invalidated}',$8::jsonb)
         WHERE domain_id=$1 AND owner_id=$2 AND id<>$3
           AND intent->'source'->>'kind'='agent-page'
           AND intent->'operation'->>'kind'='form.save'
           AND intent->>'dispatched'='false'
           AND intent->'invalidated' IS NULL
           AND intent->'use'->>'applicationId'=$4
           AND intent->'use'->>'useId' IS NOT DISTINCT FROM $5
           AND intent->'call'->'target'->>'kind'='object'
           AND intent->'call'->'target'->>'objectType'=$6
           AND intent->'call'->'target'->>'primaryKey'=$7`,
        [
          owner.domainId,
          owner.userId,
          match.excludeIntentId,
          match.applicationId,
          match.useId,
          match.target.objectType,
          match.target.primaryKey,
          JSON.stringify(reason),
        ],
      );
      return result.rowCount ?? 0;
    }
    const result = await db().query(
      `UPDATE ${t("panel_operation_intents")}
       SET intent=jsonb_set(intent,'{invalidated}',$9::jsonb)
       WHERE domain_id=$1 AND owner_id=$2 AND id<>$3
         AND intent->'source'->>'kind'='agent-page'
         AND intent->'operation'->>'kind'='form.save'
         AND intent->>'dispatched'='false'
         AND intent->'invalidated' IS NULL
         AND intent->'use'->>'applicationId'=$4
         AND intent->'use'->>'useId' IS NOT DISTINCT FROM $5
         AND intent->>'panelId'=$6
         AND intent->>'projectionId' IS NOT DISTINCT FROM $7
         AND intent->'operation'->>'id'=$8`,
      [
        owner.domainId,
        owner.userId,
        match.excludeIntentId,
        match.applicationId,
        match.useId,
        match.panelId,
        match.projectionId,
        match.operationId,
        JSON.stringify(reason),
      ],
    );
    return result.rowCount ?? 0;
  },
  async claim(owner: AssistantOwner, intent: PanelOperationIntent) {
    return (await db().query(`UPDATE ${t("panel_operation_intents")} SET intent=$4::jsonb WHERE domain_id=$1 AND owner_id=$2 AND id=$3 AND intent->>'dispatched'='false' AND intent->'invalidated' IS NULL RETURNING id`, [owner.domainId,owner.userId,intent.intentId,{...intent,dispatched:true}])).rowCount !== 0;
  },
  async outcome(owner: AssistantOwner, id: string, outcome: PanelOperationOutcome) {
    await db().query(`UPDATE ${t("panel_operation_intents")} SET intent=jsonb_set(intent,'{outcome}',$4::jsonb) WHERE domain_id=$1 AND owner_id=$2 AND id=$3`, [owner.domainId,owner.userId,id,JSON.stringify(outcome)]);
  },
  async settings(owner: AssistantOwner, root: AgentSessionRef) {
    const row = (await db().query(`SELECT confirm_before_execute FROM ${t("panel_operation_settings")} WHERE domain_id=$1 AND owner_id=$2 AND provider_id=$3 AND session_id=$4`, [owner.domainId,owner.userId,root.providerId,root.sessionId])).rows[0];
    return {rootSession:root,confirmBeforeExecute:row ? row.confirm_before_execute as boolean : true};
  },
  async setSettings(owner: AssistantOwner, root: AgentSessionRef, confirm: boolean) {
    await db().query(`INSERT INTO ${t("panel_operation_settings")} AS settings (domain_id,owner_id,provider_id,session_id,confirm_before_execute) VALUES($1,$2,$3,$4,$5) ON CONFLICT(domain_id,provider_id,session_id) DO UPDATE SET confirm_before_execute=EXCLUDED.confirm_before_execute WHERE settings.owner_id=EXCLUDED.owner_id`, [owner.domainId,owner.userId,root.providerId,root.sessionId,confirm]);
    return this.settings(owner,root);
  },
};
