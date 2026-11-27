import { runtimeSkillKey, type RuntimeSkillRef } from "@ontomato/contracts/agent-runtime-skills";
import { qualifiedTable as t } from "../../postgres";
import type { QueryableClient } from "../helpers";

export const ONTOLOGY_QUERY_SKILL_VERSION = "20261127_ontology_query_skill_backfill_v1";
export const ONTOLOGY_QUERY_SKILL_NAME = "ontology query skill backfill";

const ASSISTANT_SKILL: RuntimeSkillRef = { namespace: { kind: "provider", provider: "ontology" }, name: "ontomato-analyst-assistant" };
const QUERY_SKILL: RuntimeSkillRef = { namespace: { kind: "provider", provider: "ontology" }, name: "ontology-query" };
const assistantKey = runtimeSkillKey(ASSISTANT_SKILL);
const queryKey = runtimeSkillKey(QUERY_SKILL);

type Row = { id: string; kind: string; skills: RuntimeSkillRef[] };

/** Agents that already delegate data questions also need the skill holding the query commands those instructions use. */
export async function migrateOntologyQuerySkill(client: QueryableClient) {
  const rows = (await client.query(
    `SELECT id,kind,skills FROM ${t("assistant_agents")}`,
  )).rows as Row[];
  let updated = 0;
  for (const row of rows) {
    const keys = row.skills.map(runtimeSkillKey);
    if (!keys.includes(assistantKey) || keys.includes(queryKey)) continue;
    const next = [...row.skills];
    next.splice(keys.indexOf(assistantKey) + 1, 0, QUERY_SKILL);
    await client.query(`UPDATE ${t("assistant_agents")} SET skills=$2::jsonb WHERE id=$1`, [row.id, JSON.stringify(next)]);
    updated++;
  }
  return { updated };
}
