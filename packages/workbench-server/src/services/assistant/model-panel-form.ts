import { z } from "zod";
import { modelLabel } from "@ontomato/contracts/model-selection";
import { modelOptionsSchema, modelReferenceSchema } from "@ontomato/contracts/model-settings";
import { MODEL_OPTION } from "@ontomato/contracts/platform-object-types";
import type { PanelFormOption } from "@ontomato/contracts/form-fields";
import type { PanelFormDescription, PanelFormField, PanelFormRequest, PanelOption } from "@ontomato/contracts/panel-projection";
import { config } from "../../config/application";
import { tForLocale } from "../../i18n";
import { validateModelSelection } from "../../platform/agent-runtime/model-selection";
import type { AssistantCredentials } from "../../platform/agent-runtime/runtime";
import { backendGet, buildBackendHeaders } from "../../utils/backend-client";
import { HttpError } from "../../utils/errors";
import { cachedZodToRuntimeJsonSchema } from "../../utils/zod-json-schema";

export const DOMAIN_DEFAULT_MODEL_OPTION = "@default";

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
    primaryKey: DOMAIN_DEFAULT_MODEL_OPTION,
    value: null,
    label: current
      ? tForLocale(viewer.locale, "panels.agentOptions.domainDefaultModel", { model: modelLabel(current) })
      : tForLocale(viewer.locale, "panels.agentOptions.domainDefault"),
  };
  return [following, ...chat.map((model): PanelOption => ({ primaryKey: model.ref, value: model.ref, label: modelLabel(model) }))];
}

export async function tryReadDomainModelOptions(viewer: AssistantCredentials): Promise<PanelOption[] | null> {
  try {
    return await readDomainModelOptions(viewer);
  } catch {
    return null;
  }
}

export async function readDomainModelLabelMap(viewer: AssistantCredentials): Promise<Map<string | null, string>> {
  const options = await tryReadDomainModelOptions(viewer);
  return options ? new Map(options.map(option => [option.value as string | null, option.label])) : new Map();
}

export function missingModelWarning(
  domainOptions: readonly PanelOption[] | null, modelId: string | null | undefined, locale?: string,
): string | undefined {
  if (!domainOptions || !modelId) return undefined;
  if (domainOptions.some(option => option.value === modelId)) return undefined;
  return tForLocale(locale, "panels.simplePages.modelMissing", { id: modelId });
}

/**
 * Builds select options for row-style model settings forms where each agent is a field:
 * `"@default"` represents following the domain default, followed by each domain chat model, plus a disabled entry if
 * the stored model ID is no longer configured.
 */
export function buildModelSelectOptions(
  domainOptions: readonly PanelOption[], storedModelId: string | null, locale?: string,
): PanelFormOption[] {
  const choices: PanelFormOption[] = domainOptions.map(option => ({
    value: option.value === null ? DOMAIN_DEFAULT_MODEL_OPTION : String(option.value),
    label: option.label,
    description: null,
    disabled: false,
    disabledReason: null,
  }));
  if (storedModelId && !choices.some(choice => choice.value === storedModelId)) {
    const unavailable = tForLocale(locale, "panels.agentOptions.unavailable");
    choices.push({
      value: storedModelId,
      label: `${storedModelId} (${unavailable})`,
      description: null,
      disabled: true,
      disabledReason: unavailable,
    });
  }
  return choices;
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

export async function describeModelPanelForm(
  domainId: string, current: string | null, inputs: Pick<PanelFormRequest, "values">,
  save: Omit<PanelFormDescription["save"], "bodySchema">, locale?: string,
  meta?: { label?: string; help?: string; viewer?: AssistantCredentials },
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
  const activeModelId = typeof values.modelSelection?.modelId === "string" ? values.modelSelection.modelId : null;
  const domainOptions = meta?.viewer ? await tryReadDomainModelOptions(meta.viewer) : null;
  const warning = missingModelWarning(domainOptions, activeModelId, locale);
  return {
    fields: [modelPanelField(locale, { label: meta?.label, help: meta?.help, warning })], values, errors,
    save: { ...save, bodySchema: formJsonSchema(modelSelectionWrite) },
  };
}
