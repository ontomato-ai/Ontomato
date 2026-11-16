import {createHash} from 'node:crypto';
import type {RuntimeStartRunRequest} from '@ontomato/contracts/agent-runtime';
import type {assembleAgentProfile} from './agent-profile';

export function profileRuntimeTools(profile:Pick<Awaited<ReturnType<typeof assembleAgentProfile>>,'id'|'tools'>&{releaseId:string},sessionId?:string):NonNullable<RuntimeStartRunRequest['definition']['productTools']>{
  return profile.tools.map(tool=>({
    name:'product_'+createHash('sha256').update(tool.assetId).digest('hex').slice(0,24),
    description:`${tool.name}${'description' in tool&&tool.description?' — '+tool.description:''}`,
    inputSchema:{type:'object',properties:Object.fromEntries(('parameters' in tool&&Array.isArray(tool.parameters)?tool.parameters:[]).map((parameter:Record<string,unknown>)=>{
      const name=String(parameter.key??parameter.name);
      const type=String(parameter.type??'string');
      const scalar=type==='TYPE_NUMBER'?'number':type==='boolean'?'boolean':type==='number'?'number':type==='TYPE_ONTOOBJ'||type==='TYPE_VECTOR'?'object':'string';
      const schema:Record<string,unknown>=tool.kind!=='action'&&(type.endsWith('_ARRAY')||type==='TYPE_DATASET')?{type:'array',items:{type:type==='TYPE_NUMBER_ARRAY'?'number':type==='TYPE_DATASET'?'object':'string'}}:{type:tool.kind==='action'?'string':scalar};
      if(type==='select'&&Array.isArray(parameter.options))schema.enum=parameter.options.filter((option:{disabled?:boolean})=>!option.disabled).map((option:{value:string})=>option.value);
      return [name,{...schema,description:String(parameter.help??parameter.description??name),...(Object.hasOwn(parameter,'defaultValue')&&parameter.defaultValue!==null?{default:parameter.defaultValue}:Object.hasOwn(parameter,'value')&&parameter.value!==null?{default:parameter.value}:{})}];
    })),required:('parameters' in tool&&Array.isArray(tool.parameters)?tool.parameters:[]).filter((parameter:Record<string,unknown>)=>parameter.required===true).map((parameter:Record<string,unknown>)=>String(parameter.key??parameter.name)),additionalProperties:false},
    path:`/api/product-assets/${encodeURIComponent(profile.id)}/releases/${encodeURIComponent(profile.releaseId)}/tools/${encodeURIComponent(tool.assetId)}${sessionId?'?sessionId='+encodeURIComponent(sessionId):''}`,
  }));
}
