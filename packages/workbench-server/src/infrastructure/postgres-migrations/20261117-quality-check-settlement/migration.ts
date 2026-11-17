import { qualifiedTable } from "../../postgres.js";
import type { QueryableClient } from "../helpers.js";

/** The legacy writer saved running only after a read had already ended without a final result. */
export async function settleLegacyQualityCheckReads(client: QueryableClient): Promise<void> {
  await client.query(`
    UPDATE ${qualifiedTable("query_runs")}
       SET qc_state = jsonb_set(qc_state, '{status}', '"unsettled"'::jsonb),
           updated_at = NOW()
     WHERE qc_state->>'status' = 'running'
  `);
}
