import type { RuntimeStartRunRequest } from "@ontomato/contracts/agent-runtime";
import { runDefinition, userSkillEnvironment } from "../../platform/agent-runtime/runtime";
import { effectiveSystemPrompt } from "../assistant/prompts";
import type { AssistantPreparation } from "../assistant/prepare";
import { APP_BUILDER } from "./definition";
import { currentAppSdk } from "./sdk";

export async function prepareAppBuilderRun({ a, session, input, credentials }: AssistantPreparation): Promise<RuntimeStartRunRequest> {
  const sdk = await currentAppSdk();
  const environment = userSkillEnvironment(credentials);
  return {
    language: credentials.locale ?? "en",
    input,
    definition: { agentId: a.id, ...runDefinition(
      effectiveSystemPrompt({...a,kind:APP_BUILDER.kind}) + "\n\nCurrent SDK (browser paths):\n" + JSON.stringify(sdk),
      a.model_selection.modelId, APP_BUILDER.skills, credentials.locale,
    ) },
    environment: { values: { ...environment.values, ONTOMATO_WORKSPACE_ID: session.workspace_id!, ONTOMATO_EXECUTION_KIND: "build-test" }, secrets: environment.secrets },
  };
}
