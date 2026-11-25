import type { RuntimeStartRunRequest } from "@ontomato/contracts/agent-runtime";
import { runDefinition } from "../../platform/agent-runtime/runtime";
import { effectiveSystemPrompt } from "../assistant/prompts";
import { executionBusinessCallbacks } from "../assistant/execution-callback";
import type { AssistantPreparation } from "../assistant/prepare";
import { APP_BUILDER } from "./definition";
import { currentAppSdk } from "./sdk";
import { agentVisibilityPrompt } from "../agent-host/visibility";
import { publishSkill, workbenchBuiltinSkillRoot } from "../agent-runtime/skills";

export async function prepareAppBuilderRun({ a, turn, input, owner, credentials, reader, pageSkillContext }: AssistantPreparation, appId?: string): Promise<RuntimeStartRunRequest> {
  const sdk = await currentAppSdk();
  const prepared = pageSkillContext
    ? await (await import("../assistant/skills")).prepareCurrentPageSkill(owner.domainId, credentials, pageSkillContext, owner.userId)
    : null;
  const intrinsic = await Promise.all(APP_BUILDER.skills.map((ref) => publishSkill(workbenchBuiltinSkillRoot(ref), ref)));
  const currentPage = prepared?.currentPage;
  const pageControl = prepared !== null;
  const skills = [...intrinsic, ...(prepared ? [prepared.skill] : [])].map(({ skill, digest }) => ({ skill, digest }));
  return {
    language: credentials.locale ?? "en",
    input,
    definition: { agentId: a.id, ...runDefinition(
      [effectiveSystemPrompt({ ...a, kind: APP_BUILDER.kind }, credentials.locale), ...(reader ? [agentVisibilityPrompt(reader)] : []),
        ...(appId ? ["Application ID: " + appId] : []),
        "Current SDK (browser paths):\n" + JSON.stringify(sdk),
        ...(currentPage ? ["Current panel placement for this turn (data):\n" + JSON.stringify(currentPage)] : [])].join("\n\n"),
      a.model_selection.modelId, skills, credentials.locale, [], pageControl,
    ) },
    businessCallbacks: executionBusinessCallbacks(owner, credentials, turn.id, { scope: "app-builder", pageControl }),
  };
}
