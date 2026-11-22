import { z } from "zod";
import { DIAGNOSIS_AGENT_ID } from "@ontomato/contracts/ops-diagnosis";
import { DIAGNOSIS_MODEL } from "@ontomato/contracts/platform-object-types";
import { panelFormSaveInputSchema, type PanelFormRequest, type PanelRecord } from "@ontomato/contracts/panel-projection";
import { assertPermission } from "../../identity/installed";
import { tForLocale } from "../../i18n";
import type { AssistantCredentials } from "../../platform/agent-runtime/runtime";
import { HttpError } from "../../utils/errors";
import { agentDefinitionPermissions } from "../assistant/definitions";
import { describeModelPanelForm, modelSelectionWrite } from "../assistant/model-panel-form";
import { affected } from "../product-panels/data-query-operations";
import type { PanelServerOperation } from "../product-panels/server-operations";
import { readDiagnosisModel, saveDiagnosisModel } from "./model-settings";

const operation = `${DIAGNOSIS_MODEL}.save`;
const inputSchema = panelFormSaveInputSchema.omit({ revision: true }).strict().extend({ values: modelSelectionWrite });
const save = { method: "PUT", path: "/api/assistant/diagnosis-model", draftOperation: operation } as const;

export function createDiagnosisModelReads(domainId: string, viewer: AssistantCredentials) {
  const text = (key: string) => tForLocale(viewer.locale, `panels.simplePages.${key}`);
  async function read(primaryKey: string) {
    await assertPermission(viewer, agentDefinitionPermissions);
    if (primaryKey !== DIAGNOSIS_AGENT_ID) throw new HttpError(404, "Diagnosis model not found", "NOT_FOUND");
    return (await readDiagnosisModel(domainId)).modelSelection.modelId;
  }
  async function record(primaryKey: string): Promise<PanelRecord> {
    const modelId = await read(primaryKey);
    return {
      primaryKey, label: text("diagnosisAgent"), subtitle: text("diagnosisDescription"),
      fields: { modelId: modelId ?? tForLocale(viewer.locale, "panels.agentOptions.domainDefault") },
      fieldLabels: { modelId: tForLocale(viewer.locale, "panels.agentForm.modelSelection") },
    };
  }
  return {
    list: async () => [await record(DIAGNOSIS_AGENT_ID)],
    record,
    async form(primaryKey: string, inputs: Pick<PanelFormRequest, "values">) {
      return describeModelPanelForm(domainId, await read(primaryKey), inputs, save, viewer.locale);
    },
  };
}

export const diagnosisModelOperations = [{
  handlerRef: operation, labelKey: "panels.simplePages.saveDiagnosis",
  kind: "form.save", effect: "write", batch: false,
  binding: { kind: "PlatformObjectType", id: DIAGNOSIS_MODEL }, targetType: DIAGNOSIS_MODEL,
  targetSchema: z.object({ kind: z.literal("object"), objectType: z.literal(DIAGNOSIS_MODEL), primaryKey: z.literal(DIAGNOSIS_AGENT_ID) }).strict(),
  inputSchema, resultSchema: modelSelectionWrite,
  draftOperation: () => operation,
  draftInput: input => inputSchema.parse(input).values,
  formInstructions: "Set modelSelection.modelId to a domain chat model reference or null to follow the domain default.",
  async execute(host, _target, input) {
    const { owner, credentials } = host.executor;
    await assertPermission(credentials, agentDefinitionPermissions);
    try {
      const data = await saveDiagnosisModel(owner.domainId, inputSchema.parse(input).values.modelSelection);
      return { kind: "success", data, affected: affected(DIAGNOSIS_MODEL, DIAGNOSIS_AGENT_ID, [DIAGNOSIS_MODEL]) };
    } catch (error) {
      if (!(error instanceof HttpError) || error.status !== 400) throw error;
      const message = tForLocale(host.locale, "panels.simplePages.invalidModel");
      return { kind: "refusal", code: "INVALID_MODEL", message, errors: [{ field: "/modelSelection/modelId", code: "invalid_option" as const, message }] };
    }
  },
}] satisfies readonly PanelServerOperation[];
