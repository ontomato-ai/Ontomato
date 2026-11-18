import { onMounted, ref } from 'vue';
import { assistantAgentListSchema } from '@ontomato/contracts/assistant-chat';
import {useManagerClient} from '../context';

/** An agent of this domain, as the platform's directory names it: what a product's profile refers to. */
export interface AgentChoice { id:string; name:string; description:string }

/**
 * The domain's agents, for choosing which one a product's profile refers to. The assembly already serves the agent
 * platform's own directory to this application, so the list is read from there and nothing new is opened across
 * packages; the answer is the directory's contract, and a read that fails keeps the reason the reader has to see.
 */
export function useAgentChoices(){
 const client=useManagerClient(), agents=ref<AgentChoice[]>([]), loading=ref(true), failure=ref<string|null>(null);
 async function read(){
  loading.value=true;failure.value=null;
  try{
   const list=assistantAgentListSchema.parse(await (await client.request('/assistant/agents',{},'')).json());
   agents.value=list.agents.map(agent=>({id:agent.id,name:agent.name,description:agent.description}));
  }catch(error){
   failure.value=error instanceof Error?error.message:String(error);
  }finally{loading.value=false;}
 }
 onMounted(()=>void read());
 return {agents,loading,failure,read};
}
