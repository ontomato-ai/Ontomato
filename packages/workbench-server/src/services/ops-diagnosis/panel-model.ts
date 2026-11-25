import type { ModelSelection } from "@ontomato/contracts/model-settings";
import { tForLocale } from "../../i18n";
import type { AssistantCredentials } from "../../platform/agent-runtime/runtime";
import { HttpError } from "../../utils/errors";
import { assistantStore, type AssistantOwner } from "../assistant/store";
import { OPS_DIAGNOSIS_KIND } from "./definition";
import { saveOpsDiagnosisModel } from "./model-settings";

export function createOpsDiagnosisDefinition(owner: AssistantOwner, viewer: AssistantCredentials) {
  const read = async () => {
    const agent = await assistantStore.opsDiagnosis(owner.domainId);
    if (!agent) throw new HttpError(404, "Operations diagnosis unavailable", "NOT_FOUND");
    return {
      id: agent.id,
      name: tForLocale(viewer.locale, "panels.simplePages.diagnosisAgent"),
      description: tForLocale(viewer.locale, "panels.simplePages.diagnosisDescription"),
      modelSelection: agent.model_selection,
    };
  };
  const save = (id: string, selection: ModelSelection) => saveOpsDiagnosisModel(owner, id, selection);
  const matches = async (id: string) => (await assistantStore.findAgent(id, owner.domainId))?.kind === OPS_DIAGNOSIS_KIND;
  return { read, save, matches };
}
