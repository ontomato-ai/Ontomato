import { z } from "zod";
import { runtimeSkillRefSchema } from "@ontomato/contracts/agent-runtime-skills";
import type { AssistantCredentials } from "../../platform/agent-runtime/runtime";
import { readObjectRanges } from "../product-governance/authorization";
import { assistantName } from "./labels";
import { readAssistantSkillView, visibleAssistantSkillRefs } from "./skills";
import { assistantStore, type AssistantOwner } from "./store";

export async function listAgentDefinitionNodes(owner: AssistantOwner, credentials: AssistantCredentials) {
  const { VIEW } = await readObjectRanges("AGENT", ["VIEW"], credentials);
  const rows = await assistantStore.agentDefinitionSummaries(owner.domainId, VIEW, { includeSystem: false });
  return rows.map(agent => ({ id: agent.id, name: assistantName(agent, credentials.locale), enabled: agent.enabled }));
}

const storedSkills = z.array(runtimeSkillRefSchema);

export async function listAgentSkillRelations(owner: AssistantOwner, credentials: AssistantCredentials, agentId?: string) {
  const { VIEW } = await readObjectRanges("AGENT", ["VIEW"], credentials);
  const rows = await assistantStore.agentDefinitionRelationRows(owner.domainId, VIEW, "skills", agentId);
  if (rows.length === 0) return [];
  const skillView = await readAssistantSkillView(owner.domainId, credentials);
  return rows.map(agent => ({
    id: agent.id, name: assistantName(agent, credentials.locale),
    skills: visibleAssistantSkillRefs(storedSkills.parse(agent.skills), skillView),
  }));
}

export async function listAgentExecutionUserRelations(owner: AssistantOwner, credentials: AssistantCredentials, agentId?: string) {
  const { VIEW } = await readObjectRanges("AGENT", ["VIEW"], credentials);
  const rows = await assistantStore.agentDefinitionRelationRows(owner.domainId, VIEW, "execution_user_id", agentId);
  return rows.map(agent => ({
    id: agent.id, name: assistantName(agent, credentials.locale), executionUserId: agent.execution_user_id,
  }));
}
