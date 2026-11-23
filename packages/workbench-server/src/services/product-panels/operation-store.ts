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
    return (await db().query(`UPDATE ${t("panel_operation_intents")} SET intent=$4::jsonb WHERE domain_id=$1 AND owner_id=$2 AND id=$3 AND intent->>'dispatched'='false' AND intent->'invalidated' IS NULL RETURNING id`, [owner.domainId,owner.userId,intent.intentId,{...intent,dispatched:true}])).rowCount !== 0;
  },
  async outcome(owner: AssistantOwner, id: string, outcome: PanelOperationOutcome) {
    await db().query(`UPDATE ${t("panel_operation_intents")} SET intent=jsonb_set(intent,'{outcome}',$4::jsonb) WHERE domain_id=$1 AND owner_id=$2 AND id=$3`, [owner.domainId,owner.userId,id,JSON.stringify(outcome)]);
  },
  async invalidatePendingFormSaves(
    owner: AssistantOwner,
    match: {
      rootSession?: AgentSessionRef;
      targetType?: string;
      affectedTypes?: readonly string[];
      primaryKey?: string | null;
      slot?: string;
      panelId?: string;
      actionId?: string;
    },
    reason: { code: string; message: string },
  ): Promise<number> {
    const params: unknown[] = [owner.domainId, owner.userId, JSON.stringify(reason)];
    const push = (value: unknown) => {
      params.push(value);
      return `$${params.length}`;
    };
    const clauses = [
      "domain_id=$1",
      "owner_id=$2",
      "intent->>'dispatched'='false'",
      "intent->'source'->>'kind' IS NULL",
      "intent->'invalidated' IS NULL",
    ];
    const targetClauses: string[] = [];
    if (match.primaryKey) {
      if (match.targetType) {
        const typeParam = push(match.targetType);
        const keyParam = push(match.primaryKey);
        targetClauses.push(
          `(intent->'operation'->>'kind'='form.save' OR intent->'operation'->>'handlerRef'='actions.execute')` +
          ` AND intent->'call'->'target'->>'kind'='object'` +
          ` AND intent->'call'->'target'->>'objectType'=${typeParam}` +
          ` AND intent->'call'->'target'->>'primaryKey'=${keyParam}`,
        );
      }
    } else {
      const types = [...new Set([
        ...(match.targetType ? [match.targetType] : []),
        ...(match.affectedTypes ?? []),
      ])];
      if (types.length === 1) {
        const typeParam = push(types[0]);
        targetClauses.push(
          `intent->'operation'->>'kind'='form.save' AND intent->'call'->'target'->>'kind'='draft' AND intent->'binding'->>'id'=${typeParam}`,
        );
      } else if (types.length > 1) {
        const typesParam = push(types);
        targetClauses.push(
          `intent->'operation'->>'kind'='form.save' AND intent->'call'->'target'->>'kind'='draft' AND intent->'binding'->>'id'=ANY(${typesParam}::text[])`,
        );
      }
      const actionDraftPredicates: string[] = [];
      if (match.slot) {
        const slotParam = push(match.slot);
        if (match.panelId) {
          const panelParam = push(match.panelId);
          actionDraftPredicates.push(`(intent->>'panelId'=${panelParam} AND intent->'operation'->>'slot'=${slotParam})`);
        } else {
          actionDraftPredicates.push(`intent->'operation'->>'slot'=${slotParam}`);
        }
      }
      if (match.actionId) {
        const actionParam = push(match.actionId);
        actionDraftPredicates.push(`intent->'binding'->>'id'=${actionParam}`);
      }
      if (types.length === 1) {
        const typeParam = push(types[0]);
        actionDraftPredicates.push(`(intent->'operation'->'action'->'affects' ? ${typeParam})`);
      } else if (types.length > 1) {
        const typesParam = push(types);
        actionDraftPredicates.push(`(intent->'operation'->'action'->'affects' ?| ${typesParam}::text[])`);
      }
      if (actionDraftPredicates.length > 0) {
        targetClauses.push(
          `intent->'operation'->>'handlerRef'='actions.execute'` +
          ` AND (intent->'call'->'target' IS NULL OR jsonb_typeof(intent->'call'->'target')='null' OR intent->'call'->'target'->>'kind'='draft')` +
          ` AND (${actionDraftPredicates.join(" OR ")})`,
        );
      }
    }
    if (!targetClauses.length) return 0;
    clauses.push(`(${targetClauses.join(" OR ")})`);
    if (match.rootSession) {
      const providerParam = push(match.rootSession.providerId);
      const sessionParam = push(match.rootSession.sessionId);
      clauses.push(`intent->'rootSession'->>'providerId'=${providerParam} AND intent->'rootSession'->>'sessionId'=${sessionParam}`);
    }
    const result = await db().query(
      `UPDATE ${t("panel_operation_intents")} SET intent=jsonb_set(intent,'{invalidated}',$3::jsonb) WHERE ${clauses.join(" AND ")}`,
      params,
    );
    return result.rowCount ?? 0;
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
