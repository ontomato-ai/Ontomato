import { qualifiedTable } from "../../postgres.js";
import type { QueryableClient } from "../helpers.js";

/**
 * Position of the built-in Q&A agent in a domain's agent lineup, in the same sort space as
 * `analysis_agents.sort_order`. Existing domains get no row and keep showing Q&A first until
 * their lineup is first saved.
 */
export async function ensureQaAgentSortOrderSchema(client: QueryableClient): Promise<void> {
  await client.query(`
    CREATE TABLE IF NOT EXISTS ${qualifiedTable("qa_agent_sort_orders")} (
      domain_id TEXT PRIMARY KEY,
      sort_order INTEGER NOT NULL,
      updated_at BIGINT NOT NULL
    )
  `);
}
