import type { RuntimeStartRunRequest } from "@ontomato/contracts/agent-runtime";
import { runDefinition, userSkillEnvironment } from "../../platform/agent-runtime/runtime";
import { effectiveSystemPrompt } from "../assistant/prompts";
import type { AssistantPreparation } from "../assistant/prepare";
import { APP_BUILDER } from "./definition";
import { currentAppSdk } from "./sdk";
import { agentVisibilityPrompt } from "../agent-host/visibility";
import { publishSkill, workbenchBuiltinSkillRoot } from "../agent-runtime/skills";

export async function prepareAppBuilderRun({ a, session, input, credentials, reader }: AssistantPreparation): Promise<RuntimeStartRunRequest> {
  const sdk = await currentAppSdk();
  const environment = userSkillEnvironment(credentials);
  const published = await Promise.all(APP_BUILDER.skills.map((ref) => publishSkill(workbenchBuiltinSkillRoot(ref), ref)));
  const skills = published.map(({ skill, digest }) => ({ skill, digest }));
  return {
    language: credentials.locale ?? "en",
    input,
    definition: { agentId: a.id, ...runDefinition(
      [effectiveSystemPrompt({...a,kind:APP_BUILDER.kind}), ...(reader ? [agentVisibilityPrompt(reader)] : []),
        "Current SDK (browser paths):\n" + JSON.stringify(sdk)].join("\n\n"),
      a.model_selection.modelId, skills, credentials.locale,
    ) },
    environment: { values: { ...environment.values, ONTOMATO_WORKSPACE_ID: session.workspace_id!, ONTOMATO_EXECUTION_KIND: "build-test" }, secrets: environment.secrets },
  };
}
