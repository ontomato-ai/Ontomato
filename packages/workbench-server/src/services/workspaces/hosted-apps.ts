import { BUILD_TEST_SAMPLE_DIRECTORY } from "@ontomato/contracts/build-tests";
import { appSdkBuild } from "../app-builder/sdk";
import { sourceProductManifest,deriveSourceProductReview } from './product-admission';
import {captureProductRelease,saveProductRelease,readProductRelease,validateReleaseContracts,productReleaseIssues} from '../product-assets/releases';
import { getProduct, saveProduct, validateChildren } from "../product-assets/store";
import {validateProduct} from '../product-assets/validation';
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { cp, mkdir, writeFile, rename, readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { workspaceExportSchema, type WorkspaceExport } from "@ontomato/contracts/workspaces";
import { RuntimeClient } from "../../infrastructure/agent-runtime/client";
import { getPostgresPool as db, qualifiedTable as t } from "../../infrastructure/postgres";
import { transaction } from "../../infrastructure/postgres-transaction";
import { runtimeDataDir, runtimeRoot } from "../../content/layout";
import { backendPut } from "../../utils/backend-client";
import { buildUrl, getApiConfig } from "../../config/data-query-api";
import type { AssistantOwner } from "../assistant/store";
import type { AssistantCredentials } from "../../platform/agent-runtime/runtime";
import { HttpError } from "../../utils/errors";
import {registerSourceFunction} from './source-function';
import {recommendApplicationIcon} from '@ontomato/contracts/application-icons';

/**
 * Installs the apps SDK versions this image carries (dist/apps-sdk/<version>) into the data volume that /apps-sdk
 * serves. An installed version is never replaced or removed, so an app keeps the exact version it names across platform
 * upgrades. A version appears only complete: it is copied beside its place and renamed into it.
 */
export async function installAppSdk() {
  const shipped = path.join(runtimeRoot(), "dist", "apps-sdk");
  const { version } = await appSdkBuild();
  const target = runtimeDataDir("apps-sdk", version);
  if (existsSync(target)) {
    await assertSameSdk(path.join(shipped, version), target, version);
    return;
  }
  await cp(path.join(shipped, version), `${target}.tmp`, { recursive: true });
  await rename(`${target}.tmp`, target);
}
async function sdkFiles(root: string, prefix = ""): Promise<string[]> {
  const files: string[] = [];
  for (const entry of await readdir(path.join(root, prefix), { withFileTypes: true })) {
    const name = path.join(prefix, entry.name);
    files.push(...(entry.isDirectory() ? await sdkFiles(root, name) : [name]));
  }
  return files.sort();
}

export async function assertSameSdk(shipped: string, installed: string, version: string) {
  const files = await sdkFiles(shipped);
  const existing = await sdkFiles(installed);
  const conflict = () => new Error(`Apps SDK version conflict: ${version} has different installed content; bump the SDK base version for a release`);
  if (JSON.stringify(files) !== JSON.stringify(existing)) throw conflict();
  for (const file of files) {
    const incoming = await readFile(path.join(shipped, file));
    const current = await readFile(path.join(installed, file));
    // Older persisted manifests contain provenance, which does not change the SDK contract.
    if (file === "sdk.json") {
      const normalize = (bytes: Buffer) => {
        const manifest = JSON.parse(bytes.toString("utf8"));
        delete manifest.sources;
        delete manifest.productVersion;
        return JSON.stringify(manifest);
      };
      if (normalize(incoming) !== normalize(current)) throw conflict();
    } else if (!incoming.equals(current)) throw conflict();
  }
}

export async function writeHostedPublication(appId: string, releaseId: string, declaration: Record<string, unknown>, credentials: AssistantCredentials) {
  const response = await backendPut("hosted-publication", buildUrl(getApiConfig(), `/platform/applications/${appId}/hosted-publication`),
    { declaration, releaseId }, { ...credentials, retries: 1 });
  const result = z.object({ success: z.boolean(), message: z.string().nullish() }).passthrough().parse(JSON.parse(response.text));
  if (!result.success) throw new HttpError(502, result.message ?? "Publication rejected");
  return result;
}
/** Materialize only application files; the workspace keeps its test source for rebuilding. */
export async function writeHostedFiles(files: WorkspaceExport["files"], temporary: string) {
    for (const file of files) {
      if (file.path === BUILD_TEST_SAMPLE_DIRECTORY || file.path.startsWith(BUILD_TEST_SAMPLE_DIRECTORY + "/")) continue;
      if(['ontomato.product-review.json','.ontomato-network-policy.json','.ontomato-source-function.json'].includes(file.path))continue;
      const target = path.join(temporary, file.path);
      await mkdir(path.dirname(target), { recursive: true });
      await writeFile(target, Buffer.from(file.content, file.encoding));
    }
    await writeFile(path.join(temporary,'ontomato.product-review.json'),JSON.stringify(deriveSourceProductReview(files),null,2));
}
export async function requireHostedSdkTransport(files:WorkspaceExport['files'],readManifest=(version:string)=>readFile(runtimeDataDir('apps-sdk',version,'sdk.json'),'utf8').then(JSON.parse)){
  const versions=new Set<string>();
  for(const file of files){
    if(!/\.html$/i.test(file.path))continue;
    const source=Buffer.from(file.content,file.encoding).toString('utf8');
    const pageVersions=[...source.matchAll(/\/apps-sdk\/([A-Za-z0-9._-]+)\//g)];
    if(!pageVersions.length)throw new HttpError(409,`Use a host-transport SDK in ${file.path}`,'PRODUCT_SDK_UPGRADE_REQUIRED');
    for(const match of pageVersions)versions.add(match[1]);
  }
  if(!versions.size)throw new HttpError(409,'Use a host-transport SDK before publishing this source application','PRODUCT_SDK_UPGRADE_REQUIRED');
  for(const version of versions){
    let manifest;
    try{manifest=await readManifest(version);}catch{throw new HttpError(409,'Referenced SDK is not installed','PRODUCT_SDK_UPGRADE_REQUIRED');}
    if(manifest.hostTransport!==1||manifest.messageBridge!==2)throw new HttpError(409,'Upgrade the application SDK to the sandbox message bridge before publishing','PRODUCT_SDK_UPGRADE_REQUIRED');
  }
}
/** A retry or rollback cannot reactivate a historical release outside the current transport boundary. */
export async function requireHostedReleasePolicy(appId:string,releaseId:string,readPolicy=()=>readFile(runtimeDataDir('hosted-apps',appId,releaseId,'.ontomato-network-policy.json'),'utf8').then(JSON.parse)){
  let policy;
  try{policy=await readPolicy();}catch(error){if((error as {code?:string}).code!=='ENOENT')throw error;}
  if(policy?.hostTransport!==1||policy?.messageBridge!==2)throw new HttpError(409,'Migrate this historical source release to the message-bridge SDK and publish a new commit','PRODUCT_SDK_UPGRADE_REQUIRED');
}
export async function publishWorkspace(owner: AssistantOwner, workspaceId: string, commit: string, declaration: Record<string, unknown>, credentials: AssistantCredentials) {
  if(!declaration.icon){const names=declaration.names as Record<string,string>|undefined;const descriptions=declaration.descriptions as Record<string,string>|undefined;declaration={...declaration,icon:recommendApplicationIcon([...Object.values(names??{}),...Object.values(descriptions??{})].join(' '))};}
  const client = new RuntimeClient(owner.domainId, undefined, owner.userId);
  await client.request(`/v1/workspaces/${workspaceId}`);
  const exported=workspaceExportSchema.parse(await client.request(`/v1/workspaces/${workspaceId}/export`,"POST",{commit}));
  const previousRelease=(await db().query(`SELECT release.id,app.app_id FROM ${t('hosted_apps')} app JOIN ${t('hosted_app_releases')} release ON release.app_id=app.app_id WHERE app.domain_id=$1 AND app.owner_id=$2 AND app.workspace_id=$3 AND release.commit_id=$4`,[owner.domainId,owner.userId,workspaceId,commit])).rows[0];
  if(previousRelease){
    await requireHostedReleasePolicy(previousRelease.app_id,previousRelease.id);
    const snapshot=await readProductRelease(owner,previousRelease.id);
    await validateReleaseContracts(owner,snapshot,credentials);
    const functionId=await registerSourceFunction(owner.domainId,previousRelease.app_id,previousRelease.id,exported.files,snapshot.contracts);await writeFile(runtimeDataDir('hosted-apps',previousRelease.app_id,previousRelease.id,'.ontomato-source-function.json'),JSON.stringify({functionId}));
    await writeHostedPublication(previousRelease.app_id,previousRelease.id,declaration,credentials);
    await registerApplicationProduct(owner,previousRelease.app_id,workspaceId,declaration,snapshot.roots,credentials);
    return {appId:previousRelease.app_id as string,releaseId:previousRelease.id as string,commit};
  }
  const manifest=sourceProductManifest(exported.files),productIds=manifest.assetIds;
  await requireHostedSdkTransport(exported.files);
  for(const productId of productIds) {
    const product=await getProduct(owner,productId);
    if(!["page","widget","widget-group","operation-panel","dashboard","object-view","object-projection","metric-widget","action-view","collection-view","navigation","agent-profile"].includes(product.document.kind))throw new HttpError(400,"Application manifest must reference pages or runnable components","INVALID_PRODUCT_CHILD");
    await validateProduct(owner,product,credentials);
    await validateChildren(owner,product,credentials);
  }
  const productSnapshot=await captureProductRelease(owner,productIds,credentials,manifest.triggerIds);
  const release = await transaction(async c => {
    await c.query(`INSERT INTO ${t("hosted_apps")} (app_id,domain_id,owner_id,workspace_id) VALUES($1,$2,$3,$4) ON CONFLICT(domain_id,workspace_id) DO NOTHING`, [`app-${randomUUID()}`, owner.domainId, owner.userId, workspaceId]);
    const app = (await c.query(`SELECT app_id FROM ${t("hosted_apps")} WHERE domain_id=$1 AND owner_id=$2 AND workspace_id=$3`, [owner.domainId, owner.userId, workspaceId])).rows[0];
    const existing = (await c.query(`SELECT id FROM ${t("hosted_app_releases")} WHERE app_id=$1 AND commit_id=$2`, [app.app_id, commit])).rows[0];
    if (existing) return { appId: app.app_id as string, releaseId: existing.id as string, commit };
    const releaseId = randomUUID();
    const destination = runtimeDataDir("hosted-apps", app.app_id, releaseId);
    const temporary = destination + ".tmp";
    await mkdir(temporary, { recursive: true });
    await writeHostedFiles(exported.files,temporary);
    await writeFile(path.join(temporary,'.ontomato-network-policy.json'),JSON.stringify({hostTransport:1,messageBridge:2}));
    await rename(temporary, destination);
    await c.query(`INSERT INTO ${t("hosted_app_releases")} (id,app_id,commit_id) VALUES($1,$2,$3)`, [releaseId, app.app_id, commit]);
    await saveProductRelease(owner,releaseId,app.app_id,productSnapshot,c);
    return { appId: app.app_id as string, releaseId, commit };
  });
  const frozen=await readProductRelease(owner,release.releaseId);
  await validateReleaseContracts(owner,frozen,credentials);
  const functionId=await registerSourceFunction(owner.domainId,release.appId,release.releaseId,exported.files,frozen.contracts);
  await writeFile(runtimeDataDir('hosted-apps',release.appId,release.releaseId,'.ontomato-source-function.json'),JSON.stringify({functionId}));
  await writeHostedPublication(release.appId, release.releaseId, declaration, credentials);
  await registerApplicationProduct(owner,release.appId,workspaceId,declaration,productIds,credentials);
  return release;
}
/** Keep publication identity and its explicit product composition on the same application ID. */
async function registerApplicationProduct(owner:AssistantOwner,appId:string,workspaceId:string,declaration:Record<string,unknown>,assetIds:string[],credentials:AssistantCredentials) {
  let previous;
  try{previous=await getProduct(owner,appId);}catch(error){if(!(error instanceof HttpError)||error.status!==404)throw error;}
  const names=declaration.names as Record<string,string>|undefined;
  await saveProduct(owner,appId,{name:names?.["zh-CN"]??names?.en??appId,description:previous?.description??"",visibility:previous?.visibility??"private",
    document:{kind:"application",applicationId:appId,workspaceId,...(previous?.document.kind==='application'&&previous.document.navigationId?{navigationId:previous.document.navigationId}:{}),children:assetIds.map(assetId=>({assetId,column:"main"}))}},previous?.revision??0,credentials);
}
export async function workspaceReleases(owner: AssistantOwner, workspaceId: string) {
  return (await db().query(`SELECT r.id AS "releaseId",a.app_id AS "appId",r.commit_id AS commit,r.created_at AS "createdAt" FROM ${t("hosted_apps")} a JOIN ${t("hosted_app_releases")} r ON r.app_id=a.app_id WHERE a.domain_id=$1 AND a.owner_id=$2 AND a.workspace_id=$3 ORDER BY r.created_at DESC`, [owner.domainId, owner.userId, workspaceId])).rows;
}
export async function rollbackWorkspace(owner: AssistantOwner, workspaceId: string, releaseId: string, declaration: Record<string, unknown>, credentials: AssistantCredentials) {
  const release = (await workspaceReleases(owner, workspaceId)).find(r => r.releaseId === releaseId);
  if (!release) throw new HttpError(404, "Release not found", "NOT_FOUND");
  await requireHostedReleasePolicy(release.appId,releaseId);
  const snapshot=await readProductRelease(owner,releaseId);
  await productReleaseIssues(owner,snapshot,credentials);
  await writeHostedPublication(release.appId, releaseId, declaration, credentials);
  // Published product roots come from the release snapshot; editing roots stay independent.
  return release;
}
