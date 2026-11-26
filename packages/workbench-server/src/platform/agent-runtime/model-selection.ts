import type { ModelOptions, ModelSelection } from "@ontomato/contracts/model-settings";
import { RuntimeClient } from "../../infrastructure/agent-runtime/client";
import { HttpError } from "../../utils/errors";

export async function validateModelSelection(domainId: string, selection: ModelSelection) {
  if (selection.modelId === null) return;
  requireChatModel(selection.modelId, await new RuntimeClient(domainId).modelOptions());
}

export function requireChatModel(modelId: string, options: ModelOptions) {
  if (!options.models.some(model => model.name === modelId && model.type === "chat"))
    throw new HttpError(400, "The selected model does not exist in this domain", "INVALID_REQUEST");
}
