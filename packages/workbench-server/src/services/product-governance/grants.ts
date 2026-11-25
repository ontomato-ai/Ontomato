import {backendPost,buildBackendHeaders} from '../../utils/backend-client';
import {config} from '../../config/application';
import {environment} from '../../config/environment';
import {HttpError} from '../../utils/errors';
import type {AssistantCredentials} from '../../platform/agent-runtime/runtime';
import {
  domainProductGrantsResponseSchema,
  productGrantChangeResponseSchema,
  productGrantPrincipalsResponseSchema,
  productGrantsResponseSchema,
  type ChangeProductGrantRequest,
  type DomainProductGrantsRequest,
  type ProductGrantVerb,
  type SetProductGrantsRequest,
} from '@ontomato/contracts/product-governance';

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

interface ProductRegistrationOptions {
  ownerId?: string | null;
  verbs?: ProductGrantVerb[];
  grantAdmin?: boolean;
  legacyMenuPermission?: string;
}

export async function registerProductResource(
  owner: { domainId: string; userId?: string }, id: string, shared: boolean,
  { ownerId = owner.userId, ...options }: ProductRegistrationOptions = {},
) {
  const response = await backendPost('product-grant-registration', config.dataQuery.baseUrl + '/product-governance/register',
    { domainId: owner.domainId, ownerId, id, shared, ...options }, { headers: serviceHeaders(), retries: 1 });
  if(JSON.parse(response.text).success!==true)throw new HttpError(503,'Product resource registration failed','PRODUCT_GOVERNANCE_UNAVAILABLE');
}
export async function productGrantAllowed(id:string,verb: ProductGrantVerb,credentials:AssistantCredentials){
  const response=await backendPost('product-grant-check',config.dataQuery.baseUrl+'/product-governance/check',{id,verb},{headers:buildBackendHeaders(credentials.token,undefined,credentials.locale,credentials.apiKey),retries:1});
  return JSON.parse(response.text).allowed===true;
}
export async function productGrantsAllowedBatch(
  ids: readonly string[], verb: ProductGrantVerb, credentials: AssistantCredentials,
): Promise<Record<string, boolean>> {
  const unique = [...new Set(ids)];
  if (unique.length === 0) return {};
  if (unique.length === 1) {
    const [id] = unique;
    return { [id]: await productGrantAllowed(id, verb, credentials) };
  }
  const batches: string[][] = [];
  for (let start = 0; start < unique.length; start += 200) batches.push(unique.slice(start, start + 200));
  const results = await Promise.all(batches.map(ids => checkProductGrants(ids, verb, credentials)));
  return Object.fromEntries(results.flatMap(result => Object.entries(result)));
}

async function checkProductGrants(ids: string[], verb: ProductGrantVerb, credentials: AssistantCredentials) {
  const response = await backendPost(
    "product-grant-check-batch", config.dataQuery.baseUrl + "/product-governance/check-batch",
    { ids: ids, verb },
    { headers: buildBackendHeaders(credentials.token, undefined, credentials.locale, credentials.apiKey), retries: 1 },
  );
  const allowed = JSON.parse(response.text)?.allowed;
  if (allowed === null || typeof allowed !== "object" || Array.isArray(allowed)
      || ids.some(id => !Object.hasOwn(allowed, id) || typeof allowed[id] !== "boolean"))
    throw new HttpError(503, "Invalid product Grant response", "PRODUCT_GOVERNANCE_UNAVAILABLE");
  return allowed;
}
export async function requireProductGrant(id:string,verb: ProductGrantVerb,credentials:AssistantCredentials){
  if(!await productGrantAllowed(id,verb,credentials))throw new HttpError(403,`Product ${verb} Grant required`,'PRODUCT_FORBIDDEN');
}
export async function grantedProductIds(verb: ProductGrantVerb,credentials:AssistantCredentials):Promise<string[]>{
  const response=await backendPost('product-grant-resources',config.dataQuery.baseUrl+'/product-governance/resources',{verb},{headers:buildBackendHeaders(credentials.token,undefined,credentials.locale,credentials.apiKey),retries:1});
  const result=JSON.parse(response.text);
  if(!Array.isArray(result.ids)||result.ids.some((id:unknown)=>typeof id!=='string'))throw new HttpError(503,'Invalid product Grant response','PRODUCT_GOVERNANCE_UNAVAILABLE');
  return result.ids;
}
export async function shareProductResource(id:string,shared:boolean,credentials:AssistantCredentials){
  const response=await backendPost('product-grant-sharing',config.dataQuery.baseUrl+'/product-governance/share',{id,shared},{headers:buildBackendHeaders(credentials.token,undefined,credentials.locale,credentials.apiKey),retries:1});
  if(JSON.parse(response.text).success!==true)throw new HttpError(503,'Product sharing update failed','PRODUCT_GOVERNANCE_UNAVAILABLE');
}
export async function productGrantIdsForOwner(owner:ProductOwner,verb: ProductGrantVerb):Promise<string[]>{
  const response=await backendPost('product-grant-owner-resources',config.dataQuery.baseUrl+'/product-governance/service-resources',{domainId:owner.domainId,userId:owner.userId,verb},{headers:serviceHeaders(),retries:1});
  const result=JSON.parse(response.text);
  if(!Array.isArray(result.ids)||result.ids.some((id:unknown)=>typeof id!=='string'))throw new HttpError(503,'Invalid product Grant response','PRODUCT_GOVERNANCE_UNAVAILABLE');
  return result.ids;
}
export async function readProductGrantRecords(id:string,credentials:AssistantCredentials){
  const response=await backendPost('product-grant-records',config.dataQuery.baseUrl+'/product-governance/grants',{id},{headers:buildBackendHeaders(credentials.token,undefined,credentials.locale,credentials.apiKey),retries:1});
  return productGrantsResponseSchema.parse(JSON.parse(response.text));
}
export async function searchProductGrantPrincipals(
  kind: "principal" | "role",
  keyword: string | undefined,
  limit: number,
  credentials: AssistantCredentials,
) {
  const response = await backendPost(
    "product-grant-principals",
    config.dataQuery.baseUrl + "/product-governance/principals",
    { kind, ...(keyword ? { keyword } : {}), limit },
    { headers: buildBackendHeaders(credentials.token, undefined, credentials.locale, credentials.apiKey), retries: 1 },
  );
  return productGrantPrincipalsResponseSchema.parse(JSON.parse(response.text));
}
export async function changeProductGrant(id:string,grant:ChangeProductGrantRequest,credentials:AssistantCredentials){
  const response=await backendPost('product-grant-mutation',config.dataQuery.baseUrl+'/product-governance/grant',{id,...grant},{headers:buildBackendHeaders(credentials.token,undefined,credentials.locale,credentials.apiKey),retries:1});
  if(JSON.parse(response.text).success!==true)throw new HttpError(503,'Product Grant update failed','PRODUCT_GOVERNANCE_UNAVAILABLE');
}
export async function changeProductDomainGrant(id:string,shared:boolean,credentials:AssistantCredentials){return shareProductResource(id,shared,credentials);}

export async function setProductGrants(credentials: AssistantCredentials, input: SetProductGrantsRequest) {
  const response = await backendPost(
    "product-grant-set", config.dataQuery.baseUrl + "/product-governance/grant-set", input,
    { headers: buildBackendHeaders(credentials.token, undefined, credentials.locale, credentials.apiKey), retries: 1 },
  );
  return productGrantChangeResponseSchema.parse(JSON.parse(response.text));
}

export async function readDomainProductGrants(
  credentials: AssistantCredentials, filter: DomainProductGrantsRequest = {},
) {
  const response = await backendPost(
    "product-grant-domain-records", config.dataQuery.baseUrl + "/product-governance/domain-grants", filter,
    { headers: buildBackendHeaders(credentials.token, undefined, credentials.locale, credentials.apiKey), retries: 1 },
  );
  return domainProductGrantsResponseSchema.parse(JSON.parse(response.text));
}
