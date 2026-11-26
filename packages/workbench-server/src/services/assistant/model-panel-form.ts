import { z } from "zod";
import { modelOptionsSchema, modelNameSchema } from "@ontomato/contracts/model-settings";
import { MODEL_OPTION } from "@ontomato/contracts/platform-object-types";
import type { PanelFormField, PanelOption } from "@ontomato/contracts/panel-projection";
import { config } from "../../config/application";
import { tForLocale } from "../../i18n";
import type { AssistantCredentials } from "../../platform/agent-runtime/runtime";
import { backendGet, buildBackendHeaders } from "../../utils/backend-client";
import { cachedZodToRuntimeJsonSchema } from "../../utils/zod-json-schema";

export const DOMAIN_DEFAULT_MODEL_OPTION = "@default";

export const modelPanelValues = z.object({ modelId: modelNameSchema.nullable() }).strict();
export const modelSelectionWrite = z.object({ modelSelection: modelPanelValues }).strict();
const modelOptionsResponse = z.object({ success: z.literal(true), data: z.unknown() });

/**
 * The domain's chat models, headed by the empty choice, which follows the domain default and names its current model.
 * A model is offered by its public name, which is what every caller stores.
 */
export async function readDomainModelOptions(viewer: AssistantCredentials): Promise<PanelOption[]> {
  const response = await backendGet("agent-model-options", `${config.dataQuery.baseUrl}/model-options`, {
    headers: buildBackendHeaders(viewer.token, undefined, viewer.locale, viewer.apiKey, viewer.headers), retries: 1,
  });
  return presentDomainModelOptions(modelOptionsResponse.parse(JSON.parse(response.text)).data, viewer.locale);
}

export function presentDomainModelOptions(payload: unknown, locale?: string): PanelOption[] {
  const { models, defaultModel } = modelOptionsSchema.parse(payload);
  const chat = models.filter(model => model.type === "chat");
  const current = chat.find(model => model.name === defaultModel);
  const following: PanelOption = {
    primaryKey: DOMAIN_DEFAULT_MODEL_OPTION,
    value: null,
    label: current
      ? tForLocale(locale, "panels.agentOptions.domainDefaultModel", { model: current.name })
      : tForLocale(locale, "panels.agentOptions.domainDefault"),
  };
  return [following, ...chat.map((model): PanelOption => ({ primaryKey: model.name, value: model.name, label: model.name }))];
}

export const formJsonSchema = (schema: z.ZodTypeAny) => cachedZodToRuntimeJsonSchema(schema, { effectStrategy: "input" });
export const modelPanelField = (locale?: string, meta?: { label?: string; help?: string; warning?: string }): PanelFormField => ({
  path: "/modelSelection/modelId",
  label: meta?.label ?? tForLocale(locale, "panels.agentForm.modelSelection"),
  ...(meta?.help ? { help: meta.help } : {}),
  ...(meta?.warning ? { warning: meta.warning } : {}),
  valueSchema: formJsonSchema(modelPanelValues.shape.modelId),
  required: false, readOnly: false, defaultValue: null,
  control: { kind: "reference", objectType: MODEL_OPTION, multiple: false },
});
