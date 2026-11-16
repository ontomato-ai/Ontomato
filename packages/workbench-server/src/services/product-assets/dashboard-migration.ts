import {createHash} from 'node:crypto';
import {isMetricReferenceEntry} from '@ontomato/contracts/dashboard';
import {productAssetInputSchema} from '@ontomato/contracts/product-assets';
import {getOwnedDashboard} from '../dashboard/access';
import {getProduct,saveProduct,type ProductOwner} from './store';
import type {AssistantCredentials} from '../../platform/agent-runtime/runtime';
import {HttpError} from '../../utils/errors';
import {isDeepStrictEqual} from 'node:util';

/** Migrate only capability-backed cards; never carry a historical calculation into a Page. */
export async function migrateDashboardPage(owner:ProductOwner,credentials:AssistantCredentials,id:string,revision:number){
  const source=await getProduct(owner,id);
  if(!source.editable)throw new HttpError(403,'Product edit Grant required','PRODUCT_FORBIDDEN');
  if(source.revision!==revision)throw new HttpError(409,'Dashboard changed; reload first','PRODUCT_CONFLICT');
  if(source.document.kind!=='dashboard')throw new HttpError(400,'Choose a historical dashboard asset','INVALID_PRODUCT_TYPE');
  if(source.ownerId&&source.ownerId!==owner.userId)throw new HttpError(403,'Personal dashboards must be migrated by their owner','PRODUCT_FORBIDDEN');
  const dashboard=await getOwnedDashboard(owner.userId,owner.domainId,source.document.dashboardId);
  const children=dashboard.groups.flatMap(group=>[...group.metrics,...group.charts].map(card=>{
    if(!isMetricReferenceEntry(card))throw new HttpError(409,'Publish legacy dashboard calculations as MetricViews before migration','LEGACY_INLINE_LOGIC');
    const chart='chartType' in card;
    if(chart&&!['bar','line','pie','gauge'].includes(card.chartType))throw new HttpError(409,'This dashboard renderer requires a product renderer before migration','PRODUCT_RENDERER_MIGRATION_REQUIRED');
    const formats=Object.fromEntries(Object.entries(card.formats??{}).map(([field,format])=>{
      if(format.kind==='percent'&&format.scale!==1)throw new HttpError(409,'Publish percentage scaling as a MetricView before migration','PRODUCT_PRESENTATION_MIGRATION_REQUIRED');
      return [field,{kind:format.kind,decimals:format.decimals,...(format.currency?{unit:format.currency}:{})}];
    }));
    const mapping=chart?card.fields:{};
    const valueField=chart?mapping.yAxis??mapping.value:card.valueField;
    const labelField=chart?mapping.xAxis??mapping.name:'';
    if(typeof valueField!=='string'||chart&&card.chartType!=='gauge'&&typeof labelField!=='string')throw new HttpError(409,'Dashboard requires scalar field mappings','PRODUCT_PRESENTATION_MIGRATION_REQUIRED');
    return {id:`dashboard-projection-${createHash('sha256').update(`${id}:${group.id}:${card.id}`).digest('hex').slice(0,40)}`,input:productAssetInputSchema.parse({name:card.name,description:group.title,visibility:'private',document:{kind:'metric-widget',renders:{kind:'MetricView',id:card.query.metricId},renderer:chart?card.chartType==='gauge'?'gauge':'chart':'number',chartType:chart?card.chartType==='pie'?'donut':card.chartType==='line'?'line':'bar':undefined,parameters:Object.fromEntries(Object.entries(card.query.parameters).map(([name,value])=>[name,{source:'literal',value}])),fields:[],valueField,labelField:labelField??'',display:{sort:card.sort,limit:card.displayLimit,colors:card.style?.colors,formats},format:formats[valueField]??(!chart&&card.unit?{kind:'number',unit:card.unit}:undefined)}}),width:Math.max(1,Math.min(12,Math.round(card.layout?.colSpan??12)))};
  }));
  for(const child of children){
    let current;try{current=await getProduct(owner,child.id);}catch(error){if(!(error instanceof HttpError)||error.status!==404)throw error;}
    if(!current)await saveProduct(owner,child.id,child.input,0,credentials);
    else if(current.document.kind!=='metric-widget'||!isDeepStrictEqual(current.document,child.input.document))throw new HttpError(409,'Migrated dashboard child was edited; resolve it before retrying','PRODUCT_CONFLICT');
  }
  return saveProduct(owner,id,{name:source.name,description:source.description,visibility:'private',document:{kind:'page',layout:{mode:'grid',mainWidth:12,gap:'normal'},children:children.map(child=>({assetId:child.id,column:'main',width:child.width})),embeddable:true}},revision,credentials,true);
}
