import {createHash} from 'node:crypto';
import {productAssetInputSchema,productAssetSchema,productDefaultTexts,type ProductAsset} from '@ontomato/contracts/product-assets';
import {getPostgresPool,qualifiedTable as t} from '../../infrastructure/postgres';
import {transaction} from '../../infrastructure/postgres-transaction';
import {backendGet,backendPost,buildBackendHeaders} from '../../utils/backend-client';
import {config} from '../../config/application';
import {environment} from '../../config/environment';
import type {AssistantCredentials} from '../../platform/agent-runtime/runtime';
import {assistantStore} from '../assistant/store';
import {effectiveSystemPrompt} from '../assistant/prompts';
import {assistantName,assistantDescription} from '../assistant/labels';
import {registerProductResource} from './grants';
import {ontologyRegistration,synchronizeProductOntology} from './ontology';
import {lockProducts,type ProductOwner} from './store';
import {migratePlatformProjection} from './platform-migration';
import type {PoolClient} from 'pg';
const synchronized=new Map<string,{at:number;pending?:Promise<unknown>}>();
export async function ensurePlatformAssets(owner:ProductOwner,credentials:AssistantCredentials){
 const key=owner.domainId+':'+owner.userId,previous=synchronized.get(key);
 if(previous?.pending){await previous.pending;return;}
 if(previous&&Date.now()-previous.at<60_000)return;
 const pending=(async()=>{
  const response=await backendGet('platform-sync-permission',config.dataQuery.baseUrl+'/platform/applications/platform-assets-access',{headers:buildBackendHeaders(credentials.token,undefined,credentials.locale,credentials.apiKey),retries:1,timeoutMs:15_000});
  const permissions=JSON.parse(response.text);if(permissions.data?.allowed!==true)return;
  await synchronizePlatformAssets(owner,credentials,false);
 })();
 synchronized.set(key,{at:0,pending});try{await pending;synchronized.set(key,{at:Date.now()});}catch(error){synchronized.delete(key);throw error;}
}

export async function nativeAgentAsset(domain:string,assetId:string){
 const result=await getPostgresPool().query(`SELECT agent_id FROM ${t('product_native_agent_bindings')} WHERE domain_id=$1 AND asset_id=$2`,[domain,assetId]);
 return result.rows[0]?.agent_id as string|undefined;
}
export async function nativeProfileId(domain:string,agentId:string){
 const result=await getPostgresPool().query(`SELECT asset_id FROM ${t('product_native_agent_bindings')} WHERE domain_id=$1 AND agent_id=$2`,[domain,agentId]);
 return result.rows[0]?.asset_id as string|undefined;
}
export async function nativeApplicationAsset(domain:string,assetId:string){
 const result=await getPostgresPool().query(`SELECT application_id FROM ${t('product_native_application_bindings')} WHERE domain_id=$1 AND asset_id=$2`,[domain,assetId]);
 return result.rows[0]?.application_id as string|undefined;
}
/** Reconcile catalog identities without replacing their execution engines or assigning execution roles. */
export async function synchronizePlatformAssets(owner:ProductOwner,credentials:AssistantCredentials,migrateLegacy=true){
 const agents=(await assistantStore.agents(owner.domainId)).filter(agent=>['regular','analysis'].includes(agent.kind));
 const response=await backendGet('platform-product-catalog',config.dataQuery.baseUrl+'/platform/applications?purpose=navigation',{headers:buildBackendHeaders(credentials.token,undefined,credentials.locale,credentials.apiKey),retries:1,timeoutMs:15_000});
 const catalog=JSON.parse(response.text);if(!Array.isArray(catalog.data))throw new Error('Application catalog unavailable');
 const token=environment.agentRuntime().queryServiceToken;
 for(const agent of agents){const result=await backendPost('default-agent-identity',config.dataQuery.baseUrl+'/agent-principals/register-user-scoped',{domainId:owner.domainId,principalId:agent.id,name:assistantName(agent,credentials.locale)},{headers:{'Content-Type':'application/json','X-Ontomato-Query-Service-Token':token},retries:1});if(JSON.parse(result.text).success!==true)throw new Error('Default Agent identity registration failed');const existing=await getPostgresPool().query(`SELECT owner_id FROM ${t('product_assets')} WHERE domain_id=$1 AND id=$2`,[owner.domainId,'default-agent-profile-'+agent.id]);await registerProductResource({...owner,userId:existing.rows[0]?.owner_id??owner.userId},agent.id,true);}
 const inserted:string[]=[];
 await transaction(async client=>{
  await lockProducts(client,owner);
  async function insert(id:string,name:string,description:string,document:unknown){
   const exists=await client.query(`SELECT 1 FROM ${t('product_assets')} WHERE domain_id=$1 AND id=$2`,[owner.domainId,id]);if(exists.rows.length)return;
   const input=productAssetInputSchema.parse({name,description:description.slice(0,2000),document});
   await registerProductResource(owner,id,true);
   const saved=await client.query(`INSERT INTO ${t('product_assets')}(domain_id,id,owner_id,name,description,visibility,document,governance_registered) VALUES($1,$2,$3,$4,$5,'private',$6::jsonb,true) RETURNING revision,created_at,updated_at`,[owner.domainId,id,owner.userId,input.name,input.description,JSON.stringify(input.document)]);
   const row=saved.rows[0];const asset=productAssetSchema.parse({...input,id,ownerId:owner.userId,revision:row.revision,createdAt:row.created_at.toISOString(),updatedAt:row.updated_at.toISOString(),editable:true});
   await client.query(`INSERT INTO ${t('product_asset_revisions')}(domain_id,asset_id,revision,asset) VALUES($1,$2,$3,$4::jsonb)`,[owner.domainId,id,row.revision,JSON.stringify(asset)]);
   const registration=ontologyRegistration(asset);if(registration)await client.query(`INSERT INTO ${t('product_ontology_outbox')}(domain_id,asset_id,revision,registration) VALUES($1,$2,$3,$4::jsonb) ON CONFLICT(domain_id,asset_id) DO UPDATE SET revision=EXCLUDED.revision,registration=EXCLUDED.registration`,[owner.domainId,id,row.revision,JSON.stringify(registration)]);
   inserted.push(id);
  }
  for(const agent of agents){
   const id='default-agent-profile-'+agent.id;
   await client.query(`INSERT INTO ${t('product_native_agent_bindings')}(domain_id,asset_id,agent_id) VALUES($1,$2,$3) ON CONFLICT DO NOTHING`,[owner.domainId,id,agent.id]);
   await insert(id,assistantName(agent,credentials.locale),assistantDescription(agent,credentials.locale),{kind:'agent-profile',principalId:agent.id,instructions:effectiveSystemPrompt(agent,credentials.locale),tools:[],contextViews:[]});
  }
  for(const app of catalog.data){
   if(app.entry.renderer==='panels')continue;
   const already=await client.query(`SELECT 1 FROM ${t('product_assets')} WHERE domain_id=$1 AND (id=$2 OR document->>'applicationId'=$2) LIMIT 1`,[owner.domainId,app.id]);if(already.rows.length)continue;
   const suffix=createHash('sha256').update(app.id).digest('hex').slice(0,24),pageId='platform-page-'+suffix,id='platform-application-'+suffix;
   const name=app.names?.[credentials.locale??'']??app.names?.['zh-CN']??app.names?.en??app.id;
   const children=app.id==='agents'?agents.map(agent=>({assetId:'default-agent-profile-'+agent.id,column:'main'})):[];
   if(children.length)await insert(pageId,name+' · 页面',productDefaultTexts.platformPageDescription,{kind:'page',children});
   await client.query(`INSERT INTO ${t('product_native_application_bindings')}(domain_id,asset_id,application_id) VALUES($1,$2,$3) ON CONFLICT DO NOTHING`,[owner.domainId,id,app.id]);
    await insert(id,name,app.descriptions?.[credentials.locale??'']??app.descriptions?.['zh-CN']??app.descriptions?.en??'',{kind:'application',applicationId:app.id,children:children.length?[{assetId:pageId,column:'main'}]:[]});
  }
 });
  await synchronizeProductOntology(owner);
  if(!migrateLegacy)return {created:inserted};
 const legacy=await getPostgresPool().query(`SELECT id,revision,document FROM ${t('product_assets')} WHERE domain_id=$1 AND owner_id=$2 AND document->>'kind'='widget' AND document->'widget'->>'kind'='platform'`,[owner.domainId,owner.userId]);
 for(const row of legacy.rows){
  if(row.document.widget.source==='assistant'){
   const {saveProduct}=await import('./store');
   const result=await getPostgresPool().query(`SELECT name,description,visibility FROM ${t('product_assets')} WHERE domain_id=$1 AND id=$2`,[owner.domainId,row.id]);const source=result.rows[0];
   await saveProduct(owner,row.id,{...source,document:{kind:'page',children:agents.length?[{assetId:'default-agent-profile-'+agents[0].id,column:'main'}]:[]}},row.revision,credentials,true);
   }else await migratePlatformProjection(owner,credentials,row.id,row.revision);
 }
 return {created:inserted};
}

export async function updateNativeAgent(asset:ProductAsset,owner:ProductOwner,client:Pick<PoolClient,'query'>=getPostgresPool()){
 if(asset.document.kind!=='agent-profile')return;
 const id=await nativeAgentAsset(owner.domainId,asset.id);if(!id)return;
 await client.query(`UPDATE ${t('assistant_agents')} SET name=$3,description=$4,system_prompt=$5 WHERE domain_id=$1 AND id=$2`,[owner.domainId,id,asset.name,asset.description,asset.document.instructions]);
}

export async function synchronizeNativeProfile(client:PoolClient,owner:ProductOwner,agent:import('../assistant/store').AgentRow,locale?:string){
 const binding=await client.query(`SELECT asset_id FROM ${t('product_native_agent_bindings')} WHERE domain_id=$1 AND agent_id=$2`,[owner.domainId,agent.id]);
 const id=binding.rows[0]?.asset_id;if(!id)return;
 const result=await client.query(`UPDATE ${t('product_assets')} SET name=$3,description=$4,document=jsonb_set(document,'{instructions}',to_jsonb($5::text)),revision=revision+1,updated_at=now() WHERE domain_id=$1 AND id=$2 RETURNING *`,[owner.domainId,id,assistantName(agent,locale),assistantDescription(agent,locale),effectiveSystemPrompt(agent,locale)]);
 const row=result.rows[0];if(!row)return;
 const asset=productAssetSchema.parse({id:row.id,name:row.name,description:row.description,visibility:row.visibility,document:row.document,revision:row.revision,ownerId:row.owner_id,createdAt:row.created_at.toISOString(),updatedAt:row.updated_at.toISOString(),editable:true});
 await client.query(`INSERT INTO ${t('product_asset_revisions')}(domain_id,asset_id,revision,asset) VALUES($1,$2,$3,$4::jsonb)`,[owner.domainId,id,row.revision,JSON.stringify(asset)]);
 const registration=ontologyRegistration(asset);if(registration)await client.query(`INSERT INTO ${t('product_ontology_outbox')}(domain_id,asset_id,revision,registration) VALUES($1,$2,$3,$4::jsonb) ON CONFLICT(domain_id,asset_id) DO UPDATE SET revision=EXCLUDED.revision,registration=EXCLUDED.registration`,[owner.domainId,id,row.revision,JSON.stringify(registration)]);
}
