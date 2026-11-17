import {z} from 'zod';
import {backendPost} from '../../utils/backend-client';
import {config} from '../../config/application';
import {environment} from '../../config/environment';
import {HttpError} from '../../utils/errors';
import type {AssistantCredentials} from '../../platform/agent-runtime/runtime';
import {requireProductUse} from './grants';
import {getQueryTimeoutMs} from '../../config/query-settings';

export async function userScopedAgentCredentials(domainId:string,principalId:string,initiatorId:string,locale?:string):Promise<AssistantCredentials>{
 const expiresAt=Date.now()+getQueryTimeoutMs();
 const response=await backendPost('user-scoped-agent-execution',config.dataQuery.baseUrl+'/agent-principals/user-scoped-execution',{domainId,principalId,initiatorId,expiresAt},{headers:{'Content-Type':'application/json','X-Ontomato-Query-Service-Token':environment.agentRuntime().queryServiceToken},retries:1});
 const result=z.object({token:z.string().startsWith('ap2.'),expiresAt:z.number()}).parse(JSON.parse(response.text));return {token:result.token,locale};
}

/** The service exchanges a Profile identity for governance-owned, short-lived execution authority. */
export async function agentPrincipalCredentials(domainId:string,principalId:string,locale?:string,initiatorId?:string):Promise<AssistantCredentials>{
  if(!initiatorId)throw new HttpError(403,'Agent execution requires an authorized initiating principal','AGENT_PRINCIPAL_FORBIDDEN');
  await requireProductUse({domainId,userId:initiatorId},principalId);
  const serviceToken=environment.agentRuntime().queryServiceToken;
  if(!serviceToken)throw new HttpError(503,'Agent governance service credential is not configured','AGENT_PRINCIPAL_UNAVAILABLE');
  const response=await backendPost('agent-principal-execution',config.dataQuery.baseUrl+'/agent-principals/execution',{domainId,principalId,initiatorId,expiresAt:Date.now()+240_000},{headers:{'Content-Type':'application/json','X-Ontomato-Query-Service-Token':serviceToken},retries:1});
  const result=z.object({token:z.string().startsWith('ap1.'),expiresAt:z.number()}).parse(JSON.parse(response.text));
  return {token:result.token,locale};
}
