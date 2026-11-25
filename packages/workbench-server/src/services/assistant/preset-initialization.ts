import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import { z } from "zod";
import { runtimeSkillKey, type RuntimeSkillRef } from "@ontomato/contracts/agent-runtime-skills";
import { config } from "../../config/application";
import { environment } from "../../config/environment";
import { getPostgresPool, qualifiedTable as table } from "../../infrastructure/postgres";
import { transaction } from "../../infrastructure/postgres-transaction";
import { findCurrentProduct } from "../../infrastructure/product-current";
import { backendGet } from "../../utils/backend-client";
import { APP_BUILDER, APP_BUILDER_KIND } from "../app-builder/definition";
import { OPS_DIAGNOSIS, OPS_DIAGNOSIS_KIND } from "../ops-diagnosis/definition";
import { panelSkillRef } from "../product-panels/skill-identity";
import { readPanelSkillSources } from "../product-panels/skill-provider";
import { GOVERNANCE_KIND, GOVERNANCE_PANEL_ID, GOVERNANCE_PRESET_VERSION } from "./governance-definition";
import { registerProductResource } from "../product-governance/grants";
import { presetAgentDefinitions } from "./preset-definitions";

const domainPresets = [
  ...Object.values(presetAgentDefinitions),
  { ...APP_BUILDER, sortOrder: 2 },
  { ...OPS_DIAGNOSIS, sortOrder: 3 },
];

const legacyGrantsKind = "legacy-agent-grants";
const legacyGrantsVersion = 1;

async function shouldUpgradeGovernancePreset(domainId: string) {
  const applied = await getPostgresPool().query(
    `SELECT 1 FROM ${table("assistant_preset_upgrades")} WHERE domain_id=$1 AND kind=$2 AND version=$3`,
    [domainId, GOVERNANCE_KIND, GOVERNANCE_PRESET_VERSION],
  );
  if (applied.rowCount) return false;
  if (!await findCurrentProduct(domainId, "panel", GOVERNANCE_PANEL_ID)) return false;
  return (await readPanelSkillSources(domainId)).some(source => source.panelId === GOVERNANCE_PANEL_ID);
}

async function markLegacyGrants(client: Pick<PoolClient, "query">, domainId: string) {
  await client.query(
    `INSERT INTO ${table("assistant_preset_upgrades")} (domain_id,kind,version)
     VALUES($1,$2,$3) ON CONFLICT DO NOTHING`,
    [domainId, legacyGrantsKind, legacyGrantsVersion],
  );
}

export async function initializeDomainPresetAgents(domainId: string): Promise<void> {
  const upgradeGovernance = await shouldUpgradeGovernancePreset(domainId);
  const { rows, migrateLegacy, builderId, diagnosisId } = await transaction(async client => {
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [`assistant-presets:${domainId}`]);
    const { rows: [{ count: existingCount }] } = await client.query<{ count: number }>(
      `SELECT COUNT(*)::int AS count FROM ${table("assistant_agents")} WHERE domain_id=$1`,
      [domainId],
    );
    const marker = await client.query(
      `SELECT 1 FROM ${table("assistant_preset_upgrades")} WHERE domain_id=$1 AND kind=$2 AND version=$3`,
      [domainId, legacyGrantsKind, legacyGrantsVersion],
    );
    const legacyDiagnosisModel = (await client.query<{ model_selection: unknown }>(
      `SELECT model_selection FROM ${table("ops_diagnosis_settings")} WHERE domain_id=$1`,
      [domainId],
    )).rows[0]?.model_selection ?? null;
    for (const preset of domainPresets) {
      const icon = "icon" in preset ? preset.icon : null;
      const modelSelection = preset.kind === OPS_DIAGNOSIS_KIND && legacyDiagnosisModel
        ? JSON.stringify(legacyDiagnosisModel)
        : '{"modelId":null}';
      await client.query(
        `INSERT INTO ${table("assistant_agents")} (id,domain_id,kind,name,description,icon,system_prompt,model_selection,skills,sort_order)
         VALUES($1,$2,$3,$4,$5,$6,NULL,$7::jsonb,$8,$9) ON CONFLICT(domain_id,kind) DO NOTHING`,
        [randomUUID(), domainId, preset.kind, preset.name, preset.description, icon, modelSelection, JSON.stringify(preset.skills), preset.sortOrder],
      );
    }
    if (existingCount === 0) await markLegacyGrants(client, domainId);

    const migrateLegacy = existingCount > 0 && !marker.rowCount;
    const { rows } = await client.query<{ id: string }>(
      `SELECT id FROM ${table("assistant_agents")}
       WHERE domain_id=$1 AND kind NOT IN ('app-builder','ops-diagnosis') AND kind NOT LIKE 'app-builder:%'
       ${migrateLegacy ? "" : "AND kind=ANY($2::text[])"}`,
      migrateLegacy ? [domainId] : [domainId, Object.keys(presetAgentDefinitions)],
    );
    const { rows: [{ id: builderId }] } = await client.query<{ id: string }>(
      `SELECT id FROM ${table("assistant_agents")} WHERE domain_id=$1 AND kind=$2`,
      [domainId, APP_BUILDER_KIND],
    );
    const { rows: [{ id: diagnosisId }] } = await client.query<{ id: string }>(
      `SELECT id FROM ${table("assistant_agents")} WHERE domain_id=$1 AND kind=$2`,
      [domainId, OPS_DIAGNOSIS_KIND],
    );
    const registration = { rows, migrateLegacy, builderId, diagnosisId };
    if (!upgradeGovernance) return registration;

    const recorded = await client.query(
      `INSERT INTO ${table("assistant_preset_upgrades")} (domain_id,kind,version)
       VALUES($1,$2,$3) ON CONFLICT(domain_id,kind,version) DO NOTHING`,
      [domainId, GOVERNANCE_KIND, GOVERNANCE_PRESET_VERSION],
    );
    if (!recorded.rowCount) return registration;

    const ref = panelSkillRef(domainId, GOVERNANCE_PANEL_ID);
    const key = runtimeSkillKey(ref);
    const { rows: [agent] } = await client.query<{ id: string; skills: RuntimeSkillRef[] }>(
      `SELECT id,skills FROM ${table("assistant_agents")} WHERE domain_id=$1 AND kind=$2 FOR UPDATE`,
      [domainId, GOVERNANCE_KIND],
    );
    if (agent.skills.some(skill => runtimeSkillKey(skill) === key)) return registration;
    await client.query(
      `UPDATE ${table("assistant_agents")} SET skills=$2::jsonb WHERE id=$1`,
      [agent.id, JSON.stringify([...agent.skills, ref])],
    );
    return registration;
  });

  for (const { id } of rows) {
    await registerProductResource({ domainId }, id, true, {
      ownerId: null, verbs: ["use", "view", "edit"], grantAdmin: true,
      ...(migrateLegacy && { legacyMenuPermission: "analysis-agent" }),
    });
  }
  if (migrateLegacy) await markLegacyGrants(getPostgresPool(), domainId);
  for (const id of [builderId, diagnosisId])
    await registerProductResource({ domainId }, id, true, { ownerId: null, verbs: ["use", "view", "edit"], grantAdmin: true });
}

export async function initializeExistingDomainPresetAgents(): Promise<void> {
  const response = await backendGet("domain-ids", `${config.dataQuery.baseUrl}/internal/domains/ids`, {
    headers: { "X-Ontomato-Query-Service-Token": environment.agentRuntime().queryServiceToken },
    retries: 1, timeoutMs: 30_000,
  });
  const domainIds = z.array(z.string().min(1)).parse(JSON.parse(response.text));
  const { rows } = await getPostgresPool().query<{ domain_id: string }>(
    `SELECT DISTINCT domain_id FROM ${table("assistant_agents")}`,
  );
  for (const domainId of new Set([...domainIds, ...rows.map(row => row.domain_id)])) {
    await initializeDomainPresetAgents(domainId);
  }
}
