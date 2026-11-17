import {z} from 'zod';
import {storedChartFileSchema} from './chart-data';
import {viewBindingSchema,objectViewDocumentSchema} from './object-views';

const id=z.string().min(1).max(200);
export const ontologyParameterTypeSchema=z.discriminatedUnion('kind',[
  z.object({kind:z.literal('object'),objectType:id}).strict(),
  z.object({kind:z.literal('scalar'),type:z.enum(['string','number','boolean','date'])}).strict(),
]);
const parameters=z.record(id,viewBindingSchema);
type DisplayFormat='number'|'text'|'date'|'percent'|'currency';
const format=z.object({kind:z.enum(['number','text','date','percent','currency']),decimals:z.number().int().min(0).max(12).optional(),locale:z.string().max(30).optional(),unit:z.string().max(30).optional()}).strict();
export const projectionDisplaySchema=z.object({sort:z.array(z.object({field:id,order:z.enum(['asc','desc'])}).strict()).max(20).optional(),limit:z.number().int().min(1).max(10000).optional(),colors:z.array(z.string().max(100)).max(100).optional(),formats:z.record(id,format).optional()}).strict();
export function projectionDisplayRows(rows:Record<string,unknown>[],display?:z.infer<typeof projectionDisplaySchema>){
  const result=[...rows];
  if(display?.sort?.length)result.sort((a,b)=>{for(const {field,order} of display.sort!){const first=a[field],second=b[field];const comparison=typeof first==='number'&&typeof second==='number'?first-second:String(first??'').localeCompare(String(second??''));if(comparison)return order==='desc'?-comparison:comparison;}return 0;});
  return display?.limit?result.slice(0,display.limit):result;
}
const base={isDefault:z.boolean().default(false),audience:z.enum(['human','agent','both']).default('both'),presentation:z.object({fieldLabels:z.record(z.string(),z.string()).default({}),fieldOptions:z.record(z.string(),z.array(z.object({value:z.string(),label:z.string()}).strict())).default({}),variable:z.string().regex(/^$|^[A-Za-z_][A-Za-z0-9_]*$/).refine(value=>!['__proto__','constructor','prototype'].includes(value)).default('')}).strict().optional()};
/** Formatting preserves the value; calculated measures belong to MetricViews. */
export function formatProjectionValue(value:unknown,options?:{kind:DisplayFormat;decimals?:number;locale?:string;unit?:string}){
  if(value===null||value===undefined)return '—';
  if(!options||options.kind==='text')return String(value);
  try{
    if(options.kind==='date'){
      if(typeof value!=='string'&&typeof value!=='number')return String(value);
      const date=new Date(value);return Number.isFinite(date.getTime())?new Intl.DateTimeFormat(options.locale).format(date):String(value);
    }
    if(typeof value!=='number'||!Number.isFinite(value))return String(value);
    const result=new Intl.NumberFormat(options.locale,{maximumFractionDigits:options.decimals??6,minimumFractionDigits:options.decimals??0}).format(value);
    return result+(options.unit?` ${options.unit}`:options.kind==='percent'?' %':'');
  }catch{return String(value);}
}
export const metricProjectionSchema=z.object({kind:z.literal('metric-widget'),...base,renders:z.object({kind:z.literal('MetricView'),id}).strict(),renderer:z.enum(['number','chart','table']).default('number'),chartFile:storedChartFileSchema.optional(),parameters,fields:z.array(id).default([]),valueField:z.string().default(''),labelField:z.string().default(''),chartType:z.enum(['bar','line','donut']).default('bar'),format:format.optional(),display:projectionDisplaySchema.optional(),height:z.number().int().min(80).max(1200).default(240)}).strict();
export type MetricProjection = z.infer<typeof metricProjectionSchema>;
export type MetricChartProjection = MetricProjection & {renderer:'chart';chartFile:z.infer<typeof storedChartFileSchema>};
/** Narrow a parsed product document to its file-based chart presentation. */
export function isMetricChartProjection(document:{kind:string;renderer?:string;chartFile?:MetricProjection['chartFile']}):document is MetricChartProjection{
  return document.kind==='metric-widget'&&document.renderer==='chart'&&document.chartFile!==undefined;
}
export const actionProjectionSchema=z.object({kind:z.literal('action-view'),...base,renders:z.object({kind:z.literal('Action'),id}).strict(),renderer:z.enum(['form','button','dialog','inline']).default('form'),parameters,readOnlyParameters:z.array(id).default([])}).strict();
export const collectionProjectionSchema=z.object({kind:z.literal('collection-view'),...base,renders:z.object({kind:z.literal('Definition'),id}).strict(),renderer:z.enum(['table','list','3d-scene']).default('table'),parameters,fields:z.array(id).default([]),pageSize:z.number().int().min(1).max(50).optional()}).strict();
export const objectProjectionSchema=z.object({kind:z.literal('object-projection'),...base,renders:z.object({kind:z.literal('ObjectType'),id}).strict(),renderer:z.enum(['full','summary','card','text','3d']).default('full'),fields:z.array(id).default([]),primaryKey:z.string().max(1000).optional(),layout:objectViewDocumentSchema.optional()}).strict();
export const navigationSchema=z.object({kind:z.literal('navigation'),entry:id,nodes:z.array(z.object({id,pageId:id,label:z.string().max(200),path:z.string().regex(/^\/(?!\/)/)}).strict()).min(1).max(100)}).strict().refine(value=>new Set(value.nodes.map(node=>node.id)).size===value.nodes.length&&new Set(value.nodes.map(node=>node.path)).size===value.nodes.length&&value.nodes.some(node=>node.id===value.entry),'Navigation requires distinct nodes, distinct paths and a valid entry');
export const agentProfileSchema=z.object({kind:z.literal('agent-profile'),principalId:id,instructions:z.string().max(50000),tools:z.array(id).max(100).refine(ids=>new Set(ids).size===ids.length,'Duplicate tool projection'),contextViews:z.array(id).max(100).refine(ids=>new Set(ids).size===ids.length,'Duplicate context projection')}).strict();
