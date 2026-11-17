import express from "express";
import {createServer} from "node:http";
import {beforeEach,afterEach,expect,it,vi} from "vitest";
const mocks=vi.hoisted(()=>({prepare:vi.fn()}));
vi.mock("../../../services/charts/import",()=>({prepareChartImport:mocks.prepare}));
vi.mock("../../../identity/installed",()=>({workbenchIdentity:()=>({requireDomainId:(identity:{domainId:string})=>identity.domainId})}));
import router from "../chart-import";
import {HttpError} from "../../../utils/errors";
let server:ReturnType<typeof createServer>,base:string;
const source={sessionId:"00000000-0000-4000-8000-000000000001",runId:"00000000-0000-4000-8000-000000000002",artifactId:"00000000-0000-4000-8000-000000000003"};
beforeEach(async()=>{
  vi.resetAllMocks();
  const app=express();app.use(express.json());app.use((req,_res,next)=>{Object.assign(req,{domainId:"domain",userId:"reader",token:"caller"});next();});app.use("/api/assistant/charts",router);
  server=createServer(app);await new Promise<void>(resolve=>server.listen(0,"127.0.0.1",resolve));
  base=`http://127.0.0.1:${(server.address() as import("node:net").AddressInfo).port}`;
});
afterEach(async()=>{await new Promise<void>(resolve=>server.close(()=>resolve()));});
function post(body:unknown){return fetch(`${base}/api/assistant/charts/prepare-import`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(body)});}
it("uses the authenticated identity and retains import issue paths at the HTTP boundary",async()=>{
  mocks.prepare.mockRejectedValue(new HttpError(422,"Missing column","CARD_OUTPUT_MISMATCH",{missingColumns:["amount"],issues:[{path:["series",0,"encode","y"]}]}));
  const response=await post(source);
  expect(response.status).toBe(422);
  expect(await response.json()).toMatchObject({code:"CARD_OUTPUT_MISMATCH",details:{missingColumns:["amount"],issues:[{path:["series",0,"encode","y"]}]}});
  expect(mocks.prepare).toHaveBeenCalledWith({domainId:"domain",userId:"reader"},expect.objectContaining({token:"caller"}),source);
});
it("reports request paths and rejects identity overrides before importing",async()=>{
  const response=await post({...source,domainId:"other"});
  expect(response.status).toBe(400);
  expect(await response.json()).toMatchObject({code:"INVALID_REQUEST",details:{issues:expect.arrayContaining([expect.objectContaining({code:"unrecognized_keys",keys:["domainId"]})])}});
  expect(mocks.prepare).not.toHaveBeenCalled();
});
