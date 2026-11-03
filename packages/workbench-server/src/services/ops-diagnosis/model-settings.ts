import { modelSelectionSchema, type ModelSelection } from "@ontomato/contracts/model-settings";
import { getPostgresPool, qualifiedTable as table } from "../../infrastructure/postgres";
import { validateModelSelection } from "../../platform/agent-runtime/model-selection";

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
     ON CONFLICT(domain_id) DO UPDATE SET model_selection=EXCLUDED.model_selection`,
    [domainId, JSON.stringify(modelSelection)],
  );
  return { modelSelection };
}
