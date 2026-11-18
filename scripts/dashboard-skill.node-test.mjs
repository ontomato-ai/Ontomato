import assert from "node:assert/strict";
import {test} from "node:test";
import {createServer} from "node:http";
import {execFile} from "node:child_process";
import {promisify} from "node:util";
import {mkdtemp,readFile,writeFile,rm} from "node:fs/promises";
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
function invoke(dir,base,args){return run(process.execPath,[cli,...args],{cwd:dir,env:{...process.env,ONTOMATO_WORKBENCH_URL:base,ONTOMATO_TK:"fixture-reader",ONTOMATO_API_KEY:"",ONTOMATO_SESSION_ID:sessionId,ONTOMATO_RUN_ID:runId,ONTOMATO_SKILL_SCENARIO:"platform"}});}

test("the standalone dashboard skill matches its shared schema source",async t=>{
  const dir=await workspace(t);await run(process.execPath,[path.join(root,"packages/workbench-server/dashboard-skill/build.mjs"),dir]);
  for(const file of ["scripts/dashboard-pages.mjs","licenses/zod-LICENSE.txt"])assert.equal(Buffer.compare(await readFile(path.join(dir,file)),await readFile(path.join(skill,file))),0);
});
test("draft returns only the page link for a combined card edit",async t=>{
  const dir=await workspace(t),api=await server(t);
  const chartFile={name:"staff.chart.json",content:{
    dataset:[{id:"metric",dimensions:["department","headcount"],source:[]}],
    series:[{id:"main",type:"bar",datasetId:"metric",encode:{x:"department",y:"headcount"}}],
    ontomato:{display:{displayLimit:3}},
  }};
  const form={id:"board:custom",groups:[{id:"group",title:"Staff",metrics:[],charts:[
    {id:"card",name:"Top three departments",chartFile,layout:{colSpan:6,rowSpan:1}},
  ]}]};
  const out="outputs/drafts/combined.page-draft.json";
  await writeFile(path.join(dir,"form.json"),JSON.stringify(form));
  const result=JSON.parse((await invoke(dir,api.base,["draft","--operation","dashboard.layout","--form","form.json","--out",out])).stdout);
  assert.deepEqual(Object.keys(result),["link"]);
  const draft=JSON.parse(await readFile(path.join(dir,out),"utf8"));
  assert.deepEqual(draft,{pageKey:"dashboard",operation:"dashboard.layout",target:{id:form.id},form});
  const href=result.link.match(/^\[[^\]]+\]\(([^)]+)\)$/)?.[1];
  assert.ok(href,"Draft output must include a clickable page link, not a file preview");
  const link=new URL(href,"http://page.test/");
  assert.equal(link.hash.split("?")[0],"#/dashboards");
  const query=new URLSearchParams(link.hash.split("?")[1]);
  assert.deepEqual([...query.keys()].sort(),["draftPath","draftRunId","draftSessionId"]);
  assert.equal(query.get("draftPath"),out);
  assert.equal(api.calls.length,0);
});
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
test("parameter drafts keep text and address the dashboard from dashboardId",async t=>{
  const dir=await workspace(t),api=await server(t);
  const form={dashboardId:"board",cardId:"card",revision:"r",values:{year:"2026"}};
  await writeFile(path.join(dir,"form.json"),JSON.stringify(form));
  await invoke(dir,api.base,["draft","--operation","dashboard.card.parameters","--form","form.json","--out","outputs/drafts/parameters.page-draft.json"]);
  const draft=JSON.parse(await readFile(path.join(dir,"outputs/drafts/parameters.page-draft.json"),"utf8"));
  assert.deepEqual(draft.target,{id:"board"});assert.deepEqual(draft.form,form);assert.equal(api.calls.length,0);
});
test("invalid forms fail before draft output or a save request",async t=>{
  const dir=await workspace(t),api=await server(t);
  await writeFile(path.join(dir,"form.json"),JSON.stringify({id:"board",chartId:"card",resultSetName:12}));
  for(const command of ["draft","save"])await assert.rejects(invoke(dir,api.base,[command,"--operation","dashboard.chart.rename","--form","form.json","--out","outputs/drafts/invalid.page-draft.json"]));
  await assert.rejects(readFile(path.join(dir,"outputs/drafts/invalid.page-draft.json")),{code:"ENOENT"});
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
