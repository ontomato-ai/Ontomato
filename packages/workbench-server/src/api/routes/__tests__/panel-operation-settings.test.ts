import { spawn, type ChildProcess } from "node:child_process";
import { createRequire } from "node:module";
import nodePath from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import { afterAll, beforeAll, beforeEach, expect, it, vi } from "vitest";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { agentSessionRefSchema } from "@ontomato/contracts/agent-channel";
const state=vi.hoisted(()=>({runtimeUrl:"",identityUrl:"",confirm:true,query:vi.fn(),internal:[] as string[]}));
vi.mock("../../../config/environment",()=>({environment:{agentRuntime:()=>({url:state.runtimeUrl,token:"workbench-service",queryServiceToken:"query-service"})}}));
vi.mock("../../../config/data-query-api",()=>({getApiConfig:()=>({baseUrl:state.identityUrl})}));
vi.mock("../../../config/application",()=>({config:{dataQuery:{get baseUrl(){return state.identityUrl;}}}}));
vi.mock("../../../infrastructure/postgres",()=>({getPostgresPool:()=>({query:state.query}),qualifiedTable:(name:string)=>name}));
vi.mock("../../../services/assistant/skills",()=>({loadedPageSkillVersion:vi.fn(),readAssistantSkillView:vi.fn()}));
vi.mock("../../../services/skills/view",()=>({pageSkillMemberContext:vi.fn(),readSkillView:vi.fn()}));
vi.mock("../../../services/product-panels/current",()=>({readCurrentPanelRecord:vi.fn(),readCurrentProjectionRecord:vi.fn(),requireDirectPanelMember:vi.fn(),validateApplicationPanelReferences:vi.fn(),saveCurrentPanel:vi.fn(),saveCurrentProjection:vi.fn()}));
vi.mock("../../../utils/request-identity",async original=>({...await original<typeof import("../../../utils/request-identity")>(),requireDomainId:(req:{domainId:string})=>req.domainId}));
import { configureI18n } from "../../../i18n";
import { en, enLocaleMeta } from "../../../i18n/locales/en";
import { panelOperationsRouter } from "../product-panels";
import { RuntimeClient } from "../../../infrastructure/agent-runtime/client";
import { readCurrentPanelRecord, requireDirectPanelMember } from "../../../services/product-panels/current";

const sessionId="77777777-7777-4777-8777-777777777777",actorId="11111111-1111-4111-8111-111111111111";
const path=`/api/panel-operation-settings/workbench/${sessionId}`;
const servers:Server[]=[];
let hostUrl="", gateway:ChildProcess;
async function listen(app:express.Express) {
 const server=app.listen(0,"127.0.0.1");servers.push(server);
 await new Promise<void>(resolve=>server.once("listening",resolve));
 return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}
beforeAll(async()=>{
 configureI18n({defaultLocale:"en",appTextLocale:"en",languageSwitchEnabled:false,packs:{en:{messages:en,...enLocaleMeta}}});
 const actor={id:actorId,domainId:"domain"};
 const repo=nodePath.resolve(nodePath.dirname(fileURLToPath(import.meta.url)),"../../../../../..");
 gateway=spawn(process.execPath,["--import",createRequire(nodePath.join(repo,"packages/agent-runtime/package.json")).resolve("tsx"),
   nodePath.join(repo,"packages/agent-runtime/src/__tests__/fixtures/channel-gateway.ts")],{
   env:{...process.env,TEST_CHANNEL_SESSION_ID:sessionId,TEST_CHANNEL_ACTOR_ID:actorId},stdio:["ignore","pipe","pipe"],
 });
 state.runtimeUrl=await new Promise<string>((resolve,reject)=>{
   let output="",errors="";
   gateway.stdout!.on("data",chunk=>{output+=String(chunk);const ready=/GATEWAY_FIXTURE_READY (http:\/\/[^\s]+)/u.exec(output);if(ready)resolve(ready[1]);});
   gateway.stderr!.on("data",chunk=>{errors+=String(chunk);});
   gateway.once("exit",code=>reject(new Error(`Gateway fixture exited ${code}: ${errors}`)));
 });
 const identity=express();identity.use(express.json());
 identity.get("/platform/applications/resolve-entry", (req, res, next) => {
   if (req.query.applicationId !== "app-tasks") { next(); return; }
   if (req.header("tk") !== "owner") { res.sendStatus(403); return; }
   if (req.query.useId !== "tasks") { res.sendStatus(404); return; }
   res.json({ success: true, data: {
     applicationId: "app-tasks", menu: { groups: [], panelUses: [] },
     use: { id: "tasks", pageKey: "tasks", path: "/applications/app-tasks/tasks", panelId: "panel-tasks",
       access: { kind: "domain-member" } },
   } });
 });
 identity.use((req,res,next)=>{
   if(req.header("X-Ontomato-Query-Service-Token")!=="query-service"){res.status(403).json({error:{code:"FORBIDDEN",message:"Service authorization required"}});return;}
   expect(req.header("tk")).toBeUndefined();expect(req.header("X-API-Key")).toBeUndefined();
   state.internal.push(req.path);next();
 });
 // The identity service's existing gateway transport, not a mocked RuntimeClient or relaxed runtime host.
 identity.post("/platform/agent-channel/session-actor",async(req,res)=>{
   const ref=agentSessionRefSchema.parse(req.body);
   const upstream=await fetch(`${state.runtimeUrl}/v1/channel/providers/${ref.providerId}/sessions/${ref.sessionId}/actor`,{
     headers:{authorization:"Bearer ontology-service","X-Domain-Id":req.header("X-Domain-Id")!,"X-Correlation-Id":"test"},
   });
   const value=await upstream.json() as {actor:unknown};res.status(upstream.status).json(upstream.ok?value.actor:value);
 });
 identity.post("/platform/agent-channel/restore",(req,res)=>{
   expect(req.body).toEqual({actor,readOnly:true});
   res.json({userId:"owner",domainId:"domain",expiresAt:0});
 });
 state.identityUrl=await listen(identity);
 const host=express();host.use(express.json());
 host.use((req,_res,next)=>{Object.assign(req,{userId:req.header("tk") ?? "owner",domainId:req.header("X-Test-Domain") ?? "domain",token:req.header("tk"),locale:"en"});next();});
 host.use("/api",panelOperationsRouter);hostUrl=await listen(host);
});
afterAll(async()=>{
 await Promise.all(servers.map(server=>new Promise<void>((resolve,reject)=>{server.closeAllConnections();server.close(error=>error?reject(error):resolve());})));
 if(gateway?.exitCode===null)await new Promise<void>(resolve=>{gateway.once("exit",()=>resolve());gateway.kill("SIGTERM");});
});
beforeEach(()=>{
 state.confirm=true;state.internal=[];state.query.mockReset();
 state.query.mockImplementation(async(sql:string,args:unknown[])=>{
   expect(args.slice(0,4)).toEqual(["domain","owner","workbench",sessionId]);
   if(sql.startsWith("SELECT"))return {rows:[{confirm_before_execute:state.confirm}]};
   if(sql.startsWith("INSERT INTO panel_operation_settings")){state.confirm=args[4] as boolean;return {rows:[]};}
   throw new Error(sql);
 });
});
async function settings(method="GET",user="owner",domain="domain") {
 return fetch(hostUrl+path,{method,headers:{tk:user,"X-Test-Domain":domain,"Content-Type":"application/json"},...(method==="PUT"?{body:JSON.stringify({confirmBeforeExecute:false})}:{})});
}
it("keeps the real runtime gateway route closed to the deployed workbench host",async()=>{
 await expect(new RuntimeClient("domain",undefined,"owner").request(`/v1/channel/providers/workbench/sessions/${sessionId}/actor`))
   .rejects.toMatchObject({status:403,code:"FORBIDDEN",message:"The channel gateway capability is required"});
});
it("lets the actual session owner read and update settings after the root run ended",async()=>{
 let response=await settings();expect(response.status).toBe(200);
 expect(await response.json()).toEqual({rootSession:{providerId:"workbench",sessionId},confirmBeforeExecute:true});
 response=await settings("PUT");expect(response.status).toBe(200);
 expect(await response.json()).toEqual({rootSession:{providerId:"workbench",sessionId},confirmBeforeExecute:false});
 expect((await (await settings()).json()).confirmBeforeExecute).toBe(false);
 expect(state.internal).toEqual(Array.from({length:3},()=>["/platform/agent-channel/session-actor","/platform/agent-channel/restore"]).flat());
});
it.each(["GET","PUT"])("rejects a different user for %s before reading or changing settings",async method=>{
 const response=await settings(method,"viewer");expect(response.status).toBe(403);
 expect((await response.json()).error.code).toBe("FORBIDDEN");
 expect(state.query).not.toHaveBeenCalled();expect(state.confirm).toBe(true);
});
it("does not read another domain's session",async()=>{
 expect((await settings("GET","owner","another-domain")).status).toBe(404);
 expect(state.query).not.toHaveBeenCalled();
});

it("returns the server descriptor only for a current use of the authenticated reader", async () => {
 const objectType = "platform:ScheduledTask";
 const record = {
   domainId: "domain", ownerId: "owner", visibility: "domain" as const, description: "",
   revision: 1, createdAt: "2026-11-19T00:00:00Z", updatedAt: "2026-11-19T00:00:00Z", editable: true,
 };
 const task = { kind: "object" as const, objectType };
 const member = { target: { projectionId: "run" }, inputs: { task: { state: "task" } } };
 vi.mocked(readCurrentPanelRecord).mockResolvedValue({
   ...record, id: "panel-tasks", name: "Tasks", content: { html: "", module: "" },
   manifest: { state: { task: { type: task, personal: false, deepLink: false, external: false } }, members: { run: member }, events: {} },
 });
 vi.mocked(requireDirectPanelMember).mockResolvedValue({
   member,
   projection: {
     ...record, id: "run", componentId: "@ontomato/sdk:OperationButton", name: "Run now",
     inputs: { task }, outputs: {}, config: {},
     data: { operation: {
       source: { operation: { kind: "PlatformOperation", id: "schedules.runNow" } }, read: "describe", params: {},
     } },
   },
 });

 const url = hostUrl + "/api/panel-operations/descriptor?applicationId=app-tasks&operationId=run.runNow";
 const result = await fetch(url + "&useId=tasks", { headers: { tk: "owner" } });
 expect(result.status).toBe(200);
 expect(await result.json()).toMatchObject({
   handlerRef: "schedules.runNow", effect: "write", batch: false,
   target: { source: "input", input: "task" },
   inputSchema: { type: "object" }, resultSchema: { type: "object" },
 });
 expect((await fetch(url + "&useId=missing", { headers: { tk: "owner" } })).status).toBe(403);
 expect((await fetch(url + "&useId=tasks&effect=read", { headers: { tk: "owner" } })).status).toBe(400);
 expect(state.query).not.toHaveBeenCalled();
});
