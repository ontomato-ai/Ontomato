import assert from "node:assert/strict";
import {before,test} from "node:test";
import {createServer} from "node:http";
import {execFile} from "node:child_process";
import {promisify} from "node:util";
import {mkdtemp,writeFile,rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import path from "node:path";
import {fileURLToPath} from "node:url";
const run=promisify(execFile);
const root=fileURLToPath(new URL("../",import.meta.url));
const skill=path.join(root,"packages/workbench-server/skills/pages/dashboard-pages");
const cli=path.join(skill,"scripts/dashboard-pages.mjs");
const sessionId="00000000-0000-4000-8000-000000000001",runId="00000000-0000-4000-8000-000000000002";
async function workspace(t){const dir=await mkdtemp(path.join(tmpdir(),"dashboard-pages-"));t.after(()=>rm(dir,{recursive:true,force:true}));return dir;}
async function server(t,reply={success:true,data:{rows:[{value:0},{value:null}],truncation:{truncated:true,rowLimit:2,truncationHint:"Partial"}}}){
  const calls=[];
  const http=createServer(async(req,res)=>{let raw="";for await(const part of req)raw+=part;calls.push({path:req.url,method:req.method,headers:req.headers,body:raw?JSON.parse(raw):undefined});res.setHeader("content-type","application/json");res.end(JSON.stringify(reply));});
  await new Promise(resolve=>http.listen(0,"127.0.0.1",resolve));t.after(()=>new Promise(resolve=>http.close(resolve)));
  return {calls,base:`http://127.0.0.1:${http.address().port}`};
}
function invoke(dir,base,args,extraEnv={}){return run(process.execPath,[cli,...args],{cwd:dir,env:{...process.env,ONTOMATO_WORKBENCH_URL:base,ONTOMATO_TK:"fixture-reader",ONTOMATO_API_KEY:"",ONTOMATO_EXECUTION_CALLBACK:"",ONTOMATO_SESSION_ID:sessionId,ONTOMATO_RUN_ID:runId,ONTOMATO_SKILL_SCENARIO:"platform",...extraEnv}});}

before(async()=>{await run(process.execPath,[path.join(root,"packages/workbench-server/dashboard-skill/build.mjs")],{cwd:root});});
test("link addresses the saved dashboard and optionally its selected card",async t=>{
  const dir=await workspace(t);
  const dashboard={id:"board:1",name:"教职工 & 规模"};
  const card={id:"card:5",name:"Top 5 (staff)"};
  const api=await server(t,{data:{...dashboard,groups:[{charts:[card],metrics:[]}]}});
  const boardAddress={dashboardId:dashboard.id,dashboardName:dashboard.name};

  for(const [args,expected] of [
    [[],boardAddress],
    [["--card-id",card.id],{...boardAddress,cardId:card.id,cardName:card.name}],
  ]){
    const result=JSON.parse((await invoke(dir,api.base,["link","--dashboard-id",dashboard.id,...args])).stdout);
    const href=result.link.match(/^\[[^\]]+\]\(([^)]+)\)$/)?.[1];
    assert.ok(href);
    const [pathname,search]=href.split("?");
    assert.equal(pathname,"#/dashboards");
    assert.deepEqual(Object.fromEntries(new URLSearchParams(search)),expected);
  }
  assert.ok(api.calls.every(call=>call.method==="GET" && call.path==="/api/dashboards/board%3A1"));
});
test("invalid forms fail before a save request and draft command is rejected",async t=>{
  const dir=await workspace(t),api=await server(t);
  await writeFile(path.join(dir,"form.json"),JSON.stringify({id:"board",chartId:"card",resultSetName:12}));
  await assert.rejects(invoke(dir,api.base,["save","--operation","dashboard.chart.rename","--form","form.json"]));
  await assert.rejects(invoke(dir,api.base,["draft","--operation","dashboard.chart.rename","--form","form.json"]));
  assert.equal(api.calls.length,0);
});
test("save uses the original APIs and bodies without scenario blocking",async t=>{
  const dir=await workspace(t),api=await server(t);
  const actions=[
    ["dashboard.layout","/modifyLayout",{id:"board",groups:[]}],
    ["dashboard.rename","/modify",{id:"board",name:"New"}],
    ["dashboard.chart.rename","/modifyResultSetName",{id:"board",chartId:"card",resultSetName:"New"}],
    ["dashboard.metric.rename","/modifyMetricName",{id:"board",metricId:"number",metricName:"New"}],
    ["dashboard.group.rename","/modifyDimensionName",{id:"board",groupId:"group",dimensionName:"New"}],
    ["dashboard.card.parameters","/save-card-parameters",{dashboardId:"board",cardId:"card",revision:"r",values:{year:"2026"}}],
  ];
  for(const [operation,endpoint,form] of actions){
    await writeFile(path.join(dir,"form.json"),JSON.stringify(form));await invoke(dir,api.base,["save","--operation",operation,"--form","form.json"]);
    const actual=api.calls.at(-1);assert.equal(actual.method,"POST");assert.equal(actual.path,"/api/dashboards"+endpoint);assert.deepEqual(actual.body,form);assert.equal(actual.headers.tk,"fixture-reader");
  }
});
test("read commands retain current rows and truncation and use the supplied identity",async t=>{
  const dir=await workspace(t),api=await server(t);
  for(const args of [["list"],["read","--dashboard-id","board:1"],["card","--dashboard-id","board:1","--card-id","card"],["parameters","--dashboard-id","board:1","--card-id","card"]]){
    const result=JSON.parse((await invoke(dir,api.base,args)).stdout);assert.deepEqual(result.data.rows,[{value:0},{value:null}]);assert.equal(result.data.truncation.truncated,true);
  }
  assert.deepEqual(api.calls.map(call=>call.path),["/api/dashboards","/api/dashboards/board%3A1","/api/dashboards/query-card","/api/dashboards/card-parameter-form"]);
  assert.ok(api.calls.every(call=>call.headers.tk==="fixture-reader"));
});
test("background callback credential sends X-Ontomato-Callback-Credential and X-Ontomato-Run-Id",async t=>{
  const dir=await workspace(t),api=await server(t);
  const form={id:"board",name:"Scheduled Rename"};
  await writeFile(path.join(dir,"form.json"),JSON.stringify(form));
  await invoke(dir,api.base,["read","--dashboard-id","board:1"],{ONTOMATO_TK:"",ONTOMATO_EXECUTION_CALLBACK:"cb-token-123"});
  await invoke(dir,api.base,["save","--operation","dashboard.rename","--form","form.json"],{ONTOMATO_TK:"",ONTOMATO_EXECUTION_CALLBACK:"cb-token-123"});
  assert.equal(api.calls.length,2);
  for(const call of api.calls){
    assert.equal(call.headers["x-ontomato-callback-credential"],"cb-token-123");
    assert.equal(call.headers["x-ontomato-run-id"],runId);
    assert.equal(call.headers.tk,undefined);
  }
  assert.equal(api.calls[0].path,"/api/dashboards/board%3A1");
  assert.equal(api.calls[1].path,"/api/dashboards/modify");
  assert.deepEqual(api.calls[1].body,form);
});
