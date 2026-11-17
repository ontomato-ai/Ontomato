import type {
  DashboardDetail,
  DashboardGroup,
  DashboardListItem,
} from "@ontomato/contracts/dashboard";
import { dashboardGroupsSchema } from "@ontomato/contracts/dashboard";
import { HttpError } from "../../utils/errors";
import { randomUUID } from "node:crypto";
import { t, tApp } from "../../i18n";
import pg from "pg";

import { createLogger } from "../../logging/logger";

import { getPostgresPool, qualifiedTable } from "../../infrastructure/postgres";

const logger = createLogger("dashboard-store");

function getPool(): pg.Pool {
  return getPostgresPool();
}

function readGroups(groups: unknown): DashboardGroup[] {
  const result = dashboardGroupsSchema.safeParse(groups);
  if (!result.success) throw new HttpError(500, "Invalid saved dashboard cards", "INVALID_CARD_DATA", {
    issues: result.error.issues.map(issue => ({ ...issue, path: ["groups", ...issue.path] })),
  });
  return result.data;
}

export async function listDashboards(
  ownerId: string,
  domainId: string
): Promise<DashboardListItem[]> {
  const pool = getPool();
  const result = await pool.query(
    `SELECT id, name, created_at, updated_at
     FROM ${qualifiedTable("dashboards")}
     WHERE owner_id = $1 AND domain_id = $2
     ORDER BY updated_at DESC`,
    [ownerId, domainId]
  );
  return result.rows.map((row) => ({
    id: row.id,
    name: row.name,
    createdAt: parseInt(row.created_at, 10),
    updatedAt: parseInt(row.updated_at, 10),
  }));
}

export async function getDashboard(
  ownerId: string,
  domainId: string,
  id: string
): Promise<DashboardDetail | null> {
  const pool = getPool();
  const result = await pool.query(
    `SELECT * FROM ${qualifiedTable("dashboards")} WHERE owner_id = $1 AND id = $2 AND domain_id = $3`,
    [ownerId, id, domainId]
  );
  if (result.rows.length === 0) return null;

  const row = result.rows[0];
  const detail: DashboardDetail = {
    id: row.id,
    ownerId: row.owner_id,
    name: row.name,
    source: row.source,
    groups: readGroups(row.groups),
    createdAt: parseInt(row.created_at, 10),
    updatedAt: parseInt(row.updated_at, 10),
  };

  return detail;
}

export async function createDashboard(params: {
  ownerId: string;
  domainId: string;
  name: string;
  source?: DashboardDetail["source"];
  groups?: DashboardGroup[];
  id?: string;
}) {
  const pool = getPool();
  const now = Date.now();
  const detail: DashboardDetail = {
    id: String(params.id || randomUUID()),
    ownerId: params.ownerId,
    name: String(params.name || "").trim() || tApp("queryFixed.175"),
    createdAt: now,
    updatedAt: now,
    groups: params.groups ?? [],
  };
  if (params.source) {
    detail.source = params.source;
  }
  await pool.query(
    `INSERT INTO ${qualifiedTable("dashboards")}
     (id, owner_id, name, source, groups, created_at, updated_at, domain_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [
      detail.id,
      params.ownerId,
      detail.name,
      params.source ? JSON.stringify(params.source) : null,
      JSON.stringify(detail.groups),
      now,
      now,
      params.domainId,
    ]
  );
  logger.info(tApp("queryFixed.176"), { ownerId: params.ownerId, dashboardId: detail.id });
  return detail;
}

export async function saveDashboard(ownerId: string, domainId: string, detail: DashboardDetail) {
  const pool = getPool();
  detail.updatedAt = Date.now();
  const result = await pool.query(
    `UPDATE ${qualifiedTable("dashboards")}
     SET name = $1, groups = $2, source = $3, updated_at = $4
     WHERE owner_id = $5 AND id = $6 AND domain_id = $7`,
    [
      detail.name,
      JSON.stringify(detail.groups),
      detail.source ? JSON.stringify(detail.source) : null,
      detail.updatedAt,
      ownerId,
      detail.id,
      domainId,
    ]
  );
  if ((result.rowCount ?? 0) === 0) {
    throw new Error(t("dashboard.notFoundOrNoPerm"));
  }
}

export async function deleteUserDashboards(userId: string): Promise<void> {
  await getPostgresPool().query(`DELETE FROM ${qualifiedTable("dashboards")} WHERE owner_id = $1 AND domain_id <> ''`, [userId]);
}

export async function deleteDashboard(ownerId: string, domainId: string, id: string) {
  const pool = getPool();
  await pool.query(
    `DELETE FROM ${qualifiedTable("dashboards")} WHERE owner_id = $1 AND id = $2 AND domain_id = $3`,
    [ownerId, id, domainId]
  );
}
