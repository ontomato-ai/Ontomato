import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { cp, mkdir, readdir, writeFile, rename } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { workspaceExportSchema } from "@ontomato/contracts/workspaces";
import { RuntimeClient } from "../../infrastructure/agent-runtime/client";
import { getPostgresPool as db, qualifiedTable as t } from "../../infrastructure/postgres";
import { transaction } from "../../infrastructure/postgres-transaction";
import { runtimeDataDir, runtimeRoot } from "../../content/layout";
import { backendPut } from "../../utils/backend-client";
import { buildUrl, getApiConfig } from "../../config/data-query-api";
import type { AssistantOwner } from "../assistant/store";
import type { AssistantCredentials } from "../../platform/agent-runtime/runtime";
import { HttpError } from "../../utils/errors";

/**
 * Installs the apps SDK versions this image carries (dist/apps-sdk/<version>) into the data volume that /apps-sdk
 * serves. An installed version is never replaced or removed, so an app keeps the exact version it names across platform
 * upgrades. A version appears only complete: it is copied beside its place and renamed into it.
 */
export async function installAppSdk() {
  const shipped = path.join(runtimeRoot(), "dist", "apps-sdk");
  for (const version of await readdir(shipped)) {
    const target = runtimeDataDir("apps-sdk", version);
    if (existsSync(target)) continue;
    await cp(path.join(shipped, version), `${target}.tmp`, { recursive: true });
    await rename(`${target}.tmp`, target);
  }
}
export async function writeHostedPublication(appId: string, releaseId: string, declaration: Record<string, unknown>, credentials: AssistantCredentials) {
  const response = await backendPut("hosted-publication", buildUrl(getApiConfig(), `/platform/applications/${appId}/hosted-publication`),
    { declaration, releaseId }, { ...credentials, retries: 1 });
  const result = z.object({ success: z.boolean(), message: z.string().nullish() }).passthrough().parse(JSON.parse(response.text));
  if (!result.success) throw new HttpError(502, result.message ?? "Publication rejected");
  return result;
}
export async function publishWorkspace(owner: AssistantOwner, workspaceId: string, commit: string, declaration: Record<string, unknown>, credentials: AssistantCredentials) {
  const client = new RuntimeClient(owner.domainId, undefined, owner.userId);
  await client.request(`/v1/workspaces/${workspaceId}`);
  const release = await transaction(async c => {
    await c.query(`INSERT INTO ${t("hosted_apps")} (app_id,domain_id,owner_id,workspace_id) VALUES($1,$2,$3,$4) ON CONFLICT(domain_id,workspace_id) DO NOTHING`, [`app-${randomUUID()}`, owner.domainId, owner.userId, workspaceId]);
    const app = (await c.query(`SELECT app_id FROM ${t("hosted_apps")} WHERE domain_id=$1 AND owner_id=$2 AND workspace_id=$3`, [owner.domainId, owner.userId, workspaceId])).rows[0];
    const existing = (await c.query(`SELECT id FROM ${t("hosted_app_releases")} WHERE app_id=$1 AND commit_id=$2`, [app.app_id, commit])).rows[0];
    if (existing) return { appId: app.app_id as string, releaseId: existing.id as string, commit };
    const exported = workspaceExportSchema.parse(await client.request(`/v1/workspaces/${workspaceId}/export`, "POST", { commit }));
    const releaseId = randomUUID();
    const destination = runtimeDataDir("hosted-apps", app.app_id, releaseId);
    const temporary = destination + ".tmp";
    await mkdir(temporary, { recursive: true });
    for (const file of exported.files) {
      const target = path.join(temporary, file.path);
      await mkdir(path.dirname(target), { recursive: true });
      await writeFile(target, Buffer.from(file.content, file.encoding));
    }
    await rename(temporary, destination);
    await c.query(`INSERT INTO ${t("hosted_app_releases")} (id,app_id,commit_id) VALUES($1,$2,$3)`, [releaseId, app.app_id, commit]);
    return { appId: app.app_id as string, releaseId, commit };
  });
  await writeHostedPublication(release.appId, release.releaseId, declaration, credentials);
  return release;
}
export async function workspaceReleases(owner: AssistantOwner, workspaceId: string) {
  return (await db().query(`SELECT r.id AS "releaseId",a.app_id AS "appId",r.commit_id AS commit,r.created_at AS "createdAt" FROM ${t("hosted_apps")} a JOIN ${t("hosted_app_releases")} r ON r.app_id=a.app_id WHERE a.domain_id=$1 AND a.owner_id=$2 AND a.workspace_id=$3 ORDER BY r.created_at DESC`, [owner.domainId, owner.userId, workspaceId])).rows;
}
export async function rollbackWorkspace(owner: AssistantOwner, workspaceId: string, releaseId: string, declaration: Record<string, unknown>, credentials: AssistantCredentials) {
  const release = (await workspaceReleases(owner, workspaceId)).find(r => r.releaseId === releaseId);
  if (!release) throw new HttpError(404, "Release not found", "NOT_FOUND");
  await writeHostedPublication(release.appId, releaseId, declaration, credentials);
  return release;
}
