import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import { z } from "zod";
import { runtimeSkillKey, type RuntimeSkillRef } from "@ontomato/contracts/agent-runtime-skills";
import { config } from "../../config/application";
import { environment } from "../../config/environment";
import { getPostgresPool, qualifiedTable as table } from "../../infrastructure/postgres";
import { transaction } from "../../infrastructure/postgres-transaction";
import { findCurrentProduct } from "../../infrastructure/product-current";
import { backendGet, backendPost } from "../../utils/backend-client";
import { APP_BUILDER } from "../app-builder/definition";
import { OPS_DIAGNOSIS, OPS_DIAGNOSIS_KIND } from "../ops-diagnosis/definition";
import { panelSkillRef } from "../product-panels/skill-identity";
import { readPanelSkillSources } from "../product-panels/skill-provider";
import { GOVERNANCE_KIND, GOVERNANCE_PANEL_ID, GOVERNANCE_PRESET_VERSION } from "./governance-definition";
import { productGovernanceServiceHeaders } from "../product-governance/grants";
import { presetAgentDefinitions } from "./preset-definitions";

const domainPresets = [
  ...Object.values(presetAgentDefinitions),
  { ...APP_BUILDER, sortOrder: 2 },
  { ...OPS_DIAGNOSIS, sortOrder: 3 },
];

const presetPublicationKind = "preset-object-policy";
const presetPublicationVersion = 1;

async function shouldUpgradeGovernancePreset(domainId: string) {
  const applied = await getPostgresPool().query(
    `SELECT 1 FROM ${table("assistant_preset_upgrades")} WHERE domain_id=$1 AND kind=$2 AND version=$3`,
    [domainId, GOVERNANCE_KIND, GOVERNANCE_PRESET_VERSION],
  );
  if (applied.rowCount) return false;
  if (!await findCurrentProduct(domainId, "panel", GOVERNANCE_PANEL_ID)) return false;
  return (await readPanelSkillSources(domainId)).some(source => source.panelId === GOVERNANCE_PANEL_ID);
}

export async function initializeDomainPresetAgents(domainId: string): Promise<void> {
  const upgradeGovernance = await shouldUpgradeGovernancePreset(domainId);
  await transaction(async client => {
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [`assistant-presets:${domainId}`]);
    const legacyDiagnosisModel = (await client.query<{ model_selection: unknown }>(
      `SELECT model_selection FROM ${table("ops_diagnosis_settings")} WHERE domain_id=$1`,
      [domainId],
    )).rows[0]?.model_selection ?? null;
    const createdIds: string[] = [];
    for (const preset of domainPresets) {
      const icon = "icon" in preset ? preset.icon : null;
      const modelSelection = preset.kind === OPS_DIAGNOSIS_KIND && legacyDiagnosisModel
        ? JSON.stringify(legacyDiagnosisModel)
        : '{"modelId":null}';
      const { rows } = await client.query<{ id: string }>(
        `INSERT INTO ${table("assistant_agents")} (id,domain_id,kind,name,description,icon,system_prompt,model_selection,skills,sort_order)
         VALUES($1,$2,$3,$4,$5,$6,NULL,$7::jsonb,$8,$9) ON CONFLICT(domain_id,kind) DO NOTHING RETURNING id`,
        [randomUUID(), domainId, preset.kind, preset.name, preset.description, icon, modelSelection, JSON.stringify(preset.skills), preset.sortOrder],
      );
      for (const { id } of rows) createdIds.push(id);
    }
    if (upgradeGovernance) await upgradeGovernancePreset(client, domainId);

    const publication = await client.query(
      `INSERT INTO ${table("assistant_preset_upgrades")} (domain_id,kind,version)
       VALUES($1,$2,$3) ON CONFLICT DO NOTHING`,
      [domainId, presetPublicationKind, presetPublicationVersion],
    );
    if (publication.rowCount) {
      const { rows } = await client.query<{ id: string }>(
        `SELECT id FROM ${table("assistant_agents")} WHERE domain_id=$1 AND kind=ANY($2::text[])`,
        [domainId, domainPresets.map(preset => preset.kind)],
      );
      await backendPost(
        "published-agent-presets", `${config.dataQuery.baseUrl}/authorization/objects/published-agent-presets`,
        { domainId, ids: rows.map(({ id }) => id), createdIds }, { headers: productGovernanceServiceHeaders(), retries: 1 },
      );
    }
  });
}

async function upgradeGovernancePreset(client: Pick<PoolClient, "query">, domainId: string) {
  const recorded = await client.query(
    `INSERT INTO ${table("assistant_preset_upgrades")} (domain_id,kind,version)
     VALUES($1,$2,$3) ON CONFLICT(domain_id,kind,version) DO NOTHING`,
    [domainId, GOVERNANCE_KIND, GOVERNANCE_PRESET_VERSION],
  );
  if (!recorded.rowCount) return;

  const ref = panelSkillRef(domainId, GOVERNANCE_PANEL_ID);
  const key = runtimeSkillKey(ref);
  const { rows: [agent] } = await client.query<{ id: string; skills: RuntimeSkillRef[] }>(
    `SELECT id,skills FROM ${table("assistant_agents")} WHERE domain_id=$1 AND kind=$2 FOR UPDATE`,
    [domainId, GOVERNANCE_KIND],
  );
  if (agent.skills.some(skill => runtimeSkillKey(skill) === key)) return;
  await client.query(
    `UPDATE ${table("assistant_agents")} SET skills=$2::jsonb WHERE id=$1`,
    [agent.id, JSON.stringify([...agent.skills, ref])],
  );
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
