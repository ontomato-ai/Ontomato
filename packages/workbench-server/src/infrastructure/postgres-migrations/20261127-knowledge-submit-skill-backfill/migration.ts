import { runtimeSkillKey, type RuntimeSkillRef } from "@ontomato/contracts/agent-runtime-skills";
import { qualifiedTable as t } from "../../postgres";
import type { QueryableClient } from "../helpers";

export const KNOWLEDGE_SUBMIT_SKILL_VERSION = "20261127_knowledge_submit_skill_backfill_v1";
export const KNOWLEDGE_SUBMIT_SKILL_NAME = "knowledge submit skill backfill";

const ASSISTANT_SKILL: RuntimeSkillRef = { namespace: { kind: "provider", provider: "ontology" }, name: "ontomato-analyst-assistant" };
const QUERY_SKILL: RuntimeSkillRef = { namespace: { kind: "provider", provider: "ontology" }, name: "ontology-query" };
const SUBMIT_SKILL: RuntimeSkillRef = { namespace: { kind: "provider", provider: "ontology" }, name: "knowledge-submit" };
const assistantKey = runtimeSkillKey(ASSISTANT_SKILL);
const queryKey = runtimeSkillKey(QUERY_SKILL);
const submitKey = runtimeSkillKey(SUBMIT_SKILL);

type Row = { id: string; kind: string; skills: RuntimeSkillRef[] };

/** Agents that already answer data questions also need the generic pending-knowledge submission command. */
export async function migrateKnowledgeSubmitSkill(client: QueryableClient) {
  const rows = (await client.query(
    `SELECT id,kind,skills FROM ${t("assistant_agents")}`,
  )).rows as Row[];
  let updated = 0;
  for (const row of rows) {
    const keys = row.skills.map(runtimeSkillKey);
    if (!keys.includes(assistantKey) || keys.includes(submitKey)) continue;
    const next = [...row.skills];
    next.splice(keys.includes(queryKey) ? keys.indexOf(queryKey) + 1 : keys.indexOf(assistantKey) + 1, 0, SUBMIT_SKILL);
    await client.query(`UPDATE ${t("assistant_agents")} SET skills=$2::jsonb WHERE id=$1`, [row.id, JSON.stringify(next)]);
    updated++;
  }
  return { updated };
}
