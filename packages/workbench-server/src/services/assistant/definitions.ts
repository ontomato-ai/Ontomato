import {
  assistantAgentDefinitionSchema,
  type AssistantAgentInput,
} from "@ontomato/contracts/assistant-chat";

import {
  getPostgresPool,
  qualifiedTable as t,
} from "../../infrastructure/postgres";
import { assistantStore, type AssistantOwner, type AgentRow } from "./store";
import { HttpError } from "../../utils/errors";
import { resolveAssistantSkillReferences } from "./skill-references";
import { validateAssistantSkills } from "./skills";
import { withDomainSkills } from "../skills/operations";
const view = (a: AgentRow) =>
  assistantAgentDefinitionSchema.parse({
    id: a.id,
    name: a.name,
    description: a.description,
    icon: a.icon ?? null,
    enabled: a.enabled,
    modelRole: a.model_role,
    skills: a.skills,
    classNames: a.class_names,
    enabledMcpServiceIds: a.enabled_mcp_service_ids,
    sortOrder: a.sort_order,
    systemPrompt: a.system_prompt,
  });
export async function readAgentDefinition(id: string, owner: AssistantOwner) {
  return view(await assistantStore.agent(id, owner));
}
export async function saveAgentDefinition(
  id: string,
  input: AssistantAgentInput,
  owner: AssistantOwner,
) {
  return withDomainSkills(owner.domainId, async () => {
    const skills = resolveAssistantSkillReferences(input.skills, owner.domainId);
    await validateAssistantSkills(owner.domainId, skills);
    const current = await assistantStore.agent(id, owner);
    await getPostgresPool().query(
      `UPDATE ${t("assistant_agents")} SET name=$3,description=$4,enabled=$5,system_prompt=$6,model_role=$7,skills=$8,icon=$9,class_names=$10,enabled_mcp_service_ids=$11,sort_order=$12 WHERE id=$1 AND domain_id=$2`,
      [
        id,
        owner.domainId,
        input.name,
        input.description,
        input.enabled,
        input.systemPrompt,
        input.modelRole ?? current.model_role,
        JSON.stringify(skills),
        input.icon,
        JSON.stringify(input.classNames),
        JSON.stringify(input.enabledMcpServiceIds),
        input.sortOrder,
      ],
    );
    return readAgentDefinition(id, owner);
  });
}
export async function createAgentDefinition(
  id: string,
  input: AssistantAgentInput,
  owner: AssistantOwner,
) {
  return withDomainSkills(owner.domainId, async () => {
    const skills = resolveAssistantSkillReferences(input.skills, owner.domainId);
    await validateAssistantSkills(owner.domainId, skills);
    await getPostgresPool().query(
      `INSERT INTO ${t("assistant_agents")} (id,domain_id,kind,name,description,enabled,system_prompt,model_role,skills,icon,class_names,enabled_mcp_service_ids,sort_order) VALUES($1,$2,$1::text,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) ON CONFLICT DO NOTHING`,
      [
        id,
        owner.domainId,
        input.name,
        input.description,
        input.enabled,
        input.systemPrompt,
        input.modelRole ?? "general",
        JSON.stringify(skills),
        input.icon,
        JSON.stringify(input.classNames),
        JSON.stringify(input.enabledMcpServiceIds),
        input.sortOrder,
      ],
    );
    const actual = await readAgentDefinition(id, owner);
    const { id: _id, ...semantic } = actual;
    if (
      JSON.stringify(semantic) !==
      JSON.stringify(
        assistantAgentDefinitionSchema
          .omit({ id: true })
          .parse({ ...input, skills, modelRole: input.modelRole ?? "general" }),
      )
    )
      throw new HttpError(409, "Idempotency key reused", "IDEMPOTENCY_CONFLICT");
    return actual;
  });
}

export async function listAgentDefinitions(owner: AssistantOwner) {
  return { agents: (await assistantStore.agents(owner.domainId)).map(view) };
}
export async function deleteAgentDefinition(id: string, owner: AssistantOwner) {
  await assistantStore.agent(id, owner);
  await getPostgresPool().query(
    `DELETE FROM ${t("assistant_agents")} WHERE id=$1 AND domain_id=$2`,
    [id, owner.domainId],
  );
}
