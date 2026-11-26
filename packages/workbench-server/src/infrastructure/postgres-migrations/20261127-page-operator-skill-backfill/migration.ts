import { isPageOperatorSkill, PAGE_OPERATOR_SKILL, type RuntimeSkillRef } from "@ontomato/contracts/agent-runtime-skills";
import { qualifiedTable as t } from "../../postgres";
import type { QueryableClient } from "../helpers";

export const PAGE_OPERATOR_SKILL_VERSION = "20261127_page_operator_skill_backfill_v1";
export const PAGE_OPERATOR_SKILL_NAME = "single page operator skill backfill";

const PRESET_KINDS = new Set(["regular", "knowledge-governance", "app-builder", "ops-diagnosis"]);
const RETIRED_PRESET_KINDS = new Set(["modeling", "product-layer", "admin"]);
const ANALYSIS_KIND = "analysis";
const isPrivatePanelSkill = (skill: RuntimeSkillRef) => skill.name.startsWith("pvt-");
const hasOperator = (skills: readonly RuntimeSkillRef[]) => skills.some(isPageOperatorSkill);

type Row = { id: string; kind: string; skills: RuntimeSkillRef[] };

/**
 * Corrective replacement for the withdrawn exact-factory-array migration. Migration replay is keyed only by
 * schema_migrations.version, so this correction uses a new version rather than editing the already-applied 20261126 id.
 * Preset rows keep every legitimate skill and only gain the operator when missing. Dead per-panel pvt- references
 * are removed from every row; for user-built rows that removal is compensated by the operator unless already present.
 */
export async function migratePageOperatorSkill(client: QueryableClient) {
  const rows = (await client.query(
    `SELECT id,kind,skills FROM ${t("assistant_agents")}`,
  )).rows as Row[];
  let presetsUpdated = 0;
  let userAgentsUpdated = 0;
  let analysisRowsUpdated = 0;
  for (const row of rows) {
    if (RETIRED_PRESET_KINDS.has(row.kind)) continue;
    const hadPrivatePanelSkills = row.skills.some(isPrivatePanelSkill);
    let next: RuntimeSkillRef[] | null = hadPrivatePanelSkills ? row.skills.filter(skill => !isPrivatePanelSkill(skill)) : null;
    if (PRESET_KINDS.has(row.kind)) {
      const current = next ?? row.skills;
      if (!hasOperator(current)) next = [...current, PAGE_OPERATOR_SKILL];
    } else if (row.kind !== ANALYSIS_KIND && hadPrivatePanelSkills) {
      const current = next ?? row.skills;
      if (!hasOperator(current)) next = [...current, PAGE_OPERATOR_SKILL];
    }
    if (!next) continue;
    await client.query(`UPDATE ${t("assistant_agents")} SET skills=$2::jsonb WHERE id=$1`, [row.id, JSON.stringify(next)]);
    if (PRESET_KINDS.has(row.kind)) presetsUpdated++;
    else if (row.kind === ANALYSIS_KIND) analysisRowsUpdated++;
    else userAgentsUpdated++;
  }
  const retired = rows.filter(row => RETIRED_PRESET_KINDS.has(row.kind)).map(row => row.id);
  if (retired.length)
    await client.query(`DELETE FROM ${t("assistant_agents")} WHERE id=ANY($1::uuid[])`, [retired]);
  return { presetsUpdated, userAgentsUpdated, analysisRowsUpdated, retiredPresetsDeleted: retired.length };
}
