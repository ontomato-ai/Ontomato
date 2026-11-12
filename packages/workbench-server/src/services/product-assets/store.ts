import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import { productAssetSchema, productAssetInputSchema, productReferences, type ProductAsset, type ProductAssetInput } from "@ontomato/contracts/product-assets";
import { defaultPersonalWorkspace, personalWorkspaceSchema, type PersonalWorkspace } from "@ontomato/contracts/personal-workspace";
import { getPostgresPool as db, qualifiedTable as t } from "../../infrastructure/postgres";
import { transaction } from "../../infrastructure/postgres-transaction";
import { HttpError } from "../../utils/errors";
import {validateProduct} from './validation';
import type {AssistantCredentials} from '../../platform/agent-runtime/runtime';

export interface ProductOwner { domainId: string; userId: string }
const columns = `id, owner_id AS "ownerId", name, description, visibility, document, revision, created_at AS "createdAt", updated_at AS "updatedAt"`;
function asset(row: Record<string, unknown>, owner: ProductOwner): ProductAsset {
  return productAssetSchema.parse({ ...row, editable: row.ownerId === owner.userId,
    createdAt: (row.createdAt as Date).toISOString(), updatedAt: (row.updatedAt as Date).toISOString() });
}
export async function listProducts(owner: ProductOwner, client = db()) {
  const result = await client.query(`SELECT ${columns} FROM ${t("product_assets")} WHERE domain_id=$1 AND (owner_id=$2 OR visibility='domain') ORDER BY updated_at DESC,id`, [owner.domainId, owner.userId]);
  return result.rows.map(row => asset(row, owner));
}
export async function getProduct(owner: ProductOwner, id: string, client: Pick<PoolClient, "query"> = db()) {
  const result = await client.query(`SELECT ${columns} FROM ${t("product_assets")} WHERE domain_id=$1 AND id=$2 AND (owner_id=$3 OR visibility='domain')`, [owner.domainId, id, owner.userId]);
  if (!result.rows[0]) throw new HttpError(404, "Product asset unavailable", "PRODUCT_UNAVAILABLE");
  return asset(result.rows[0], owner);
}
export async function lockProducts(client: PoolClient, owner: ProductOwner) {
  await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [`product-assets:${owner.domainId}`]);
}
async function writeProduct(client: PoolClient, owner: ProductOwner, id: string, input: ProductAssetInput, revision: number) {
  const existing = await client.query(`SELECT owner_id,revision,document FROM ${t("product_assets")} WHERE domain_id=$1 AND id=$2`, [owner.domainId, id]);
  const row = existing.rows[0];
  if (row && row.owner_id !== owner.userId) throw new HttpError(403, "Only the owner may edit this asset", "PRODUCT_FORBIDDEN");
  if ((row?.revision ?? 0) !== revision) throw new HttpError(409, "Asset changed; reload before saving", "PRODUCT_CONFLICT");
  if (row && row.document.kind !== input.document.kind) throw new HttpError(400, "Asset type cannot change", "PRODUCT_TYPE_CHANGED");
  if(input.document.kind === "page" && input.visibility === "domain") {
    const home=await client.query(`SELECT 1 FROM ${t("product_home")} WHERE domain_id=$1 AND asset_id=$2`,[owner.domainId,id]);
    if(home.rowCount)throw new HttpError(400,"Copy a personal home into a shared template instead","PRIVATE_HOME");
  }
  for (const ref of productReferences(input.document).filter(ref => ref.kind === "asset")) {
    const target = await getProduct(owner, ref.id, client);
    if (input.visibility === "domain" && target.visibility !== "domain") throw new HttpError(400, "Shared assets can only contain shared product assets", "PRIVATE_DEPENDENCY");
    if (target.document.kind === "layout-template" || target.document.kind === "application" || (target.document.kind === "page" && input.document.kind !== "application"))
      throw new HttpError(400, "Choose a runnable product component; only applications can contain pages", "INVALID_PRODUCT_CHILD");
    if (id === ref.id) throw new HttpError(400, "Asset cannot contain itself", "PRODUCT_CYCLE");
  }
  if (input.visibility === "private" && row) {
    const parents = await client.query(`SELECT document FROM ${t("product_assets")} WHERE domain_id=$1 AND visibility='domain' AND id<>$2`, [owner.domainId, id]);
    if (parents.rows.some(parent => productReferences(parent.document).some(ref => ref.kind === "asset" && ref.id === id)))
      throw new HttpError(409, "A shared asset uses this asset", "PRODUCT_IN_USE");
  }
  await client.query(`INSERT INTO ${t("product_assets")} (domain_id,id,owner_id,name,description,visibility,document)
    VALUES($1,$2,$3,$4,$5,$6,$7::jsonb) ON CONFLICT(domain_id,id) DO UPDATE SET
    name=EXCLUDED.name,description=EXCLUDED.description,visibility=EXCLUDED.visibility,document=EXCLUDED.document,
    revision=${t("product_assets")}.revision+1,updated_at=now()`,
  [owner.domainId, id, owner.userId, input.name, input.description, input.visibility, JSON.stringify(input.document)]);
  return getProduct(owner, id, client);
}
export async function saveProduct(owner: ProductOwner, id: string, input: ProductAssetInput, revision: number, credentials:AssistantCredentials) {
  const parsed=productAssetInputSchema.parse(input);
  return transaction(async client => {
    await lockProducts(client, owner);
    const existing=await client.query(`SELECT owner_id,revision FROM ${t('product_assets')} WHERE domain_id=$1 AND id=$2`,[owner.domainId,id]);
    if(existing.rows[0]&&existing.rows[0].owner_id!==owner.userId)throw new HttpError(403,'Only the owner may edit this asset','PRODUCT_FORBIDDEN');
    if((existing.rows[0]?.revision??0)!==revision)throw new HttpError(409,'Asset changed; reload before saving','PRODUCT_CONFLICT');
    await validateProduct(owner,parsed,credentials);
    await validateChildren(owner,parsed,credentials,client);
    return writeProduct(client, owner, id, parsed, revision);
  });
}
export async function validateChildren(owner:ProductOwner,input:ProductAssetInput,credentials:AssistantCredentials,client:Pick<PoolClient,'query'>=db(),seen=new Set<string>()) {
  for(const reference of productReferences(input.document).filter(ref=>ref.kind==='asset')){
    if(seen.has(reference.id))continue;
    seen.add(reference.id);
    const child=await getProduct(owner,reference.id,client);
    await validateProduct(owner,child,credentials);
    await validateChildren(owner,child,credentials,client,seen);
  }
}
export async function deleteProduct(owner: ProductOwner, id: string, revision: number) {
  await transaction(async client => {
    await lockProducts(client, owner);
    const target = await getProduct(owner, id, client);
    if (!target.editable) throw new HttpError(403, "Only the owner may delete this asset", "PRODUCT_FORBIDDEN");
    if (target.revision !== revision) throw new HttpError(409, "Asset changed; reload before deleting", "PRODUCT_CONFLICT");
    const parents = await client.query(`SELECT document FROM ${t("product_assets")} WHERE domain_id=$1 AND id<>$2`, [owner.domainId, id]);
    const homes = await client.query(`SELECT 1 FROM ${t("product_home")} WHERE domain_id=$1 AND asset_id=$2`, [owner.domainId, id]);
    if (homes.rowCount || parents.rows.some(row => productReferences(row.document).some(ref => ref.kind === "asset" && ref.id === id)))
      throw new HttpError(409, "Asset is in use; remove its references first", "PRODUCT_IN_USE");
    await client.query(`DELETE FROM ${t("product_assets")} WHERE domain_id=$1 AND id=$2`, [owner.domainId, id]);
  });
}

/** Migrate once under the same lock used for editing; legacy rows are retained solely for rollback. */
export async function personalHome(owner: ProductOwner,credentials:AssistantCredentials={}) {
  return transaction(async client => {
    await lockProducts(client, owner);
    const home = await client.query(`SELECT asset_id FROM ${t("product_home")} WHERE domain_id=$1 AND user_id=$2`, [owner.domainId, owner.userId]);
    if (home.rows[0]) return getProduct(owner, home.rows[0].asset_id, client);
    const legacy = await client.query(`SELECT value FROM ${t("user_preferences")} WHERE user_id=$1 AND key=$2`, [owner.userId, `personal-workspace:${owner.domainId}`]);
    const previousHome = await client.query(`SELECT dashboard_ids,favorites FROM ${t("platform_home_preferences")} WHERE domain_id=$1 AND user_id=$2`, [owner.domainId, owner.userId]);
    const workspace = legacy.rows[0] ? personalWorkspaceSchema.parse(legacy.rows[0].value) : defaultPersonalWorkspace();
    const previous = previousHome.rows[0];
    workspace.dashboardIds = [...new Set([...workspace.dashboardIds, ...(previous?.dashboard_ids ?? [])])].slice(0,100);
    workspace.applicationIds = [...new Set([...workspace.applicationIds, ...(previous?.favorites ?? []).filter((ref: {kind:string}) => ref.kind === "application").map((ref: {id:string}) => ref.id)])].filter(id=>id!=="home"&&id!=="personal-workspace").slice(0,100);
    workspace.agentIds = [...new Set([...workspace.agentIds, ...(previous?.favorites ?? []).filter((ref: {kind:string}) => ref.kind === "agent").map((ref: {id:string}) => ref.id)])].slice(0,100);
    const input=productAssetInputSchema.parse({name:"我的主页", document:{kind:"page",workspace,children:[]}});
    await validateProduct(owner,input,credentials);
    const result = await writeProduct(client, owner, randomUUID(), input, 0);
    await client.query(`INSERT INTO ${t("product_home")} (domain_id,user_id,asset_id) VALUES($1,$2,$3)`, [owner.domainId, owner.userId, result.id]);
    return result;
  });
}
export async function saveHomeWorkspace(owner: ProductOwner, workspace: PersonalWorkspace, revision: number,credentials:AssistantCredentials) {
  const home = await personalHome(owner,credentials);
  if (home.document.kind !== "page") throw new Error("Home must be a page");
  return saveProduct(owner, home.id, {name:home.name,description:home.description,visibility:home.visibility,
    document:{...home.document,workspace}}, revision,credentials);
}
