import { PAGE_OPERATOR_SKILL, runtimeSkillKey, type RuntimeSkillRef } from "@ontomato/contracts/agent-runtime-skills";
import { defaultAssistantSkills } from "../../../config/assistant-defaults";
import { qualifiedTable as t } from "../../postgres";
import type { QueryableClient } from "../helpers";

const skill = (name: string, provider = "workbench"): RuntimeSkillRef => ({ namespace: { kind: "provider", provider }, name });
// Frozen shipped skill identities: migrations never follow later edits to the live constants.
const GOVERNANCE_SKILLS: RuntimeSkillRef[] = [skill("knowledge-governance", "ontology"), skill("assistant-report")];
const APP_BUILDER_SKILL = skill("ontomato-app-builder");
const APPLICATION_DESIGN_SKILL = skill("application-design");
const OPS_DIAGNOSIS_SKILL = skill("ops-diagnosis");

export const PAGE_OPERATOR_SKILL_VERSION = "20261126_page_operator_skill_v1";
export const PAGE_OPERATOR_SKILL_NAME = "single page operator skill presets";

const withoutOperator = (skills: readonly RuntimeSkillRef[]) => skills.filter(skill => skill.name !== PAGE_OPERATOR_SKILL.name);
const withOperator = (skills: readonly RuntimeSkillRef[]) => [...withoutOperator(skills), PAGE_OPERATOR_SKILL];
const sameSkills = (actual: readonly RuntimeSkillRef[], expected: readonly RuntimeSkillRef[]) =>
  actual.length === expected.length && actual.every((skill, index) => runtimeSkillKey(skill) === runtimeSkillKey(expected[index]!));

type Row = { id: string; kind: string; skills: RuntimeSkillRef[] };

/** Upgrade only rows whose skill arrays still match the arrays the product shipped; custom selections stay untouched. */
export async function migratePageOperatorSkill(client: QueryableClient) {
  const rows = (await client.query(
    `SELECT id,kind,skills FROM ${t("assistant_agents")} WHERE kind IN ('regular','knowledge-governance','app-builder','ops-diagnosis','modeling','product-layer','admin')`,
  )).rows as Row[];
  const previousRegular = withoutOperator(defaultAssistantSkills);
  const dashboardSkill: RuntimeSkillRef = { namespace: { kind: "provider", provider: "workbench" }, name: "dashboard-pages" };
  const previousAppBuilder: RuntimeSkillRef[] = [APP_BUILDER_SKILL, APPLICATION_DESIGN_SKILL, dashboardSkill];
  const previousOpsDiagnosis: RuntimeSkillRef[] = [OPS_DIAGNOSIS_SKILL];
  const expected = new Map<string, { previous: readonly RuntimeSkillRef[]; next: readonly RuntimeSkillRef[] }>([
    ["regular", { previous: previousRegular, next: defaultAssistantSkills }],
    ["knowledge-governance", { previous: GOVERNANCE_SKILLS, next: withOperator(GOVERNANCE_SKILLS) }],
    ["app-builder", { previous: previousAppBuilder, next: withOperator(previousAppBuilder) }],
    ["ops-diagnosis", { previous: previousOpsDiagnosis, next: withOperator(previousOpsDiagnosis) }],
  ]);
  let updated = 0;
  for (const row of rows) {
    const preset = expected.get(row.kind);
    if (!preset || !sameSkills(row.skills, preset.previous)) continue;
    await client.query(`UPDATE ${t("assistant_agents")} SET skills=$2::jsonb WHERE id=$1`, [row.id, JSON.stringify(preset.next)]);
    updated++;
  }
  const retired = rows.filter(row => ["modeling", "product-layer", "admin"].includes(row.kind)).map(row => row.id);
  if (retired.length)
    await client.query(`DELETE FROM ${t("assistant_agents")} WHERE id=ANY($1::uuid[])`, [retired]);
  return { presetsUpdated: updated, retiredPresetsDeleted: retired.length };
}
