import type { RuntimeStartRunRequest } from "@ontomato/contracts/agent-runtime";
import { runDefinition, userSkillEnvironment } from "../../platform/agent-runtime/runtime";
import { effectiveSystemPrompt } from "../assistant/prompts";
import type { AssistantPreparation } from "../assistant/prepare";
import { APP_BUILDER } from "./definition";
import { currentAppSdk } from "./sdk";

export async function prepareAppBuilderRun({ a, session, turn, message, credentials }: AssistantPreparation): Promise<RuntimeStartRunRequest> {
  const sdk = await currentAppSdk();
  const environment = userSkillEnvironment(credentials);
  return {
    language: credentials.locale ?? "en",
    input: { role: "user", content: message, timestamp: new Date(turn.created_at).getTime() },
    definition: { agentId: a.id, ...runDefinition(
      effectiveSystemPrompt(a) + "\n\nCurrent SDK (browser paths):\n" + JSON.stringify(sdk),
      null, APP_BUILDER.skills, credentials.locale,
    ) },
    environment: { values: { ...environment.values, ONTOMATO_WORKSPACE_ID: session.workspace_id! }, secrets: environment.secrets },
  };
}
