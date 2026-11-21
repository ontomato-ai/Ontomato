import { runtimeSkillKey, type RuntimeSkillRef } from "@ontomato/contracts/agent-runtime-skills";
import { qualifiedTable as t } from "../../postgres";
import type { QueryableClient } from "../helpers";

export const GOVERNANCE_REPORT_SKILL_VERSION = "20261121_governance_report_skill_v1";
export const GOVERNANCE_REPORT_SKILL_NAME = "knowledge governance assistant report skill";

const GOVERNANCE_KIND = "knowledge-governance";
const REPORT_SKILL: RuntimeSkillRef = { namespace: { kind: "provider", provider: "workbench" }, name: "assistant-report" };

type StoredAgent = { id: string; skills: RuntimeSkillRef[] };

/** Add workbench:assistant-report to existing knowledge-governance presets without duplicating it. */
export async function migrateGovernanceReportSkill(client: QueryableClient): Promise<{ agents: number }> {
  const rows = (await client.query(
    `SELECT id,skills FROM ${t("assistant_agents")} WHERE kind=$1`,
    [GOVERNANCE_KIND],
  )).rows as StoredAgent[];
  const reportKey = runtimeSkillKey(REPORT_SKILL);
  let agents = 0;
  for (const row of rows) {
    if (row.skills.some(skill => runtimeSkillKey(skill) === reportKey)) continue;
    const skills = [...row.skills, REPORT_SKILL];
    await client.query(`UPDATE ${t("assistant_agents")} SET skills=$2::jsonb WHERE id=$1`, [row.id, JSON.stringify(skills)]);
    agents++;
  }
  return { agents };
}
