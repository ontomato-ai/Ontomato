import { runtimeSkillKey, type RuntimeSkillRef } from "@ontomato/contracts/agent-runtime-skills";
import type { QueryableClient } from "../helpers";

export const REPORT_PPT_SKILL_VERSION = "20261112_report_ppt_skill_v1";
export const REPORT_PPT_SKILL_NAME = "report presentation skill replacement";

/** Run after skill-enable-retirement: only still-selected workbench PPT skills become the report skill. */
export async function migrateReportPptSkill(client: QueryableClient): Promise<{ agents: number }> {
  const { qualifiedTable: t } = await import("../../postgres");
  const rows = (await client.query(
    `SELECT id,skills FROM ${t("assistant_agents")} WHERE jsonb_array_length(skills) > 0`,
  )).rows as { id: string; skills: RuntimeSkillRef[] }[];
  let agents = 0;
  for (const row of rows) {
    const isOld = (skill: RuntimeSkillRef) => skill.namespace.kind === "provider" &&
      skill.namespace.provider === "workbench" && ["generate-ppt", "ppt-generation"].includes(skill.name);
    if (!row.skills.some(isOld)) continue;
    const seen = new Set<string>();
    const skills = row.skills.flatMap((skill) => {
      const next = isOld(skill) ? { ...skill, name: "assistant-report" } : skill;
      const key = runtimeSkillKey(next);
      if (next.namespace.kind === "provider" && next.namespace.provider === "workbench" && next.name === "assistant-report") {
        if (seen.has(key)) return [];
        seen.add(key);
      }
      return [next];
    });
    await client.query(`UPDATE ${t("assistant_agents")} SET skills=$2::jsonb WHERE id=$1`, [row.id, JSON.stringify(skills)]);
    agents++;
  }
  return { agents };
}
