import { DIAGNOSIS_AGENT_ID } from "@ontomato/contracts/ops-diagnosis";
import type { ModelSelection } from "@ontomato/contracts/model-settings";
import { assertPermission } from "../../identity/installed";
import { tForLocale } from "../../i18n";
import type { AssistantCredentials } from "../../platform/agent-runtime/runtime";
import { agentDefinitionPermissions } from "../assistant/definition-permissions";
import { readDiagnosisModel, saveDiagnosisModel } from "./model-settings";

export function createOpsDiagnosisDefinition(domainId: string, viewer: AssistantCredentials) {
  const admit = () => assertPermission(viewer, agentDefinitionPermissions);
  async function read() {
    const { modelSelection } = await readDiagnosisModel(domainId);
    return {
      id: DIAGNOSIS_AGENT_ID,
      name: tForLocale(viewer.locale, "panels.simplePages.diagnosisAgent"),
      description: tForLocale(viewer.locale, "panels.simplePages.diagnosisDescription"),
      modelSelection,
    };
  }
  const save = (_id: string, selection: ModelSelection) => saveDiagnosisModel(domainId, selection);
  return { admit, read, save };
}
