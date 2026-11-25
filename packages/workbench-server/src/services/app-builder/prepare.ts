import type { RuntimeStartRunRequest } from "@ontomato/contracts/agent-runtime";
import { runDefinition } from "../../platform/agent-runtime/runtime";
import { effectiveSystemPrompt } from "../assistant/prompts";
import { executionBusinessCallbacks } from "../assistant/execution-callback";
import type { AssistantPreparation } from "../assistant/prepare";
import { APP_BUILDER } from "./definition";
import { currentAppSdk } from "./sdk";
import { agentVisibilityPrompt } from "../agent-host/visibility";
import { publishSkill, workbenchBuiltinSkillRoot } from "../agent-runtime/skills";

export async function prepareAppBuilderRun({ a, session, turn, input, owner, credentials, reader, pageSkillContext }: AssistantPreparation): Promise<RuntimeStartRunRequest> {
  const sdk = await currentAppSdk();
  const prepared = pageSkillContext
    ? await (await import("../assistant/skills")).prepareAssistantSkills(owner.domainId, { kind: APP_BUILDER.kind, skills: [] }, credentials, pageSkillContext)
    : null;
  const intrinsic = await Promise.all(APP_BUILDER.skills.map((ref) => publishSkill(workbenchBuiltinSkillRoot(ref), ref)));
  const currentPage = prepared?.currentPage;
  const skills = [...intrinsic, ...(prepared?.skills ?? [])].map(({ skill, digest }) => ({ skill, digest }));
  const workspacePage = `/app-builder/workspace?workspace=${session.workspace_id}`;
  return {
    language: credentials.locale ?? "en",
    input,
    definition: { agentId: a.id, ...runDefinition(
      [effectiveSystemPrompt({...a,kind:APP_BUILDER.kind}), ...(reader ? [agentVisibilityPrompt(reader)] : []),
        "Current SDK (browser paths):\n" + JSON.stringify(sdk),
        `Use the present tool to open ${workspacePage} beside the conversation when the user needs to inspect this workspace.`,
        ...(currentPage ? ["Current panel placement for this turn (data):\n" + JSON.stringify(currentPage)] : [])].join("\n\n"),
      a.model_selection.modelId, skills, credentials.locale,
    ) },
    environment: { values: { ONTOMATO_WORKSPACE_ID: session.workspace_id!, ONTOMATO_EXECUTION_KIND: "build-test" }, secrets: {} },
    businessCallbacks: executionBusinessCallbacks(owner, credentials, turn.id, { scope: "app-builder" }),
  };
}
