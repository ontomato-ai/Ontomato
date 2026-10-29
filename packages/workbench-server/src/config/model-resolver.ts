import type { ModelRole } from "@ontomato/contracts/model-settings";
import { parseIsoDurationSeconds } from "@ontomato/contracts/model-settings";
import { RuntimeClient } from "../infrastructure/agent-runtime/client";
import { MODEL_RUNTIME_TOKEN_ENV, openSealedModelKey } from "@ontomato/contracts/model-key-seal";
import { getLogContext } from "../logging/log-context";
import { t } from "../i18n";

export class ModelNotConfiguredError extends Error {}

export interface ResolvedModelConfig {
  baseUrl: string;
  apiKey: string;
  modelName: string;
  timeoutSeconds?: number;
  maxRetries?: number;
  maxTokens: number;
  contextWindow: number;
  customRequestParameters: Record<string, unknown>;
}

export function getRoleNotConfiguredMessage(role: ModelRole): string {
  const roleName = t(`model.role.${role}`);
  return t("model.roleNotConfigured", { role: roleName });
}

export async function resolveModelForRole(role: ModelRole = "general"): Promise<ResolvedModelConfig> {
  const context = getLogContext();
  if (!context?.domainId) throw new Error("A verified domain is required to resolve a model");
  const data = await new RuntimeClient(context.domainId).modelSettings();

  const agentEntry = data.agents?.[role];
  const modelId = agentEntry?.model;
  if (!modelId) {
    throw new ModelNotConfiguredError(getRoleNotConfiguredMessage(role));
  }

  const model = data.models?.find((m) => m.name === modelId);
  if (!model) {
    throw new Error(`Model settings are inconsistent: role "${role}" references missing model "${modelId}"`);
  }

  // apiKeys are masks; the key to use comes sealed and is opened here.
  const sealed = data.sealedApiKeys?.[modelId]?.[0];
  const apiKey = sealed ? openSealedModelKey(sealed, process.env[MODEL_RUNTIME_TOKEN_ENV]) : "";
  const baseUrl = model.baseUrl;
  const modelName = model.modelName;
  const timeoutSeconds = model.timeout ? parseIsoDurationSeconds(model.timeout) : undefined;

  return {
    baseUrl,
    apiKey,
    modelName,
    timeoutSeconds,
    maxRetries: model.maxRetries,
    maxTokens: model.maxTokens,
    contextWindow: model.contextWindow,
    customRequestParameters: model.customRequestParameters ?? {},
  };
}
