import pg from "pg";
import { environment } from "../config/environment";
import { createLogger } from "../logging/logger";
import { tApp } from "../i18n";
import { runPostgresBusinessMigrations } from "./postgres-migrations/index.js";

const { Pool } = pg;
const logger = createLogger("postgres");

let pool: pg.Pool | null = null;
let schemaName: string;

export function getSchemaName(): string {
  return environment.pgSchema();
}

export function getPostgresPool(): pg.Pool {
  if (!pool) {
    schemaName = getSchemaName();
    pool = new Pool({
      connectionString: environment.pgConnection(),
      max: 20,
      idleTimeoutMillis: 30000,
    });
    const onConnectionError = (err: Error) => {
      logger.error(tApp("foundation.log.pg.poolError"), err);
    };
    pool.on("error", onConnectionError);
    // pg removes its idle error listener while a client is checked out.
    pool.on("acquire", (client) => client.on("error", onConnectionError));
    pool.on("release", (_err, client) => client.removeListener("error", onConnectionError));
    logger.info(tApp("foundation.log.pg.poolCreated"));
  }
  return pool;
}

export async function initializePostgres(): Promise<void> {
  const p = getPostgresPool();
  const client = await p.connect();
  try {
    if (schemaName !== "public") {
      await client.query(`CREATE SCHEMA IF NOT EXISTS ${escapeIdentifier(schemaName)}`);
    }

    const legacy = await client.query("SELECT to_regclass($1) IS NOT NULL AS present", [qualifiedTable("scheduled_tasks")]);
    if (legacy.rows[0].present) throw new Error("Import and retire the old scheduled tasks before starting the workbench (see platform-schedules-upgrade.md)");
    await runPostgresBusinessMigrations(client);

    logger.info(tApp("foundation.log.pg.schemaReady"));
  } finally {
    client.release();
  }
}

export function qualifiedTable(table: string): string {
  const schema = schemaName || getSchemaName();
  if (schema === "public") return escapeIdentifier(table);
  return `${escapeIdentifier(schema)}.${escapeIdentifier(table)}`;
}

function escapeIdentifier(id: string): string {
  return `"${id.replace(/"/g, '""')}"`;
}

export async function closePostgres(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = null;
    logger.info(tApp("foundation.log.pg.poolClosed"));
  }
}
