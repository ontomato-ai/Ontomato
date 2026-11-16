import {z} from 'zod';
import type {ontologyParameterTypeSchema} from './product-projections';
import type {ProductAsset} from './product-assets';
type ParameterType=z.infer<typeof ontologyParameterTypeSchema>;
const objectSelectionSchema=z.object({className:z.string().min(1).max(200),primaryKey:z.string().trim().min(1).max(1000)}).strict();
export const productNavigationTargetSchema=z.union([
  z.object({pageId:z.string().min(1).max(200),params:z.record(z.unknown())}).strict(),
  z.object({objectViewId:z.string().min(1).max(200),object:objectSelectionSchema}).strict(),
]);
export type ProductNavigationTarget=z.infer<typeof productNavigationTargetSchema>;
export function pageParameterAcceptsPath(signature:Record<string,ParameterType>,path:string){
  const [name,...parts]=path.split('.');
  if(!Object.hasOwn(signature,name)||['__proto__','constructor','prototype'].includes(name))return false;
  if(!parts.length)return true;
  return signature[name].kind==='object'&&parts.length===1&&['className','primaryKey'].includes(parts[0]);
}
export function pageBindingType(signature:Record<string,ParameterType>,path:string):ParameterType|undefined{
  if(!pageParameterAcceptsPath(signature,path))return undefined;
  return path.includes('.')?{kind:'scalar',type:'string'}:signature[path];
}
export function pageParameterCompatible(source:ParameterType,target:ParameterType){
  return source.kind===target.kind&&(source.kind==='object'?target.kind==='object'&&source.objectType===target.objectType:target.kind==='scalar'&&source.type===target.type);
}
/** Navigation and selection share the same typed value contract. */
export function validatePageState(signature:Record<string,ParameterType>,values:Record<string,unknown>){
  if(!values||typeof values!=='object'||Array.isArray(values))throw new Error('Page state must be an object');
  for(const [name,value] of Object.entries(values)){
    const type=Object.hasOwn(signature,name)?signature[name]:undefined;if(!type)throw new Error(`Unknown page parameter: ${name}`);
    if(value===null)continue;
    if(type.kind==='object'){
      const object=value as {className?:unknown;primaryKey?:unknown};
      if(!object||object.className!==type.objectType||typeof object.primaryKey!=='string'||!object.primaryKey.trim()||Object.keys(object).some(key=>!['className','primaryKey'].includes(key)))throw new Error(`Invalid object reference: ${name}`);
    }else if(type.type==='date'){
      if(typeof value!=='string'||!Number.isFinite(Date.parse(value)))throw new Error(`Invalid date parameter: ${name}`);
    }else if(typeof value!==type.type||typeof value==='number'&&!Number.isFinite(value))throw new Error(`Invalid page parameter: ${name}`);
  }
  return values;
}
/** A published Navigation constrains transitions even when the target exists in the snapshot. */
export function validateProductNavigation(assets:ProductAsset[],pageId:string){
  const navigations=assets.filter(asset=>asset.document.kind==='navigation');
  if(navigations.length&&!navigations.some(asset=>asset.document.kind==='navigation'&&asset.document.nodes.some(node=>node.pageId===pageId)))throw new Error('Page is outside the published Navigation');
  const page=assets.find(asset=>asset.id===pageId);
  if(!page||page.document.kind!=='page'||page.document.isTemplate)throw new Error('Choose a published runnable Page');
  return page;
}
