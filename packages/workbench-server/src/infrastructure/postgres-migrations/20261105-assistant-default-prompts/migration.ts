import { qualifiedTable as t } from "../../postgres";
import type { QueryableClient } from "../helpers";
import { HISTORICAL_SYSTEM_PROMPTS } from "./defaults";

export const ASSISTANT_DEFAULT_PROMPTS_VERSION =
  "20261105_assistant_default_prompts_v1";
export const ASSISTANT_DEFAULT_PROMPTS_NAME = "assistant default prompts";

type StoredAgent = { id: string; kind: string; system_prompt: string | null };

export function isHistoricalDefaultPrompt(
  kind: string,
  prompt: string | null,
): boolean {
  if (prompt === null) return false;
  const templates = HISTORICAL_SYSTEM_PROMPTS[kind as "regular" | "analysis"];
  if (!templates) return false;
  const normalized = prompt.trim();
  return templates.some((template) => template.trim() === normalized);
}

/** Only a built-in agent that still equals a shipped default becomes NULL; custom text stays. */
export async function migrateAssistantDefaultPrompts(
  client: QueryableClient,
): Promise<{ cleared: number }> {
  const rows = (
    await client.query(
      `SELECT id,kind,system_prompt FROM ${t("assistant_agents")} WHERE kind IN ('regular','analysis') AND system_prompt IS NOT NULL`,
    )
  ).rows as StoredAgent[];
  const ids = rows
    .filter((row) => isHistoricalDefaultPrompt(row.kind, row.system_prompt))
    .map((row) => row.id);
  if (ids.length)
    await client.query(
      `UPDATE ${t("assistant_agents")} SET system_prompt=NULL WHERE id=ANY($1::uuid[])`,
      [ids],
    );
  return { cleared: ids.length };
}
