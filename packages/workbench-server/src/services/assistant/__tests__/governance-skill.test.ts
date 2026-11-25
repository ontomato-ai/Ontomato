import { afterEach, beforeEach, expect, it } from "vitest";
import { createServer, type Server } from "node:http";
import { once } from "node:events";
import type { AddressInfo } from "node:net";
import { mkdtemp, rm, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
const execute=promisify(execFile),script=path.resolve("../../agent-skills/knowledge-governance/scripts/governance.mjs");
const id="11111111-1111-4111-8111-111111111111",run="22222222-2222-4222-8222-222222222222";
let server:Server,directory:string,url:string,windowRun:string;
let calls:Array<{path:string;token?:string;run?:string;callback?:string}>;
beforeEach(async()=>{
  directory=await mkdtemp(path.join(tmpdir(),"governance-skill-"));calls=[];windowRun=run;
  server=createServer(async(req,res)=>{
    for await(const _chunk of req) { /* Consume the request before responding. */ }
    calls.push({path:req.url!,token:req.headers.tk as string,run:req.headers["x-ontomato-run-id"] as string,...(req.headers["x-ontomato-callback-credential"]?{callback:req.headers["x-ontomato-callback-credential"] as string}:{})});
    res.setHeader("content-type","application/json");
    if(req.url==="/admin/getBussinessKnowledge")res.end(JSON.stringify({success:true,data:{existing:{knowledgeID:"existing",knowledgeTitle:"Original",knowledgeText:"Old text",knowledgeTags:["retained"],status:1}}}));
    else if(req.url==="/window")res.end(JSON.stringify({id,sessionId:id,runId:windowRun,expiresAt:new Date(Date.now()+60_000).toISOString(),token:"governance-grant"}));
    else if(req.url?.endsWith("/skill-runs"))res.end(JSON.stringify({id,sessionId:id,runId:run,expiresAt:new Date(Date.now()+60_000).toISOString()}));
    else if(req.url?.endsWith("/close")){res.statusCode=204;res.end();}
    else if(req.url?.endsWith("/actions/import_knowledge"))res.end(JSON.stringify({imported:["new"],skipped:["existing"],status:"pending"}));
    else res.end(JSON.stringify({saved:true}));
  });server.listen(0,"127.0.0.1");await once(server,"listening");url=`http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterEach(async()=>{await new Promise<void>((resolve,reject)=>server.close(error=>error?reject(error):resolve()));await rm(directory,{recursive:true,force:true});});
function command(name:string,platform:boolean,input?:unknown){return execute(process.execPath,[script,name,...(input?[JSON.stringify(input)]:[])],{cwd:directory,env:{...process.env,ONTOMATO_ONTOLOGY_URL:url,ONTOMATO_TK:platform?"":"user",ONTOMATO_EXECUTION_CALLBACK:platform?"session-callback":"",ONTOMATO_SESSION_ID:id,ONTOMATO_SKILL_SCENARIO:platform?"platform":"external",ONTOMATO_RUN_ID:undefined,ONTOMATO_GOVERNANCE_WINDOW_URL:url+"/window"}});}
it("platform commands get the active window using the session credential and keep only the record ID",async()=>{
  await mkdir(path.join(directory,"work"));await writeFile(path.join(directory,"work/.governance-run.json"),JSON.stringify({id,sessionId:id,runId:"old-external"}));
  const result=JSON.parse((await command("read-work-record",true)).stdout);
  expect(result).toEqual({saved:true});
  expect(JSON.parse(await readFile(path.join(directory,"work/.governance-platform-window.json"),"utf8"))).toEqual({id});
  windowRun="33333333-3333-4333-8333-333333333333";
  await command("read-work-record",true);
  const request=(path:string)=>({path,token:undefined,run:undefined,callback:"session-callback"});
  expect(calls).toEqual([
    request("/window"),request(`/ontology/ai/knowledge-governance/${id}/runs/${run}/actions/read_work_record`),
    request("/window"),request(`/ontology/ai/knowledge-governance/${id}/runs/${windowRun}/actions/read_work_record`),
  ]);
  await expect(command("close",true)).rejects.toThrow();expect(calls).toHaveLength(4);
});
it("external begin and close retain user authentication and create no platform window",async()=>{
  const begun=JSON.parse((await command("begin",false)).stdout);expect(begun.id).toBe(id);
  await command("import-knowledge",false,{items:[{id:"new",title:"New",text:"New text",sourceIds:["source"]}]});
  await command("close",false);
  expect(calls.map(call=>call.path)).toEqual(["/ontology/ai/knowledge-governance/skill-runs",`/ontology/ai/knowledge-governance/${id}/runs/${run}/actions/import_knowledge`,`/ontology/ai/knowledge-governance/${id}/skill-runs/${run}/close`]);
  expect(calls.every(call=>call.token==="user")).toBe(true);
});

it("platform knowledge import returns fields for each live form and never calls Java import",async()=>{
  const result=JSON.parse((await command("import-knowledge",true,{items:[
    {id:"new",title:"New",text:"New text",tags:["new-tag"],sourceIds:["source"]},
    {id:"existing",title:"Changed",text:"Changed text",sourceIds:["source"]},
  ]})).stdout);
  expect(calls.map(call=>call.path)).toEqual(["/admin/getBussinessKnowledge"]);
  expect(result.items).toEqual([
    {mode:"create",page:"/ontology/knowledge",form:{knowledgeTitle:"New",knowledgeText:"New text",knowledgeTags:["new-tag"],status:0}},
    {mode:"update",id:"existing",page:"/ontology/knowledge",form:{knowledgeTitle:"Changed",knowledgeText:"Changed text"}},
  ]);
});

it("platform import uses the execution callback for its business-page read without a long user key",async()=>{
 const result=JSON.parse((await command("import-knowledge",true,{items:[{id:"new",title:"Title",text:"Text",sourceIds:[]}]})).stdout);
 expect(calls).toEqual([{path:"/admin/getBussinessKnowledge",token:undefined,run:undefined,callback:"session-callback"}]);
 expect(result.items).toHaveLength(1);
 expect(JSON.stringify(result)).not.toContain("session-callback");
});

it("pending import uses the platform governance window and the execution callback", async () => {
  const { stdout } = await command("import-pending", true, {
    items: [
      { id: "new", title: "New", text: "New text", sourceIds: ["source"] },
      { id: "existing", title: "Original", text: "Old text", sourceIds: ["source"] },
    ],
  });
  expect(calls).toEqual([
    { path: "/window", token: undefined, run: undefined, callback: "session-callback" },
    { path: `/ontology/ai/knowledge-governance/${id}/runs/${run}/actions/import_knowledge`, token: undefined, run: undefined, callback: "session-callback" },
  ]);
  expect(JSON.parse(stdout)).toEqual({ imported: ["new"], skipped: ["existing"], status: "pending" });
});

it("platform work-record updates return only the saved result without a report link",async()=>{
  const result=JSON.parse((await command("update-work-record",true,{summary:"Reviewed"})).stdout);
  expect(result).toEqual({saved:true});
});
