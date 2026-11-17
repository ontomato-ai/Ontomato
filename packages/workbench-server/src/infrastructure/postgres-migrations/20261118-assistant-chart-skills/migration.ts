import { runtimeSkillKey, type RuntimeSkillRef } from "@ontomato/contracts/agent-runtime-skills";
import { defaultAssistantSkills } from "../../../config/assistant-defaults";
import { qualifiedTable as t } from "../../postgres";
import type { QueryableClient } from "../helpers";
import { isHistoricalDefaultPrompt } from "../20261105-assistant-default-prompts/migration";
import shippedPrompts from "./defaults.json" with { type: "json" };

export const ASSISTANT_CHART_SKILLS_VERSION = "20261118_assistant_chart_skills_v1";
export const ASSISTANT_CHART_SKILLS_NAME = "assistant chart skill defaults";

// Frozen pre-chart default identities; customized selections are not replaced.
const previousSkills: RuntimeSkillRef[] = [
  { namespace: { kind: "provider", provider: "ontology" }, name: "ontomato-analyst-assistant" },
  { namespace: { kind: "provider", provider: "workbench" }, name: "assistant-report" },
];
const previousKeys = previousSkills.map(runtimeSkillKey);
type StoredAgent = { id: string; kind: "regular" | "analysis"; system_prompt: string | null; skills: RuntimeSkillRef[] };

/** Match only shipped values: NULL prompts follow code, while custom text and skills remain owned by the user. */
export async function migrateAssistantChartSkills(client: QueryableClient) {
  const rows = (await client.query(
    `SELECT id,kind,system_prompt,skills FROM ${t("assistant_agents")} WHERE kind IN ('regular','analysis')`,
  )).rows as StoredAgent[];
  const prompts = rows.filter(row => row.system_prompt !== null && (
    isHistoricalDefaultPrompt(row.kind, row.system_prompt)
    || shippedPrompts[row.kind].some(prompt => prompt.trim() === row.system_prompt!.trim())
  )).map(row => row.id);
  const skills = rows.filter(row => row.skills.length === previousKeys.length
    && row.skills.every((skill, index) => runtimeSkillKey(skill) === previousKeys[index])).map(row => row.id);
  if (prompts.length) await client.query(`UPDATE ${t("assistant_agents")} SET system_prompt=NULL WHERE id=ANY($1::uuid[])`, [prompts]);
  if (skills.length) await client.query(`UPDATE ${t("assistant_agents")} SET skills=$2::jsonb WHERE id=ANY($1::uuid[])`, [skills, JSON.stringify(defaultAssistantSkills)]);
  return { promptsCleared: prompts.length, skillsUpdated: skills.length };
}
