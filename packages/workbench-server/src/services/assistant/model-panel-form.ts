import { z } from "zod";
import { runtimeJsonObjectSchema } from "@ontomato/contracts/agent-runtime-values";
import { zodToJsonSchema } from "zod-to-json-schema";
import { modelReferenceSchema } from "@ontomato/contracts/model-settings";
import { MODEL_OPTION } from "@ontomato/contracts/platform-object-types";
import type { PanelFormDescription, PanelFormField, PanelFormRequest } from "@ontomato/contracts/panel-projection";
import { tForLocale } from "../../i18n";
import { validateModelSelection } from "../../platform/agent-runtime/model-selection";
import { HttpError } from "../../utils/errors";

export const modelPanelValues = z.object({ modelId: modelReferenceSchema.nullable() }).strict();
export const modelSelectionWrite = z.object({ modelSelection: modelPanelValues }).strict();

export const formJsonSchema = (schema: z.ZodTypeAny) => runtimeJsonObjectSchema.parse(zodToJsonSchema(schema, { effectStrategy: "input" }));
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
