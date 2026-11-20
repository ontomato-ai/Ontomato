import { readCurrentAppSdkRelease } from "../app-builder/sdk";
import { sourceProductManifest,deriveSourceProductReview } from './product-admission';
import {captureProductRelease,saveProductRelease,readProductRelease,validateReleaseContracts,productReleaseIssues} from '../product-assets/releases';
import { getProduct, saveProduct, validateChildren } from "../product-assets/store";
import {validateProduct} from '../product-assets/validation';
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, writeFile, rename, readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { workspaceExportSchema, type WorkspaceExport } from "@ontomato/contracts/workspaces";
import { RuntimeClient } from "../../infrastructure/agent-runtime/client";
import { getPostgresPool as db, qualifiedTable as t } from "../../infrastructure/postgres";
import { transaction } from "../../infrastructure/postgres-transaction";
import { runtimeDataDir } from "../../content/layout";
import { backendPut } from "../../utils/backend-client";
import { buildUrl, getApiConfig } from "../../config/data-query-api";
import type { AssistantOwner } from "../assistant/store";
import type { AssistantCredentials } from "../../platform/agent-runtime/runtime";
import { HttpError } from "../../utils/errors";
import {registerSourceFunction} from './source-function';
import {recommendApplicationIcon} from '@ontomato/contracts/application-icons';
import {assertLegacyApplicationWrite} from '../product-assets/panel-boundary';
import { hostedReleaseFiles, injectHostedSdkHtml, requireHostedSdkTransport } from './hosted-sdk';

async function releaseFiles(root: string, prefix = ""): Promise<WorkspaceExport["files"]> {
  const files: WorkspaceExport["files"] = [];
  for (const entry of await readdir(path.join(root, prefix), { withFileTypes: true })) {
    const filename = path.join(prefix, entry.name);
    if (entry.isDirectory()) {
      files.push(...await releaseFiles(root, filename));
    } else {
      files.push({ path: filename, encoding: "base64", content: (await readFile(path.join(root, filename))).toString("base64") });
    }
  }
  return files;
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
  const delivered = hostedReleaseFiles(files);
  for (const file of delivered) {
    const target = path.join(temporary, file.path);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, Buffer.from(file.content, file.encoding));
  }
  await writeFile(path.join(temporary, "ontomato.product-review.json"), JSON.stringify(deriveSourceProductReview(delivered), null, 2));
}

const hostedReleasePolicy = z.object({
  hostTransport: z.literal(1),
  messageBridge: z.literal(2),
  sdkVersion: z.string().min(1),
});

/** Retry and rollback both admit the saved, already-reviewed HTML against the current SDK. */
async function requireHostedReleasePolicy(appId: string, releaseId: string) {
  const root = runtimeDataDir("hosted-apps", appId, releaseId);
  const policyPath = path.join(root, ".ontomato-network-policy.json");
  if (!existsSync(policyPath)) {
    throw new HttpError(409, "Publish a new commit using the current SDK", "PRODUCT_SDK_UPGRADE_REQUIRED");
  }
  const policy = hostedReleasePolicy.safeParse(JSON.parse(await readFile(policyPath, "utf8")));
  if (!policy.success) {
    throw new HttpError(409, "Publish a new commit using the current SDK", "PRODUCT_SDK_UPGRADE_REQUIRED");
  }
  const files = hostedReleaseFiles(await releaseFiles(root));
  const sdk = await readCurrentAppSdkRelease();
  requireHostedSdkTransport(files, sdk);
  return { files, sdkVersion: policy.data.sdkVersion };
}

async function registerHostedSourceFunction(
  owner: AssistantOwner,
  release: { appId: string; releaseId: string },
  files: WorkspaceExport["files"],
  contracts: { kind: string; id: string; hash: string }[],
  sdkVersion: string,
) {
  const reference = runtimeDataDir("hosted-apps", release.appId, release.releaseId, ".ontomato-source-function.json");
  if (existsSync(reference)) return;
  const functionId = await registerSourceFunction(owner.domainId, release.appId, release.releaseId, files, contracts, sdkVersion);
  await writeFile(reference, JSON.stringify({ functionId }));
}

export async function publishWorkspace(owner: AssistantOwner, workspaceId: string, commit: string, declaration: Record<string, unknown>, credentials: AssistantCredentials) {
  const registered=await db().query(`SELECT app_id FROM ${t('hosted_apps')} WHERE domain_id=$1 AND owner_id=$2 AND workspace_id=$3`,[owner.domainId,owner.userId,workspaceId]);
  if(registered.rows.length)await assertLegacyApplicationWrite(credentials,registered.rows[0].app_id);
  if(!declaration.icon){const names=declaration.names as Record<string,string>|undefined;const descriptions=declaration.descriptions as Record<string,string>|undefined;declaration={...declaration,icon:recommendApplicationIcon([...Object.values(names??{}),...Object.values(descriptions??{})].join(' '))};}
  const client = new RuntimeClient(owner.domainId, undefined, owner.userId);
  await client.request(`/v1/workspaces/${workspaceId}`);
  const previousRelease=(await db().query(`SELECT release.id,app.app_id FROM ${t('hosted_apps')} app JOIN ${t('hosted_app_releases')} release ON release.app_id=app.app_id WHERE app.domain_id=$1 AND app.owner_id=$2 AND app.workspace_id=$3 AND release.commit_id=$4`,[owner.domainId,owner.userId,workspaceId,commit])).rows[0];
  if(previousRelease){
    const { files, sdkVersion } = await requireHostedReleasePolicy(previousRelease.app_id, previousRelease.id);
    const snapshot=await readProductRelease(owner,previousRelease.id);
    await validateReleaseContracts(owner,snapshot,credentials);
    await registerHostedSourceFunction(owner, { appId: previousRelease.app_id, releaseId: previousRelease.id }, files, snapshot.contracts, sdkVersion);
    await writeHostedPublication(previousRelease.app_id,previousRelease.id,declaration,credentials);
    await registerApplicationProduct(owner,previousRelease.app_id,workspaceId,declaration,snapshot.roots,credentials);
    return {appId:previousRelease.app_id as string,releaseId:previousRelease.id as string,commit};
  }
  const exported = workspaceExportSchema.parse(await client.request(`/v1/workspaces/${workspaceId}/export`, "POST", { commit }));
  const sdk = await readCurrentAppSdkRelease();
  const files = hostedReleaseFiles(exported.files).map(file => /\.html$/i.test(file.path)
    ? { ...file, encoding: "utf8" as const, content: injectHostedSdkHtml(Buffer.from(file.content, file.encoding).toString("utf8"), sdk, file.path) }
    : file);
  requireHostedSdkTransport(files, sdk);
  const { assetIds: productIds } = sourceProductManifest(files);
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
    await writeHostedFiles(files, temporary);
    await writeFile(path.join(temporary,'.ontomato-network-policy.json'),JSON.stringify({hostTransport:1,messageBridge:2,sdkVersion:sdk.build.version}));
    await rename(temporary, destination);
    await c.query(`INSERT INTO ${t("hosted_app_releases")} (id,app_id,commit_id) VALUES($1,$2,$3)`, [releaseId, app.app_id, commit]);
    await saveProductRelease(owner,releaseId,app.app_id,productSnapshot,c);
    return { appId: app.app_id as string, releaseId, commit };
  });
  const frozen=await readProductRelease(owner,release.releaseId);
  await validateReleaseContracts(owner,frozen,credentials);
  await registerHostedSourceFunction(owner, release, files, frozen.contracts, sdk.build.version);
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
  await assertLegacyApplicationWrite(credentials,release.appId);
  await requireHostedReleasePolicy(release.appId,releaseId);
  const snapshot=await readProductRelease(owner,releaseId);
  await productReleaseIssues(owner,snapshot,credentials);
  await writeHostedPublication(release.appId, releaseId, declaration, credentials);
  // Published product roots come from the release snapshot; editing roots stay independent.
  return release;
}
