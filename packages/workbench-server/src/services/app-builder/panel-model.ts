import type { ModelSelection } from "@ontomato/contracts/model-settings";
import { tForLocale } from "../../i18n";
import type { AssistantCredentials } from "../../platform/agent-runtime/runtime";
import { assistantStore, type AssistantOwner } from "../assistant/store";
import { saveBuilderModel } from "./agents";
import { APP_BUILDER_KIND } from "./definition";

export function createAppBuilderDefinition(owner: AssistantOwner, viewer: AssistantCredentials) {
  const read = async () => {
    const { id, model_selection } = await assistantStore.appBuilder(owner.domainId);
    return {
      id,
      name: tForLocale(viewer.locale, "panels.simplePages.defaultBuilderAgentName"),
      description: tForLocale(viewer.locale, "panels.simplePages.builderDescription"),
      modelSelection: model_selection,
    };
  };
  const save = (id: string, selection: ModelSelection) => saveBuilderModel(owner, id, selection);
  const matches = async (id: string) => (await assistantStore.findAgent(id, owner.domainId))?.kind === APP_BUILDER_KIND;
  return { read, save, matches };
}
