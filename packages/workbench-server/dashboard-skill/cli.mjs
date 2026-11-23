#!/usr/bin/env node
import {parseArgs} from "node:util";
import {readFile} from "node:fs/promises";
import {dashboardAuthoring,dashboardOperationSchema,dashboardCardRequestSchema} from "../../contracts/src/dashboard.ts";

const {values,positionals}=parseArgs({allowPositionals:true,options:{
  "dashboard-id":{type:"string"},"card-id":{type:"string"},operation:{type:"string"},form:{type:"string"},
}});
const [command]=positionals,env=process.env;
async function call(endpoint,body){
  if(!env.ONTOMATO_WORKBENCH_URL)throw new Error("Set ONTOMATO_WORKBENCH_URL to the platform base before /api");
  const headers={"Content-Type":"application/json"};
  for(const [variable,header] of [["ONTOMATO_TK","tk"],["ONTOMATO_API_KEY","X-API-Key"],["ONTOMATO_EXECUTION_CALLBACK","X-Ontomato-Callback-Credential"],["ONTOMATO_LANGUAGE","Accept-Language"],["ONTOMATO_SESSION_ID","X-Ontomato-Session-Id"],["ONTOMATO_RUN_ID","X-Ontomato-Run-Id"],["ONTOMATO_CORRELATION_ID","X-Correlation-Id"]])if(env[variable])headers[header]=env[variable];
  const response=await fetch(env.ONTOMATO_WORKBENCH_URL.replace(/\/$/,"")+"/api/dashboards"+endpoint,{method:body===undefined?"GET":"POST",headers,body:body===undefined?undefined:JSON.stringify(body),redirect:"error"});
  const text=await response.text();
  if(!response.ok)throw new Error(`HTTP ${response.status}: ${text}`);
  return JSON.parse(text);
}
function readDashboard(dashboardId){
  return call("/"+encodeURIComponent(dashboardCardRequestSchema.shape.dashboardId.parse(dashboardId)));
}
function dashboardLink(label,query){
  return `[${label}](#/dashboards?${query})`;
}
async function run(){
  if(command==="list")return call("");
  if(command==="read")return readDashboard(values["dashboard-id"]);
  if(command==="link"){
    const cardId=dashboardCardRequestSchema.shape.cardId.optional().parse(values["card-id"]);
    const {data:dashboard}=await readDashboard(values["dashboard-id"]);
    const query=new URLSearchParams({dashboardId:dashboard.id,dashboardName:dashboard.name});
    if(cardId!==undefined){
      const card=dashboard.groups.flatMap(group=>[...group.charts,...group.metrics]).find(item=>item.id===cardId);
      if(!card)throw new Error(`Card ${cardId} is not on dashboard ${dashboard.id}`);
      query.set("cardId",card.id);
      query.set("cardName",card.name);
    }
    return {link:dashboardLink("Open dashboard",query)};
  }
  if(command==="card"||command==="parameters"){
    const body=dashboardCardRequestSchema.parse({dashboardId:values["dashboard-id"],cardId:values["card-id"]});
    return call(command==="card"?"/query-card":"/card-parameter-form",body);
  }
  if(command!=="save")throw new Error("Use list, read, link, card, parameters or save; see SKILL.md");
  const operation=dashboardOperationSchema.parse(values.operation);
  const input=JSON.parse(await readFile(values.form.replace(/^@/,""),"utf8"));
  const action=dashboardAuthoring[operation],form=action.schema.parse(input);
  return call(action.path,form);
}
run().then(result=>console.log(JSON.stringify(result,null,2))).catch(error=>{console.error(error.message);process.exitCode=1;});
