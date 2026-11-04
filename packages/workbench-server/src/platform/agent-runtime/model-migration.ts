import { modelMigrationMapSchema, migrateModelReference } from "@ontomato/contracts/model-migration";
import { getPostgresPool, qualifiedTable as table } from "../../infrastructure/postgres";
import { RuntimeClient } from "../../infrastructure/agent-runtime/client";
import { createLogger } from "../../logging/logger";

const logger = createLogger("model-migration");
let timer: ReturnType<typeof setTimeout> | undefined;
let stopped = false;
/** CAS updates preserve selections edited while the runtime mapping was being fetched. */
export async function migrateWorkbenchModels() {
  for (const name of ["assistant_agents", "ops_diagnosis_settings"]) {
    const rows = (await getPostgresPool().query(`SELECT DISTINCT domain_id FROM ${table(name)}
      WHERE NOT model_reference_migrated`)).rows;
    for (const { domain_id: domain } of rows) {
      const mapping = modelMigrationMapSchema.parse(await new RuntimeClient(domain).request("/v1/models/migration-map", "GET", undefined, undefined, AbortSignal.timeout(30000)));
      const selections = (await getPostgresPool().query(`SELECT DISTINCT model_selection FROM ${table(name)} WHERE domain_id=$1 AND NOT model_reference_migrated`, [domain])).rows;
      for (const { model_selection: selection } of selections) {
        const before = selection.modelId as string | null, after = migrateModelReference(before, mapping);
        await getPostgresPool().query(`UPDATE ${table(name)} SET model_selection=$1::jsonb, model_reference_migrated=true WHERE domain_id=$2 AND model_selection=$3::jsonb AND NOT model_reference_migrated`,
          [JSON.stringify({ modelId: after }), domain, JSON.stringify(selection)]);
      }
    }
  }
}
export function startModelMigration() {
  stopped = false;
  const attempt = async () => {
    try { await migrateWorkbenchModels(); }
    catch {
      logger.warn("Model selection upgrade is waiting for the runtime");
      if (!stopped) { timer = setTimeout(() => { void attempt(); }, 30000); timer.unref(); }
    }
  };
  void attempt();
}
export function stopModelMigration() { stopped = true; clearTimeout(timer); }
