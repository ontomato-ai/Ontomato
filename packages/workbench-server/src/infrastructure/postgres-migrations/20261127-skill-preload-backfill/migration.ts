import { runtimeSkillKey, type RuntimeSkillSelection } from "@ontomato/contracts/agent-runtime-skills";
import { qualifiedTable as t } from "../../postgres";
import type { QueryableClient } from "../helpers";

export const SKILL_PRELOAD_VERSION = "20261127_skill_preload_backfill_v1";
export const SKILL_PRELOAD_NAME = "assistant analyst skill preload backfill";

const PRESET_KINDS = new Set(["regular", "analysis"]);
const ANALYST_SKILL_KEY = runtimeSkillKey({
  namespace: { kind: "provider", provider: "ontology" },
  name: "ontomato-analyst-assistant",
});

type Row = { id: string; kind: string; skills: RuntimeSkillSelection[] };

/** Existing Assistant and Analyst presets keep their selected skills; the analyst skill gains its use-specific preload marker. */
export async function migrateSkillPreload(client: QueryableClient) {
  const rows = (await client.query(
    `SELECT id,kind,skills FROM ${t("assistant_agents")} WHERE kind=ANY($1::text[])`,
    [["regular", "analysis"]],
  )).rows as Row[];
  let agentsUpdated = 0;
  for (const row of rows) {
    if (!PRESET_KINDS.has(row.kind)) continue;
    let changed = false;
    const next = row.skills.map(skill => {
      if (runtimeSkillKey(skill) !== ANALYST_SKILL_KEY || skill.preload === true) return skill;
      changed = true;
      return { ...skill, preload: true };
    });
    if (!changed) continue;
    await client.query(`UPDATE ${t("assistant_agents")} SET skills=$2::jsonb WHERE id=$1`, [row.id, JSON.stringify(next)]);
    agentsUpdated++;
  }
  return { agentsUpdated };
}
