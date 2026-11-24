import { modelSelectionSchema, type ModelSelection } from "@ontomato/contracts/model-settings";
import { getPostgresPool, qualifiedTable as t } from "../../infrastructure/postgres";
import { validateModelSelection } from "../../platform/agent-runtime/model-selection";
import { HttpError } from "../../utils/errors";
import { assistantStore, type AssistantOwner } from "../assistant/store";

export async function listBuilderAgents({ domainId }: AssistantOwner) {
  const { id, name, model_selection } = await assistantStore.appBuilder(domainId);
  return [{ id, name, modelSelection: modelSelectionSchema.parse(model_selection) }];
}

export async function saveBuilderModel(owner: AssistantOwner, id: string, modelSelection: ModelSelection) {
  const agent = await assistantStore.appBuilder(owner.domainId);
  if (agent.id !== id) throw new HttpError(404, "App builder unavailable", "NOT_FOUND");
  await validateModelSelection(owner.domainId, modelSelection);
  await getPostgresPool().query(
    `UPDATE ${t("assistant_agents")} SET model_selection=$3,model_reference_migrated=true WHERE domain_id=$1 AND id=$2`,
    [owner.domainId, id, JSON.stringify(modelSelection)],
  );
  return { modelSelection };
}
