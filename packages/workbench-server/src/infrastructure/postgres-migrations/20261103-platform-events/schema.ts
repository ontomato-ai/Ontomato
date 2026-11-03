import { qualifiedTable } from "../../postgres";
import type { QueryableClient } from "../helpers";

export async function ensurePlatformEventCursorSchema(client: QueryableClient): Promise<void> {
  await client.query(`CREATE TABLE IF NOT EXISTS ${qualifiedTable("platform_event_cursor")} (
    consumer_key text PRIMARY KEY, last_sequence bigint NOT NULL, updated_at timestamptz NOT NULL
  )`);
}
