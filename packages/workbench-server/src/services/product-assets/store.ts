import type { PoolClient } from "pg";
import { productAssetSchema, productAssetInputSchema, productReferences, productTypes, type ProductAsset, type ProductAssetInput, type ProductQuery } from "@ontomato/contracts/product-assets";
import { personalWorkspaceSchema, type PersonalWorkspace } from "@ontomato/contracts/personal-workspace";
import { getPostgresPool as db, qualifiedTable as t } from "../../infrastructure/postgres";
import { transaction } from "../../infrastructure/postgres-transaction";
import { HttpError } from "../../utils/errors";
import {validateProduct,validatePageBindings} from './validation';
import type {AssistantCredentials} from '../../platform/agent-runtime/runtime';
import {normalizeComposition,validateComposition,validateAffectedCompositions} from './composition';
import {backendPost,buildBackendHeaders} from '../../utils/backend-client';
import {config} from '../../config/application';
import {objectViewDocumentSchema} from '@ontomato/contracts/object-views';
import {withProductGrants,currentProductGrants,refreshProductGrants} from './grants';
import {registerProductResource,productGrantIdsForOwner,type ProductOwner} from '../product-governance/grants';
import {ontologyRegistration,synchronizeProductOntology} from './ontology';
import {lockProducts} from '../../infrastructure/product-write-lock';
import {assertLegacyProductWrite,assertLegacyProductIdentity} from './panel-boundary';
export {lockProducts} from '../../infrastructure/product-write-lock';

const columns = `id, owner_id AS "ownerId", name, description, visibility, document, revision, created_at AS "createdAt", updated_at AS "updatedAt"`;
function asset(row: Record<string, unknown>, owner: ProductOwner): ProductAsset {
  return productAssetSchema.parse({ ...row, editable: currentProductGrants(owner).edit.has(String(row.id)),
    createdAt: (row.createdAt as Date).toISOString(), updatedAt: (row.updatedAt as Date).toISOString() });
}
export async function listProducts(owner: ProductOwner, client = db()) {return withProductGrants(owner,()=>listAuthorizedProducts(owner,client));}
async function listAuthorizedProducts(owner:ProductOwner,client=db()){
  const access=currentProductGrants(owner);
  const result = await client.query(`SELECT ${columns} FROM ${t("product_assets")} WHERE domain_id=$1 AND id=ANY($2::text[]) ORDER BY updated_at DESC,id`, [owner.domainId,[...new Set([...access.use,...access.edit])]]);
  return result.rows.map(row => asset(row, owner));
}
export async function queryProducts(owner:ProductOwner,query:ProductQuery){return withProductGrants(owner,()=>queryAuthorizedProducts(owner,query));}
async function queryAuthorizedProducts(owner:ProductOwner,query:ProductQuery){
  const access=currentProductGrants(owner);
  const args:unknown[]=[owner.domainId,[...new Set([...access.use,...access.edit])]];
  const clauses=["domain_id=$1 AND id=ANY($2::text[])"];
  if(query.scope==='mine'){args.push(owner.userId);clauses.push(`owner_id=$${args.length}`);}
  if(query.scope==='shared'){args.push(owner.userId);clauses.push(`owner_id<>$${args.length}`);}
  if(query.kind){args.push(query.kind);clauses.push(`document->>'kind'=$${args.length}`);}
  if(query.pageForm&&query.pageForm!=='all'){
    clauses.push("document->>'kind'='page'");
    if(query.pageForm==='template')clauses.push("document->>'isTemplate'='true'");
    else if(query.pageForm==='embeddable')clauses.push("document->>'embeddable'='true' AND COALESCE(document->>'isTemplate','false')<>'true'");
    else clauses.push("COALESCE(document->>'isTemplate','false')<>'true' AND COALESCE(document->>'embeddable','false')<>'true'");
  }
  if(query.search){args.push(query.search);clauses.push(`strpos(lower(name),lower($${args.length}))>0`);}
  const where=clauses.join(' AND ');
  const count=await db().query(`SELECT count(*)::int AS total FROM ${t('product_assets')} WHERE ${where}`,args);
  const typeOrder=`CASE document->>'kind' ${productTypes.map((type,index)=>`WHEN '${type.kind}' THEN ${index}`).join(' ')} ELSE ${productTypes.length} END`;
  const pageOrder="CASE WHEN document->>'kind'='page' THEN CASE WHEN document->>'isTemplate'='true' THEN 2 WHEN document->>'embeddable'='true' THEN 1 ELSE 0 END ELSE 0 END";
  const order=query.sort==='updated'?'updated_at DESC,id':query.sort==='name'?'lower(name),id':`${typeOrder},${pageOrder},lower(name),id`;
  const result=await db().query(`SELECT id,owner_id AS "ownerId",name,description,visibility,revision,created_at AS "createdAt",updated_at AS "updatedAt",document->>'kind' AS kind FROM ${t('product_assets')} WHERE ${where} ORDER BY ${order} LIMIT $${args.length+1} OFFSET $${args.length+2}`,[...args,query.pageSize,(query.page-1)*query.pageSize]);
  const details=await db().query(`SELECT id,jsonb_strip_nulls(jsonb_build_object(
    'isTemplate',document->'isTemplate','embeddable',document->'embeddable','renderer',document->>'renderer',
    'widgetKind',document->'widget'->>'kind',
    'section',document->'widget'->>'source','className',COALESCE(document->>'className',CASE WHEN document->'renders'->>'kind'='ObjectType' THEN document->'renders'->>'id' END),'resourceId',COALESCE(document->'renders'->>'id',document->'widget'->>'resourceId'),
    'childCount',CASE WHEN document ? 'children' THEN jsonb_array_length(document->'children') END,
    'widgetCount',CASE WHEN document ? 'widgets' THEN jsonb_array_length(document->'widgets') END,
    'widgetKinds',CASE WHEN document ? 'widgets' THEN (SELECT jsonb_agg(DISTINCT w->>'kind') FROM jsonb_array_elements(document->'widgets') w) END)) AS details
    FROM ${t('product_assets')} WHERE domain_id=$1 AND id=ANY($2::text[])`,[owner.domainId,result.rows.map(row=>row.id)]);
  const byId=new Map(details.rows.map(row=>[row.id,row.details]));
  return {items:result.rows.map(row=>({...row,details:byId.get(row.id)??{},createdAt:row.createdAt.toISOString(),updatedAt:row.updatedAt.toISOString(),editable:access.edit.has(row.id)})),total:count.rows[0].total,page:query.page,pageSize:query.pageSize};
}
export async function countProductTypes(owner:ProductOwner){return withProductGrants(owner,()=>countAuthorizedProducts(owner));}
async function countAuthorizedProducts(owner:ProductOwner){
  const access=currentProductGrants(owner);
  const result=await db().query<{ kind: string; count: number }>(`SELECT document->>'kind' AS kind,count(*)::int AS count FROM ${t('product_assets')} WHERE domain_id=$1 AND id=ANY($2::text[]) GROUP BY document->>'kind'`,[owner.domainId,[...new Set([...access.use,...access.edit])]]);
  return Object.fromEntries(result.rows.map(row=>[row.kind,row.count]));
}
/** Walk the requested composition in SQL instead of loading every visible document. */
export async function dependencyProducts(owner:ProductOwner,id:string){return withProductGrants(owner,()=>authorizedDependencies(owner,id));}
async function authorizedDependencies(owner:ProductOwner,id:string){
  const access=currentProductGrants(owner);
  const result=await db().query(`WITH RECURSIVE visible AS (SELECT * FROM ${t('product_assets')} WHERE domain_id=$1 AND id=ANY($2::text[])),
    edges AS (SELECT p.id AS parent,child->>'assetId' AS child FROM visible p CROSS JOIN LATERAL jsonb_array_elements(COALESCE(p.document->'children','[]'::jsonb)) child
      UNION SELECT p.id,node->>'pageId' FROM visible p CROSS JOIN LATERAL jsonb_array_elements(COALESCE(p.document->'nodes','[]'::jsonb)) node
      UNION SELECT p.id,reference FROM visible p CROSS JOIN LATERAL jsonb_array_elements_text(COALESCE(p.document->'tools','[]'::jsonb)||COALESCE(p.document->'contextViews','[]'::jsonb)) reference
      UNION SELECT p.id,p.document->>'navigationId' FROM visible p WHERE p.document ? 'navigationId'),
    descendants(id) AS (SELECT id FROM visible WHERE id=$3 UNION SELECT e.child FROM edges e JOIN descendants d ON e.parent=d.id),
    ancestors(id) AS (SELECT id FROM visible WHERE id=$3 UNION SELECT e.parent FROM edges e JOIN ancestors a ON e.child=a.id)
    SELECT ${columns} FROM visible WHERE id IN (SELECT id FROM descendants UNION SELECT id FROM ancestors)`,[owner.domainId,[...new Set([...access.use,...access.edit])],id]);
  return result.rows.map(row=>asset(row,owner));
}
export async function getProduct(owner: ProductOwner, id: string, client: Pick<PoolClient, "query"> = db()) {
  return withProductGrants(owner,()=>getAuthorizedProduct(owner,id,client));
}
/** Historical catalog imports used a separate asset ID; resolve it without widening grants. */
export async function getApplicationProduct(owner:ProductOwner,applicationId:string){
  return withProductGrants(owner,async()=>{
    const access=currentProductGrants(owner);
    const result=await db().query(`SELECT id FROM ${t('product_assets')} WHERE domain_id=$1 AND document->>'kind'='application' AND document->>'applicationId'=$2 AND id=ANY($3::text[]) ORDER BY (id=$2) DESC,id LIMIT 2`,[owner.domainId,applicationId,[...access.use]]);
    if(!result.rows.length)throw new HttpError(404,'Application product unavailable','PRODUCT_UNAVAILABLE');
    if(result.rows.length>1&&result.rows[0].id!==applicationId)throw new HttpError(409,'Application product identity is ambiguous','PRODUCT_CONFLICT');
    return getProduct(owner,result.rows[0].id);
  });
}
async function getAuthorizedProduct(owner:ProductOwner,id:string,client:Pick<PoolClient,'query'>){
  const access=currentProductGrants(owner);
  if(!access.use.has(id)&&!access.edit.has(id))throw new HttpError(404,'Product asset unavailable','PRODUCT_UNAVAILABLE');
  const result = await client.query(`SELECT ${columns} FROM ${t("product_assets")} WHERE domain_id=$1 AND id=$2`, [owner.domainId, id]);
  if (!result.rows[0]) throw new HttpError(404, "Product asset unavailable", "PRODUCT_UNAVAILABLE");
  return asset(result.rows[0], owner);
}
async function writeProduct(client: PoolClient, owner: ProductOwner, id: string, input: ProductAssetInput, revision: number, migrating=false,_credentials:AssistantCredentials={}) {
  await assertLegacyProductIdentity(owner,id,client);
  const existing = await client.query(`SELECT owner_id,revision,document,visibility FROM ${t("product_assets")} WHERE domain_id=$1 AND id=$2`, [owner.domainId, id]);
  const row = existing.rows[0];
  if (row && !currentProductGrants(owner).edit.has(id)) throw new HttpError(403, "Product edit Grant required", "PRODUCT_FORBIDDEN");
  if ((row?.revision ?? 0) !== revision) throw new HttpError(409, "Asset changed; reload before saving", "PRODUCT_CONFLICT");
  if (row && row.document.kind !== input.document.kind && !migrating) throw new HttpError(400, "Asset type cannot change", "PRODUCT_TYPE_CHANGED");
  if(input.document.kind === "page" && input.visibility === "domain") {
    const home=await client.query(`SELECT 1 FROM ${t("product_home")} WHERE domain_id=$1 AND asset_id=$2`,[owner.domainId,id]);
    if(home.rowCount)throw new HttpError(400,"Copy a personal home into a shared template instead","PRIVATE_HOME");
  }
  for (const ref of productReferences(input.document).filter(ref => ref.kind === "asset")) {
    const target = await getProduct(owner, ref.id, client);
    if (target.document.kind === "layout-template" || target.document.kind === "application" || (target.document.kind==='page'&&target.document.isTemplate))
      throw new HttpError(400, "Choose a runnable product component; only applications can contain pages", "INVALID_PRODUCT_CHILD");
    if (id === ref.id) throw new HttpError(400, "Asset cannot contain itself", "PRODUCT_CYCLE");
  }
  const document={...input.document};
  if(document.kind==='page'&&document.workspace){
    const preferences=row?row.document.kind==='page'?row.document.workspace:undefined:document.workspace;
    if(preferences)await client.query(`INSERT INTO ${t('product_user_overlays')} (domain_id,principal_id,page_id,preferences) VALUES($1,$2,$3,$4::jsonb) ON CONFLICT DO NOTHING`,[owner.domainId,row?.owner_id??owner.userId,id,JSON.stringify(preferences)]);
    delete document.workspace;
  }
  await client.query(`INSERT INTO ${t("product_assets")} (domain_id,id,owner_id,name,description,visibility,document)
    VALUES($1,$2,$3,$4,$5,$6,$7::jsonb) ON CONFLICT(domain_id,id) DO UPDATE SET
    name=EXCLUDED.name,description=EXCLUDED.description,visibility=EXCLUDED.visibility,document=EXCLUDED.document,
    revision=${t("product_assets")}.revision+1,updated_at=now()`,
  [owner.domainId, id, owner.userId, input.name, input.description, input.visibility, JSON.stringify(document)]);
  if(!row){
    await registerProductResource(owner,id,input.visibility==='domain',{createOnly:true});
    const [use,edit]=await Promise.all([productGrantIdsForOwner(owner,'use'),productGrantIdsForOwner(owner,'edit')]);
    if(!edit.includes(id))throw new HttpError(403,'Product edit Grant required','PRODUCT_FORBIDDEN');
    const access=currentProductGrants(owner);if(use.includes(id))access.use.add(id);access.edit.add(id);
  }
  const saved=await getProduct(owner,id,client);
  const registration=ontologyRegistration(saved);
  if(registration)await client.query(`INSERT INTO ${t('product_ontology_outbox')} (domain_id,asset_id,revision,registration) VALUES($1,$2,$3,$4::jsonb) ON CONFLICT(domain_id,asset_id) DO UPDATE SET revision=EXCLUDED.revision,registration=EXCLUDED.registration`,[owner.domainId,id,saved.revision,JSON.stringify(registration)]);
  await client.query(`INSERT INTO ${t('product_asset_revisions')} (domain_id,asset_id,revision,asset) VALUES($1,$2,$3,$4::jsonb) ON CONFLICT DO NOTHING`,[owner.domainId,id,saved.revision,JSON.stringify(saved)]);
  return saved;
}
export async function saveProduct(owner: ProductOwner, id: string, input: Omit<ProductAssetInput,'visibility'> & {visibility?:ProductAssetInput['visibility']}, revision: number, credentials:AssistantCredentials,migrating=false) {
  await assertLegacyProductWrite(owner,credentials,{id,document:input.document});
  return withProductGrants(owner,async()=>{
    const visibility=input.visibility??(revision>0?(await getProduct(owner,id)).visibility:'private');
    const saved=await saveAuthorizedProduct(owner,id,{...input,visibility},revision,credentials,migrating);
    if(ontologyRegistration(saved))await synchronizeProductOntology(owner);return saved;
  });
}
async function saveAuthorizedProduct(owner:ProductOwner,id:string,input:ProductAssetInput,revision:number,credentials:AssistantCredentials,migrating=false){
  const parsed=productAssetInputSchema.parse(input);
  const normalized=normalizeComposition(id,parsed);
  if(parsed.document.kind==='object-view'){
    const response=await backendPost('product-object-view-migration',config.dataQuery.baseUrl+'/objectView/read',{className:parsed.document.className,form:parsed.document.form},{headers:buildBackendHeaders(credentials.token,undefined,credentials.locale,credentials.apiKey),retries:1});
    const state=JSON.parse(response.text);
    const published=state.data?.versions?.find((version:{revision:number})=>version.revision===state.data.publishedRevision);
    if(!state.success||!published)throw new HttpError(409,'Publish the source ObjectView before migrating it','UNPUBLISHED_OBJECT_VIEW');
    normalized.input=productAssetInputSchema.parse({...parsed,document:{kind:'object-projection',renders:{kind:'ObjectType',id:parsed.document.className},renderer:'full',primaryKey:parsed.document.primaryKey,fields:[],layout:objectViewDocumentSchema.parse(published.document),isDefault:!parsed.document.primaryKey}});
  }
  return transaction(async client => {
    await lockProducts(client, owner);
    await refreshProductGrants(owner);
    const existing=await client.query(`SELECT owner_id,revision FROM ${t('product_assets')} WHERE domain_id=$1 AND id=$2`,[owner.domainId,id]);
    if(existing.rows[0]&&!currentProductGrants(owner).edit.has(id))throw new HttpError(403,'Product edit Grant required','PRODUCT_FORBIDDEN');
    if((existing.rows[0]?.revision??0)!==revision)throw new HttpError(409,'Asset changed; reload before saving','PRODUCT_CONFLICT');
    if(!existing.rows[0]){
      const removed=await client.query(`SELECT 1 FROM ${t('product_asset_revisions')} WHERE domain_id=$1 AND asset_id=$2 LIMIT 1`,[owner.domainId,id]);
      if(removed.rows.length)throw new HttpError(409,'Deleted asset identities cannot be reused; create a new asset ID','PRODUCT_ID_RETIRED');
    }
    await validateProduct(owner,normalized.input,credentials);
    for(const child of normalized.children){
      await validateProduct(owner,child.input,credentials);
      const existingChild=await client.query(`SELECT revision FROM ${t('product_assets')} WHERE domain_id=$1 AND id=$2`,[owner.domainId,child.id]);
      await writeProduct(client,owner,child.id,child.input,existingChild.rows[0]?.revision??0,false,credentials);
    }
    await validateComposition(id,normalized.input,childId=>getProduct(owner,childId,client));
    await validatePageBindings(owner,normalized.input,childId=>getProduct(owner,childId,client),credentials);
    const parents=await client.query(`SELECT ${columns} FROM ${t('product_assets')} WHERE domain_id=$1 AND id<>$2 AND document->>'kind' IN ('page','navigation','application')`,[owner.domainId,id]);
    const internalRead=async(childId:string)=>{
      const result=await client.query(`SELECT ${columns} FROM ${t('product_assets')} WHERE domain_id=$1 AND id=$2`,[owner.domainId,childId]);
      if(!result.rows[0])throw new HttpError(409,'An existing composition has an unavailable dependency','PRODUCT_IN_USE');
      return asset(result.rows[0],owner);
    };
    await validateAffectedCompositions(id,normalized.input,parents.rows.map(row=>asset(row,owner)),internalRead);
    const candidateRead=async(childId:string)=>childId===id?({...normalized.input,id} as ProductAsset):internalRead(childId);
    for(const parent of parents.rows.map(row=>asset(row,owner)))if(productReferences(parent.document).some(reference=>reference.kind==='asset'&&reference.id===id))await validatePageBindings(owner,parent,candidateRead,credentials);
    await validateChildren(owner,normalized.input,credentials,client);
    return writeProduct(client, owner, id, normalized.input, revision,migrating||parsed.document.kind!==normalized.input.document.kind,credentials);
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
export async function deleteProduct(owner: ProductOwner, id: string, revision: number, credentials:AssistantCredentials) {
  await assertLegacyProductWrite(owner,credentials,{id});
  return withProductGrants(owner,async()=>{await deleteAuthorizedProduct(owner,id,revision);await synchronizeProductOntology(owner);});
}
async function deleteAuthorizedProduct(owner:ProductOwner,id:string,revision:number){
  await transaction(async client => {
    await lockProducts(client, owner);
    await refreshProductGrants(owner);
    const target = await getProduct(owner, id, client);
    if (!target.editable) throw new HttpError(403, "Only the owner may delete this asset", "PRODUCT_FORBIDDEN");
    if (target.revision !== revision) throw new HttpError(409, "Asset changed; reload before deleting", "PRODUCT_CONFLICT");
    const parents = await client.query(`SELECT document FROM ${t("product_assets")} WHERE domain_id=$1 AND id<>$2`, [owner.domainId, id]);
    const homes = await client.query(`SELECT 1 FROM ${t("product_home")} WHERE domain_id=$1 AND asset_id=$2`, [owner.domainId, id]);
    if (homes.rowCount || parents.rows.some(row => productReferences(row.document).some(ref => ref.kind === "asset" && ref.id === id)))
      throw new HttpError(409, "Asset is in use; remove its references first", "PRODUCT_IN_USE");
    const releases=await client.query(`SELECT 1 FROM ${t('product_releases')} WHERE domain_id=$1 AND EXISTS(SELECT 1 FROM jsonb_array_elements(snapshot->'assets') item WHERE item->>'id'=$2) LIMIT 1`,[owner.domainId,id]);
    if(releases.rowCount)throw new HttpError(409,'Published releases retain this asset','PRODUCT_IN_USE');
    await client.query(`DELETE FROM ${t("product_assets")} WHERE domain_id=$1 AND id=$2`, [owner.domainId, id]);
    if(ontologyRegistration(target))await client.query(`INSERT INTO ${t('product_ontology_outbox')} (domain_id,asset_id,revision,registration) VALUES($1,$2,$3,NULL) ON CONFLICT(domain_id,asset_id) DO UPDATE SET revision=EXCLUDED.revision,registration=NULL`,[owner.domainId,id,target.revision+1]);
  });
}

export async function readProductOverlay(owner:ProductOwner,pageId:string){
  const page=await getProduct(owner,pageId);
  if(!['page','collection-view','object-projection'].includes(page.document.kind))throw new HttpError(400,'Preferences require a Page or projection','INVALID_PRODUCT_TYPE');
  const result=await db().query(`SELECT revision,preferences FROM ${t('product_user_overlays')} WHERE domain_id=$1 AND principal_id=$2 AND page_id=$3`,[owner.domainId,owner.userId,pageId]);
  return result.rows[0]?{revision:result.rows[0].revision,workspace:personalWorkspaceSchema.parse(result.rows[0].preferences)}:{revision:0,workspace:null};
}
export async function saveProductOverlay(owner:ProductOwner,pageId:string,workspace:PersonalWorkspace,revision:number){
  const parsed=personalWorkspaceSchema.parse(workspace);const page=await getProduct(owner,pageId);
  if(!['page','collection-view','object-projection'].includes(page.document.kind))throw new HttpError(400,'Preferences require a Page or projection','INVALID_PRODUCT_TYPE');
  return transaction(async client=>{
    await lockProducts(client,owner);
    const current=await getProduct(owner,pageId,client);
    if(!['page','collection-view','object-projection'].includes(current.document.kind))throw new HttpError(400,'Preferences require a Page or projection','INVALID_PRODUCT_TYPE');
    const existing=await client.query(`SELECT revision FROM ${t('product_user_overlays')} WHERE domain_id=$1 AND principal_id=$2 AND page_id=$3`,[owner.domainId,owner.userId,pageId]);
    if((existing.rows[0]?.revision??0)!==revision)throw new HttpError(409,'Personal preferences changed; reload first','PRODUCT_CONFLICT');
    await client.query(`INSERT INTO ${t('product_user_overlays')} (domain_id,principal_id,page_id,preferences) VALUES($1,$2,$3,$4::jsonb) ON CONFLICT(domain_id,principal_id,page_id) DO UPDATE SET preferences=EXCLUDED.preferences,revision=${t('product_user_overlays')}.revision+1`,[owner.domainId,owner.userId,pageId,JSON.stringify(parsed)]);
    if(current.document.kind==='page')await client.query(`INSERT INTO ${t('product_user_overlays')} (domain_id,principal_id,page_id,preferences) SELECT $1,$2,projection.id,$4::jsonb FROM ${t('product_assets')} projection WHERE projection.domain_id=$1 AND projection.document->>'kind'='collection-view' AND projection.document->'renders'->>'id' LIKE 'platform-members:platform:%' AND projection.id=ANY($3::text[]) ON CONFLICT(domain_id,principal_id,page_id) DO UPDATE SET preferences=EXCLUDED.preferences,revision=${t('product_user_overlays')}.revision+1`,[owner.domainId,owner.userId,current.document.children.map(child=>child.assetId),JSON.stringify(parsed)]);
    return {revision:revision+1,workspace:parsed};
  });
}
