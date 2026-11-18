import type { PoolClient } from "pg";

/** The existing product namespace lock also covers current panels and projections. */
export async function lockProducts(client: PoolClient, owner: { domainId: string }) {
  await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [`product-assets:${owner.domainId}`]);
}
