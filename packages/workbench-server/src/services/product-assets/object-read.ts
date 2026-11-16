import {getProduct,type ProductOwner} from './store';
import type {AssistantCredentials} from '../../platform/agent-runtime/runtime';
import {readPlatformObjects} from './platform-objects';
import {HttpError} from '../../utils/errors';
import {productAssetSchema,type ProductAsset} from '@ontomato/contracts/product-assets';
import {getPostgresPool,qualifiedTable as t} from '../../infrastructure/postgres';
import {backendPost,buildBackendHeaders} from '../../utils/backend-client';
import {config} from '../../config/application';

export async function readPlatformProjectionObject(owner:ProductOwner,credentials:AssistantCredentials,id:string,primaryKey:string,revision?:number){
  let asset=await getProduct(owner,id);
  if(revision!==undefined&&revision!==asset.revision){
    const archived=await getPostgresPool().query(`SELECT asset FROM ${t('product_asset_revisions')} WHERE domain_id=$1 AND asset_id=$2 AND revision=$3`,[owner.domainId,id,revision]);
    if(!archived.rows[0])throw new HttpError(409,'ObjectView revision unavailable','PRODUCT_RELEASE_UNPINNED');
    asset=productAssetSchema.parse(archived.rows[0].asset);
  }
  return readPlatformObjectAsset(owner,credentials,asset,primaryKey);
}
export async function readPlatformObjectAsset(owner:ProductOwner,credentials:AssistantCredentials,asset:ProductAsset,primaryKey:string){
  if(asset.document.kind!=='object-projection')throw new HttpError(400,'Expected ObjectView','INVALID_PRODUCT_TYPE');
  if(!asset.document.renders.id.startsWith('platform:')){
    const document=asset.document;
    const response=await backendPost('product-object-read',config.dataQuery.baseUrl+'/data/queryInfoByNode',{id:`${document.renders.id}:${primaryKey}`,class:document.renders.id},{headers:buildBackendHeaders(credentials.token,undefined,credentials.locale,credentials.apiKey),retries:1});
    const result=JSON.parse(response.text);
    if(result.success!==true||!result.data?.data)throw new HttpError(403,'Object unavailable','OBJECT_CONTEXT_UNAVAILABLE');
    const record=result.data.data as Record<string,unknown>;
    const primaryKeyField=result.data.classDef?.attrs?.find((attribute:{name:string;primaryKey?:boolean;primary_key?:boolean})=>attribute.primaryKey===true||attribute.primary_key===true)?.name;
    if(primaryKeyField)record[primaryKeyField]=primaryKey;
    const widgets=document.layout?.tabs.flatMap(tab=>tab.sections.flatMap(section=>section.widgets))??[];
    const fields=new Set([...document.fields,...(document.renderer==='full'?widgets.filter(widget=>widget.kind==='properties'&&!widget.resourceId).flatMap(widget=>widget.fields):[]),...(document.renderer==='full'&&document.layout?.titleField?[document.layout.titleField]:[])]);
    const allProperties=document.renderer==='full'&&widgets.some(widget=>widget.kind==='properties'&&!widget.resourceId&&!widget.fields.length);
    return {object:allProperties?record:Object.fromEntries([...fields].filter(field=>Object.hasOwn(record,field)).map(field=>[field,record[field]]))};
  }
  const layoutFields=asset.document.renderer==='full'?asset.document.layout?.tabs.flatMap(tab=>tab.sections.flatMap(section=>section.widgets.filter(widget=>widget.kind==='properties'&&!widget.resourceId).flatMap(widget=>widget.fields)))??[]:[];
  const fields=[...new Set(['id',...asset.document.fields,...layoutFields])];
  const rows=await readPlatformObjects(owner,credentials,asset.document.renders.id,{},fields);
  const object=rows.find(row=>row.id===primaryKey);
  if(!object)throw new HttpError(404,'Platform object unavailable','PLATFORM_OBJECT_UNAVAILABLE');
  return {object};
}
