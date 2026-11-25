import { modelSelectionSchema, type ModelSelection } from "@ontomato/contracts/model-settings";
import { getPostgresPool, qualifiedTable as table } from "../../infrastructure/postgres";
import { validateModelSelection } from "../../platform/agent-runtime/model-selection";
import { HttpError } from "../../utils/errors";
import { assistantStore, type AssistantOwner } from "../assistant/store";

export async function readDiagnosisModel(domainId: string) {
  const row = (await getPostgresPool().query(
    `SELECT model_selection FROM ${table("ops_diagnosis_settings")} WHERE domain_id=$1`, [domainId],
  )).rows[0];
  return { modelSelection: modelSelectionSchema.parse(row?.model_selection ?? { modelId: null }) };
}

export async function saveDiagnosisModel(domainId: string, modelSelection: ModelSelection) {
  await validateModelSelection(domainId, modelSelection);
  await getPostgresPool().query(
    `INSERT INTO ${table("ops_diagnosis_settings")} (domain_id,model_selection) VALUES($1,$2::jsonb)
     ON CONFLICT(domain_id) DO UPDATE SET model_selection=EXCLUDED.model_selection,model_reference_migrated=true`,
    [domainId, JSON.stringify(modelSelection)],
  );
  return { modelSelection };
}

export async function saveOpsDiagnosisModel(owner: AssistantOwner, id: string, modelSelection: ModelSelection) {
  const agent = await assistantStore.opsDiagnosis(owner.domainId);
  if (!agent || agent.id !== id) throw new HttpError(404, "Operations diagnosis unavailable", "NOT_FOUND");
  await validateModelSelection(owner.domainId, modelSelection);
  await getPostgresPool().query(
    `UPDATE ${table("assistant_agents")} SET model_selection=$3,model_reference_migrated=true WHERE domain_id=$1 AND id=$2`,
    [owner.domainId, id, JSON.stringify(modelSelection)],
  );
  return { modelSelection };
}
