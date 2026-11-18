import { AgentChannel } from "../../channel";
import { createRuntimeHttp } from "../../http";
import { RuntimeError } from "../../errors";
import type { AgentRuntime } from "../../runtime";
import { runtimeIdSchema } from "@ontomato/contracts/agent-runtime-values";
import type { AddressInfo } from "node:net";

// A real runtime HTTP boundary with only its persistence replaced; no host implementation is imported.
const sessionId=runtimeIdSchema.parse(process.env.TEST_CHANNEL_SESSION_ID);
const actor={id:runtimeIdSchema.parse(process.env.TEST_CHANNEL_ACTOR_ID),domainId:"domain"};
const persistence={
  async session(scope:{hostId:string;domainId:string},id:string) {
    if(scope.hostId!=="workbench" || scope.domainId!=="domain" || id!==sessionId)throw new RuntimeError(404,"NOT_FOUND","Session not found");
  },
  table:(name:string)=>name,
  pool:{query:async()=>({rows:[{channel:{agent:{providerId:"workbench",agentId:"regular"},actor,parent:null}}]})},
};
const runtime={options:{hosts:[
  {id:"workbench",token:"workbench-service",providers:["workbench","ontology"],domainSkills:true},
  {id:"ontology",token:"ontology-service",providers:["ontology"],domainHistory:true,channelGateway:true},
],agentProviders:[{id:"workbench",hostId:"workbench",url:"http://unused",token:"query-service"}]},store:persistence,channel:null as unknown as AgentChannel};
runtime.channel=new AgentChannel(runtime as unknown as AgentRuntime);
const server=createRuntimeHttp(runtime as unknown as AgentRuntime).listen(0,"127.0.0.1",()=>{
  process.stdout.write(`GATEWAY_FIXTURE_READY http://127.0.0.1:${(server.address() as AddressInfo).port}\n`);
});
process.once("SIGTERM",()=>{server.closeAllConnections();server.close(()=>process.exit(0));});
