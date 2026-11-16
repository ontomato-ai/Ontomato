import {backendPost,buildBackendHeaders} from '../../utils/backend-client';
import {config} from '../../config/application';
import {environment} from '../../config/environment';
import {HttpError} from '../../utils/errors';
import type {AssistantCredentials} from '../../platform/agent-runtime/runtime';
import type {ProductOwner} from './store';
import {getPostgresPool,qualifiedTable as t} from '../../infrastructure/postgres';
import {AsyncLocalStorage} from 'node:async_hooks';
import {z} from 'zod';
const accessContext=new AsyncLocalStorage<{domainId:string;userId:string;use:Set<string>;edit:Set<string>}>();
export async function withProductGrants<T>(owner:ProductOwner,action:()=>Promise<T>):Promise<T>{
  const current=accessContext.getStore();
  if(current?.domainId===owner.domainId&&current.userId===owner.userId)return action();
  await migrateProductGrants(owner);
  const [use,edit]=await Promise.all([productGrantIdsForOwner(owner,'use'),productGrantIdsForOwner(owner,'edit')]);
  return accessContext.run({domainId:owner.domainId,userId:owner.userId,use:new Set(use),edit:new Set(edit)},action);
}
export async function refreshProductGrants(owner:ProductOwner){
  const access=currentProductGrants(owner);
  const [use,edit]=await Promise.all([productGrantIdsForOwner(owner,'use'),productGrantIdsForOwner(owner,'edit')]);
  access.use=new Set(use);access.edit=new Set(edit);
}
export function currentProductGrants(owner:ProductOwner){
  const access=accessContext.getStore();
  if(!access||access.domainId!==owner.domainId||access.userId!==owner.userId)throw new HttpError(503,'Product Grant context is required','PRODUCT_GOVERNANCE_UNAVAILABLE');
  return access;
}
export async function requireProductUse(owner:ProductOwner,id:string){
  return withProductGrants(owner,async()=>{if(!currentProductGrants(owner).use.has(id))throw new HttpError(403,'Product use Grant required','PRODUCT_FORBIDDEN');});
}

export async function registerProductResource(owner:ProductOwner,id:string,shared:boolean){
  const token=environment.agentRuntime().queryServiceToken;
  if(!token)throw new HttpError(503,'Product governance service credential is not configured','PRODUCT_GOVERNANCE_UNAVAILABLE');
  const response=await backendPost('product-grant-registration',config.dataQuery.baseUrl+'/product-governance/register',{domainId:owner.domainId,ownerId:owner.userId,id,shared},{headers:{'Content-Type':'application/json','X-Ontomato-Query-Service-Token':token},retries:1});
  if(JSON.parse(response.text).success!==true)throw new HttpError(503,'Product resource registration failed','PRODUCT_GOVERNANCE_UNAVAILABLE');
}
export async function requireProductGrant(id:string,verb:'use'|'edit',credentials:AssistantCredentials){
  const response=await backendPost('product-grant-check',config.dataQuery.baseUrl+'/product-governance/check',{id,verb},{headers:buildBackendHeaders(credentials.token,undefined,credentials.locale,credentials.apiKey),retries:1});
  if(JSON.parse(response.text).allowed!==true)throw new HttpError(403,`Product ${verb} Grant required`,'PRODUCT_FORBIDDEN');
}
export async function grantedProductIds(verb:'use'|'edit',credentials:AssistantCredentials):Promise<string[]>{
  const response=await backendPost('product-grant-resources',config.dataQuery.baseUrl+'/product-governance/resources',{verb},{headers:buildBackendHeaders(credentials.token,undefined,credentials.locale,credentials.apiKey),retries:1});
  const result=JSON.parse(response.text);
  if(!Array.isArray(result.ids)||result.ids.some((id:unknown)=>typeof id!=='string'))throw new HttpError(503,'Invalid product Grant response','PRODUCT_GOVERNANCE_UNAVAILABLE');
  return result.ids;
}
export async function shareProductResource(id:string,shared:boolean,credentials:AssistantCredentials){
  const response=await backendPost('product-grant-sharing',config.dataQuery.baseUrl+'/product-governance/share',{id,shared},{headers:buildBackendHeaders(credentials.token,undefined,credentials.locale,credentials.apiKey),retries:1});
  if(JSON.parse(response.text).success!==true)throw new HttpError(503,'Product sharing update failed','PRODUCT_GOVERNANCE_UNAVAILABLE');
}
export async function productGrantIdsForOwner(owner:ProductOwner,verb:'use'|'edit'):Promise<string[]>{
  const token=environment.agentRuntime().queryServiceToken;
  if(!token)throw new HttpError(503,'Product governance service credential is not configured','PRODUCT_GOVERNANCE_UNAVAILABLE');
  const response=await backendPost('product-grant-owner-resources',config.dataQuery.baseUrl+'/product-governance/service-resources',{domainId:owner.domainId,userId:owner.userId,verb},{headers:{'Content-Type':'application/json','X-Ontomato-Query-Service-Token':token},retries:1});
  const result=JSON.parse(response.text);
  if(!Array.isArray(result.ids)||result.ids.some((id:unknown)=>typeof id!=='string'))throw new HttpError(503,'Invalid product Grant response','PRODUCT_GOVERNANCE_UNAVAILABLE');
  return result.ids;
}
/** Import once, preserving revocations on every subsequent read. */
export async function migrateProductGrants(owner:ProductOwner){
  const rows=await getPostgresPool().query(`SELECT id,owner_id,visibility FROM ${t('product_assets')} WHERE domain_id=$1 AND NOT governance_registered ORDER BY id`,[owner.domainId]);
  for(const row of rows.rows){
    await registerProductResource({domainId:owner.domainId,userId:row.owner_id},row.id,row.visibility==='domain');
    await getPostgresPool().query(`UPDATE ${t('product_assets')} SET governance_registered=true WHERE domain_id=$1 AND id=$2 AND owner_id=$3`,[owner.domainId,row.id,row.owner_id]);
  }
}
export async function readProductGrantRecords(id:string,credentials:AssistantCredentials){
  const response=await backendPost('product-grant-records',config.dataQuery.baseUrl+'/product-governance/grants',{id},{headers:buildBackendHeaders(credentials.token,undefined,credentials.locale,credentials.apiKey),retries:1});
  return z.object({grants:z.array(z.object({principalKind:z.enum(['principal','role','domain']),principalId:z.string(),verb:z.enum(['use','edit'])}))}).parse(JSON.parse(response.text));
}
export async function changeProductGrant(id:string,grant:{principalKind:'principal'|'role';principalId:string;verb:'use'|'edit';remove:boolean},credentials:AssistantCredentials){
  const response=await backendPost('product-grant-mutation',config.dataQuery.baseUrl+'/product-governance/grant',{id,...grant},{headers:buildBackendHeaders(credentials.token,undefined,credentials.locale,credentials.apiKey),retries:1});
  if(JSON.parse(response.text).success!==true)throw new HttpError(503,'Product Grant update failed','PRODUCT_GOVERNANCE_UNAVAILABLE');
}
export async function changeProductDomainGrant(id:string,shared:boolean,credentials:AssistantCredentials){return shareProductResource(id,shared,credentials);}
