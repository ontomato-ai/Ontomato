import {z} from 'zod';
import type {ProductOwner} from '../product-governance/grants';
import type {AssistantCredentials} from '../../platform/agent-runtime/runtime';
import {HttpError} from '../../utils/errors';
import {AsyncLocalStorage} from 'node:async_hooks';
import type {PersonalWorkspace} from '@ontomato/contracts/personal-workspace';
const preferencesContext=new AsyncLocalStorage<PersonalWorkspace>();
export function platformProjectionPreferences(){return preferencesContext.getStore();}
export function withPlatformProjectionPreferences<T>(preferences:PersonalWorkspace|undefined,read:()=>Promise<T>){return preferences?preferencesContext.run(structuredClone(preferences),read):read();}

export interface PlatformObjectProvider {
  objectType:string;
  name:string;
  fields:Readonly<Record<string,'string'|'number'|'boolean'>>;
  parameters:z.ZodType<Record<string,unknown>>;
  read(owner:ProductOwner,credentials:AssistantCredentials,parameters:Record<string,unknown>):Promise<Record<string,unknown>[]>;
}
const providers=new Map<string,PlatformObjectProvider>();
/** Registration belongs to assembly; saved product configuration cannot create executable providers. */
export function registerPlatformObject(provider:PlatformObjectProvider){
  if(!provider.objectType.startsWith('platform:')||providers.has(provider.objectType))throw new Error('Invalid or duplicate platform ObjectType');
  providers.set(provider.objectType,provider);
}
export function platformObjectTypes(){return [...providers.values()].map(({objectType,name,fields})=>({objectType,name,fields}));}
export function platformObjectProvider(objectType:string){
  const provider=providers.get(objectType);if(!provider)throw new HttpError(404,'Platform ObjectType unavailable','PLATFORM_OBJECT_UNAVAILABLE');return provider;
}
export async function readPlatformObjects(owner:ProductOwner,credentials:AssistantCredentials,objectType:string,parameters:Record<string,unknown>,fields:string[]){
  const provider=platformObjectProvider(objectType);
  if(fields.some(field=>!Object.hasOwn(provider.fields,field)))throw new HttpError(400,'Unknown platform object field','INVALID_PRODUCT_FIELD');
  const parsed=provider.parameters.parse(parameters);
  const rows=await provider.read(owner,credentials,parsed);
  for(const row of rows)for(const field of fields){const value=row[field];if(value!==undefined&&value!==null&&(typeof value!==provider.fields[field]||typeof value==='number'&&!Number.isFinite(value)))throw new HttpError(502,'Platform provider returned a value outside its published field contract','INVALID_PLATFORM_OBJECT_RESPONSE');}
  return rows.map(row=>Object.fromEntries(fields.map(field=>[field,row[field]??null])));
}
