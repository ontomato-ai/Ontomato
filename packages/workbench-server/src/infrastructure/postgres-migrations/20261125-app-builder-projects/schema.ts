import { qualifiedTable as t } from "../../postgres";
import type { QueryableClient } from "../helpers";

/**
 * Schema for application-scoped builder projects ("one project is one application").
 * - `app_builder_projects`: binds each domain application (or creator-private unpublished draft)
 *   to its single shared git workspace and tracks the last synchronized live fingerprint/commit.
 * - `app_builder_owned_resources`: enforces single-application ownership per domain panel/projection
 *   so shared resources live in only one application's source and are never overwritten by other consumers.
 * - `app_builder_releases`: records each publish/rollback commit for an application.
 */
export async function ensureAppBuilderProjectsSchema(client: QueryableClient) {
  await client.query(`
    CREATE TABLE IF NOT EXISTS ${t("app_builder_projects")} (
      domain_id text NOT NULL,
      app_id text NOT NULL,
      workspace_id uuid NOT NULL UNIQUE,
      created_by text NOT NULL,
      draft_meta jsonb NULL,
      last_synced_fingerprint jsonb NULL,
      last_synced_commit text NULL,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY (domain_id, app_id)
    );
    CREATE INDEX IF NOT EXISTS app_builder_projects_creator_draft_idx
      ON ${t("app_builder_projects")} (domain_id, created_by)
      WHERE draft_meta IS NOT NULL;
    CREATE TABLE IF NOT EXISTS ${t("app_builder_owned_resources")} (
      domain_id text NOT NULL,
      kind text NOT NULL CHECK (kind IN ('panel', 'projection')),
      resource_id text NOT NULL,
      app_id text NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY (domain_id, kind, resource_id)
    );
    CREATE INDEX IF NOT EXISTS app_builder_owned_resources_app_idx
      ON ${t("app_builder_owned_resources")} (domain_id, app_id);
    CREATE TABLE IF NOT EXISTS ${t("app_builder_releases")} (
      id uuid PRIMARY KEY,
      domain_id text NOT NULL,
      app_id text NOT NULL,
      commit_id text NOT NULL,
      hosted_release_id uuid NULL,
      published_by text NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS app_builder_releases_app_idx
      ON ${t("app_builder_releases")} (domain_id, app_id, created_at DESC);
  `);
}
