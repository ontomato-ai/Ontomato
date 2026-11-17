import { afterEach, beforeEach, expect, it } from "vitest";
import { createServer, type Server } from "node:http";
import { once } from "node:events";
import type { AddressInfo } from "node:net";
import { mkdtemp, rm, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
const execute=promisify(execFile),script=path.resolve("../../agent-skills/knowledge-governance/scripts/governance.mjs");
const id="11111111-1111-4111-8111-111111111111",run="22222222-2222-4222-8222-222222222222";
let server:Server,directory:string,url:string;
let calls:Array<{path:string;token?:string;run?:string}>;
beforeEach(async()=>{
  directory=await mkdtemp(path.join(tmpdir(),"governance-skill-"));calls=[];
  server=createServer(async(req,res)=>{
    for await(const _chunk of req) { /* Consume the request before responding. */ }
    calls.push({path:req.url!,token:req.headers.tk as string,run:req.headers["x-ontomato-run-id"] as string});
    res.setHeader("content-type","application/json");
    if(req.url==="/window")res.end(JSON.stringify({id,sessionId:id,runId:run,expiresAt:new Date(Date.now()+60_000).toISOString(),token:"governance-grant"}));
    else if(req.url?.endsWith("/skill-runs"))res.end(JSON.stringify({id,sessionId:id,runId:run,expiresAt:new Date(Date.now()+60_000).toISOString()}));
    else if(req.url?.endsWith("/close")){res.statusCode=204;res.end();}
    else res.end(JSON.stringify({saved:true}));
  });server.listen(0,"127.0.0.1");await once(server,"listening");url=`http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterEach(async()=>{await new Promise<void>((resolve,reject)=>server.close(error=>error?reject(error):resolve()));await rm(directory,{recursive:true,force:true});});
function command(name:string,platform:boolean){return execute(process.execPath,[script,name],{cwd:directory,env:{...process.env,ONTOMATO_ONTOLOGY_URL:url,ONTOMATO_TK:"user",ONTOMATO_SKILL_SCENARIO:platform?"platform":"external",ONTOMATO_RUN_ID:platform?run:"",ONTOMATO_GOVERNANCE_WINDOW_URL:url+"/window",ONTOMATO_GOVERNANCE_CALLBACK:"host-callback"}});}
it("platform commands request the bound host window and use its scoped grant, never an external begin",async()=>{
  await mkdir(path.join(directory,"work"));await writeFile(path.join(directory,"work/.governance-run.json"),JSON.stringify({id,sessionId:id,runId:"old-external"}));
  expect(JSON.parse((await command("read-work-record",true)).stdout)).toEqual({saved:true});
  expect(calls).toEqual([{path:"/window",token:"host-callback",run},{path:`/ontology/ai/knowledge-governance/${id}/runs/${run}/actions/read_work_record`,token:"governance-grant",run}]);
  await expect(command("close",true)).rejects.toThrow();expect(calls).toHaveLength(2);
});
it("external begin and close retain user authentication and create no platform window",async()=>{
  const begun=JSON.parse((await command("begin",false)).stdout);expect(begun.id).toBe(id);
  await command("close",false);
  expect(calls.map(call=>call.path)).toEqual(["/ontology/ai/knowledge-governance/skill-runs",`/ontology/ai/knowledge-governance/${id}/skill-runs/${run}/close`]);
  expect(calls.every(call=>call.token==="user")).toBe(true);
});
