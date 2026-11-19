import { isPanelHumanOperationIntent, readStoredPanelOperationIntent, type PanelOperationIntent, type PanelOperationOutcome } from "@ontomato/contracts/panel-agent";
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
    const questionId = isPanelHumanOperationIntent(intent) ? null : intent.questionId;
    await db().query(`INSERT INTO ${t("panel_operation_intents")} (domain_id,id,owner_id,question_id,intent) VALUES($1,$2,$3,$4,$5) ON CONFLICT(domain_id,id) DO NOTHING`, [owner.domainId,intent.intentId,owner.userId,questionId,intent]);
    return this.get(owner,intent.intentId);
  },
  async claim(owner: AssistantOwner, intent: PanelOperationIntent) {
    return (await db().query(`UPDATE ${t("panel_operation_intents")} SET intent=$4::jsonb WHERE domain_id=$1 AND owner_id=$2 AND id=$3 AND intent->>'dispatched'='false' RETURNING id`, [owner.domainId,owner.userId,intent.intentId,{...intent,dispatched:true}])).rowCount !== 0;
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
