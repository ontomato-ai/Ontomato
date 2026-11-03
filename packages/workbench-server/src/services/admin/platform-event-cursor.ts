import { getPostgresPool, qualifiedTable } from "../../infrastructure/postgres";

const consumerKey = "account-deletion/workbench";
export const platformEventCursor = {
  async readCursor(): Promise<string> {
    const result = await getPostgresPool().query(
      `SELECT last_sequence::text AS sequence FROM ${qualifiedTable("platform_event_cursor")} WHERE consumer_key=$1`, [consumerKey],
    );
    return result.rows[0]?.sequence ?? "0";
  },
  async saveCursor(sequence: string): Promise<void> {
    await getPostgresPool().query(
      `INSERT INTO ${qualifiedTable("platform_event_cursor")} (consumer_key,last_sequence,updated_at) VALUES($1,$2,now())
       ON CONFLICT(consumer_key) DO UPDATE SET last_sequence=excluded.last_sequence,updated_at=now()`,
      [consumerKey, sequence],
    );
  },
};
