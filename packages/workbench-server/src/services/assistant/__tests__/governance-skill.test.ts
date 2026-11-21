import { draftTarget, pageDraftSchema, pageDraftPathSchema } from "@ontomato/contracts/page-draft";
import { afterEach, beforeEach, expect, it } from "vitest";
import { createServer, type Server } from "node:http";
import { once } from "node:events";
import type { AddressInfo } from "node:net";
import { mkdtemp, rm, mkdir, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
const execute=promisify(execFile),script=path.resolve("../../agent-skills/knowledge-governance/scripts/governance.mjs");
const id="11111111-1111-4111-8111-111111111111",run="22222222-2222-4222-8222-222222222222";
let server:Server,directory:string,url:string;
let calls:Array<{path:string;token?:string;run?:string;callback?:string}>;
beforeEach(async()=>{
  directory=await mkdtemp(path.join(tmpdir(),"governance-skill-"));calls=[];
  server=createServer(async(req,res)=>{
    for await(const _chunk of req) { /* Consume the request before responding. */ }
    calls.push({path:req.url!,token:req.headers.tk as string,run:req.headers["x-ontomato-run-id"] as string,...(req.headers["x-ontomato-callback-credential"]?{callback:req.headers["x-ontomato-callback-credential"] as string}:{})});
    res.setHeader("content-type","application/json");
    if(req.url==="/admin/getBussinessKnowledge")res.end(JSON.stringify({success:true,data:{existing:{knowledgeID:"existing",knowledgeTitle:"Original",knowledgeText:"Old text",knowledgeTags:["retained"],status:1}}}));
    else if(req.url==="/window")res.end(JSON.stringify({id,sessionId:id,runId:run,expiresAt:new Date(Date.now()+60_000).toISOString(),token:"governance-grant"}));
    else if(req.url?.endsWith("/skill-runs"))res.end(JSON.stringify({id,sessionId:id,runId:run,expiresAt:new Date(Date.now()+60_000).toISOString()}));
    else if(req.url?.endsWith("/close")){res.statusCode=204;res.end();}
    else res.end(JSON.stringify({saved:true}));
  });server.listen(0,"127.0.0.1");await once(server,"listening");url=`http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterEach(async()=>{await new Promise<void>((resolve,reject)=>server.close(error=>error?reject(error):resolve()));await rm(directory,{recursive:true,force:true});});
function command(name:string,platform:boolean,input?:unknown,selected=false){return execute(process.execPath,[script,name,...(input?[JSON.stringify(input)]:[])],{cwd:directory,env:{...process.env,ONTOMATO_ONTOLOGY_URL:url,ONTOMATO_TK:selected?"":"user",ONTOMATO_EXECUTION_CALLBACK:selected?"executor-callback":"",ONTOMATO_SESSION_ID:id,ONTOMATO_SKILL_SCENARIO:platform?"platform":"external",ONTOMATO_RUN_ID:platform?run:"",ONTOMATO_GOVERNANCE_WINDOW_URL:url+"/window",ONTOMATO_GOVERNANCE_CALLBACK:"host-callback"}});}
it("platform commands request the bound host window and use its scoped grant, never an external begin",async()=>{
  await mkdir(path.join(directory,"work"));await writeFile(path.join(directory,"work/.governance-run.json"),JSON.stringify({id,sessionId:id,runId:"old-external"}));
  const result=JSON.parse((await command("read-work-record",true)).stdout);
  expect(result).toEqual({saved:true});
  expect(calls).toEqual([{path:"/window",token:"host-callback",run},{path:`/ontology/ai/knowledge-governance/${id}/runs/${run}/actions/read_work_record`,token:"governance-grant",run}]);
  await expect(command("close",true)).rejects.toThrow();expect(calls).toHaveLength(2);
});
it("external begin and close retain user authentication and create no platform window",async()=>{
  const begun=JSON.parse((await command("begin",false)).stdout);expect(begun.id).toBe(id);
  await command("import-knowledge",false,{items:[{id:"new",title:"New",text:"New text",sourceIds:["source"]}]});
  await command("close",false);
  expect(calls.map(call=>call.path)).toEqual(["/ontology/ai/knowledge-governance/skill-runs",`/ontology/ai/knowledge-governance/${id}/runs/${run}/actions/import_knowledge`,`/ontology/ai/knowledge-governance/${id}/skill-runs/${run}/close`]);
  expect(calls.every(call=>call.token==="user")).toBe(true);
});

it("platform knowledge import emits separate original-page forms and never calls Java import",async()=>{
  const result=JSON.parse((await command("import-knowledge",true,{items:[
    {id:"new",title:"New",text:"New text",tags:["new-tag"],sourceIds:["source"]},
    {id:"existing",title:"Changed",text:"Changed text",sourceIds:["source"]},
  ]})).stdout);
  expect(calls.map(call=>call.path)).toEqual(["/admin/getBussinessKnowledge"]);
  const drafts=await Promise.all(result.drafts.map(async(entry:{path:string;link:string})=>{
    const target=/^\[[\s\S]+\]\((#\/ontology\/knowledge\?.*)\)$/.exec(entry.link);
    expect(target).not.toBeNull();
    pageDraftPathSchema.parse(entry.path);
    const link=new URL(target![1].slice(1),"http://platform");
    expect(link.pathname).toBe("/ontology/knowledge");
    expect(link.searchParams.get("draftSessionId")).toBe(id);expect(link.searchParams.get("draftRunId")).toBe(run);
    expect(link.searchParams.get("draftPath")).toBe(entry.path);
    return pageDraftSchema.parse(JSON.parse(await readFile(path.join(directory,entry.path),"utf8")));
  }));
  expect(drafts).toEqual([
    {pageKey:"business-knowledge",operation:"knowledge.create",target:{objectType:"platform:BusinessKnowledge"},form:{knowledgeTitle:"New",knowledgeText:"New text",knowledgeTags:["new-tag"],status:0}},
    {pageKey:"business-knowledge",operation:"knowledge.update",target:{objectType:"platform:BusinessKnowledge",id:"existing"},form:{knowledgeTitle:"Changed",knowledgeText:"Changed text",knowledgeTags:["retained"],status:1}},
  ]);
  expect(new Set(result.drafts.map((entry:{path:string})=>entry.path)).size).toBe(2);
  // The draft decides create or update before it exists; its own operation and target must agree with what a page
  // derives from the draft it reads, so changing either side alone breaks here.
  // A drafted new item stays pending for review, and names no id in its form: the target says it is a create.
  const created=drafts.find((draft)=>draftTarget(draft).kind==="create")!;
  expect((created.form as Record<string,unknown>).status).toBe(0);
  expect("knowledgeID" in (created.form as Record<string,unknown>)).toBe(false);
  const kinds=drafts.map((draft)=>({derived:draftTarget(draft).kind,operation:draft.operation}));
  expect(kinds).toEqual([{derived:"create",operation:"knowledge.create"},{derived:"update",operation:"knowledge.update"}]);
});

it("platform import uses the execution callback for its business-page read without a long user key",async()=>{
 const result=JSON.parse((await command("import-knowledge",true,{items:[{id:"new",title:"Title",text:"Text",sourceIds:[]}]},true)).stdout);
 expect(calls).toEqual([{path:"/admin/getBussinessKnowledge",token:"",run,callback:"executor-callback"}]);
 expect(result.drafts).toHaveLength(1);
 expect(await readFile(path.join(directory,result.drafts[0].path),"utf8")).not.toContain("executor-callback");
});

it("platform work-record updates return only the saved result without a report link",async()=>{
  const result=JSON.parse((await command("update-work-record",true,{summary:"Reviewed"})).stdout);
  expect(result).toEqual({saved:true});
});
