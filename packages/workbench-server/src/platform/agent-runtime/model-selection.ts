import type { ModelSelection } from "@ontomato/contracts/model-settings";
import { RuntimeClient } from "../../infrastructure/agent-runtime/client";
import { HttpError } from "../../utils/errors";

export async function validateModelSelection(domainId: string, selection: ModelSelection) {
  if (selection.modelId === null) return;
  const options = await new RuntimeClient(domainId).modelOptions();
  if (!options.models.some(model => model.name === selection.modelId))
    throw new HttpError(400, "The selected model does not exist in this domain", "INVALID_REQUEST");
}
