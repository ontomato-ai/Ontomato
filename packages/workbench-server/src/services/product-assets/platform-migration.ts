import {productAssetInputSchema} from '@ontomato/contracts/product-assets';
import {getProduct,listProducts,saveProduct,lockProducts,type ProductOwner} from './store';
import {getPostgresPool,qualifiedTable as t} from '../../infrastructure/postgres';
import type {AssistantCredentials} from '../../platform/agent-runtime/runtime';
import {HttpError} from '../../utils/errors';
import {platformObjectProvider} from './platform-objects';
import {activeProductBundle} from './releases';
import {personalWorkspaceSchema} from '@ontomato/contracts/personal-workspace';
import {transaction} from '../../infrastructure/postgres-transaction';
import {createHash} from 'node:crypto';

/** Explicit migration preserves the old placement identity and delegates content to open platform objects. */
export async function migratePlatformProjection(owner:ProductOwner,credentials:AssistantCredentials,id:string,revision:number,profileId?:string){
  const source=await getProduct(owner,id);
  if(!source.editable)throw new HttpError(403,'Product edit permission required','PRODUCT_FORBIDDEN');
  if(source.revision!==revision)throw new HttpError(409,'Asset changed; reload before migrating','PRODUCT_CONFLICT');
  if(source.document.kind!=='widget'||source.document.widget.kind!=='platform')throw new HttpError(400,'Choose a legacy platform widget','INVALID_PRODUCT_TYPE');
  const mapping:Record<string,{objectType:string;fields:string[]}>= {
    tasks:{objectType:'platform:Task',fields:['title','enabled','pause','pauseMessage','resultSummary','resultPath']},
    conversations:{objectType:'platform:Conversation',fields:['title','updatedAt','agentId','pinned']},
    objects:{objectType:'platform:Favorite',fields:['title','className','primaryKey']},
    recent:{objectType:'platform:RecentVisit',fields:['title','visitedAt','path']},
    apps:{objectType:'platform:FavoriteApplication',fields:['name','description','path']},
    data:{objectType:'platform:Dashboard',fields:['name','updatedAt']},
  };
  if(source.document.widget.source==='assistant'){
    if(!profileId)throw new HttpError(409,'Select a published AgentProfile for this conversation panel','PRODUCT_PROFILE_REQUIRED');
    const profile=await getProduct(owner,profileId);
    if(profile.document.kind!=='agent-profile')throw new HttpError(400,'Choose an AgentProfile','INVALID_AGENT_PROFILE');
    await activeProductBundle(owner,profileId,credentials);
    return saveProduct(owner,id,productAssetInputSchema.parse({name:source.name,description:source.description,visibility:source.visibility,document:{kind:'page',children:[{assetId:profileId}]}}),revision,credentials,true);
  }
  const target=mapping[source.document.widget.source];
  if(!target)throw new HttpError(409,'Migrate dashboard or application content to product Page projections before replacing this entry','PRODUCT_UNPINNABLE_DEPENDENCY');
  const homePreferences=await getPostgresPool().query(`SELECT overlay.preferences FROM ${t('product_home')} home JOIN ${t('product_user_overlays')} overlay ON overlay.domain_id=home.domain_id AND overlay.principal_id=home.user_id AND overlay.page_id=home.asset_id WHERE home.domain_id=$1 AND home.user_id=$2 AND EXISTS(SELECT 1 FROM ${t('product_assets')} page CROSS JOIN LATERAL jsonb_array_elements(COALESCE(page.document->'children','[]'::jsonb)) child WHERE page.domain_id=home.domain_id AND page.id=home.asset_id AND child->>'assetId'=$3)`,[owner.domainId,source.ownerId,id]);
  const effectivePreferences=homePreferences.rows[0]?.preferences?personalWorkspaceSchema.parse(homePreferences.rows[0].preferences):source.document.widget.workspace;
  if(source.document.widget.source==='data'&&Object.values(effectivePreferences?.dashboardCards??{}).some(cards=>cards.length))throw new HttpError(409,'Migrate selected dashboard cards to Page projections before replacing this collection','PRODUCT_PRESENTATION_MIGRATION_REQUIRED');
  const agentIds=source.document.widget.source==='apps'?effectivePreferences?.agentIds??[]:[];
  const profiles=[];
  if(agentIds.length){
    const assets=await listProducts(owner);
    for(const principalId of agentIds){
      const candidates=assets.filter(asset=>asset.document.kind==='agent-profile'&&asset.document.principalId===principalId);
      const published=[];
      for(const candidate of candidates)try{await activeProductBundle(owner,candidate.id,credentials);published.push(candidate);}catch(error){if(!(error instanceof HttpError)||error.code!=='PRODUCT_RELEASE_UNPINNED')throw error;}
      if(published.length!==1)throw new HttpError(409,'Each Agent shortcut requires exactly one accessible published Profile','PRODUCT_PROFILE_REQUIRED');
      profiles.push(published[0]);
    }
  }
  platformObjectProvider(target.objectType);
  const definitionId='platform-members:'+target.objectType;
  const existing=await getPostgresPool().query(`SELECT definition FROM ${t('business_definitions')} WHERE domain_id=$1 AND id=$2`,[owner.domainId,definitionId]);
  if(existing.rows[0]&&(existing.rows[0].definition.status!=='PUBLISHED'||existing.rows[0].definition.objectType!==target.objectType||existing.rows[0].definition.predicate||existing.rows[0].definition.parameters?.length))throw new HttpError(409,'Reserved platform Definition identity contains another contract','INVALID_DEFINITION');
  if(effectivePreferences){
    const preferences=personalWorkspaceSchema.parse(effectivePreferences);
    await transaction(async client=>{
      await lockProducts(client,owner);
      const current=await client.query(`SELECT owner_id,revision FROM ${t('product_assets')} WHERE domain_id=$1 AND id=$2`,[owner.domainId,id]);
      if(current.rows[0]?.revision!==revision)throw new HttpError(409,'Asset changed during preference migration','PRODUCT_CONFLICT');
      await client.query(`INSERT INTO ${t('product_user_overlays')} (domain_id,principal_id,page_id,preferences) VALUES($1,$2,$3,$4::jsonb) ON CONFLICT DO NOTHING`,[owner.domainId,source.ownerId,id,JSON.stringify(preferences)]);
    });
  }
  await getPostgresPool().query(`INSERT INTO ${t('business_definitions')} (domain_id,id,status,definition) VALUES($1,$2,'PUBLISHED',$3::jsonb) ON CONFLICT DO NOTHING`,[owner.domainId,definitionId,JSON.stringify({id:definitionId,name:target.objectType,objectType:target.objectType,revision:1,status:'PUBLISHED',parameters:[]})]);
  const projection=productAssetInputSchema.parse({name:source.name,description:source.description,visibility:source.visibility,document:{kind:'collection-view',renders:{kind:'Definition',id:definitionId},renderer:'list',parameters:{},fields:target.fields,pageSize:source.document.widget.limit??4,isDefault:true}});
  if(!profiles.length)return saveProduct(owner,id,projection,revision,credentials,true);
  const childId=`platform-projection-${createHash('sha256').update(id).digest('hex').slice(0,40)}`;
  let child;try{child=await getProduct(owner,childId);}catch(error){if(!(error instanceof HttpError)||error.status!==404)throw error;}
  if(!child)await saveProduct(owner,childId,projection,0,credentials);
  else if(child.document.kind!=='collection-view'||child.document.renders.id!==definitionId)throw new HttpError(409,'Platform migration child identity is occupied','PRODUCT_CONFLICT');
  if(effectivePreferences)await getPostgresPool().query(`INSERT INTO ${t('product_user_overlays')} (domain_id,principal_id,page_id,preferences) SELECT domain_id,principal_id,$4,preferences FROM ${t('product_user_overlays')} WHERE domain_id=$1 AND principal_id=$2 AND page_id=$3 ON CONFLICT DO NOTHING`,[owner.domainId,source.ownerId,id,childId]);
  return saveProduct(owner,id,productAssetInputSchema.parse({name:source.name,description:source.description,visibility:source.visibility,document:{kind:'page',children:[{assetId:childId},...profiles.map(profile=>({assetId:profile.id}))]}}),revision,credentials,true);
}
