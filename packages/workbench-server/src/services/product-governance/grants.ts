import {backendPost,buildBackendHeaders} from '../../utils/backend-client';
import {config} from '../../config/application';
import {environment} from '../../config/environment';
import {HttpError} from '../../utils/errors';
import type {AssistantCredentials} from '../../platform/agent-runtime/runtime';
import {productGrantsResponseSchema,type ChangeProductGrantRequest} from '@ontomato/contracts/product-governance';

export interface ProductOwner { domainId: string; userId: string }

function serviceHeaders() {
  const token = environment.agentRuntime().queryServiceToken;
  if (!token) throw new HttpError(503, "Product governance service credential is not configured", "PRODUCT_GOVERNANCE_UNAVAILABLE");
  return { "Content-Type": "application/json", "X-Ontomato-Query-Service-Token": token };
}

export async function unregisterProductResource(domainId: string, id: string) {
  const response = await backendPost("product-grant-unregister", config.dataQuery.baseUrl + "/product-governance/unregister",
    { domainId, id }, { headers: serviceHeaders(), retries: 1 });
  if (JSON.parse(response.text).success !== true)
    throw new HttpError(503, "Product resource removal failed", "PRODUCT_GOVERNANCE_UNAVAILABLE");
}

export async function registerProductResource(owner:ProductOwner,id:string,shared:boolean){
  const response=await backendPost('product-grant-registration',config.dataQuery.baseUrl+'/product-governance/register',{domainId:owner.domainId,ownerId:owner.userId,id,shared},{headers:serviceHeaders(),retries:1});
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
  const response=await backendPost('product-grant-owner-resources',config.dataQuery.baseUrl+'/product-governance/service-resources',{domainId:owner.domainId,userId:owner.userId,verb},{headers:serviceHeaders(),retries:1});
  const result=JSON.parse(response.text);
  if(!Array.isArray(result.ids)||result.ids.some((id:unknown)=>typeof id!=='string'))throw new HttpError(503,'Invalid product Grant response','PRODUCT_GOVERNANCE_UNAVAILABLE');
  return result.ids;
}
export async function readProductGrantRecords(id:string,credentials:AssistantCredentials){
  const response=await backendPost('product-grant-records',config.dataQuery.baseUrl+'/product-governance/grants',{id},{headers:buildBackendHeaders(credentials.token,undefined,credentials.locale,credentials.apiKey),retries:1});
  return productGrantsResponseSchema.parse(JSON.parse(response.text));
}
export async function changeProductGrant(id:string,grant:ChangeProductGrantRequest,credentials:AssistantCredentials){
  const response=await backendPost('product-grant-mutation',config.dataQuery.baseUrl+'/product-governance/grant',{id,...grant},{headers:buildBackendHeaders(credentials.token,undefined,credentials.locale,credentials.apiKey),retries:1});
  if(JSON.parse(response.text).success!==true)throw new HttpError(503,'Product Grant update failed','PRODUCT_GOVERNANCE_UNAVAILABLE');
}
export async function changeProductDomainGrant(id:string,shared:boolean,credentials:AssistantCredentials){return shareProductResource(id,shared,credentials);}
