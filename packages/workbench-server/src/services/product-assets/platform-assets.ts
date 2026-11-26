import {createHash} from 'node:crypto';
import {localizedApplicationText} from '@ontomato/contracts/application-metadata';
import {productAssetInputSchema,productAssetSchema} from '@ontomato/contracts/product-assets';
import {getPostgresPool,qualifiedTable as t} from '../../infrastructure/postgres';
import {transaction} from '../../infrastructure/postgres-transaction';
import {backendGet,backendPost,buildBackendHeaders} from '../../utils/backend-client';
import {config} from '../../config/application';
import type {AssistantCredentials} from '../../platform/agent-runtime/runtime';
import {registerProductResource} from '../product-governance/grants';
import {ontologyRegistration,synchronizeProductOntology} from './ontology';
import {lockProducts} from './store';
import type {ProductOwner} from '../product-governance/grants';
import {migratePlatformProjection} from './platform-migration';
export async function nativeApplicationAsset(domain:string,assetId:string){
 const result=await getPostgresPool().query(`SELECT application_id FROM ${t('product_native_application_bindings')} WHERE domain_id=$1 AND asset_id=$2`,[domain,assetId]);
 return result.rows[0]?.application_id as string|undefined;
}
/** Reconcile catalog identities without replacing their execution engines or assigning execution roles. */
export async function synchronizePlatformAssets(owner:ProductOwner,credentials:AssistantCredentials){
 const response=await backendGet('platform-product-catalog',config.dataQuery.baseUrl+'/platform/applications?purpose=navigation',{headers:buildBackendHeaders(credentials.token,undefined,credentials.locale,credentials.apiKey),retries:1,timeoutMs:15_000});
 const catalog=JSON.parse(response.text);if(!Array.isArray(catalog.data))throw new Error('Application catalog unavailable');
 const inserted:string[]=[];
 await transaction(async client=>{
  await lockProducts(client,owner);
  async function insert(id:string,name:string,description:string,document:unknown){
   const exists=await client.query(`SELECT 1 FROM ${t('product_assets')} WHERE domain_id=$1 AND id=$2`,[owner.domainId,id]);if(exists.rows.length)return;
   const input=productAssetInputSchema.parse({name,description:description.slice(0,2000),document});
   await registerProductResource(owner,id,true,{createOnly:true});
   const saved=await client.query(`INSERT INTO ${t('product_assets')}(domain_id,id,owner_id,name,description,visibility,document) VALUES($1,$2,$3,$4,$5,'private',$6::jsonb) RETURNING revision,created_at,updated_at`,[owner.domainId,id,owner.userId,input.name,input.description,JSON.stringify(input.document)]);
   const row=saved.rows[0];const asset=productAssetSchema.parse({...input,id,ownerId:owner.userId,revision:row.revision,createdAt:row.created_at.toISOString(),updatedAt:row.updated_at.toISOString(),editable:true});
   await client.query(`INSERT INTO ${t('product_asset_revisions')}(domain_id,asset_id,revision,asset) VALUES($1,$2,$3,$4::jsonb)`,[owner.domainId,id,row.revision,JSON.stringify(asset)]);
   const registration=ontologyRegistration(asset);if(registration)await client.query(`INSERT INTO ${t('product_ontology_outbox')}(domain_id,asset_id,revision,registration) VALUES($1,$2,$3,$4::jsonb) ON CONFLICT(domain_id,asset_id) DO UPDATE SET revision=EXCLUDED.revision,registration=EXCLUDED.registration`,[owner.domainId,id,row.revision,JSON.stringify(registration)]);
   inserted.push(id);
  }
  for(const app of catalog.data){
   if(app.entry.renderer==='panels')continue;
   const already=await client.query(`SELECT 1 FROM ${t('product_assets')} WHERE domain_id=$1 AND (id=$2 OR document->>'applicationId'=$2) LIMIT 1`,[owner.domainId,app.id]);if(already.rows.length)continue;
   const suffix=createHash('sha256').update(app.id).digest('hex').slice(0,24),id='platform-application-'+suffix;
   const name=localizedApplicationText(app.names,credentials.locale??'zh-CN')??app.id;
   await client.query(`INSERT INTO ${t('product_native_application_bindings')}(domain_id,asset_id,application_id) VALUES($1,$2,$3) ON CONFLICT DO NOTHING`,[owner.domainId,id,app.id]);
    await insert(id,name,localizedApplicationText(app.descriptions,credentials.locale??'zh-CN')??'',{kind:'application',applicationId:app.id,children:[]});
  }
 });
  await synchronizeProductOntology(owner);
 const legacy=await getPostgresPool().query(`SELECT id,revision,document FROM ${t('product_assets')} WHERE domain_id=$1 AND owner_id=$2 AND document->>'kind'='widget' AND document->'widget'->>'kind'='platform'`,[owner.domainId,owner.userId]);
 for(const row of legacy.rows){
  if(row.document.widget.source!=='assistant')await migratePlatformProjection(owner,credentials,row.id,row.revision);
 }
 return {created:inserted};
}
