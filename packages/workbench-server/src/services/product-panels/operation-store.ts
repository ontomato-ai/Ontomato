import { readStoredPanelOperationIntent, type PanelOperationIntent, type PanelOperationOutcome } from "@ontomato/contracts/panel-agent";
import type { PanelObjectIdentity } from "@ontomato/contracts/panel-manifest";
import type { AgentSessionRef } from "@ontomato/contracts/agent-channel";
import { getPostgresPool, qualifiedTable as t } from "../../infrastructure/postgres";
import { HttpError } from "../../utils/errors";
import type { AssistantOwner } from "../assistant/store";

import { panelSecretStore } from "./secret-store";

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
  async findAgentPageQuestion(owner: AssistantOwner, questionId: string) {
    const row = (await db().query(
      `SELECT intent FROM ${t("panel_operation_intents")}
       WHERE domain_id=$1 AND owner_id=$2 AND question_id=$3 AND intent->'source'->>'kind'='agent-page'
       LIMIT 1`,
      [owner.domainId, owner.userId, questionId],
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
    if (result.rowCount) panelSecretStore.remove(owner, id);
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
    if (row) panelSecretStore.remove(owner, row.id);
    return row ? { intentId: row.id } : null;
  },
  async invalidatePendingObjectWrites(
    owner: AssistantOwner,
    excludeIntentId: string,
    objects: readonly PanelObjectIdentity[],
    reason: { code: string; message: string },
  ): Promise<void> {
    const targets = objects.map(({ objectType, primaryKey }) => ({ target: { kind: "object", objectType, primaryKey } }));
    const { rows } = await db().query<{ id: string }>(
      `UPDATE ${t("panel_operation_intents")}
       SET intent=jsonb_set(intent,'{invalidated}',$5::jsonb)
       WHERE domain_id=$1 AND owner_id=$2 AND id<>$3
         AND intent->'source'->>'kind'='agent-page'
         AND question_id IS NOT NULL
         AND intent->>'dispatched'='false'
         AND intent->'invalidated' IS NULL
         AND EXISTS (
           SELECT 1 FROM jsonb_array_elements($4::jsonb) AS affected(call)
           WHERE intent->'call' @> affected.call
              OR intent->'calls' @> jsonb_build_array(affected.call)
         )
       RETURNING id`,
      [owner.domainId, owner.userId, excludeIntentId, JSON.stringify(targets), JSON.stringify(reason)],
    );
    for (const { id } of rows) panelSecretStore.remove(owner, id);
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
