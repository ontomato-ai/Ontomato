import { qualifiedTable as t } from "../../postgres";
import type { QueryableClient } from "../helpers";

/** Built-in agents follow the current template by storing no copy at all. */
export async function ensureAssistantDefaultPromptSchema(c: QueryableClient) {
  await c.query(
    `ALTER TABLE ${t("assistant_agents")} ALTER COLUMN system_prompt DROP NOT NULL`,
  );
}
