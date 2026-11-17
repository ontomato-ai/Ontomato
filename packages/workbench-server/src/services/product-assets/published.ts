import type {AssistantCredentials} from '../../platform/agent-runtime/runtime';
import type {ProductOwner} from './store';
import {getApplicationProduct} from './store';
import {requireProductUse} from './grants';
import {readActiveProductBundle,readProductRelease,synchronizeBundlePublication} from './releases';
import {backendGet,buildBackendHeaders} from '../../utils/backend-client';
import {config} from '../../config/application';
import {HttpError} from '../../utils/errors';

export async function publishedApplication(owner:ProductOwner,credentials:AssistantCredentials,id:string){
  return (await publishedApplicationRelease(owner,credentials,id)).snapshot;
}
export async function publishedApplicationRelease(owner:ProductOwner,credentials:AssistantCredentials,id:string){
   const bundle=await getApplicationProduct(owner,id);
   await requireProductUse(owner,bundle.id);
  if(bundle.document.kind!=='application')throw new HttpError(404,'Application bundle unavailable','PRODUCT_UNAVAILABLE');
  if(!bundle.document.workspaceId&&bundle.document.navigationId){if(bundle.editable)await synchronizeBundlePublication(owner,id,credentials);return readActiveProductBundle(owner,id);}
  const headers=buildBackendHeaders(credentials.token,undefined,credentials.locale,credentials.apiKey);
  const catalog=JSON.parse((await backendGet('published-application-admission',config.dataQuery.baseUrl+'/platform/applications?purpose=navigation',{headers,retries:1})).text);
  if(!catalog.success||!Array.isArray(catalog.data)||!catalog.data.some((application:{id:string})=>application.id===id))throw new HttpError(403,'Application use permission required','PRODUCT_FORBIDDEN');
  const result=JSON.parse((await backendGet('published-application-entry',config.dataQuery.baseUrl+'/platform/applications/'+encodeURIComponent(id),{headers,retries:1})).text);
  if(!result.success||!result.data?.releaseId)throw new HttpError(404,'Application release unavailable','PRODUCT_UNAVAILABLE');
  return {releaseId:result.data.releaseId as string,snapshot:await readProductRelease(owner,result.data.releaseId,id)};
}
