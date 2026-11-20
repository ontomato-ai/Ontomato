import { qualifiedTable as t } from "../../postgres";
import type { QueryableClient } from "../helpers";

/** Tracks lazy per-domain upgrades of built-in assistant presets by preset kind and version. */
export async function ensureAssistantPresetUpgradesSchema(client: QueryableClient) {
  await client.query(`CREATE TABLE IF NOT EXISTS ${t("assistant_preset_upgrades")} (
    domain_id text NOT NULL,
    kind text NOT NULL,
    version integer NOT NULL,
    applied_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (domain_id, kind, version)
  )`);
}
