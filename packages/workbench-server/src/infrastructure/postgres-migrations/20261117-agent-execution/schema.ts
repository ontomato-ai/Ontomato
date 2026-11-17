import { qualifiedTable as t } from "../../postgres";
import type { QueryableClient } from "../helpers";

export async function ensureAgentExecutionSchema(client: QueryableClient) {
  await client.query(`ALTER TABLE ${t("assistant_agents")} ADD COLUMN IF NOT EXISTS execution_user_id text`);
}
