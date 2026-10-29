import type { SkillOutput } from "@ontomato/contracts/skills";
import { ARTIFACT_MARKDOWN_PROMPT } from "@ontomato/contracts/agent-artifact-markdown";
import { skillRegistryManager } from "../../core/skills/registry/manager";
import { renderPrompt } from "../../core/prompts/loader";
import { startAuxiliary, waitForRun, finalText, userSkillEnvironment,
  type AssistantCredentials } from "../../platform/agent-runtime/runtime";
import { HttpError } from "../../utils/errors";
import { prepareAssistantSkills } from "../assistant/skills";
import { skillReference } from "./skill-manager";
import { withDomainSkills } from "./operations";

export async function previewSkill(owner: { domainId: string; userId: string },
  credentials: AssistantCredentials, id: string, input: Record<string, unknown>): Promise<SkillOutput> {
  const { client, runId } = await withDomainSkills(owner.domainId, async () => {
    const registry = await skillRegistryManager.forDomain(owner.domainId);
    const skill = registry.getSkillById(id);
    if (!skill) throw new HttpError(404, "Skill not found", "SKILL_NOT_FOUND");
    if (!registry.isSkillEnabled(id)) throw new HttpError(409, "Skill is disabled", "SKILL_DISABLED");
    const selected = await prepareAssistantSkills(owner.domainId, [skillReference(skill, owner.domainId)]);
    return startAuxiliary({
      ...owner, credentials, skills: selected, environment: userSkillEnvironment(credentials),
      systemPrompt: renderPrompt("skills.preview.system", {}, credentials.locale) + "\n\n" + ARTIFACT_MARKDOWN_PROMPT,
      message: JSON.stringify(input),
    });
  });
  const snapshot = await waitForRun(client, runId);
  return {
    text: finalText(snapshot) || snapshot.run.errorMessage || "",
    json: { runId, status: snapshot.run.status, stopReason: snapshot.run.stopReason,
      errorMessage: snapshot.run.errorMessage, artifacts: snapshot.artifacts },
    meta: { skillId: id, resolvedSkills: snapshot.run.resolvedSkills },
  };
}
