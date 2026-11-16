import type {RuntimeStartRunRequest} from '@ontomato/contracts/agent-runtime';
import type {AgentTool} from './core/pi/types';
import type {TSchema} from 'typebox';

export function productTools(request:RuntimeStartRunRequest,runId:string):AgentTool[]{
  const definitions=request.definition.productTools??[];
  if(!definitions.length)return [];
  const root=request.environment.values.ONTOMATO_WORKBENCH_URL;
  const credential=request.environment.secrets.ONTOMATO_PRODUCT_CALLBACK;
  if(!root||!credential)throw new Error('Product tool callback delegation is missing');
  const base=new URL(root);
  if(!['http:','https:'].includes(base.protocol)||base.search||base.hash||base.username||base.password)throw new Error('Invalid product callback origin');
  return definitions.map(definition=>({
    name:definition.name,label:definition.name,description:definition.description,parameters:definition.inputSchema as TSchema,
    async execute(_id,args,signal){
      const response=await fetch(new URL(base.toString().replace(/\/$/,'')+definition.path),{method:'POST',redirect:'error',headers:{'Content-Type':'application/json',tk:credential,'X-Ontomato-Run-Id':runId},body:JSON.stringify({parameters:args}),signal});
      const result=await response.json();
      return {content:[{type:'text' as const,text:JSON.stringify(result)}],details:{},isError:!response.ok};
    },
  }));
}
