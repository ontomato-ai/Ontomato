import { randomUUID } from "node:crypto";
import { z } from "zod";
import { config } from "../../config/application";
import { environment } from "../../config/environment";
import { getPostgresPool, qualifiedTable as table } from "../../infrastructure/postgres";
import { transaction } from "../../infrastructure/postgres-transaction";
import { backendGet, backendPost } from "../../utils/backend-client";
import { OPS_DIAGNOSIS_KIND } from "../ops-diagnosis/definition";
import { productGovernanceServiceHeaders } from "../product-governance/service-authentication";
import { presetAgents } from "./preset-definitions";

/** Every preset takes its place in agent lists from this list, so a domain initialized earlier is brought back in line. */
export async function initializeDomainPresetAgents(domainId: string): Promise<void> {
  await transaction(async client => {
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [`assistant-presets:${domainId}`]);
    const legacyDiagnosisModel = (await client.query<{ model_selection: unknown }>(
      `SELECT model_selection FROM ${table("ops_diagnosis_settings")} WHERE domain_id=$1`,
      [domainId],
    )).rows[0]?.model_selection ?? null;
    const ids: string[] = [];
    for (const [index, preset] of presetAgents.entries()) {
      const icon = "icon" in preset ? preset.icon : null;
      const modelSelection = preset.kind === OPS_DIAGNOSIS_KIND && legacyDiagnosisModel
        ? JSON.stringify(legacyDiagnosisModel)
        : '{"modelId":null}';
      const { rows } = await client.query<{ id: string }>(
        `INSERT INTO ${table("assistant_agents")} (id,domain_id,kind,name,description,icon,system_prompt,model_selection,skills,sort_order)
         VALUES($1,$2,$3,$4,$5,$6,NULL,$7::jsonb,$8,$9) ON CONFLICT(domain_id,kind) DO NOTHING RETURNING id`,
        [randomUUID(), domainId, preset.kind, preset.name, preset.description, icon, modelSelection, JSON.stringify(preset.skills), index],
      );
      for (const { id } of rows) ids.push(id);
      await client.query(
        `UPDATE ${table("assistant_agents")} SET sort_order=$3 WHERE domain_id=$1 AND kind=$2 AND sort_order<>$3`,
        [domainId, preset.kind, index],
      );
    }

    if (ids.length) {
      await backendPost(
        "published-agent-presets", `${config.dataQuery.baseUrl}/authorization/objects/published-agent-presets`,
        { domainId, ids }, { headers: productGovernanceServiceHeaders(), retries: 1 },
      );
    }
  });
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
