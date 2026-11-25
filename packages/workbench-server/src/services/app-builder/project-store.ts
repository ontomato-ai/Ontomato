import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import { z } from "zod";
import { applicationMetadataSchema } from "@ontomato/contracts/application-metadata";
import { getPostgresPool as db, qualifiedTable as t } from "../../infrastructure/postgres";
import { transaction } from "../../infrastructure/postgres-transaction";
import { applicationLiveFingerprintSchema, type ApplicationLiveFingerprint } from "./source-codec";

export const draftApplicationMetaSchema = applicationMetadataSchema.pick({
  names: true,
  descriptions: true,
  icon: true,
});
export type DraftApplicationMeta = z.infer<typeof draftApplicationMetaSchema>;

export interface AppBuilderProjectRow {
  domainId: string;
  appId: string;
  workspaceId: string;
  createdBy: string;
  draftMeta: DraftApplicationMeta | null;
  lastSyncedFingerprint: ApplicationLiveFingerprint | null;
  lastSyncedCommit: string | null;
  createdAt: string;
  updatedAt: string;
}

export type OwnedResourceKind = "panel" | "projection";

export interface OwnedResourceRef {
  kind: OwnedResourceKind;
  resourceId: string;
}

export interface AppBuilderReleaseRow {
  id: string;
  domainId: string;
  appId: string;
  commitId: string;
  hostedReleaseId: string | null;
  publishedBy: string;
  createdAt: string;
}

/** Shared agent-runtime workspace owner slot for an application's single source repository. */
export function appWorkspaceSlot(appId: string): string {
  return `app:${appId}`;
}

interface RawProjectRow {
  domain_id: string;
  app_id: string;
  workspace_id: string;
  created_by: string;
  draft_meta: unknown;
  last_synced_fingerprint: unknown;
  last_synced_commit: string | null;
  created_at: Date | string;
  updated_at: Date | string;
}

function mapProjectRow(row: RawProjectRow): AppBuilderProjectRow {
  return {
    domainId: row.domain_id,
    appId: row.app_id,
    workspaceId: row.workspace_id,
    createdBy: row.created_by,
    draftMeta: row.draft_meta == null ? null : draftApplicationMetaSchema.parse(row.draft_meta),
    lastSyncedFingerprint:
      row.last_synced_fingerprint == null
        ? null
        : applicationLiveFingerprintSchema.parse(row.last_synced_fingerprint),
    lastSyncedCommit: row.last_synced_commit,
    createdAt: new Date(row.created_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString(),
  };
}

const queryable = (client?: PoolClient) => client ?? db();

export const appBuilderProjectStore = {
  async withMaterializationLock<T>(domainId: string, appId: string, materialize: (client: PoolClient) => Promise<T>) {
    return transaction(async client => {
      await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [JSON.stringify(["app-builder", domainId, appId])]);
      return materialize(client);
    });
  },

  async findByAppId(domainId: string, appId: string, client?: PoolClient): Promise<AppBuilderProjectRow | null> {
    const { rows } = await queryable(client).query<RawProjectRow>(
      `SELECT domain_id, app_id, workspace_id, created_by, draft_meta, last_synced_fingerprint, last_synced_commit, created_at, updated_at
       FROM ${t("app_builder_projects")}
       WHERE domain_id = $1 AND app_id = $2`,
      [domainId, appId],
    );
    return rows[0] ? mapProjectRow(rows[0]) : null;
  },

  async findByWorkspaceId(domainId: string, workspaceId: string, client?: PoolClient): Promise<AppBuilderProjectRow | null> {
    const { rows } = await queryable(client).query<RawProjectRow>(
      `SELECT domain_id, app_id, workspace_id, created_by, draft_meta, last_synced_fingerprint, last_synced_commit, created_at, updated_at
       FROM ${t("app_builder_projects")}
       WHERE domain_id = $1 AND workspace_id = $2`,
      [domainId, workspaceId],
    );
    return rows[0] ? mapProjectRow(rows[0]) : null;
  },

  async listByAppIds(domainId: string, appIds: readonly string[], client?: PoolClient): Promise<Map<string, AppBuilderProjectRow>> {
    const result = new Map<string, AppBuilderProjectRow>();
    if (!appIds.length) return result;
    const { rows } = await queryable(client).query<RawProjectRow>(
      `SELECT domain_id, app_id, workspace_id, created_by, draft_meta, last_synced_fingerprint, last_synced_commit, created_at, updated_at
       FROM ${t("app_builder_projects")}
       WHERE domain_id = $1 AND app_id = ANY($2::text[])`,
      [domainId, appIds],
    );
    for (const row of rows) result.set(row.app_id, mapProjectRow(row));
    return result;
  },

  /** Lists creator-private unpublished drafts only. Never exposed to other users or platform catalogues. */
  async listDraftsByCreator(domainId: string, userId: string, client?: PoolClient): Promise<AppBuilderProjectRow[]> {
    const { rows } = await queryable(client).query<RawProjectRow>(
      `SELECT domain_id, app_id, workspace_id, created_by, draft_meta, last_synced_fingerprint, last_synced_commit, created_at, updated_at
       FROM ${t("app_builder_projects")}
       WHERE domain_id = $1 AND created_by = $2 AND draft_meta IS NOT NULL
       ORDER BY updated_at DESC`,
      [domainId, userId],
    );
    return rows.map(mapProjectRow);
  },

  async insertProject(
    params: {
      domainId: string;
      appId: string;
      workspaceId: string;
      createdBy: string;
      draftMeta: DraftApplicationMeta | null;
      lastSyncedFingerprint?: ApplicationLiveFingerprint | null;
      lastSyncedCommit?: string | null;
    },
    client?: PoolClient,
  ): Promise<AppBuilderProjectRow> {
    const { rows } = await queryable(client).query<RawProjectRow>(
      `INSERT INTO ${t("app_builder_projects")} (
         domain_id, app_id, workspace_id, created_by, draft_meta, last_synced_fingerprint, last_synced_commit
       ) VALUES ($1, $2, $3, $4, $5::jsonb, $6::jsonb, $7)
       ON CONFLICT (domain_id, app_id) DO NOTHING
       RETURNING domain_id, app_id, workspace_id, created_by, draft_meta, last_synced_fingerprint, last_synced_commit, created_at, updated_at`,
      [
        params.domainId,
        params.appId,
        params.workspaceId,
        params.createdBy,
        params.draftMeta ? JSON.stringify(draftApplicationMetaSchema.parse(params.draftMeta)) : null,
        params.lastSyncedFingerprint ? JSON.stringify(applicationLiveFingerprintSchema.parse(params.lastSyncedFingerprint)) : null,
        params.lastSyncedCommit ?? null,
      ],
    );
    if (!rows[0]) {
      const existing = await this.findByAppId(params.domainId, params.appId, client);
      if (existing) return existing;
      throw new Error(`Failed to insert app builder project '${params.appId}'`);
    }
    return mapProjectRow(rows[0]);
  },

  async updateDraftMeta(domainId: string, appId: string, draftMeta: DraftApplicationMeta, client?: PoolClient): Promise<AppBuilderProjectRow | null> {
    const { rows } = await queryable(client).query<RawProjectRow>(
      `UPDATE ${t("app_builder_projects")}
       SET draft_meta = $3::jsonb, updated_at = now()
       WHERE domain_id = $1 AND app_id = $2 AND draft_meta IS NOT NULL
       RETURNING domain_id, app_id, workspace_id, created_by, draft_meta, last_synced_fingerprint, last_synced_commit, created_at, updated_at`,
      [domainId, appId, JSON.stringify(draftApplicationMetaSchema.parse(draftMeta))],
    );
    return rows[0] ? mapProjectRow(rows[0]) : null;
  },

  async markSynced(
    domainId: string,
    appId: string,
    fingerprint: ApplicationLiveFingerprint,
    commit: string,
    clearDraftMeta: boolean,
    client?: PoolClient,
  ): Promise<AppBuilderProjectRow | null> {
    const { rows } = await queryable(client).query<RawProjectRow>(
      `UPDATE ${t("app_builder_projects")}
       SET last_synced_fingerprint = $3::jsonb,
           last_synced_commit = $4,
           draft_meta = CASE WHEN $5::boolean THEN NULL ELSE draft_meta END,
           updated_at = now()
       WHERE domain_id = $1 AND app_id = $2
       RETURNING domain_id, app_id, workspace_id, created_by, draft_meta, last_synced_fingerprint, last_synced_commit, created_at, updated_at`,
      [domainId, appId, JSON.stringify(applicationLiveFingerprintSchema.parse(fingerprint)), commit, clearDraftMeta],
    );
    return rows[0] ? mapProjectRow(rows[0]) : null;
  },

  async deleteProject(domainId: string, appId: string, client?: PoolClient): Promise<void> {
    await queryable(client).query(
      `DELETE FROM ${t("app_builder_releases")} WHERE domain_id = $1 AND app_id = $2`,
      [domainId, appId],
    );
    await queryable(client).query(
      `DELETE FROM ${t("app_builder_owned_resources")} WHERE domain_id = $1 AND app_id = $2`,
      [domainId, appId],
    );
    await queryable(client).query(
      `DELETE FROM ${t("app_builder_projects")} WHERE domain_id = $1 AND app_id = $2`,
      [domainId, appId],
    );
  },

  /** Looks up current single-application owners for the given resource IDs. */
  async findResourceOwners(
    domainId: string,
    kind: OwnedResourceKind,
    resourceIds: readonly string[],
    client?: PoolClient,
  ): Promise<Map<string, string>> {
    const owners = new Map<string, string>();
    if (!resourceIds.length) return owners;
    const { rows } = await queryable(client).query<{ resource_id: string; app_id: string }>(
      `SELECT resource_id, app_id
       FROM ${t("app_builder_owned_resources")}
       WHERE domain_id = $1 AND kind = $2 AND resource_id = ANY($3::text[])`,
      [domainId, kind, resourceIds],
    );
    for (const row of rows) owners.set(row.resource_id, row.app_id);
    return owners;
  },

  /**
   * Atomically claims unclaimed resources for `appId`. Existing ownership by another application
   * is preserved (ON CONFLICT DO NOTHING) and never overwritten. Returns the effective owners map.
   */
  async claimUnclaimedResources(
    domainId: string,
    appId: string,
    resources: readonly OwnedResourceRef[],
    client?: PoolClient,
  ): Promise<{ panels: Map<string, string>; projections: Map<string, string> }> {
    const q = queryable(client);
    const panelIds: string[] = [];
    const projectionIds: string[] = [];
    const ordered = [...resources].sort((a, b) => a.kind.localeCompare(b.kind) || a.resourceId.localeCompare(b.resourceId));
    for (const item of ordered) {
      if (item.kind === "panel") panelIds.push(item.resourceId);
      else projectionIds.push(item.resourceId);
      await q.query(
        `INSERT INTO ${t("app_builder_owned_resources")} (domain_id, kind, resource_id, app_id)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (domain_id, kind, resource_id) DO NOTHING`,
        [domainId, item.kind, item.resourceId, appId],
      );
    }
    const [panels, projections] = await Promise.all([
      this.findResourceOwners(domainId, "panel", panelIds, client),
      this.findResourceOwners(domainId, "projection", projectionIds, client),
    ]);
    return { panels, projections };
  },

  async recordRelease(
    params: {
      domainId: string;
      appId: string;
      commitId: string;
      hostedReleaseId?: string | null;
      publishedBy: string;
    },
    client?: PoolClient,
  ): Promise<AppBuilderReleaseRow> {
    const id = randomUUID();
    const { rows } = await queryable(client).query<{
      id: string;
      domain_id: string;
      app_id: string;
      commit_id: string;
      hosted_release_id: string | null;
      published_by: string;
      created_at: Date | string;
    }>(
      `INSERT INTO ${t("app_builder_releases")} (id, domain_id, app_id, commit_id, hosted_release_id, published_by)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id, domain_id, app_id, commit_id, hosted_release_id, published_by, created_at`,
      [id, params.domainId, params.appId, params.commitId, params.hostedReleaseId ?? null, params.publishedBy],
    );
    const row = rows[0]!;
    return {
      id: row.id,
      domainId: row.domain_id,
      appId: row.app_id,
      commitId: row.commit_id,
      hostedReleaseId: row.hosted_release_id,
      publishedBy: row.published_by,
      createdAt: new Date(row.created_at).toISOString(),
    };
  },

  async listReleases(domainId: string, appId: string, client?: PoolClient): Promise<AppBuilderReleaseRow[]> {
    const { rows } = await queryable(client).query<{
      id: string;
      domain_id: string;
      app_id: string;
      commit_id: string;
      hosted_release_id: string | null;
      published_by: string;
      created_at: Date | string;
    }>(
      `SELECT id, domain_id, app_id, commit_id, hosted_release_id, published_by, created_at
       FROM ${t("app_builder_releases")}
       WHERE domain_id = $1 AND app_id = $2
       ORDER BY created_at DESC`,
      [domainId, appId],
    );
    return rows.map(row => ({
      id: row.id,
      domainId: row.domain_id,
      appId: row.app_id,
      commitId: row.commit_id,
      hostedReleaseId: row.hosted_release_id,
      publishedBy: row.published_by,
      createdAt: new Date(row.created_at).toISOString(),
    }));
  },
};
