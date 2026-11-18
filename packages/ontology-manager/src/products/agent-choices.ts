import { onMounted, ref } from 'vue';
import {useManagerClient} from '../context';

/** An agent of this domain, as the platform's directory names it: what a product's profile refers to. */
export interface AgentChoice { id:string; name:string; description?:string }

/**
 * The domain's agents, for choosing which one a product's profile refers to. The assembly already serves the agent
 * platform's own directory to this application (the same call that resolves member and role names), so the list is read
 * from there and nothing new is opened across packages.
 */
export function useAgentChoices(){
 const client=useManagerClient(), agents=ref<AgentChoice[]>([]), loading=ref(true), failed=ref(false);
 onMounted(async()=>{
  try{
   const value=await (await client.request('/assistant/agents',{},'')).json() as {agents?:Record<string,unknown>[]};
   agents.value=(value.agents??[]).flatMap(row=>typeof row.id==='string'&&typeof row.name==='string'?[{id:row.id,name:row.name,...(typeof row.description==='string'?{description:row.description}:{})}]:[]);
  }catch{failed.value=true;}
  finally{loading.value=false;}
 });
 return {agents,loading,failed};
}
