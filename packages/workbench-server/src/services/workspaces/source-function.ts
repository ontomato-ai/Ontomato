import {z} from 'zod';
import {backendPost} from '../../utils/backend-client';
import {config} from '../../config/application';
import {environment} from '../../config/environment';
import {HttpError} from '../../utils/errors';
import type {WorkspaceExport} from '@ontomato/contracts/workspaces';
import {hostedReleaseFiles} from './hosted-sdk';
import {deriveSourceProductReview} from './product-admission';
import {createHash} from 'node:crypto';

export async function registerSourceFunction(domainId:string,applicationId:string,releaseId:string,files:WorkspaceExport['files'],contracts:{kind:string;id:string;hash:string}[],sdkVersion:string){
  const token=environment.agentRuntime().queryServiceToken;
  if(!token)throw new HttpError(503,'Product Function registration credential unavailable','PRODUCT_ONTOLOGY_UNAVAILABLE');
  const delivered=hostedReleaseFiles(files);
  deriveSourceProductReview(delivered);
  const dependencies=contracts.map(({kind,id,hash})=>({kind,id,hash})).sort((a,b)=>`${a.kind}:${a.id}`.localeCompare(`${b.kind}:${b.id}`));
  const contents=delivered.map(file=>({path:file.path,hash:createHash('sha256').update(Buffer.from(file.content,file.encoding)).digest('hex')})).sort((a,b)=>a.path.localeCompare(b.path));
  const artifact={applicationId,releaseId,name:applicationId,dependencies,files:contents,sdkVersions:[sdkVersion],messageBridge:2};
  const response=await backendPost('product-source-function',config.dataQuery.baseUrl+'/ontology/products/service/source-function',{domainId,artifact},{headers:{'Content-Type':'application/json','X-Ontomato-Query-Service-Token':token},retries:1});
  return z.object({success:z.literal(true),functionId:z.string().regex(/^[a-f0-9]{64}$/)}).parse(JSON.parse(response.text)).functionId;
}
