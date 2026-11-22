import { z } from "zod";
import { modelLabel } from "@ontomato/contracts/model-selection";
import { modelOptionsSchema, modelReferenceSchema } from "@ontomato/contracts/model-settings";
import { MODEL_OPTION } from "@ontomato/contracts/platform-object-types";
import type { PanelFormDescription, PanelFormField, PanelFormRequest, PanelOption } from "@ontomato/contracts/panel-projection";
import { config } from "../../config/application";
import { tForLocale } from "../../i18n";
import { validateModelSelection } from "../../platform/agent-runtime/model-selection";
import type { AssistantCredentials } from "../../platform/agent-runtime/runtime";
import { backendGet, buildBackendHeaders } from "../../utils/backend-client";
import { HttpError } from "../../utils/errors";
import { cachedZodToRuntimeJsonSchema } from "../../utils/zod-json-schema";

export const modelPanelValues = z.object({ modelId: modelReferenceSchema.nullable() }).strict();
export const modelSelectionWrite = z.object({ modelSelection: modelPanelValues }).strict();
const modelOptionsResponse = z.object({ success: z.literal(true), data: modelOptionsSchema });

/**
 * The domain's chat models, headed by the empty choice (follow the domain default, named by its current model) and
 * formatted with `modelLabel` so each option carries its full provider/model reference when it differs from the name.
 */
export async function readDomainModelOptions(viewer: AssistantCredentials): Promise<PanelOption[]> {
  const response = await backendGet("agent-model-options", `${config.dataQuery.baseUrl}/model-options`, {
    headers: buildBackendHeaders(viewer.token, undefined, viewer.locale, viewer.apiKey, viewer.headers), retries: 1,
  });
  const { data: { models, defaultModelId } } = modelOptionsResponse.parse(JSON.parse(response.text));
  const chat = models.filter(model => model.type === "chat");
  const current = chat.find(model => model.ref === defaultModelId);
  const following: PanelOption = {
    primaryKey: "@default",
    value: null,
    label: current
      ? tForLocale(viewer.locale, "panels.agentOptions.domainDefaultModel", { model: modelLabel(current) })
      : tForLocale(viewer.locale, "panels.agentOptions.domainDefault"),
  };
  return [following, ...chat.map((model): PanelOption => ({ primaryKey: model.ref, value: model.ref, label: modelLabel(model) }))];
}

export async function readDomainModelLabelMap(viewer: AssistantCredentials): Promise<Map<string | null, string>> {
  try {
    const options = await readDomainModelOptions(viewer);
    return new Map(options.map(option => [option.value as string | null, option.label]));
  } catch {
    return new Map();
  }
}

export const formJsonSchema = (schema: z.ZodTypeAny) => cachedZodToRuntimeJsonSchema(schema, { effectStrategy: "input" });
export const modelPanelField = (locale?: string): PanelFormField => ({
  path: "/modelSelection/modelId", label: tForLocale(locale, "panels.agentForm.modelSelection"),
  valueSchema: formJsonSchema(modelPanelValues.shape.modelId),
  required: false, readOnly: false, defaultValue: null,
  control: { kind: "reference", objectType: MODEL_OPTION, multiple: false },
});

export async function describeModelPanelForm(
  domainId: string, current: string | null, inputs: Pick<PanelFormRequest, "values">,
  save: Omit<PanelFormDescription["save"], "bodySchema">, locale?: string,
): Promise<PanelFormDescription> {
  const values = { modelSelection: { modelId: current }, ...inputs.values };
  const errors: PanelFormDescription["errors"] = [];
  if (inputs.values && Object.hasOwn(inputs.values, "modelSelection")) {
    const parsed = modelSelectionWrite.safeParse(values);
    if (!parsed.success) {
      errors.push({ field: "/modelSelection/modelId", code: "invalid_option" as const, message: tForLocale(locale, "panels.simplePages.invalidModel") });
    } else {
      try {
        await validateModelSelection(domainId, parsed.data.modelSelection);
      } catch (error) {
        if (!(error instanceof HttpError) || error.status !== 400) throw error;
        errors.push({ field: "/modelSelection/modelId", code: "invalid_option" as const, message: tForLocale(locale, "panels.simplePages.invalidModel") });
      }
    }
  }
  return {
    fields: [modelPanelField(locale)], values, errors,
    save: { ...save, bodySchema: formJsonSchema(modelSelectionWrite) },
  };
}
