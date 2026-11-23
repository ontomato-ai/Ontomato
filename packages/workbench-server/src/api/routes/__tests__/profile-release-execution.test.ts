import { vuePanelContent } from "../../../__tests__/fixtures/vue-panel";
import express from "express";
import {randomUUID} from "node:crypto";
import type {Server} from "node:http";
import type {AddressInfo} from "node:net";
import {afterAll,beforeAll,beforeEach,expect,it,vi} from "vitest";
import {productAssetSchema} from "@ontomato/contracts/product-assets";
import {HttpError} from "../../../utils/errors";
import {readSseData} from "@ontomato/contracts/sse";
import {notifyProductDefinitionChanged} from "../../../services/product-panels/definition-stream";

const state=vi.hoisted(()=>({executor:"V" as string|null,use:true,visible:new Set<string>(),query:vi.fn(),post:vi.fn(),agent:vi.fn(),create:vi.fn(),bind:vi.fn()}));
vi.mock("../../../config/application",()=>({config:{dataQuery:{baseUrl:"http://ontology.test"}}}));
vi.mock("../../../config/environment",()=>({environment:{agentRuntime:()=>({queryServiceToken:"fixture-service"})}}));
vi.mock("../../../core/skills/registry/manager",()=>({skillRegistryManager:{forDomain:vi.fn()}}));
vi.mock("../../../identity/installed",()=>({requirePermission:()=> (_req:unknown,_res:unknown,next:()=>void)=>next(),workbenchIdentity:()=>({requireDomainId:(identity:{domainId:string})=>identity.domainId})}));
vi.mock("../../../utils/backend-client",async original=>({
  ...await original<typeof import("../../../utils/backend-client")>(),backendPost:state.post,
  buildBackendHeaders:(token:string,_user:unknown,_locale:unknown,apiKey:string,extra:Record<string,string>)=>({...extra,...token?{tk:token}:{},...apiKey?{"X-API-Key":apiKey}:{}}),
}));
vi.mock("../../../infrastructure/postgres",()=>({getPostgresPool:()=>({query:state.query}),qualifiedTable:(name:string)=>name}));
vi.mock("../../../services/assistant/store",()=>({assistantStore:{agent:state.agent}}));
vi.mock("../../../services/assistant/service",()=>({assistantService:{create:state.create}}));
vi.mock("../../../services/product-assets/profile-sessions",()=>({bindProfileSession:state.bind}));

import router from "../product-assets";
import { productPanelsRouter } from "../product-panels";
import {contractHash,releaseSnapshotSchema} from "../../../services/product-assets/releases";

const owner={domainId:"domain",userId:"U"},profileId="profile",agentId="definition";
const panelId = "panel-live";
const releaseId="11111111-1111-4111-8111-111111111111";
const asset=(id:string,document:unknown)=>productAssetSchema.parse({id,name:id,description:"",document,visibility:"private",ownerId:"author",revision:1,editable:false,createdAt:"now",updatedAt:"now"});
const profile=asset(profileId,{kind:"agent-profile",agentId,instructions:"",tools:[],contextViews:["org-view"]});
const view=asset("org-view",{kind:"object-projection",renders:{kind:"ObjectType",id:"org"},renderer:"text",fields:["name"]});
const object={className:"org",attrs:[{name:"id",type:"string",primaryKey:true},{name:"name",type:"string"}]};
const snapshot=releaseSnapshotSchema.parse({schemaVersion:1,roots:[profileId],assets:[profile,view],contracts:[{kind:"object-type",id:"org",contractVersion:2,
  hash:contractHash({className:"org",attributes:object.attrs.map(attribute=>({...attribute,primaryKey:attribute.primaryKey})),relationships:[]})}]});
const endpoints=[["active-profile","GET",200],["sessions","POST",201]] as const;
let server:Server,base:string;

beforeAll(async()=>{
  const app=express().use(express.json()).use((req,_res,next)=>{Object.assign(req,{...owner,token:"U-token",locale:"en"});next();});
  app.use("/api/product-assets",router);
  app.use("/api/product-panels",productPanelsRouter);
  server=app.listen(0,"127.0.0.1");await new Promise<void>(resolve=>server.once("listening",resolve));
  base=`http://127.0.0.1:${(server.address() as AddressInfo).port}/api/product-assets/${profileId}`;
});
afterAll(async()=>{server.closeAllConnections();await new Promise<void>((resolve,reject)=>server.close(error=>error?reject(error):resolve()));});
beforeEach(()=>{
  vi.clearAllMocks();state.executor="V";state.use=true;state.visible=new Set(["V"]);
  state.agent.mockImplementation(async()=>({id:agentId,enabled:true,execution_user_id:state.executor}));
  state.create.mockImplementation(async(id:string,sessionOwner:typeof owner)=>({session:{id,ownerId:sessionOwner.userId}}));
  state.query.mockImplementation(async(sql:string,args:unknown[])=>{
    if(sql.includes("NOT governance_registered")||sql.includes("product_publication_outbox"))return {rows:[]};
    if(sql.includes("product_bundle_heads"))return {rows:[{release_id:releaseId}]};
    if(sql.startsWith("SELECT snapshot"))return {rows:[{snapshot}]};
    if(sql.includes("FROM product_assets")&&sql.includes("id=$2")){
      const value=snapshot.assets.find(asset=>asset.id===args[1]);
      return {rows:[{...value,createdAt:new Date(0),updatedAt:new Date(0)}]};
    }
    const current = { domainId: owner.domainId, ownerId: "author", createdAt: new Date(0), updatedAt: new Date(0) };
    if (sql.includes("FROM product_panels")) return { rows: [{
      ...current, id: panelId, revision: 3, definition: {
        name: "Panel", description: "", visibility: "domain", content: vuePanelContent("summary"),
        manifest: { state: {}, members: { summary: { target: { projectionId: "projection-live" } } } },
      },
    }] };
    if (sql.includes("FROM product_projections")) return { rows: [{
      ...current, id: "projection-live", revision: 7, definition: {
        name: "Summary", description: "", visibility: "domain", componentId: "@ontomato/sdk:ObjectSummary",
        inputs: {}, outputs: {}, config: {}, data: {},
      },
    }] };
    if(sql.includes("product_subscriptions"))return {rows:[]};
    throw new Error(`Unexpected SQL: ${sql}`);
  });
  state.post.mockImplementation(async(name:string,_url:string,body:{userId?:string;verb?:string;executionUserId?:string},options:{headers:Record<string,string>})=>{
    if(name==="product-grant-check")return {text:JSON.stringify({allowed:true})};
    if(name==="product-grant-owner-resources")return {text:JSON.stringify({ids:body.verb==="use"&&(body.userId==="V"||state.use)?[profileId,view.id]:[]})};
    if(name==="agent-execution-resolve")return {text:JSON.stringify({executionUserId:body.executionUserId,apiKey:"V-key"})};
    if(name==="projection-object-contract"){
      const user=options.headers["X-API-Key"]==="V-key"?"V":"U";
      if(!state.visible.has(user))throw new HttpError(404,"Ontology class not found: org","ONTOLOGY_QUERY_FAILED");
      return {text:JSON.stringify({classes:[object],relationships:[]})};
    }
    throw new Error(`Unexpected backend call: ${name}`);
  });
});

async function call(path:string,method:string){
  return fetch(`${base}/${path}`,{method,headers:{"content-type":"application/json","Idempotency-Key":randomUUID()},
    ...(method==="POST"?{body:JSON.stringify({releaseId})}:{})});
}

it.each(endpoints)("checks %s dependencies as the selected executor while retaining initiator ownership",async(path,method,status)=>{
  const response=await call(path,method);
  expect(response.status).toBe(status);
  if(method==="GET")expect(await response.json()).toMatchObject({asset:{id:profileId},releaseId,issues:[]});
  else{
    expect(await response.json()).toMatchObject({session:{ownerId:"U"}});
    expect(state.create).toHaveBeenCalledWith(expect.any(String),owner,{agentId});
    expect(state.bind).toHaveBeenCalledWith(owner,expect.any(String),profileId,releaseId,[],{});
  }
  const capability=state.post.mock.calls.find(([name])=>name==="projection-object-contract")!;
  expect(capability[3].headers).toMatchObject({"X-API-Key":"V-key"});
  expect(capability[3].headers).not.toHaveProperty("tk");
  expect(state.post.mock.calls.filter(([name])=>name==="product-grant-owner-resources").every(([, ,body])=>body.userId==="U")).toBe(true);
});

it.each(endpoints)("still rejects %s when U has no Profile use even though V does",async(path,method)=>{
  state.use=false;
  const response=await call(path,method);
  expect(response.status).toBe(403);
  expect(await response.json()).toMatchObject({error:{code:"PRODUCT_FORBIDDEN"}});
  expect(state.post.mock.calls.some(([name])=>name==="agent-execution-resolve"||name==="projection-object-contract")).toBe(false);
  expect(state.create).not.toHaveBeenCalled();expect(state.bind).not.toHaveBeenCalled();
});

it.each(endpoints)("keeps %s in self mode on U credentials without resolving a shared key",async(path,method,status)=>{
  state.executor=null;state.visible=new Set(["U"]);
  const response=await call(path,method);
  expect(response.status).toBe(status);
  const capability=state.post.mock.calls.find(([name])=>name==="projection-object-contract")!;
  expect(capability[3].headers).toMatchObject({tk:"U-token"});
  expect(capability[3].headers).not.toHaveProperty("X-API-Key");
  expect(state.post.mock.calls.some(([name])=>name==="agent-execution-resolve")).toBe(false);
});

it.each(endpoints)("preserves %s dependency denial when self-mode U cannot access the ontology class",async(path,method)=>{
  state.executor=null;
  const response=await call(path,method);
  expect(response.status).toBe(404);
  expect(await response.json()).toMatchObject({error:{code:"ONTOLOGY_QUERY_FAILED"}});
  expect(state.create).not.toHaveBeenCalled();
});

it("reads panel and referenced projection revisions under their use grants without opening a stream", async () => {
  const response = await fetch(new URL(`/api/product-panels/${panelId}/snapshot`, base));
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({
    panel: { id: panelId, revision: 3 },
    projections: [{ id: "projection-live", revision: 7 }],
    members: [{ status: "ready", memberPath: [{ member: "summary" }], target: { kind: "projection", id: "projection-live" }, revision: 7 }],
  });
  expect(state.post.mock.calls.filter(([name]) => name === "product-grant-check")).toHaveLength(2);
});

it("delivers live projection-only author notices while its snapshot is still reading", async () => {
  const connection = new AbortController();
  const id = "projection-live";
  let revision = 7;
  let reads = 0;
  let finishSnapshot!: () => void;
  const held = new Promise<void>(resolve => { finishSnapshot = resolve; });
  const query = state.query.getMockImplementation()!;
  state.query.mockImplementation(async (sql: string, args: unknown[]) => {
    if (!sql.includes("FROM product_projections")) return query(sql, args);
    const row = { id, revision };
    if (++reads === 2) await held;
    return { rows: [row] };
  });
  try {
    const response = await fetch(new URL("/api/product-panels/definition-stream", base), {
      method: "POST", signal: connection.signal, headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ targets: [{ kind: "projection", id }] }),
    });
    expect(response.status).toBe(200);
    const received: unknown[] = [];
    const reading = readSseData(response, frame => { received.push(frame); return received.length === 2; }, () => true);
    await vi.waitFor(() => expect(reads).toBe(2));
    revision = 8;
    await notifyProductDefinitionChanged({
      kind: "definition-changed", domainId: owner.domainId, target: { kind: "projection", id },
    });
    await vi.waitFor(() => expect(received).toEqual([
      { kind: "definition-changed", definition: { kind: "projection", id, revision: 8 } },
    ]));
    finishSnapshot();
    await reading;
    expect(received[1]).toEqual({ kind: "snapshot", definitions: [{ kind: "projection", id, revision: 7 }] });
  } finally {
    finishSnapshot();
    connection.abort();
  }
});

it("retires the single-panel subscription request", async () => {
  const response = await fetch(new URL("../subscriptions", `${base}/`), {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ kind: "product-definition", target: { kind: "panel", id: panelId } }),
  });
  expect(response.status).toBe(400);
});
