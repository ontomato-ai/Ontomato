import {createHash} from 'node:crypto';
import {createObjectView,objectViewDocumentSchema,type ObjectViewState} from '@ontomato/contracts/object-views';
import {getProduct,listProducts,saveProduct,lockProducts} from './store';
import type {ProductOwner} from '../product-governance/grants';
import type {AssistantCredentials} from '../../platform/agent-runtime/runtime';
import {backendPost,buildBackendHeaders} from '../../utils/backend-client';
import {config} from '../../config/application';
import {getPostgresPool,qualifiedTable as t} from '../../infrastructure/postgres';
import {productAssetSchema,type ProductAsset} from '@ontomato/contracts/product-assets';
import {HttpError} from '../../utils/errors';
import {transaction} from '../../infrastructure/postgres-transaction';
import {assertLegacyProductWrite} from './panel-boundary';

/** The old object editor is a client of product authoring; legacy class storage is read only during import. */
export async function objectViewAuthoring(owner:ProductOwner,credentials:AssistantCredentials,className:string,operation:'read'|'edit'|'save'|'publish',values:Record<string,unknown>={}):Promise<ObjectViewState>{
  const candidates=(await listProducts(owner)).filter(asset=>asset.document.kind==='object-projection'&&asset.document.renders.id===className&&asset.document.renderer==='full');
  const defaults=candidates.filter(asset=>asset.document.kind==='object-projection'&&asset.document.isDefault);
  if(defaults.length>1)throw new HttpError(409,'Choose the ObjectView asset explicitly; multiple defaults are visible','OBJECT_VIEW_AMBIGUOUS');
  let asset=defaults[0];
  const id=asset?.id??`object-view-${createHash('sha256').update(className).digest('hex').slice(0,40)}`;
  if(operation!=='read')await assertLegacyProductWrite(owner,credentials,{id});
  if(!asset&&operation!=='read'){
    try{const existing=await getProduct(owner,id);if(existing.document.kind!=='object-projection'||existing.document.renders.id!==className)throw new HttpError(409,'Default ObjectView identity is occupied','PRODUCT_CONFLICT');asset=existing;}
    catch(error){if(!(error instanceof HttpError)||error.status!==404)throw error;}
  }
  if(!asset){
    let layout=createObjectView(className);
    const response=await backendPost('legacy-object-view-import',config.dataQuery.baseUrl+(operation==='read'?'/objectView/read':'/objectView/edit'),{className,form:'full'},{headers:buildBackendHeaders(credentials.token,undefined,credentials.locale,credentials.apiKey),retries:1});
    const legacy=JSON.parse(response.text);
    if(legacy.success!==true)throw new HttpError(403,'ObjectView import unavailable','PRODUCT_FORBIDDEN');
    if(operation==='read')return legacy.data;
    if(operation!=='edit')throw new HttpError(409,'Open the product ObjectView editor before saving or publishing','PRODUCT_CONFLICT');
    const published=legacy.data?.versions?.find((version:{revision:number})=>version.revision===legacy.data.publishedRevision);
    const draft=legacy.data?.versions?.[0];
    if(draft)layout=objectViewDocumentSchema.parse(draft.document);
    else if(published)layout=objectViewDocumentSchema.parse(published.document);
    if(published&&draft&&published.revision!==draft.revision)throw new HttpError(409,'Migrate the published ObjectView asset before importing a separate legacy draft','PRODUCT_PRESENTATION_MIGRATION_REQUIRED');
    asset=await saveProduct(owner,id,{name:layout.title||className,description:'',visibility:'domain',document:{kind:'object-projection',renders:{kind:'ObjectType',id:className},renderer:'full',fields:[],layout,isDefault:true,audience:'both'}},0,credentials);
    if(published)await getPostgresPool().query(`INSERT INTO ${t('product_object_view_heads')} (domain_id,asset_id,revision) VALUES($1,$2,$3) ON CONFLICT DO NOTHING`,[owner.domainId,asset.id,asset.revision]);
  }
  if(operation!=='read'&&!asset.editable)throw new HttpError(403,'ObjectView edit Grant required','PRODUCT_FORBIDDEN');
  if(operation==='save'&&(!Number.isInteger(values.expectedRevision)||Number(values.expectedRevision)<1))throw new HttpError(400,'ObjectView expected revision is required','INVALID_REQUEST');
  if(operation==='save'){
    const layout=objectViewDocumentSchema.parse(values.document);
    if(layout.className!==className)throw new HttpError(400,'ObjectView class mismatch','INVALID_PRODUCT_TARGET');
    asset=await saveProduct(owner,id,{name:asset.name,description:asset.description,visibility:asset.visibility,document:{...asset.document,kind:'object-projection',renders:{kind:'ObjectType',id:className},renderer:'full',fields:asset.document.kind==='object-projection'?asset.document.fields:[],layout,isDefault:true,audience:'both'}},Number(values.expectedRevision),credentials);
  }
  if(operation==='publish'){
    if(Number(values.expectedRevision)!==asset.revision)throw new HttpError(409,'ObjectView changed; reload first','PRODUCT_CONFLICT');
    const revision=Number(values.revision);
    if(!Number.isInteger(revision)||revision<1)throw new HttpError(400,'Select an ObjectView revision','INVALID_REQUEST');
    if(revision!==asset.revision){
      const result=await getPostgresPool().query(`SELECT asset FROM ${t('product_asset_revisions')} WHERE domain_id=$1 AND asset_id=$2 AND revision=$3`,[owner.domainId,id,revision]);
      if(!result.rows[0])throw new HttpError(404,'ObjectView revision unavailable','PRODUCT_RELEASE_UNPINNED');
      const source=productAssetSchema.parse(result.rows[0].asset);
      if(source.document.kind!=='object-projection')throw new HttpError(400,'Expected an ObjectView revision','INVALID_PRODUCT_TYPE');
    }
    await transaction(async client=>{
      await lockProducts(client,owner);
      const current=await getProduct(owner,id,client);
      if(!current.editable)throw new HttpError(403,'ObjectView edit Grant required','PRODUCT_FORBIDDEN');
      if(current.revision!==Number(values.expectedRevision))throw new HttpError(409,'ObjectView changed during publication','PRODUCT_CONFLICT');
      await client.query(`INSERT INTO ${t('product_object_view_heads')} (domain_id,asset_id,revision) VALUES($1,$2,$3) ON CONFLICT(domain_id,asset_id) DO UPDATE SET revision=EXCLUDED.revision`,[owner.domainId,id,revision]);
    });
  }
  const rows=await getPostgresPool().query(`SELECT asset FROM ${t('product_asset_revisions')} WHERE domain_id=$1 AND asset_id=$2 AND (revision IN (SELECT revision FROM ${t('product_asset_revisions')} WHERE domain_id=$1 AND asset_id=$2 ORDER BY revision DESC LIMIT 100) OR revision=(SELECT revision FROM ${t('product_object_view_heads')} WHERE domain_id=$1 AND asset_id=$2)) ORDER BY revision DESC`,[owner.domainId,id]);
  const revisions=[asset,...rows.rows.map(row=>productAssetSchema.parse(row.asset))].filter((value,index,all)=>all.findIndex(item=>item.revision===value.revision)===index).sort((a,b)=>b.revision-a.revision);
  const versions=revisions.flatMap((value:ProductAsset)=>value.document.kind==='object-projection'&&value.document.layout?[{revision:value.revision,createdAt:Date.parse(value.updatedAt),author:value.ownerId,description:value.description,document:value.document.layout}]:[]);
  const head=await getPostgresPool().query(`SELECT revision FROM ${t('product_object_view_heads')} WHERE domain_id=$1 AND asset_id=$2`,[owner.domainId,id]);
  const publishedRevision=head.rows[0]?.revision??null;
  if(publishedRevision!==null&&!versions.some(version=>version.revision===publishedRevision))throw new HttpError(409,'Published ObjectView revision unavailable','PRODUCT_RELEASE_UNPINNED');
  await getProduct(owner,id);
  const published=publishedRevision===null?undefined:revisions.find(value=>value.revision===publishedRevision);
  return {assetId:asset.id,revision:asset.revision,publishedRevision,...(operation==='read'&&published?{publishedAsset:{...published,editable:asset.editable}}:{}),versions:operation==='read'?versions.filter(version=>version.revision===publishedRevision):versions};
}
